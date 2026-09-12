import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { JSDOM, VirtualConsole } from 'jsdom';
import { webcrypto } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { pool } from '../src/config/database.js';
import { checkSchema } from '../services-schema.js';

test('API e frontend contra MySQL real isolado',{skip:process.env.MYSQL_INTEGRATION!=='1'},async t=>{
  assert.match(process.env.DB_NAME,/_test$/,'Use apenas banco de teste.');
  await checkSchema();
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const password='Teste-forte-123!';
  async function request(path,{token,method='GET',body,status=200}={}){
    const r=await fetch(base+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const payload=r.status===204?null:await r.json();
    assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(payload)}`);
    assert.ok(!JSON.stringify(payload).includes('senha_hash'),'Hash não deve aparecer nas respostas');
    return payload;
  }
  let admin,user,other,account,category,revenueCategory,expense,income;
  try{
    await t.test('conexão, cadastro, hash e login',async()=>{
      await request('/health');
      admin=await request('/auth/register',{method:'POST',body:{nome:'Administrador teste',email:'admin-test@example.test',senha:password},status:201});
      assert.equal(admin.user.role,'admin');
      user=await request('/auth/register',{method:'POST',body:{nome:'Usuário teste',email:'user-test@example.test',senha:password,role:'admin'},status:201});
      assert.equal(user.user.role,'user');
      other=await request('/usuarios',{token:admin.token,method:'POST',body:{nome:'Outro teste',email:'other-test@example.test',senha:password,role:'user'},status:201});
      other=await request('/auth/login',{method:'POST',body:{email:other.email,senha:password}});
      const [rows]=await pool.execute('SELECT senha_hash FROM usuarios WHERE id=?',[user.user.id]);
      assert.ok(await bcrypt.compare(password,rows[0].senha_hash));
      await request('/auth/login',{method:'POST',body:{email:user.user.email,senha:'Senha-incorreta'},status:401});
    });
    await t.test('usuários: leitura e controle de perfis',async()=>{
      assert.equal((await request('/usuarios',{token:admin.token})).length,3);
      assert.equal((await request('/usuarios',{token:user.token})).length,1);
      await request('/usuarios/'+user.user.id,{token:user.token});
      await request('/usuarios/'+other.user.id,{token:user.token,status:403});
      await request('/usuarios',{token:user.token,method:'POST',body:{},status:403});
      await request('/usuarios/'+user.user.id,{token:user.token,method:'PUT',body:{nome:'Teste editado',email:user.user.email,role:'admin'},status:403});
    });
    await t.test('criar contas e categorias com validação',async()=>{
      account=await request('/contas',{token:user.token,method:'POST',body:{nome:'Conta teste',tipo:'corrente',saldo_inicial:'1000.00'},status:201});
      category=await request('/categorias',{token:user.token,method:'POST',body:{nome:'Alimentação',tipo:'despesa'},status:201});
      revenueCategory=await request('/categorias',{token:user.token,method:'POST',body:{nome:'Salário',tipo:'receita'},status:201});
      await request('/contas/'+account.id,{token:user.token});await request('/categorias/'+category.id,{token:user.token});
      await request('/categorias',{token:user.token,method:'POST',body:{nome:'Inválida',tipo:'outro'},status:400});
    });
    const transactionBody=()=>({conta_id:account.id,categoria_id:category.id,descricao:'Mercado',valor:'150.00',tipo:'despesa',data_transacao:'2026-09-04',valor_previsto:'200.00'});
    await t.test('receita, despesa, saldo exato e resumo',async()=>{
      income=await request('/transacoes',{token:user.token,method:'POST',body:{...transactionBody(),categoria_id:revenueCategory.id,tipo:'receita',descricao:'Salário',valor:'500.00'},status:201});
      expense=await request('/transacoes',{token:user.token,method:'POST',body:transactionBody(),status:201});
      const saldo=await request('/contas/'+account.id+'/saldo',{token:user.token});assert.equal(Number(saldo.saldo_atual),1350);
      const resumo=await request(`/usuarios/${user.user.id}/resumo?data_inicio=2026-09-01&data_fim=2026-09-30`,{token:user.token});
      assert.equal(Number(resumo.saldo_total),1350);assert.equal(Number(resumo.receitas),500);assert.equal(Number(resumo.despesas),150);assert.equal(Number(resumo.saldo_periodo),350);assert.equal(resumo.quantidade_transacoes,2);assert.equal(resumo.despesas_por_categoria[0].nome,'Alimentação');
    });
    await t.test('consultas, filtros combinados e datas inválidas',async()=>{
      assert.equal((await request(`/transacoes?usuario_id=${user.user.id}&tipo=despesa&categoria_id=${category.id}&conta_id=${account.id}&data_inicio=2026-09-04&data_fim=2026-09-04`,{token:user.token})).length,1);
      assert.equal((await request('/transacoes?data_inicio=2026-10-01',{token:user.token})).length,0);
      for(const resource of ['contas','categorias','transacoes'])assert.ok((await request(`/usuarios/${user.user.id}/${resource}`,{token:user.token})).length);
      await request('/transacoes?data_inicio=2026-09-30&data_fim=2026-09-01',{token:user.token,status:400});
      for(const body of [{valor:0},{valor:-1},{valor:'1.001'},{data_transacao:'2026-02-30'},{categoria_id:revenueCategory.id},{conta_id:2147483647},{tipo:'outro'}])await request('/transacoes',{token:user.token,method:'POST',body:{...transactionBody(),...body},status:400});
      await request('/transacoes?categoria_id=1%20OR%201=1',{token:user.token,status:400});
    });
    await t.test('isolamento financeiro inclusive administradores',async()=>{
      for(const token of [other.token,admin.token]){
        await request('/contas/'+account.id,{token,status:404});
        await request('/contas/'+account.id+'/saldo',{token,status:404});
        await request('/transacoes/'+expense.id,{token,status:404});
        await request('/transacoes?usuario_id='+user.user.id,{token,status:403});
        await request('/usuarios/'+user.user.id+'/resumo',{token,status:403});
        await request('/transacoes',{token,method:'POST',body:transactionBody(),status:400});
        await request('/transacoes/'+expense.id,{token,method:'PUT',body:transactionBody(),status:404});
        await request('/transacoes/'+expense.id,{token,method:'DELETE',status:404});
      }
      assert.equal((await request('/transacoes',{token:other.token})).length,0);
    });
    await t.test('edição, vínculos, exclusão e saldo recalculado',async()=>{
      await request('/transacoes/'+expense.id,{token:user.token,method:'PUT',body:{...transactionBody(),valor:175}});
      assert.equal(Number((await request('/contas/'+account.id+'/saldo',{token:user.token})).saldo_atual),1325);
      await request('/categorias/'+category.id,{token:user.token,method:'PUT',body:{nome:'Alimentação',tipo:'receita'},status:409});
      await request('/contas/'+account.id,{token:user.token,method:'DELETE',status:409});
      await request('/categorias/'+category.id,{token:user.token,method:'DELETE',status:409});
      await request('/transacoes/'+expense.id,{token:user.token,method:'DELETE',status:204});
      assert.equal(Number((await request('/contas/'+account.id+'/saldo',{token:user.token})).saldo_atual),1500);
    });
    await t.test('planejamento com realizado zero e conversões atômicas',async()=>{
      const plan=await request('/planejamentos',{token:user.token,method:'POST',body:{descricao:'Planejada',categoria:'Alimentação',valor_previsto:200,data_planejada:'2026-09-04'},status:201});
      const realized=await request('/transacoes',{token:user.token,method:'POST',body:{...transactionBody(),planejamento_id:plan.id},status:201});
      assert.equal((await request('/planejamentos',{token:user.token})).length,0);
      await request('/transacoes',{token:user.token,method:'POST',body:{...transactionBody(),planejamento_id:plan.id},status:409});
      await request('/transacoes/'+realized.id,{token:user.token,method:'PUT',body:{converter_planejamento:true,descricao:'Planejada',categoria:'Alimentação',valor_previsto:200,data_planejada:'2026-09-04'}});
      assert.equal(Number((await request('/contas/'+account.id+'/saldo',{token:user.token})).saldo_atual),1500);
      assert.equal((await request('/planejamentos',{token:user.token})).length,1);
    });
    await t.test('investimentos, metas, notas e conflito de versão',async()=>{
      const dados={investments:[{id:1,name:'Reserva',balance:1000,contribution:100,note:'Reserva'}],goals:[{id:1,name:'Meta',current:1000,target:2000,deadline:'2027-12-01',action:'Poupar'}],notes:'Notas de teste'};
      await request('/estado',{token:user.token,method:'PUT',body:{dados,versao:0}});
      await request('/estado',{token:user.token,method:'PUT',body:{dados,versao:0},status:409});
      assert.equal((await request('/estado',{token:user.token})).dados.notes,'Notas de teste');
      assert.equal((await request('/estado',{token:other.token})).dados.notes,'');
    });
    await t.test('migração confirmada, idempotência, saldo preservado e rollback',async()=>{
      const legacy=await request('/auth/register',{method:'POST',body:{nome:'Legado',email:'legacy-test@example.test',senha:password},status:201});
      const body={origem:'controleFinanceiroDataV2:uuid-teste',data_referencia:'2026-09-04',dados:{income:500,accounts:[{id:1,name:'Antiga',value:1000}],expenses:[{id:1,category:'Mercado',description:'Despesa',planned:200,actual:150},{id:2,category:'Casa',description:'Planejada',planned:100,actual:0}],investments:[],goals:[],notes:'Legado preservado'}};
      const first=await request('/migracoes/localstorage',{token:legacy.token,method:'POST',body,status:201});
      assert.equal(first.contagens.transacoes,2);
      assert.equal((await request('/migracoes/localstorage',{token:legacy.token,method:'POST',body})).repetida,true);
      assert.equal(Number((await request('/usuarios/'+legacy.user.id+'/resumo',{token:legacy.token})).saldo_total),1000);
      assert.equal((await request('/migracoes/localstorage',{token:legacy.token}))[0].checksum,first.checksum);
      await request('/migracoes/localstorage',{token:legacy.token,method:'POST',body:{...body,data_referencia:'2026-09-05'},status:409});
      await request('/migracoes/localstorage',{token:other.token,method:'POST',body:{...body,dados:{...body.dados,expenses:[{category:'Erro',description:'Erro',planned:1,actual:-1}]}},status:400});
      assert.equal((await request('/contas',{token:other.token})).length,0);
    });
    await t.test('frontend real: login, formulários, dashboard, busca e cancelamento',async()=>{
      const ui=await request('/auth/register',{method:'POST',body:{nome:'Interface',email:'ui-test@example.test',senha:password},status:201});
      const a=await request('/contas',{token:ui.token,method:'POST',body:{nome:'Conta UI',tipo:'corrente',saldo_inicial:1000},status:201});
      const virtualConsole=new VirtualConsole();const errors=[];virtualConsole.on('jsdomError',e=>errors.push(e.message));
      const dom=await JSDOM.fromURL(base,{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,beforeParse(window){
        window.fetch=(url,options)=>fetch(new URL(url,base),options);window.AbortSignal=AbortSignal;window.structuredClone=structuredClone;window.TextEncoder=TextEncoder;
        Object.defineProperty(window,'crypto',{value:webcrypto});window.confirm=()=>true;
        window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
      }});
      const w=dom.window,d=w.document;
      const wait=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timeout UI: '+d.querySelector('#syncStatus')?.textContent+' / '+d.querySelector('#itemMessage')?.textContent+' / '+d.querySelector('#loginMessage')?.textContent);};
      const fill=(selector,value)=>{d.querySelector(selector).value=value;};
      const submit=selector=>d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
      try{
        await wait(()=>typeof w.migrarDadosLocalStorage==='function'&&d.querySelector('#monthFilter').value);
        fill('#loginForm [name=email]',ui.user.email);fill('#loginForm [name=password]',password);submit('#loginForm');await wait(()=>!d.querySelector('#appShell').hidden);
        fill('#monthFilter','2026-09');d.querySelector('#monthFilter').dispatchEvent(new w.Event('change'));await wait(()=>d.querySelector('#syncStatus').textContent.includes('verificados'));
        d.querySelector('#primaryAction').click();await wait(()=>d.querySelector('#itemDialog').open);
        fill('#f-category','Alimentação');fill('#f-description','Despesa UI');fill('#f-planned','200');fill('#f-actual','150');fill('#f-accountId',String(a.id));fill('#f-date','2026-09-04');submit('#itemForm');
        await wait(()=>!d.querySelector('#itemDialog').open&&d.querySelector('#expenseTotal').textContent.includes('150,00'));
        assert.ok(d.querySelector('#accountTotal').textContent.includes('850,00'));assert.ok(d.querySelector('#categoryBars').textContent.includes('Alimentação'));
        d.querySelector('[data-view=expenses]').click();fill('#expenseSearch','não existe');d.querySelector('#expenseSearch').dispatchEvent(new w.Event('input'));assert.ok(!d.querySelector('#expenseList').textContent.includes('Despesa UI'));
        fill('#expenseSearch','Despesa UI');d.querySelector('#expenseSearch').dispatchEvent(new w.Event('input'));assert.ok(d.querySelector('#expenseList').textContent.includes('Despesa UI'));
        d.querySelector('#primaryAction').click();d.querySelector('#itemDialog button[value=cancel]').click();assert.equal(d.querySelector('#itemDialog').open,false);
        assert.equal((await request('/transacoes',{token:ui.token})).length,1);
        const saveDialog=async fields=>{
          for(const [key,value]of Object.entries(fields))fill('#f-'+key,String(value));
          submit('#itemForm');await wait(()=>!d.querySelector('#itemDialog').open&&!d.querySelector('#primaryAction').disabled);
        };
        d.querySelector('[data-view=revenues]').click();d.querySelector('#primaryAction').click();
        await saveDialog({category:'Salário UI',description:'Receita UI',actual:500,accountId:a.id,date:'2026-09-04'});
        assert.ok(d.querySelector('#accountTotal').textContent.includes('1.350,00'));assert.equal(d.querySelector('#incomeInput').value,'500.00');
        d.querySelector('[data-view=investments]').click();d.querySelector('#primaryAction').click();
        await saveDialog({name:'Reserva UI',balance:1000,contribution:50,note:'Teste'});
        assert.ok(d.querySelector('#investmentGrandTotal').textContent.includes('1.000,00'));assert.ok(d.querySelector('#investmentProjection').textContent.includes('1.050,00'));
        d.querySelector('[data-view=goals]').click();d.querySelector('#primaryAction').click();
        await saveDialog({name:'Meta UI',target:2000,current:1000,deadline:'2027-12-01',action:'Guardar'});
        assert.ok(d.querySelector('#goalPreview').textContent.includes('50,0%'));
        d.querySelector('[data-view=notes]').click();d.querySelector('#newNote').click();
        await wait(()=>d.querySelector('#noteSelect').options.length===1&&!d.querySelector('#newNote').disabled);
        fill('#noteTitle','Nota da interface');d.querySelector('#noteTitle').dispatchEvent(new w.Event('input'));
        fill('#notesInput','Nota gravada pela interface');d.querySelector('#notesInput').dispatchEvent(new w.Event('input'));
        await wait(()=>d.querySelector('#syncStatus').textContent.includes('verificados'));
        assert.equal((await request('/estado',{token:ui.token})).dados.notes,'Nota gravada pela interface');
        d.querySelector('[data-view=expenses]').click();
        d.querySelector('[data-edit=expenses]').click();await saveDialog({actual:0});
        assert.equal((await request('/transacoes?tipo=despesa',{token:ui.token})).length,0);
        d.querySelector('[data-edit=expenses]').click();await saveDialog({actual:150,accountId:a.id});
        assert.equal((await request('/transacoes?tipo=despesa',{token:ui.token})).length,1);
        d.querySelector('[data-delete=expenses]').click();await wait(()=>d.querySelector('#confirmTitle'));const confirmation=d.querySelector('#confirmTitle').closest('dialog');confirmation.returnValue='confirm';confirmation.close();confirmation.dispatchEvent(new w.Event('close'));await new Promise(r=>setTimeout(r,20));await wait(()=>!d.querySelector('#primaryAction').disabled);
        assert.equal((await request('/transacoes?tipo=despesa',{token:ui.token})).length,0);
        // Exercita também a leitura legada e a confirmação independente no navegador.
        d.querySelector('#logoutBtn').click();await wait(()=>d.querySelector('#appShell').hidden&&!d.querySelector('#logoutBtn').disabled);
        const migrationUser=await request('/auth/register',{method:'POST',body:{nome:'Migração UI',email:'migration-ui@example.test',senha:password},status:201});
        const salt=webcrypto.getRandomValues(new Uint8Array(16));
        const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
        const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},key,256);
        const legacyKey='controleFinanceiroDataV2:legacy-ui';
        const legacyData=JSON.stringify({income:500,accounts:[{id:1,name:'Antiga UI',value:1000}],expenses:[{id:1,category:'Mercado',description:'Legada UI',planned:200,actual:150}],investments:[],goals:[],notes:'Nota antiga'});
        w.localStorage.setItem('controleFinanceiroUsersV2',JSON.stringify([{id:'legacy-ui',email:migrationUser.user.email,salt:Buffer.from(salt).toString('base64'),hash:Buffer.from(bits).toString('base64')}]));
        w.localStorage.setItem(legacyKey,legacyData);w.localStorage.setItem(legacyKey+':backup',JSON.stringify({data:JSON.parse(legacyData)}));
        fill('#loginForm [name=email]',migrationUser.user.email);fill('#loginForm [name=password]',password);submit('#loginForm');await wait(()=>!d.querySelector('#appShell').hidden);
        d.querySelector('#legacyMigrationButton').click();await wait(()=>d.querySelector('#migrationDialog').open);
        fill('#legacyPassword',password);fill('#migrationDate','2026-09-04');submit('#migrationForm');await wait(()=>!d.querySelector('#migrationDialog').open&&!d.querySelector('#primaryAction').disabled);
        assert.equal(w.localStorage.getItem(legacyKey),legacyData);
        assert.ok(w.localStorage.getItem(legacyKey+':backup'));
        assert.ok(JSON.parse(w.localStorage.getItem(legacyKey+':mysql:'+migrationUser.user.id+':migracao')).checksum);
        assert.ok(d.querySelector('#expenseTotal').textContent.includes('150,00'));assert.ok(d.querySelector('#accountTotal').textContent.includes('1.000,00'));
        assert.deepEqual(errors,[]);
      }finally{w.close();}
    });
    await t.test('CORS, autenticação, arquivos privados e senha revogam sessão',async()=>{
      await request('/transacoes',{status:401});
      const blocked=await fetch(base+'/api/health',{headers:{Origin:'https://untrusted.example'}});assert.equal(blocked.status,403);
      for(const path of ['/backend/.env','/.env','/backend/sql/schema_referencia.sql'])assert.equal((await fetch(base+path)).status,404);
      await request('/usuarios/'+other.user.id,{token:other.token,method:'PUT',body:{nome:'Outro',email:other.user.email,senha:'Nova-senha-123!'}});
      await request('/auth/me',{token:other.token,status:401});
      await request('/usuarios/'+other.user.id,{token:admin.token,method:'DELETE',status:204});
      await request('/usuarios/'+other.user.id,{token:admin.token,status:404});
    });
  }finally{await new Promise(r=>server.close(r));await pool.end();}
});
