import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { pool,transaction } from '../src/config/database.js';
import { notesUI,waitFor,input } from './helpers/notes-ui.js';

// Opt-in: usa somente fixtures novas, identificadas por UUID. Nenhum DDL ou
// migração é executado e app_estado nunca é escrito, nem durante a remoção.
test('notas: CRUD, recarregamento do frontend e isolamento no MySQL existente',{
  skip:process.env.NOTES_MYSQL_TEST!=='1'
},async()=>{
  const fixtures=[],password='Notas-'+randomUUID();let dom,server;
  try{
    const [columns]=await pool.execute("SELECT COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notas' AND COLUMN_NAME='titulo'");
    assert.equal(columns[0]?.COLUMN_TYPE,'varchar(150)');assert.equal(columns[0]?.IS_NULLABLE,'YES');
    server=app.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    async function request(path,token,method='GET',body,status=200){
      const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
      assert.equal(r.status,status,method+' '+path);return r.status===204?null:r.json();
    }
    async function register(){
      const email='notes-crud-'+randomUUID()+'@example.test';
      const result=await request('/auth/register',null,'POST',{nome:'Teste temporário de notas',email,senha:password},201);
      fixtures.push(result.user);return result;
    }
    const user=await register(),other=await register();
    const calls=[];
    async function reloadPage(){
      dom?.window.close();
      dom=notesUI((url,options)=>{calls.push({url,method:options.method});return fetch(new URL(url,base),options);});
      const login=await request('/auth/login',null,'POST',{email:user.user.email,senha:password});
      await dom.window.notesTest.enter(login);dom.window.notesTest.open();
    }
    async function edit(title,content){
      input(dom.window,'noteTitle',title);input(dom.window,'notesInput',content);
      await waitFor(()=>!dom.window.notesTest.state().notesDirty&&!dom.window.notesTest.state().busy);
    }
    async function create(){
      const before=dom.window.document.querySelector('#noteSelect').options.length;
      dom.window.document.querySelector('#newNote').click();
      await waitFor(()=>dom.window.document.querySelector('#noteSelect').options.length===before+1&&!dom.window.notesTest.state().busy);
      return dom.window.notesTest.state().selectedNoteId;
    }
    async function remove(){
      dom.window.document.querySelector('#primaryAction').click();
      assert.ok(dom.window.document.querySelector('#confirmTitle'),'Confirmação obrigatória');
      dom.window.document.querySelector('#confirmTitle').closest('dialog').close('confirm');
      await waitFor(()=>!dom.window.notesTest.state().busy);
      // O fechamento do diálogo inicia o fluxo na próxima microtask.
      await new Promise(r=>setTimeout(r,50));
      await waitFor(()=>!dom.window.notesTest.state().busy);
    }
    await reloadPage();await reloadPage();
    assert.equal((await request('/notas',user.token)).length,0);
    assert.equal(calls.filter(c=>c.method==='POST').length,0);
    const first=await create();
    await edit('Nota teste CRUD','Esta é uma nota criada para validar o armazenamento.');
    await reloadPage();
    assert.equal(dom.window.document.querySelector('#noteTitle').value,'Nota teste CRUD');
    assert.equal(dom.window.document.querySelector('#notesInput').value,'Esta é uma nota criada para validar o armazenamento.');
    await edit('Nota teste CRUD editada','Conteúdo atualizado para validar a edição e a persistência da nota.');
    await reloadPage();
    assert.equal(dom.window.document.querySelector('#noteTitle').value,'Nota teste CRUD editada');
    assert.equal(dom.window.document.querySelector('#notesInput').value,'Conteúdo atualizado para validar a edição e a persistência da nota.');
    const second=await create();await edit('Segunda nota teste','Teste do seletor de múltiplas notas.');
    assert.deepEqual([...dom.window.document.querySelector('#noteSelect').options].map(o=>o.textContent),['Nota teste CRUD editada','Segunda nota teste']);
    function select(id){const s=dom.window.document.querySelector('#noteSelect');s.value=String(id);s.dispatchEvent(new dom.window.Event('change'));}
    select(first);assert.equal(dom.window.document.querySelector('#noteTitle').value,'Nota teste CRUD editada');
    select(second);assert.equal(dom.window.document.querySelector('#notesInput').value,'Teste do seletor de múltiplas notas.');
    for(const method of ['GET','PUT','DELETE'])await request('/notas/'+first,other.token,method,method==='PUT'?{titulo:'Invasão',conteudo:'Não permitido'}:undefined,404);
    assert.equal((await request('/notas',other.token)).length,0);
    await request('/notas?usuario_id='+user.user.id,other.token,'GET',undefined,403);
    for(const titulo of [null,7,{},'a'.repeat(151),''])await request('/notas',user.token,'POST',{titulo,conteudo:'Inválido'},400);
    await request('/notas/'+first,user.token,'PUT',{titulo:'Título',conteudo:42},400);
    await remove();assert.equal(dom.window.notesTest.state().selectedNoteId,first);
    assert.equal((await request('/notas/'+first,user.token)).titulo,'Nota teste CRUD editada');
    await remove();assert.equal((await request('/notas',user.token)).length,0);
    assert.equal(dom.window.notesTest.state().selectedNoteId,null);assert.equal(dom.window.document.querySelector('#noteEmpty').hidden,false);
    await reloadPage();assert.equal((await request('/notas',user.token)).length,0);
    // Compatibilidade: somente uma fixture nova sem título; não modifica legado real.
    const [untitled]=await pool.execute('INSERT INTO notas(usuario_id,titulo,conteudo) VALUES(?,NULL,?)',[user.user.id,'Fixture sem título']);
    await reloadPage();assert.equal(dom.window.document.querySelector('#noteSelect option').textContent,'Nota sem título');
    assert.equal((await request('/notas/'+untitled.insertId,user.token)).titulo,null);
    await edit('','Conteúdo da fixture antiga editado');
    assert.equal((await request('/notas/'+untitled.insertId,user.token)).titulo,null);
    await remove();
    const [remaining]=await pool.execute('SELECT COUNT(*) n FROM notas WHERE usuario_id IN (?,?)',[user.user.id,other.user.id]);assert.equal(remaining[0].n,0);
    const [legacy]=await pool.execute('SELECT COUNT(*) n FROM app_estado WHERE usuario_id IN (?,?)',[user.user.id,other.user.id]);assert.equal(legacy[0].n,0);
  }finally{
    dom?.window.close();
    if(server)await new Promise(r=>server.close(r));
    try{
      for(const user of fixtures)await transaction(async db=>{
        const [owned]=await db.execute('SELECT id FROM usuarios WHERE id=? AND email=? FOR UPDATE',[user.id,user.email]);
        assert.equal(owned.length,1,'Somente o usuário temporário identificado pode ser removido.');
        for(const table of ['notas','app_estado_migracoes','app_perfis'])await db.execute(`DELETE FROM ${table} WHERE usuario_id=?`,[user.id]);
        await db.execute('DELETE FROM usuarios WHERE id=? AND email=?',[user.id,user.email]);
      });
    }finally{await pool.end();}
  }
});
