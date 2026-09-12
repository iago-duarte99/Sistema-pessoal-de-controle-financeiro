import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const sources=await Promise.all(['js/api.js','app.js','js/migration.js','js/ux.js','js/controller.js','js/import-schema.js','js/import.js'].map(p=>readFile(new URL('../../'+p,import.meta.url),'utf8')));
const tick=()=>new Promise(r=>setTimeout(r,0));
function setup(fetch) {
  const dom=new JSDOM(html,{url:'http://localhost:3000/',runScripts:'outside-only'}),w=dom.window;
  w.fetch=fetch;w.AbortSignal=AbortSignal;w.structuredClone=structuredClone;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(value){this.returnValue=value||'';this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.eval(sources.join('\n')+`\nwindow.testState=()=>({currentUser,state,profileCache,periodSummary});window.testLogin=()=>{api.setToken('test-only');currentUser={id:1,name:'Teste'};document.querySelector('#appShell').hidden=false;};window.testEmptyNote=()=>{active='notes';storageMode='relacional';state.noteRecords=[{id:5,titulo:'Nota',conteudo:'Anterior'}];selectedNoteId=5;document.querySelector('#noteSelect').innerHTML='<option value="5">Nota</option>';document.querySelector('#notesInput').value='';notesDirty=true;};`);
  return dom;
}
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
const payload=path=>path.includes('/resumo')?{receitas:0,despesas:0,saldo_total:0,aportes_planejados:0,patrimonio:0,saldo_livre:0,despesas_por_categoria:[]}:path.includes('/estado')?{armazenamento:'relacional',versao:0,dados:{investments:[],goals:[],notes:'',noteRecords:[]}}:[];
test('atualização só GET, loading, cliques concorrentes, sucesso e erro',async()=>{
  const calls=[];let finish;
  const dom=setup((url,opts)=>{calls.push({url,opts});return new Promise(r=>{const previous=finish;finish=()=>{previous?.();r(response(payload(url)));};});});
  try{
    const w=dom.window,d=w.document;w.testLogin();d.querySelector('#refreshData').click();d.querySelector('#refreshData').click();
    assert.equal(calls.length,6);assert.ok(calls.every(c=>c.opts.method==='GET'));assert.equal(d.querySelector('#refreshData').disabled,true);assert.match(d.querySelector('#syncStatus').textContent,/Atualizando/);
    assert.equal(d.querySelector('#notesInput').disabled,true);
    finish();await tick();await tick();assert.match(d.querySelector('#syncStatus').textContent,/sucesso/);assert.equal(d.querySelector('#refreshData').disabled,false);
    w.fetch=async()=>{throw new Error('network');};d.querySelector('#refreshData').click();await tick();assert.match(d.querySelector('#syncStatus').textContent,/Não foi possível atualizar/);
  }finally{dom.window.close();}
});
test('excluir nota esvaziada não tenta salvar conteúdo inválido antes de excluir',async()=>{
  const calls=[];const dom=setup(async(url,options)=>{calls.push({url,options});return response(options.method==='DELETE'?null:payload(url),options.method==='DELETE'?204:200);});
  try{
    const w=dom.window,d=w.document;w.testLogin();w.testEmptyNote();d.querySelector('#primaryAction').click();
    d.querySelector('#confirmTitle').closest('dialog').close('confirm');await tick();await tick();
    assert.equal(calls.filter(x=>x.options.method==='PUT').length,0);assert.equal(calls.filter(x=>x.options.method==='DELETE'&&x.url.endsWith('/notas/5')).length,1);
  }finally{dom.window.close();}
});
test('logout sem rede remove token, dados em memória e Voltar não restaura sessão',async()=>{
  const dom=setup(async()=>{throw new Error('offline');});
  try{
    const w=dom.window,d=w.document;w.testLogin();w.localStorage.setItem('controleFinanceiroSessionV2','legacy');w.localStorage.setItem('controleFinanceiroDataV2:backup','preservado');
    d.querySelector('#logoutBtn').click();await tick();
    assert.equal(d.querySelector('#appShell').hidden,true);assert.equal(w.testState().currentUser,null);assert.equal(w.testState().state.investments.length,0);assert.equal(w.testState().periodSummary,null);
    assert.equal(w.localStorage.getItem('controleFinanceiroSessionV2'),null);assert.equal(w.localStorage.getItem('controleFinanceiroDataV2:backup'),'preservado');
    w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));assert.equal(d.querySelector('#appShell').hidden,true);
    assert.match(d.querySelector('#loginMessage').textContent,/saiu/);
  }finally{dom.window.close();}
});
test('resposta atrasada não repopula dados depois do logout',async()=>{
  let finish;const dom=setup((url)=>url.endsWith('/auth/logout')?Promise.resolve(response(null,204)):new Promise(r=>{const old=finish;finish=()=>{old?.();r(response(payload(url)));};}));
  try{const w=dom.window,d=w.document;w.testLogin();d.querySelector('#refreshData').click();d.querySelector('#logoutBtn').click();finish();await tick();await tick();assert.equal(w.testState().currentUser,null);assert.equal(w.testState().periodSummary,null);assert.equal(d.querySelector('#appShell').hidden,true);}finally{dom.window.close();}
});
test('confirmação acessível permite cancelar e confirmar; importação cancelada não envia',async()=>{
  const calls=[];const dom=setup(async url=>{calls.push(url);return response([]);});
  try{
    const w=dom.window,d=w.document;const cancelled=w.confirmAction('Excluir?');d.querySelector('dialog[open]').close('cancel');assert.equal(await cancelled,false);
    const accepted=w.confirmAction('Excluir?');d.querySelector('dialog[open]').close('confirm');assert.equal(await accepted,true);
    w.testLogin();d.querySelector('#migrationButton').click();assert.match(d.querySelector('#importDialog').textContent,/CSV, XLSX e JSON/);d.querySelector('[data-import-cancel]').click();assert.equal(calls.length,0);
  }finally{dom.window.close();}
});
test('login usa imagens locais, variação a cada acesso e fallback',()=>{
  const dom=setup(async()=>response([]));
  try{const img=dom.window.document.querySelector('#loginImage');assert.match(img.src,/assets\/finance-[123]\.svg$/);assert.equal(img.width,640);img.dispatchEvent(new dom.window.Event('error'));assert.equal(img.hidden,true);assert.ok(img.closest('figure').classList.contains('image-fallback'));}finally{dom.window.close();}
});
test('importação rejeita tamanho/MIME, mostra prévia e só grava após confirmação',async()=>{
  const calls=[];
  const context={accounts:[{id:1,nome:'Banco',ativa:1}],categories:[{id:1,nome:'Salário',tipo:'receita'}],existing:[]};
  const dom=setup(async(url,options)=>{calls.push({url,options});return response(url.includes('/contexto')?context:options.method==='POST'?{importados:1,ignorados:1,rejeitados:1}:payload(url));});
  try{
    const w=dom.window,d=w.document;w.testLogin();d.querySelector('#migrationButton').click();
    const file=d.querySelector('#importFile');
    Object.defineProperty(file,'files',{configurable:true,value:[{name:'teste.csv',type:'text/csv',size:3*1024*1024}]});
    file.dispatchEvent(new w.Event('change'));await tick();assert.match(d.querySelector('#importMessage').textContent,/maior que 2 MB/);assert.equal(calls.length,0);
    const row={tipo:'receita',descricao:'Salário',valor:'100.00',data:'2026-09-01',categoria:'Salário',conta:'Banco'};
    w.Worker=class {postMessage(){setTimeout(()=>this.onmessage({data:{rows:[row,row,{...row,valor:-1}]}}),0);}terminate(){}};
    Object.defineProperty(file,'files',{configurable:true,value:[{name:'teste.csv',type:'text/csv',size:100,arrayBuffer:async()=>new ArrayBuffer(0)}]});
    file.dispatchEvent(new w.Event('change'));await tick();await tick();await tick();
    assert.match(d.querySelector('#importMessage').textContent,/1 registros válidos · 1 duplicados · 1 inválidos/);
    const submit=()=>d.querySelector('#importForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
    submit();d.querySelector('#confirmTitle').closest('dialog').close('cancel');await tick();assert.equal(calls.filter(x=>x.options.method==='POST').length,0);
    submit();d.querySelector('#confirmTitle').closest('dialog').close('confirm');await tick();await tick();
    const posts=calls.filter(x=>x.options.method==='POST');assert.equal(posts.length,1);assert.equal(JSON.parse(posts[0].options.body).confirmado,true);
    assert.match(d.querySelector('#importMessage').textContent,/1 importados, 1 ignorados, 1 rejeitados/);
  }finally{dom.window.close();}
});
