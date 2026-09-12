// Diálogos nativos: foco contido pelo navegador, Escape cancela e foco retorna ao acionador.
function confirmAction(message) {
  const dialog=document.createElement('dialog'), trigger=document.activeElement;
  dialog.setAttribute('aria-labelledby','confirmTitle');
  dialog.innerHTML='<form method="dialog"><h2 id="confirmTitle">Confirmar ação</h2><p></p><div class="dialog-actions"><button class="button ghost" value="cancel" autofocus>Cancelar</button><button class="button" value="confirm">Confirmar</button></div></form>';
  dialog.querySelector('p').textContent=message;document.body.append(dialog);dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='confirm';dialog.remove();trigger?.focus();resolve(accepted);},{once:true}));
}
function noteLabel(note) { return note.titulo?.trim() || 'Nota sem título'; }
function noteStatus(message,error=false) { const status=$('#noteSaveStatus');status.textContent=message;status.classList.toggle('form-message',error); }
function syncNoteControls() {
  const relational=storageMode==='relacional',hasNote=Boolean(state.noteRecords?.some(n=>n.id===selectedNoteId));
  $('#noteTitleField').hidden=!relational;
  $('#noteTitle').disabled=busy||!relational||!hasNote;
  $('#notesInput').disabled=busy||(relational&&!hasNote);
  $('#noteSelect').disabled=busy||!hasNote;
  $('#newNote').disabled=busy;
  $('#noteEmpty').hidden=!relational||hasNote;
  if(active==='notes')$('#primaryAction').disabled=busy||(relational&&!hasNote);
  else if(!busy)$('#primaryAction').disabled=false;
}
function renderNotes() {
  const controls=$('.note-tools');controls.hidden=storageMode!=='relacional';
  if(storageMode!=='relacional'){syncNoteControls();return;}
  const select=$('#noteSelect'),previous=String(selectedNoteId??select.value);
  select.innerHTML=(state.noteRecords||[]).map(n=>`<option value="${n.id}">${esc(noteLabel(n))}</option>`).join('');
  if([...select.options].some(o=>o.value===previous))select.value=previous;
  selectedNoteId=Number(select.value)||null;
  const note=state.noteRecords?.find(n=>n.id===selectedNoteId);
  $('#noteTitle').value=note?.titulo||'';
  $('#noteTitle').required=Boolean(note?.titulo?.trim());
  $('#notesInput').value=note?.conteudo||'';
  noteStatus(note?'Salvo':'Nenhuma nota selecionada.');syncNoteControls();
}
$('#noteSelect').addEventListener('change',()=>{
  if(notesDirty||busy){$('#noteSelect').value=selectedNoteId||'';notice('Aguarde o salvamento antes de trocar a nota.',true);return;}
  selectedNoteId=Number($('#noteSelect').value)||null;
  renderNotes();
});
$('#newNote').addEventListener('click',async()=>{
  if(busy||storageMode!=='relacional')return;
  const generation=sessionGeneration;let created;
  await run(async()=>{
    noteStatus('Salvando…');
    try{created=await api.post('/notas',{titulo:'Nova nota',conteudo:'Escreva sua nota.'});}
    catch(error){noteStatus('Não foi possível criar a nota. Tente novamente.',true);throw error;}
    if(generation!==sessionGeneration||!currentUser)return;
    state.noteRecords=[...(state.noteRecords||[]),created];selectedNoteId=created.id;renderNotes();
  },false);
  if(created&&generation===sessionGeneration&&currentUser){$('#noteTitle').focus();$('#noteTitle').select();}
});
let contributionRows=[], contributionParent=null;
const contributionDialog=document.createElement('dialog');contributionDialog.id='contributionDialog';contributionDialog.setAttribute('aria-labelledby','contributionTitle');
contributionDialog.innerHTML=`<form id="contributionForm"><div class="dialog-head"><h2 id="contributionTitle">Histórico de aportes</h2><button type="button" class="icon-button" data-close-aportes aria-label="Fechar">×</button></div><p>Aportes sem data permanecem no planejamento de todos os períodos até serem datados. A realização ajusta o saldo atual do investimento.</p><div id="contributionRows"></div><input type="hidden" name="id"><div class="form-fields"><label>Valor<input name="valor" type="number" min="0.01" step="0.01" required></label><label>Tipo<select name="tipo"><option value="planejado">Planejado</option><option value="realizado">Realizado</option></select></label><label>Data prevista<input name="data_prevista" type="date"></label><label>Data realizada<input name="data_realizada" type="date"></label><label class="field full">Observação<input name="observacao" maxlength="10000"></label></div><p id="contributionMessage" role="status"></p><div class="dialog-actions"><button type="button" class="button ghost" data-new-aporte>Novo aporte</button><button type="submit" class="button">Salvar aporte</button></div></form>`;
document.body.append(contributionDialog);
async function loadContributions() {
  contributionRows=await api.get('/investimentos/'+contributionParent+'/aportes');
  if(!Array.isArray(contributionRows))contributionRows=[];
  $('#contributionRows').innerHTML=contributionRows.map(x=>`<div class="contribution-row"><span>${money(x.valor)} · ${esc(x.tipo)}<small>${dateBR(x.data_realizada||x.data_prevista)}</small></span><button type="button" class="text-btn" data-edit-aporte="${x.id}">Editar</button><button type="button" class="text-btn" data-delete-aporte="${x.id}">Excluir</button></div>`).join('')||empty();
}
document.addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button)return;
  try{
    if(button.dataset.aportes){
      contributionParent=Number(button.dataset.aportes);$('#contributionForm').reset();$('#contributionForm').elements.id.value='';
      $('#contributionMessage').textContent='Carregando...';contributionDialog.showModal();await loadContributions();$('#contributionMessage').textContent='';
    }
    if(button.hasAttribute('data-close-aportes'))contributionDialog.close();
    if(button.hasAttribute('data-new-aporte')){$('#contributionForm').reset();$('#contributionForm').elements.id.value='';}
    if(button.dataset.editAporte){const x=contributionRows.find(x=>x.id===Number(button.dataset.editAporte));for(const key of ['id','valor','tipo','data_prevista','data_realizada','observacao'])$('#contributionForm').elements[key].value=x[key]||'';}
    if(button.dataset.deleteAporte&&await confirmAction('Excluir este aporte? Esta ação não poderá ser desfeita.'))await run(async()=>{await api.delete('/aportes/'+button.dataset.deleteAporte);await loadContributions();});
  }catch(error){$('#contributionMessage').textContent=error.message;}
});
$('#contributionForm').addEventListener('submit',event=>{
  event.preventDefault();const body=Object.fromEntries(new FormData(event.target)),id=body.id;delete body.id;
  run(async()=>{try{await api.request(id?'/aportes/'+id:'/investimentos/'+contributionParent+'/aportes',{method:id?'PUT':'POST',body});await loadContributions();event.target.reset();event.target.elements.id.value='';$('#contributionMessage').textContent='Aporte salvo.';}catch(e){$('#contributionMessage').textContent=e.message;throw e;}});
});
document.addEventListener('session-cleared',()=>{contributionRows=[];contributionParent=null;$('#contributionRows').replaceChildren();$('#contributionForm').reset();});

(() => {
 const img=document.querySelector('#loginImage');
 img.addEventListener('error',()=>{img.hidden=true;img.closest('figure').classList.add('image-fallback');});
 // Varia a cada acesso, sem baixar imagens adicionais em segundo plano.
 const choice=1+Math.floor(Math.random()*3);
 if(choice!==1)img.src='assets/finance-'+choice+'.svg';
})();
