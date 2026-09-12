(() => {
  let rows=[],preview=[],worker=null,generation=0,timeout;
  const dialog=document.createElement('dialog');dialog.id='importDialog';dialog.setAttribute('aria-labelledby','importTitle');
  dialog.innerHTML=`<form id="importForm"><div class="dialog-head"><h2 id="importTitle">Importar dados locais</h2><button type="button" class="icon-button" data-import-cancel aria-label="Fechar">×</button></div><p>Formatos compatíveis: CSV, XLSX e JSON.</p><p>Até 2 MB e 500 receitas/despesas realizadas. Use contas e categorias já cadastradas. O arquivo é lido neste navegador.</p><p>Colunas: tipo, descricao, valor, data, categoria, conta, status (opcional). JSON: lista de objetos com esses campos. XLSX: uma aba.</p><label for="importFile">Selecionar arquivo</label><input id="importFile" type="file" accept=".csv,.xlsx,.json"><p id="importMessage" role="status" aria-live="polite"></p><div id="importPreview" class="import-preview" tabindex="0" aria-label="Prévia da importação"></div><div class="dialog-actions"><button type="button" class="button ghost" data-import-cancel>Cancelar</button><button class="button" id="confirmImport" type="submit" disabled>Confirmar importação</button></div></form>`;
  document.body.append(dialog);
  function clear(){generation++;worker?.terminate();worker=null;clearTimeout(timeout);rows=[];preview=[];$('#importFile').value='';$('#importPreview').replaceChildren();$('#confirmImport').disabled=true;}
  dialog.addEventListener('close',clear);
  document.addEventListener('session-cleared',clear);
  dialog.querySelectorAll('[data-import-cancel]').forEach(b=>b.onclick=()=>dialog.close());
  $('#migrationButton').onclick=()=>{if(busy)return;clear();$('#importMessage').textContent='';dialog.showModal();};
  $('#importFile').onchange=async e=>{
    worker?.terminate();clearTimeout(timeout);rows=[];preview=[];$('#importPreview').replaceChildren();$('#confirmImport').disabled=true;
    const current=++generation,file=e.target.files[0];if(!file)return;
    const ext=file.name.split('.').pop().toLowerCase();
    const types={csv:['text/csv','application/csv','text/plain','application/vnd.ms-excel'],json:['application/json','text/json','text/plain'],xlsx:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']};
    try{
      if(!types[ext]||file.size>2*1024*1024||!file.size||(file.type&&!types[ext].includes(file.type)&&file.type!=='application/octet-stream'))throw new Error('Arquivo incompatível ou maior que 2 MB.');
      $('#importMessage').textContent='Lendo e validando arquivo...';
      const buffer=await file.arrayBuffer();if(current!==generation)return;
      worker=new Worker('/js/import-worker.js');
      const parsed=await new Promise((resolve,reject)=>{
        timeout=setTimeout(()=>{worker?.terminate();reject(new Error('Arquivo demorou demais para processar.'));},10000);
        worker.onerror=()=>reject(new Error('Não foi possível ler este arquivo.'));
        worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.rows);
        worker.postMessage({extension:ext,buffer},[buffer]);
      });
      clearTimeout(timeout);worker?.terminate();worker=null;
      const context=await api.get('/importacao/contexto');if(current!==generation||!currentUser)return;
      rows=parsed;preview=FinanceImport.preview(rows,context);
      const counts={válido:0,duplicado:0,inválido:0};preview.forEach(x=>counts[x.status]++);
      $('#importMessage').textContent=`${counts.válido} registros válidos · ${counts.duplicado} duplicados · ${counts.inválido} inválidos. Somente válidos serão importados após confirmação.`;
      $('#importPreview').innerHTML='<table><thead><tr>'+['Tipo','Descrição','Valor','Data','Categoria','Conta','Status','Avisos'].map(x=>`<th scope="col">${x}</th>`).join('')+'</tr></thead><tbody>'+preview.map(x=>'<tr>'+[x.row.tipo,x.row.descricao,x.row.valor,x.row.data,x.row.categoria,x.row.conta,x.status,x.aviso].map(v=>`<td>${esc(v)}</td>`).join('')+'</tr>').join('')+'</tbody></table>';
      $('#confirmImport').disabled=!counts.válido;
    }catch(error){if(current===generation)$('#importMessage').textContent=error.message;clearTimeout(timeout);worker?.terminate();worker=null;}
  };
  $('#importForm').onsubmit=async event=>{
    event.preventDefault();if(busy||!preview.some(x=>x.status==='válido'))return;
    const current=generation;
    if(!await confirmAction('Tem certeza de que deseja importar os registros válidos? Esta ação poderá alterar seus dados.'))return;
    if(current!==generation||!currentUser)return;
    await run(async()=>{
      $('#confirmImport').disabled=true;
      try{
        const result=await api.post('/importacao',{confirmado:true,registros:rows});
        $('#importMessage').textContent=`Dados importados com sucesso. Revise as informações para confirmar que estão corretas. ${result.importados} importados, ${result.ignorados} ignorados, ${result.rejeitados} rejeitados.${result.repetida?' Este arquivo já havia sido processado.':''}`;
        rows=[];preview=[];$('#importPreview').replaceChildren();
      }catch(error){$('#importMessage').textContent=error.message;$('#confirmImport').disabled=false;throw error;}
    });
  };
})();
