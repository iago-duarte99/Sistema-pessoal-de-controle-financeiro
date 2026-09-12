// Mantém os renderizadores existentes em app.js e concentra os fluxos da API.
let categories = [], revenues = [], profileCache = [], stateVersion = 0, busy = false, notesTimer;
let periodSummary = null, notesDirty = false, storageMode = "legado", sessionGeneration = 0, selectedNoteId = null;
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
let selectedMonth = localDay().slice(0,7);
const schemas = {
  expenses: { title: 'Despesa', fields: [['category','Categoria','category'],['description','Descrição','text'],['planned','Valor previsto','number'],['actual','Valor realizado','number'],['accountId','Conta','account'],['date','Data','date'],['observation','Observação','optional']] },
  revenues: { title: 'Receita', fields: [['category','Categoria','category'],['description','Descrição','text'],['actual','Valor recebido','number'],['accountId','Conta','account'],['date','Data','date'],['observation','Observação','optional']] },
  investments: { title: 'Investimento', fields: [['name','Caixinha','text'],['balance','Saldo atual','number'],['contribution','Próximo aporte','number'],['note','Observação','optional'],['active','Situação','enabled']] },
  accounts: { title: 'Conta', fields: [['name','Instituição','text'],['type','Tipo de conta','text'],['opening','Saldo inicial (não é o saldo atual)','signed'],['enabled','Situação','enabled']] },
  categories: { title: 'Categoria', fields: [['name','Nome','text'],['type','Tipo','type']] },
  goals: { title: 'Meta', fields: [['name','Nome da meta','text'],['target','Valor-meta','number'],['current','Valor atual','number'],['deadline','Prazo','date'],['action','Próxima ação','optional'],['status','Status','goalStatus']] }
};
function notice(message, error = false) { const box=$('#syncStatus');box.textContent=message;box.classList.toggle('form-message',error); }
function periodQuery() {
  const [year,month]=selectedMonth.split('-').map(Number);
  const last=new Date(year,month,0).getDate();
  return `data_inicio=${selectedMonth}-01&data_fim=${selectedMonth}-${last}`;
}
function displayUser(user) { return {...user,name:user.nome,createdAt:user.criado_em}; }
async function reloadData() {
  const query=periodQuery(), generation=sessionGeneration;
  if(!currentUser)return;
  const [accounts, cats, transactions, extra, plans, summary] = await Promise.all([
    api.get('/contas'),api.get('/categorias'),api.get('/transacoes?'+query),api.get('/estado?'+query),api.get('/planejamentos?'+query),api.get(`/usuarios/${currentUser.id}/resumo?${query}`)
  ]);
  if(generation!==sessionGeneration||!currentUser)return;
  storageMode=extra.armazenamento;categories=cats;periodSummary=summary;stateVersion=extra.versao;
  const mapped=transactions.map(t=>({id:t.id,category:t.categoria_nome,categoryId:t.categoria_id,description:t.descricao,planned:Number(t.valor_previsto??t.valor),actual:Number(t.valor),accountId:t.conta_id,date:t.data_transacao,observation:t.observacao||''}));
  revenues=mapped.filter(x=>transactions.find(t=>t.id===x.id).tipo==='receita');
  state={...extra.dados,income:Number(summary.receitas),accounts:accounts.map(a=>({id:a.id,name:a.nome,type:a.tipo,opening:Number(a.saldo_inicial),enabled:Boolean(a.ativa),value:Number(a.saldo_atual)})),expenses:mapped.filter(x=>transactions.find(t=>t.id===x.id).tipo==='despesa').concat(plans.map(p=>({id:-p.id,category:p.categoria,description:p.descricao,planned:Number(p.valor_previsto),actual:0,date:p.data_planejada,accountId:'',observation:''})))};
  if(!Array.isArray(state.investments))state.investments=[];
  if(!Array.isArray(state.goals))state.goals=[];
  render();renderRemote();
}
function renderRemote() {
  $('#accountTotal').textContent=money(periodSummary.saldo_total);
  $('#reconcileStatus').textContent='Saldo inicial + receitas − despesas (todo o histórico)';
  $('#incomeInput').readOnly=true;
  $('#incomeInput').title='Cadastre e edite os lançamentos na aba Receitas';
  $('#revenueList').innerHTML=revenues.map(x=>`<div class="data-row"><strong>${esc(x.description)}<small>${esc(x.category)}</small></strong><span>${money(x.actual)}</span><span>${dateBR(x.date)}</span><span>${esc(state.accounts.find(a=>a.id===x.accountId)?.name||'')}</span>${actions('revenues',x.id)}</div>`).join('')||empty();
  $('#categoryList').innerHTML=categories.map(x=>`<div class="data-row"><strong>${esc(x.nome)}</strong><span>${esc(x.tipo)}</span><span></span><span></span>${actions('categories',x.id)}</div>`).join('')||empty();
  $('#categoryBars').innerHTML=periodSummary.despesas_por_categoria.map(x=>`<div class="bar-row"><header><strong>${esc(x.nome)}</strong><span>${money(x.total)}</span></header><div class="track"><div class="fill" style="width:${Math.min(100,Number(x.total)/Math.max(1,Number(periodSummary.despesas))*100)}%"></div></div></div>`).join('')||empty();
  renderNotes();
  const t=totals();
  $('#checks').innerHTML=[['Orçamento',t.free>=0,`${money(t.free)} após despesas e aportes planejados`],['Contas',true,`${money(periodSummary.saldo_total)} de saldo calculado`],['Aportes',t.contributions<=state.income-t.expenses,`${money(t.contributions)} planejados`]].map(([n,ok,d])=>`<div class="check ${ok?'':'warn'}"><strong>${ok?'✓':'!'} ${n}</strong><span>${d}</span></div>`).join('');
}
async function saveExtra() {
  if(storageMode==='relacional')throw new Error('Use o formulário do registro para salvar.');
  const result=await api.put('/estado',{versao:stateVersion,dados:{investments:state.investments,goals:state.goals,notes:state.notes||''}});
  stateVersion=result.versao;
}
async function flushNotes() {
  clearTimeout(notesTimer);
  if(notesDirty){
    const value=$('#notesInput').value,title=$('#noteTitle').value,generation=sessionGeneration;
    noteStatus('Salvando…');
    try {
    if(storageMode==='relacional'){
      const existing=state.noteRecords?.find(n=>n.id===selectedNoteId);
      if(existing) {
        if(!value.length)throw new Error('Para excluir uma nota, use Excluir nota.');
        if(title.length>150)throw new Error('O título deve ter até 150 caracteres.');
        if(existing.titulo?.trim()&&!title.trim())throw new Error('Informe o título da nota.');
        const saved=await api.put('/notas/'+existing.id,{titulo:title.trim()||null,conteudo:value});
        if(generation!==sessionGeneration||!currentUser)return;
        Object.assign(existing,saved);
        const option=[...$('#noteSelect').options].find(o=>o.value===String(existing.id));
        if(option)option.textContent=noteLabel(existing);
      } else throw new Error('Clique em Nova nota para começar.');
    }else {state.notes=value;await saveExtra();}
    if(generation!==sessionGeneration||!currentUser)return;
    notesDirty=$('#notesInput').value!==value||(storageMode==='relacional'&&$('#noteTitle').value!==title);
    noteStatus(notesDirty?'Alterações pendentes…':'Salvo');
    }catch(error){if(generation===sessionGeneration)noteStatus('Não foi possível salvar a nota. '+(error.status===400?error.message:'Confira os campos e tente novamente.'),true);throw error;}
  }
}
async function run(work, refresh = true) {
  if(busy)return;
  busy=true;const generation=sessionGeneration;notice('Salvando…');
  const controls=[...document.querySelectorAll('#appShell button,#appShell input,#appShell select,#appShell textarea')].filter(x=>!x.disabled);
  controls.forEach(x=>x.disabled=true);
  try { await flushNotes();if(generation!==sessionGeneration||!currentUser)return;await work();if(generation!==sessionGeneration||!currentUser)return;if(refresh)await reloadData();notice('Dados verificados e armazenados com segurança.'); }
  catch(error){if(generation===sessionGeneration)notice(error.message,true);}
  finally {busy=false;controls.forEach(x=>x.disabled=false);if(currentUser)syncNoteControls();}
}
function itemFor(type,id) {
  if(type==='categories'){const c=categories.find(x=>x.id===id);return c?{id:c.id,name:c.nome,type:c.tipo}:{};}
  return (type==='revenues'?revenues:state[type]).find(x=>x.id===id)||{};
}
function openDialog(type,id=null) {
  editing={type,id};const sc=schemas[type],item=id!==null?itemFor(type,id):{date:selectedMonth===localDay().slice(0,7)?localDay():selectedMonth+'-01',type:type==='categories'?'despesa':'corrente',enabled:true,active:true,status:'ativa'};
  $('#dialogTitle').textContent=`${id!==null?'Editar':'Adicionar'} ${sc.title.toLowerCase()}`;
  $('#formFields').innerHTML=sc.fields.filter(([key])=>!(type==='investments'&&key==='contribution'&&storageMode==='relacional'&&id!==null)&&!(storageMode!=='relacional'&&['active','status'].includes(key))).map(([key,label,kind])=>{
    let input;
    if(kind==='account')input=`<select id="f-${key}" name="${key}" ${type==='revenues'?'required':''}><option value="">Selecione uma conta</option>${state.accounts.filter(a=>a.enabled).map(a=>`<option value="${a.id}" ${Number(item[key])===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select>`;
    else if(kind==='category')input=`<input id="f-${key}" name="${key}" list="categoryOptions" maxlength="100" value="${esc(item[key]||'')}" required><datalist id="categoryOptions">${categories.filter(c=>c.tipo===(type==='revenues'?'receita':'despesa')).map(c=>`<option value="${esc(c.nome)}"></option>`).join('')}</datalist>`;
    else if(kind==='goalStatus')input=`<select id="f-${key}" name="${key}">${[['ativa','Ativa'],['concluida','Concluída'],['cancelada','Cancelada']].map(([value,label])=>`<option value="${value}" ${item[key]===value?'selected':''}>${label}</option>`).join('')}</select>`;
    else if(kind==='type'||kind==='enabled')input=`<select id="f-${key}" name="${key}">${(kind==='type'?[['despesa','Despesa'],['receita','Receita']]:[['true','Ativa'],['false','Inativa']]).map(([value,name])=>`<option value="${value}" ${String(item[key])===value?'selected':''}>${name}</option>`).join('')}</select>`;
    else input=`<input id="f-${key}" name="${key}" type="${['number','signed'].includes(kind)?'number':kind==='date'?'date':'text'}" ${['number','signed'].includes(kind)?`step="0.01" ${kind==='number'?'min="0"':''}`:''} value="${esc(item[key]??'')}" ${kind==='optional'||(type==='goals'&&key==='deadline')?'':'required'}>`;
    return `<div class="field ${['description','note','action','observation'].includes(key)?'full':''}"><label for="f-${key}">${label}</label>${input}</div>`;
  }).join('');
  $('#itemMessage').textContent='';$('#itemDialog').showModal();
}
async function categoryId(name,type) {
  const existing=categories.find(c=>c.nome.toLocaleLowerCase()===name.trim().toLocaleLowerCase()&&c.tipo===type);
  if(existing)return existing.id;
  const created=await api.post('/categorias',{nome:name,tipo:type});categories.push(created);return created.id;
}
async function saveItem(obj) {
  const {type,id}=editing;
  if(['expenses','revenues'].includes(type)){
    const actual=Number(obj.actual),tipo=type==='expenses'?'despesa':'receita';
    if(actual===0&&type==='expenses'){
      const body={descricao:obj.description,categoria:obj.category,valor_previsto:obj.planned,data_planejada:obj.date};
      if(id>0)await api.put('/transacoes/'+id,{...body,converter_planejamento:true});
      else await api.request('/planejamentos'+(id!==null?'/'+(-id):''),{method:id!==null?'PUT':'POST',body});
    }else{
      if(!obj.accountId)throw new Error('Cadastre e selecione uma conta para o lançamento.');
      if(!(actual>0))throw new Error('O valor realizado deve ser maior que zero.');
      const body={conta_id:Number(obj.accountId),categoria_id:await categoryId(obj.category,tipo),descricao:obj.description,valor:obj.actual,tipo,data_transacao:obj.date,observacao:obj.observation||'',...(type==='expenses'?{valor_previsto:obj.planned}:{}),...(id<0?{planejamento_id:-id}:{})};
      await api.request('/transacoes'+(id>0?'/'+id:''),{method:id>0?'PUT':'POST',body});
    }
  }else if(type==='accounts')await api.request('/contas'+(id!==null?'/'+id:''),{method:id!==null?'PUT':'POST',body:{nome:obj.name,tipo:obj.type,saldo_inicial:obj.opening,ativa:obj.enabled==='true'}});
  else if(type==='categories')await api.request('/categorias'+(id!==null?'/'+id:''),{method:id!==null?'PUT':'POST',body:{nome:obj.name,tipo:obj.type}});
  else if(storageMode==='relacional'){
    const body=type==='investments'?{nome:obj.name,saldo_atual:obj.balance,observacao:obj.note,ativo:obj.active==='true', ...(id===null?{proximo_aporte:obj.contribution,data_aporte:selectedMonth+'-01'}:{})}:{nome:obj.name,valor_meta:obj.target,valor_atual:obj.current,data_limite:obj.deadline,descricao:obj.action,status:obj.status||'ativa'};
    await api.request((type==='investments'?'/investimentos':'/metas')+(id!==null?'/'+id:''),{method:id!==null?'PUT':'POST',body});
  }
  else{
    schemas[type].fields.forEach(([key,,kind])=>{if(kind==='number')obj[key]=Number(obj[key]);});
    const original=structuredClone(state[type]);
    if(id!==null)state[type]=state[type].map(x=>x.id===id?{...x,...obj}:x);else state[type].push({...obj,id:Date.now()});
    try{await saveExtra();}catch(error){state[type]=original;throw error;}
  }
}
function switchView(view) {
  if(!currentUser)return;
  if(view==='profiles'&&currentUser.role!=='admin')return;
  active=view;
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===view+'-view'));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  const names={dashboard:'Visão geral',expenses:'Despesas',revenues:'Receitas',investments:'Investimentos',accounts:'Contas',categories:'Categorias',goals:'Metas',notes:'Notas',profiles:'Perfis de acesso'};
  $('#page-title').textContent=names[view];$('#primaryAction').hidden=view==='profiles';
  $('#primaryAction').textContent=view==='notes'?'Excluir nota':`Adicionar ${schemas[view==='dashboard'?'expenses':view]?.title.toLowerCase()||''}`;
  syncNoteControls();
  if(view==='profiles')run(renderProfiles,false);
}
async function renderProfiles() {
  profileCache=(await api.get('/usuarios')).map(displayUser);
  $('#profileList').innerHTML=profileCache.map(x=>`<div class="data-row"><strong>${esc(x.name)}<small>${esc(x.email)}</small></strong><span>${x.role==='admin'?'Administrador':'Usuário comum'}</span><span>${x.createdAt?dateBR(x.createdAt.slice(0,10)):''}</span><span>${x.id===currentUser.id?'Conta atual':'Ativo'}</span><div class="row-actions"><button class="icon-button" data-profile-edit="${x.id}" aria-label="Editar perfil">✎</button><button class="icon-button danger" data-profile-delete="${x.id}" ${x.id===currentUser.id?'disabled':''} aria-label="Excluir perfil">×</button></div></div>`).join('');
}
function openProfileDialog(id=null) {
  editingProfileId=id;const user=id===currentUser.id?currentUser:profileCache.find(x=>x.id===id);
  $('#profileDialogTitle').textContent=user?'Editar perfil':'Criar perfil';$('#profileName').value=user?.name||'';$('#profileEmail').value=user?.email||'';$('#profileRole').value=user?.role||'user';
  $('#profileRole').disabled=currentUser.role!=='admin'||id===currentUser.id;$('#profilePassword').required=!user;$('#profilePassword').value='';$('#passwordHint').textContent=user?'Deixe em branco para manter a senha':'Mínimo de 8 caracteres';$('#profileMessage').textContent='';$('#profileDialog').showModal();
}
function showAuth(tab='login') {
  sessionGeneration++;clearTimeout(notesTimer);api.setToken(null);currentUser=null;notesDirty=false;
  state={income:0,expenses:[],investments:[],accounts:[],goals:[],notes:''};categories=[];revenues=[];profileCache=[];periodSummary=null;stateVersion=0;selectedNoteId=null;editing=null;editingProfileId=null;
  document.dispatchEvent(new Event('session-cleared'));
  document.querySelectorAll('#appShell input,#appShell textarea').forEach(x=>{if(x.id!=='monthFilter')x.value='';});
  document.querySelectorAll('#appShell .data-list,#appShell .card-grid,#appShell .bar-list,#appShell .goal-list,#investmentProjection,#checks').forEach(x=>x.replaceChildren());
  document.querySelectorAll('#appShell strong,#appShell small').forEach(x=>{if(x.id)x.textContent='';});
  $('#currentUserName').textContent='';$('#currentUserEmail').textContent='';$('#userPopover').hidden=true;
  try{localStorage.removeItem('controleFinanceiroSessionV2');}catch{}
  document.querySelectorAll('input[type=password]').forEach(x=>x.value='');
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  $('#appShell').hidden=true;$('#authScreen').hidden=false;document.querySelector(`[data-auth-tab="${tab}"]`).click();
}
async function enterApp(result) {
  api.setToken(result.token);currentUser=displayUser(result.user);
  await reloadData();$('#authScreen').hidden=true;$('#appShell').hidden=false;
  $('#currentUserName').textContent=currentUser.name;$('#currentUserEmail').textContent=currentUser.email;
  document.querySelectorAll('.admin-only').forEach(x=>x.hidden=currentUser.role!=='admin');
  switchView('dashboard');notice('Dados verificados e armazenados com segurança.');
}
document.querySelectorAll('[data-auth-tab]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-auth-tab]').forEach(x=>x.classList.toggle('active',x===button));
  $('#loginForm').hidden=button.dataset.authTab!=='login';$('#registerForm').hidden=button.dataset.authTab!=='register';$('#authTitle').textContent=button.dataset.authTab==='login'?'Entre na sua conta':'Crie sua conta';
}));
for(const [form,path,message]of [['loginForm','login','loginMessage'],['registerForm','register','registerMessage']])$('#'+form).addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button[type="submit"]');if(button.disabled)return;button.disabled=true;
  const data=new FormData(event.target);$('#'+message).textContent='Conectando…';
  try{const result=await api.post('/auth/'+path,{nome:data.get('name'),email:data.get('email'),senha:data.get('password')});await enterApp(result);event.target.reset();$('#'+message).textContent='';}
  catch(error){$('#'+message).textContent=error.message;}finally{button.disabled=false;}
});
document.addEventListener('session-expired',()=>{showAuth();$('#loginMessage').textContent='Sessão expirada. Entre novamente.';});
$('#nav').addEventListener('click',event=>{if(event.target.dataset.view)switchView(event.target.dataset.view);});
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.go)switchView(button.dataset.go);
  if(button.dataset.edit)openDialog(button.dataset.edit,Number(button.dataset.id));
  if(button.dataset.profileEdit)openProfileDialog(Number(button.dataset.profileEdit));
  if(button.dataset.profileDelete&&await confirmAction('Excluir este perfil e seus registros? Esta ação não poderá ser desfeita.'))run(async()=>{await api.delete('/usuarios/'+button.dataset.profileDelete);await renderProfiles();},false);
  if(button.dataset.delete&&await confirmAction('Excluir este registro? Esta ação não poderá ser desfeita.'))run(async()=>{
    const type=button.dataset.delete,id=Number(button.dataset.id);
    const path={expenses:id<0?'/planejamentos/'+(-id):'/transacoes/'+id,revenues:'/transacoes/'+id,accounts:'/contas/'+id,categories:'/categorias/'+id,...(storageMode==='relacional'?{investments:'/investimentos/'+id,goals:'/metas/'+id}:{})}[type];
    if(path)await api.delete(path);else{const old=state[type];state[type]=old.filter(x=>x.id!==id);try{await saveExtra();}catch(error){state[type]=old;throw error;}}
  });
});
$('#primaryAction').addEventListener('click',async()=>{
  if(active==='notes'){
    if(busy)return;
    const id=selectedNoteId,generation=sessionGeneration;
    if(storageMode==='relacional'&&!id)return;
    if(await confirmAction('Excluir esta nota? Esta ação não poderá ser desfeita.')){
      if(busy||generation!==sessionGeneration||id!==selectedNoteId)return;
      clearTimeout(notesTimer);const pending=notesDirty;notesDirty=false;
      await run(async()=>{
        try{
          if(storageMode==='relacional'){
            await api.delete('/notas/'+id);
            if(generation!==sessionGeneration||!currentUser)return;
            state.noteRecords=state.noteRecords.filter(n=>n.id!==id);selectedNoteId=null;renderNotes();noteStatus('Nota excluída.');return;
          }
          const old=state.notes;state.notes='';try{await saveExtra();$('#notesInput').value='';noteStatus('Nota excluída.');}catch(error){state.notes=old;throw error;}
        }catch(error){if(generation===sessionGeneration){notesDirty=pending;noteStatus('Não foi possível excluir a nota. Tente novamente.',true);}throw error;}
      },false);
    }return;
  }
  openDialog(active==='dashboard'?'expenses':active);
});
$('#expenseSearch').addEventListener('input',renderExpenses);
$('#itemForm').addEventListener('submit',event=>{
  event.preventDefault();const obj=Object.fromEntries(new FormData(event.target));
  run(async()=>{try{await saveItem(obj);$('#itemDialog').close();}catch(error){$('#itemMessage').textContent=error.message;throw error;}});
});
$('#profileForm').addEventListener('submit',event=>{
  event.preventDefault();const fd=new FormData(event.target),body={nome:fd.get('name'),email:fd.get('email')};
  if(fd.get('role'))body.role=fd.get('role');if(fd.get('password'))body.senha=fd.get('password');
  run(async()=>{
    try{const user=await api.request('/usuarios'+(editingProfileId!==null?'/'+editingProfileId:''),{method:editingProfileId!==null?'PUT':'POST',body});
      $('#profileDialog').close();
      if(editingProfileId===currentUser.id){currentUser=displayUser(user);$('#currentUserName').textContent=user.nome;$('#currentUserEmail').textContent=user.email;if(body.senha){showAuth();return;}}
      if(active==='profiles')await renderProfiles();
    }catch(error){$('#profileMessage').textContent=error.message;throw error;}
  },false);
});
document.querySelectorAll('dialog button[value="cancel"]').forEach(button=>{button.type='button';button.addEventListener('click',()=>button.closest('dialog').close());});
for(const field of ['#notesInput','#noteTitle'])$(field).addEventListener('input',()=>{notesDirty=true;noteStatus('Alterações pendentes…');notice('Notas pendentes…');clearTimeout(notesTimer);notesTimer=setTimeout(()=>run(async()=>{},false),800);});
window.addEventListener('beforeunload',event=>{if(notesDirty||busy){event.preventDefault();event.returnValue='';}});
$('#addProfileBtn').addEventListener('click',()=>openProfileDialog());
$('#editOwnProfile').addEventListener('click',()=>{$('#userPopover').hidden=true;openProfileDialog(currentUser.id);});
$('#userMenuBtn').addEventListener('click',()=>{const pop=$('#userPopover');pop.hidden=!pop.hidden;$('#userMenuBtn').setAttribute('aria-expanded',String(!pop.hidden));});
$('#logoutBtn').addEventListener('click',async()=>{
  const pending=api.post('/auth/logout',{});showAuth();
  $('#loginMessage').textContent='Você saiu da sua conta com segurança.';
  try{await pending;}catch{} // A sessão local termina mesmo sem rede.
});
window.addEventListener('pagehide',()=>{if(currentUser)showAuth();});
window.addEventListener('pageshow',event=>{if(event.persisted||(currentUser&&!api.hasToken()))showAuth();});
$('#monthFilter').value=selectedMonth;
$('#monthFilter').addEventListener('change',event=>{
  const value=event.target.value;if(!/^\d{4}-\d{2}$/.test(value))return;
  run(async()=>{selectedMonth=value;});
});
$('#refreshData').title='Busca os registros mais recentes e recalcula saldos, gráficos e indicadores.';
$('#refreshData').addEventListener('click',async()=>{
  if(busy||!currentUser)return;
  if(notesDirty){notice('Aguarde o salvamento das notas antes de atualizar.',true);return;}
  busy=true;const controls=[...document.querySelectorAll('#appShell input,#appShell select,#appShell textarea,#appShell button:not(#logoutBtn):not(#userMenuBtn)')].filter(x=>!x.disabled);controls.forEach(x=>x.disabled=true);const button=$('#refreshData');button.disabled=true;button.textContent='Atualizando dados...';button.setAttribute('aria-busy','true');notice('Atualizando dados...');
  try{await reloadData();if(currentUser)notice('Dados atualizados com sucesso.');}catch{if(currentUser)notice('Não foi possível atualizar os dados. Tente novamente.',true);}
  finally{busy=false;controls.forEach(x=>x.disabled=false);button.disabled=false;button.textContent='Atualizar dados';button.removeAttribute('aria-busy');if(currentUser)syncNoteControls();}
});
$('#legacyMigrationButton').addEventListener('click',()=>migrarDadosLocalStorage().catch(error=>notice(error.message,true)));
$('#today').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date());
showAuth();
