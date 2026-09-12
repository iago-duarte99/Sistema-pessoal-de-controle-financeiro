import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root=new URL('../../../',import.meta.url);
const html=await readFile(new URL('index.html',root),'utf8');
const files=['js/api.js','app.js','js/migration.js','js/ux.js','js/controller.js','js/import-schema.js','js/import.js'];
const sources=await Promise.all(files.map(file=>readFile(new URL(file,root),'utf8')));
export function notesUI(fetch) {
  const dom=new JSDOM(html,{url:'http://localhost:3000/',runScripts:'outside-only'}),w=dom.window;
  w.fetch=fetch;w.AbortSignal=AbortSignal;w.structuredClone=structuredClone;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(value){this.returnValue=value||'';this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.eval(sources.join('\n')+`\nwindow.notesTest={enter:enterApp,reload:reloadData,state:()=>({notesDirty,busy,selectedNoteId,records:state.noteRecords}),open:()=>switchView('notes')};`);
  return dom;
}
export async function waitFor(predicate) {
  for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,30));}
  throw new Error('A interface não concluiu a operação de notas no prazo esperado.');
}
export function input(w,id,value) {const field=w.document.getElementById(id);field.value=value;field.dispatchEvent(new w.Event('input',{bubbles:true}));}
