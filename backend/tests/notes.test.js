import test from 'node:test';
import assert from 'node:assert/strict';
import { valuesFor } from '../src/controllers/relationalController.js';
import { notesUI,waitFor,input } from './helpers/notes-ui.js';

test('título de nota valida tipo/limite e preserva compatibilidade com null',()=>{
  assert.equal(valuesFor('notas',{titulo:'Título',conteudo:'Texto'}).titulo,'Título');
  assert.equal(valuesFor('notas',{titulo:null,conteudo:'Texto'}).titulo,null);
  assert.equal(valuesFor('notas',{conteudo:'Texto'}).titulo,null);
  assert.equal(valuesFor('notas',{titulo:'a'.repeat(150),conteudo:'Texto'}).titulo.length,150);
  for(const titulo of [1,{},[],false,'a'.repeat(151)])assert.throws(()=>valuesFor('notas',{titulo,conteudo:'Texto'}));
  for(const conteudo of [null,1,{},[]])assert.throws(()=>valuesFor('notas',{titulo:'Título',conteudo}));
});
function fixture(initial=[],mode='relacional') {
  let records=structuredClone(initial),sequence=10;const calls=[];
  let fail=false;
  const fetch=async(url,options)=>{
    calls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});
    if(options.method!=='GET'&&fail)return {ok:false,status:503,json:async()=>({error:'Serviço indisponível.'})};
    let result=[];
    if(url.includes('/estado'))result={armazenamento:mode,versao:1,dados:{investments:[],goals:[],notes:mode==='legado'?'Conteúdo legado':'',noteRecords:structuredClone(records)}};
    else if(url.includes('/resumo'))result={receitas:0,despesas:0,saldo_total:0,despesas_por_categoria:[]};
    else if(url.endsWith('/notas')&&options.method==='POST'){result={id:++sequence,...JSON.parse(options.body)};records.push(result);}
    else if(url.includes('/notas/')&&options.method==='PUT'){result={id:Number(url.split('/').at(-1)),...JSON.parse(options.body)};records=records.map(n=>n.id===result.id?result:n);}
    else if(url.includes('/notas/')&&options.method==='DELETE')records=records.filter(n=>n.id!==Number(url.split('/').at(-1)));
    return {ok:true,status:options.method==='DELETE'?204:200,json:async()=>result};
  };
  const dom=notesUI(fetch);
  return {dom,calls,fail(value){fail=value;},records:()=>records,async enter(){await dom.window.notesTest.enter({token:'test',user:{id:1,nome:'Teste',role:'user'}});dom.window.notesTest.open();}};
}
test('abrir/recarregar não cria notas; estado vazio e criação explicitamente pelo botão',async()=>{
  const f=fixture();try{
    await f.enter();await f.dom.window.notesTest.reload();const d=f.dom.window.document;
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
    assert.equal(d.querySelector('#notesInput').disabled,true);assert.equal(d.querySelector('#noteEmpty').hidden,false);
    d.querySelector('#newNote').click();d.querySelector('#newNote').click();
    await waitFor(()=>f.records().length===1&&!f.dom.window.notesTest.state().busy);
    assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
    assert.equal(d.activeElement.id,'noteTitle');assert.equal(d.querySelector('#noteTitle').maxLength,150);
  }finally{f.dom.window.close();}
});
test('autosave usa debounce, salva ambos os campos e atualiza somente a opção correta',async()=>{
  const f=fixture([{id:1,titulo:'Primeira',conteudo:'A'},{id:2,titulo:'Segunda',conteudo:'B'}]);try{
    await f.enter();const w=f.dom.window,d=w.document;
    input(w,'noteTitle','Título parcial');input(w,'noteTitle','Título final');input(w,'notesInput','Conteúdo atualizado');
    assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
    d.querySelector('#noteSelect').value='2';d.querySelector('#noteSelect').dispatchEvent(new w.Event('change'));
    assert.equal(d.querySelector('#noteSelect').value,'1');
    await waitFor(()=>!w.notesTest.state().notesDirty);
    const saves=f.calls.filter(c=>c.method==='PUT');assert.equal(saves.length,1);
    assert.equal(saves[0].url,'/api/notas/1');assert.deepEqual(saves[0].body,{titulo:'Título final',conteudo:'Conteúdo atualizado'});
    assert.equal(d.querySelector('#noteSelect option').textContent,'Título final');
    d.querySelector('#noteSelect').value='2';d.querySelector('#noteSelect').dispatchEvent(new w.Event('change'));
    assert.equal(d.querySelector('#noteTitle').value,'Segunda');assert.equal(d.querySelector('#notesInput').value,'B');
  }finally{f.dom.window.close();}
});
test('título nulo tem fallback somente visual e modo legado continua disponível',async()=>{
  const f=fixture([{id:1,titulo:null,conteudo:'Antiga'}]);try{
    await f.enter();const w=f.dom.window,d=w.document;
    assert.equal(d.querySelector('#noteSelect option').textContent,'Nota sem título');assert.equal(d.querySelector('#noteTitle').value,'');
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
    input(w,'notesInput','Conteúdo antigo editado');await waitFor(()=>!w.notesTest.state().notesDirty);
    assert.equal(f.records()[0].titulo,null);
  }finally{f.dom.window.close();}
  const legacy=fixture([],'legado');try{
    await legacy.enter();assert.equal(legacy.dom.window.document.querySelector('#noteTitleField').hidden,true);
    assert.equal(legacy.dom.window.document.querySelector('#notesInput').disabled,false);
    assert.equal(legacy.dom.window.document.querySelector('#notesInput').value,'Conteúdo legado');
    assert.equal(legacy.calls.filter(c=>c.method!=='GET').length,0);
  }finally{legacy.dom.window.close();}
});
test('falha preserva rascunho, permite nova tentativa e exclusão confirmada deixa seleção válida',async()=>{
  const f=fixture([{id:1,titulo:'Primeira',conteudo:'A'},{id:2,titulo:'Segunda',conteudo:'B'}]);try{
    await f.enter();const w=f.dom.window,d=w.document;f.fail(true);
    input(w,'noteTitle','Rascunho');await waitFor(()=>d.querySelector('#noteSaveStatus').classList.contains('form-message'));
    assert.equal(d.querySelector('#noteTitle').value,'Rascunho');assert.equal(w.notesTest.state().notesDirty,true);
    f.fail(false);input(w,'notesInput','Nova tentativa');await waitFor(()=>!w.notesTest.state().notesDirty);
    d.querySelector('#primaryAction').click();d.querySelector('#confirmTitle').closest('dialog').close('cancel');
    assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
    await new Promise(r=>setTimeout(r,0));
    d.querySelector('#primaryAction').click();d.querySelector('#confirmTitle').closest('dialog').close('confirm');
    await waitFor(()=>w.notesTest.state().selectedNoteId===2&&!w.notesTest.state().busy);
    assert.equal(d.querySelector('#noteTitle').value,'Segunda');
    d.querySelector('#primaryAction').click();d.querySelector('#confirmTitle').closest('dialog').close('confirm');
    await waitFor(()=>w.notesTest.state().selectedNoteId===null&&!w.notesTest.state().busy);
    assert.equal(d.querySelector('#noteSelect').options.length,0);assert.equal(d.querySelector('#noteTitle').disabled,true);assert.equal(d.querySelector('#primaryAction').disabled,true);
  }finally{f.dom.window.close();}
});
