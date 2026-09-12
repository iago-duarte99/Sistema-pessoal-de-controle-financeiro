import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { pool, transaction } from '../src/config/database.js';
import { app } from '../src/app.js';
import { migrateUser, readState, hash } from '../src/services/relational.js';
import { auditMigration } from '../src/services/migrationAudit.js';

test('normalização relacional em MySQL isolado',{skip:process.env.MYSQL_INTEGRATION!=='1'},async t=>{
  assert.match(process.env.DB_NAME,/_test$/);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api`;
  async function request(path,token,method='GET',body,status=200){
    const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=response.status===204?null:await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(result)}`);return result;
  }
  const register=async name=>request('/auth/register',null,'POST',{nome:name,email:name+'@example.test',senha:'Test-secret-123!'},201);
  const legacy={investments:[{id:9000000000001,name:'Reserva',balance:'1000.10',contribution:'90.25',note:'  Observação  '},{id:22,name:'Educação',balance:'20.00',contribution:0,note:''}],goals:[{id:99,name:'Objetivo',target:'2000.00',current:'100.00',deadline:'2028-02-29',action:'Poupar'}],notes:'  Notas com espaços\n\n e acentuação.  '};
  let user,other,investment;
  try{
    user=await register('relacional');other=await register('relacional-outro');
    await pool.execute('INSERT INTO app_estado(usuario_id,dados,versao) VALUES(?,?,7)',[user.user.id,JSON.stringify(legacy)]);
    await t.test('fallback é leitura pura; escrita relacional aguarda migração',async()=>{
      const before=await request('/estado',user.token);assert.equal(before.armazenamento,'legado');assert.equal(before.dados.notes,legacy.notes);
      await request('/investimentos',user.token,'POST',{nome:'Não inserir',saldo_atual:0},409);
      const [r]=await pool.execute('SELECT * FROM app_estado_migracoes WHERE usuario_id=?',[user.user.id]);assert.equal(r.length,0);
    });
    await t.test('migra 2 investimentos, 1 aporte, 1 meta e 1 nota, preservando JSON',async()=>{
      const [before]=await pool.execute('SELECT CAST(dados AS CHAR) original FROM app_estado WHERE usuario_id=?',[user.user.id]);
      const result=await transaction(db=>migrateUser(db,user.user.id));assert.deepEqual(result.contagens,{investimentos:2,aportes:1,metas:1,notas:1});assert.equal(result.ativo,true);
      const [after]=await pool.execute('SELECT CAST(dados AS CHAR) original FROM app_estado WHERE usuario_id=?',[user.user.id]);assert.equal(after[0].original,before[0].original);
      const [receipt]=await pool.execute('SELECT * FROM app_estado_migracoes WHERE usuario_id=?',[user.user.id]);assert.equal(receipt[0].original,before[0].original);assert.equal(receipt[0].checksum,hash(before[0].original));
      const state=await request('/estado',user.token);assert.equal(state.armazenamento,'relacional');assert.equal(state.dados.notes,legacy.notes);assert.equal(state.versao,7);
      investment=(await request('/investimentos',user.token))[0];assert.equal(Number(investment.legado_id),legacy.investments[0].id);
      assert.equal((await request('/investimentos/'+investment.id+'/aportes',user.token))[0].tipo,'planejado');
    });
    await t.test('reexecução idempotente, auditoria somente leitura e sem divergência deste usuário',async()=>{
      assert.equal((await transaction(db=>migrateUser(db,user.user.id))).repetida,true);
      assert.equal((await request('/investimentos',user.token)).length,2);
      const report=await transaction(auditMigration);
      assert.equal(report.divergencias.some(x=>x.usuario===user.user.id),false);
      assert.ok(report.investimentos_migrados>=2);assert.ok(report.metas_migradas>=1);
      const [rows]=await pool.execute('SELECT versao FROM app_estado WHERE usuario_id=?',[user.user.id]);assert.equal(rows[0].versao,7);
    });
    await t.test('falha no meio da migração desfaz destino e recibo',async()=>{
      const u=await register('relacional-falha');await pool.execute('INSERT INTO app_estado(usuario_id,dados,versao) VALUES(?,?,1)',[u.user.id,JSON.stringify(legacy)]);
      await assert.rejects(transaction(db=>migrateUser({execute(sql,args){if(sql.startsWith('INSERT INTO metas'))throw new Error('Falha simulada');return db.execute(sql,args);}},u.user.id)),/Falha simulada/);
      for(const table of ['investimentos','aportes','metas','notas','app_estado_migracoes']){const [r]=await pool.execute(`SELECT * FROM ${table} WHERE usuario_id=?`,[u.user.id]);assert.equal(r.length,0);}
      const [r]=await pool.execute('SELECT dados FROM app_estado WHERE usuario_id=?',[u.user.id]);assert.equal(r.length,1);
    });
    await t.test('registros inválidos são registrados, válidos copiados sem ativação',async()=>{
      const u=await register('relacional-invalido');const data={...legacy,goals:[{id:1,name:'Inválida',target:-1}]};await pool.execute('INSERT INTO app_estado(usuario_id,dados) VALUES(?,?)',[u.user.id,JSON.stringify(data)]);
      const result=await transaction(db=>migrateUser(db,u.user.id));assert.equal(result.ativo,false);assert.equal(result.rejeitados.length,1);assert.equal(result.contagens.investimentos,2);
      const [rows]=await pool.execute('SELECT dados FROM app_estado WHERE usuario_id=?',[u.user.id]);assert.deepEqual(typeof rows[0].dados==='string'?JSON.parse(rows[0].dados):rows[0].dados,data);
    });
    await t.test('CRUD investimento, aporte planejado/realizado, edição, exclusão e cálculo por período',async()=>{
      const x=await request('/investimentos',other.token,'POST',{nome:'Novo',saldo_atual:100,proximo_aporte:20,data_aporte:'2026-09-01'},201);
      await request('/investimentos/'+x.id,other.token);
      await request('/investimentos/'+x.id,other.token,'PUT',{nome:'Editado',saldo_atual:100,ativo:true});
      const a=await request('/investimentos/'+x.id+'/aportes',other.token,'POST',{tipo:'realizado',valor:50,data_realizada:'2026-08-01'},201);
      assert.equal(Number((await request('/investimentos/'+x.id,other.token)).saldo_atual),150);
      await request('/aportes/'+a.id,other.token,'PUT',{tipo:'realizado',valor:60,data_realizada:'2026-08-01'});
      assert.equal(Number((await request('/investimentos/'+x.id,other.token)).saldo_atual),160);
      const summary=await request(`/usuarios/${other.user.id}/resumo?data_inicio=2026-09-01&data_fim=2026-09-30`,other.token);
      assert.equal(Number(summary.patrimonio),160);assert.equal(Number(summary.aportes_planejados),20);assert.equal(Number(summary.patrimonio_apos_aportes),180);assert.equal(Number(summary.saldo_livre),-20);
      const october=await request(`/usuarios/${other.user.id}/resumo?data_inicio=2026-10-01&data_fim=2026-10-31`,other.token);assert.equal(Number(october.aportes_planejados),0);
      await request('/aportes/'+a.id,other.token,'DELETE',null,204);assert.equal(Number((await request('/investimentos/'+x.id,other.token)).saldo_atual),100);
      await request('/investimentos/'+x.id,other.token,'PUT',{nome:'Inativo',saldo_atual:100,ativo:false});assert.equal(Number((await request(`/usuarios/${other.user.id}/resumo`,other.token)).patrimonio),0);
      await request('/investimentos/'+x.id,other.token,'DELETE',null,204);await request('/investimentos/'+x.id,other.token,'GET',null,404);
    });
    await t.test('CRUD metas/notas, isolamento e ausência de ressurreição após excluir',async()=>{
      for(const [path,body,changed] of [['metas',{nome:'Meta nova',valor_meta:200,valor_atual:50},{nome:'Meta alterada',valor_meta:200,valor_atual:100,status:'concluida'}],['notas',{titulo:'Título',conteudo:'Nota nova'},{titulo:'Título novo',conteudo:'Conteúdo novo'}]]){
        const item=await request('/'+path,user.token,'POST',body,201);
        await request('/'+path+'/'+item.id,other.token,'PUT',changed,404);await request('/'+path+'/'+item.id,other.token,'DELETE',null,404);
        const updated=await request('/'+path+'/'+item.id,user.token,'PUT',changed);assert.equal(path==='metas'?Number(updated.valor_atual):updated.conteudo,path==='metas'?100:'Conteúdo novo');
        await request('/'+path+'/'+item.id,user.token,'DELETE',null,204);
      }
      await request('/investimentos/'+investment.id,other.token,'GET',null,404);
      await request('/investimentos/'+investment.id+'/aportes',other.token,'POST',{valor:10,tipo:'planejado'},404);
      await request('/metas',other.token,'POST',{usuario_id:user.user.id,nome:'x',valor_meta:100,valor_atual:0},403);
      for(const n of await request('/notas',user.token))await request('/notas/'+n.id,user.token,'DELETE',null,204);
      assert.equal((await request('/estado',user.token)).dados.notes,'');
      await request('/estado',user.token,'PUT',{versao:7,dados:legacy},409);
    });
    await t.test('rollback operacional preserva ambos os lados e bloqueia escrita legada',async()=>{
      await pool.execute('UPDATE app_estado_migracoes SET ativo=0 WHERE usuario_id=?',[user.user.id]);
      assert.equal((await transaction(db=>readState(db,user.user.id))).dados.notes,legacy.notes);
      await request('/estado',user.token,'PUT',{versao:7,dados:legacy},409);
      await pool.execute('UPDATE app_estado_migracoes SET ativo=1 WHERE usuario_id=?',[user.user.id]);
      assert.equal((await request('/estado',user.token)).dados.notes,'');
    });
    await t.test('importação confirma, valida, ignora duplicados entre arquivos e não duplica em concorrência',async()=>{
      const account=await request('/contas',other.token,'POST',{nome:'Import conta',tipo:'corrente',saldo_inicial:0},201);
      await request('/categorias',other.token,'POST',{nome:'Import categoria',tipo:'receita'},201);
      const row={tipo:'receita',descricao:'Import receita',valor:'10.00',data:'2026-09-01',categoria:'Import categoria',conta:account.nome,status:'realizado'};
      await request('/importacao',other.token,'POST',{registros:[row]},400);
      const body={confirmado:true,registros:[row,row,{...row,valor:-1}]};
      const results=await Promise.all([request('/importacao',other.token,'POST',body),request('/importacao',other.token,'POST',body)]);
      assert.ok(results.some(x=>x.repetida));assert.equal(results[0].importados,1);assert.equal(results[0].ignorados,1);assert.equal(results[0].rejeitados,1);
      const next=await request('/importacao',other.token,'POST',{confirmado:true,registros:[row]});assert.equal(next.importados,0);assert.equal(next.ignorados,1);
      assert.equal((await request('/transacoes',other.token)).filter(x=>x.descricao===row.descricao).length,1);
      assert.equal((await request('/importacao/contexto',user.token)).accounts.some(x=>x.id===account.id),false);
    });
    await t.test('migrations SQL são reaplicáveis e não contêm operações destrutivas',async()=>{
      for(const file of ['004_investimentos','005_metas','006_notas','007_migracao_app_estado']){
        const sql=await readFile(new URL('../sql/'+file+'.sql',import.meta.url),'utf8');assert.doesNotMatch(sql,/\b(DROP|TRUNCATE)\b/i);
        // A conta da API não deve ter DDL: reexecução é verificada pelo runner administrador.
        assert.match(sql,/CREATE TABLE IF NOT EXISTS/);
      }
    });
  }finally{await new Promise(r=>server.close(r));await pool.end();}
});
