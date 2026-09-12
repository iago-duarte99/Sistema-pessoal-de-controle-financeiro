(function(root){
  const keys=['tipo','descricao','valor','data','categoria','conta','status'];
  const clean=x=>String(x??'').trim();
  function normalize(row) {
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Registro deve ser um objeto.');
    if(Object.keys(row).some(k=>!keys.includes(k)))throw new Error('Colunas desconhecidas. Use o modelo indicado.');
    const r=Object.fromEntries(keys.map(k=>[k,clean(row[k])]));
    r.tipo=r.tipo.toLowerCase();r.status=(r.status||'realizado').toLowerCase();
    if(!['receita','despesa'].includes(r.tipo))throw new Error('Tipo deve ser receita ou despesa.');
    if(!r.descricao||r.descricao.length>255)throw new Error('Descrição obrigatória, até 255 caracteres.');
    if(!r.conta||r.conta.length>100||!r.categoria||r.categoria.length>100)throw new Error('Informe conta e categoria existentes.');
    if(/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(r.valor))r.valor=r.valor.replaceAll('.','').replace(',','.');
    else if(/^\d+,\d{1,2}$/.test(r.valor))r.valor=r.valor.replace(',','.');
    if(!/^\d+(\.\d{1,2})?$/.test(r.valor)||Number(r.valor)<=0||Number(r.valor)>9999999999999.99)throw new Error('Valor positivo com até duas casas decimais.');
    r.valor=Number(r.valor).toFixed(2);
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(r.data))r.data=r.data.split('/').reverse().join('-');
    const date=new Date(r.data+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.data)||r.data<'1000-01-01'||r.data>'9999-12-31'||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==r.data)throw new Error('Data inválida. Use AAAA-MM-DD ou DD/MM/AAAA.');
    if(r.status!=='realizado')throw new Error('Este formato importa somente receitas e despesas realizadas.');
    return r;
  }
  const fingerprint=r=>JSON.stringify(keys.map(k=>r[k]));
  function preview(rows,context) {
    if(!Array.isArray(rows)||!rows.length||rows.length>500)throw new Error('Informe de 1 a 500 registros.');
    const seen=new Set(context.existing||[]);
    return rows.map((input,index)=>{
      try{
        const row=normalize(input);
        const accounts=context.accounts.filter(a=>a.nome===row.conta&&Boolean(a.ativa));
        const categories=context.categories.filter(c=>c.nome===row.categoria&&c.tipo===row.tipo);
        if(accounts.length!==1||categories.length!==1)throw new Error('Conta/categoria inexistente, inativa, ambígua ou incompatível.');
        const key=fingerprint(row),duplicate=seen.has(key);seen.add(key);
        return {index,row,status:duplicate?'duplicado':'válido',aviso:duplicate?'Registro já encontrado; será ignorado.':'',conta_id:accounts[0].id,categoria_id:categories[0].id};
      }catch(error){return {index,row:Object.fromEntries(keys.map(k=>[k,typeof input?.[k]==='string'||typeof input?.[k]==='number'?String(input[k]).slice(0,255):''])),status:'inválido',aviso:error.message};}
    });
  }
  function csv(text) {
    text=text.replace(/^\uFEFF/,'');
    const first=text.split(/\r?\n/,1)[0],delimiter=first.includes(';')?';':first.includes('\t')?'\t':',';
    const matrix=[];let row=[],cell='',quoted=false,closed=false;
    for(let i=0;i<text.length;i++) {
      const c=text[i];
      if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else {quoted=false;closed=true;}}else cell+=c;}
      else if(c==='"'&&!cell&&!closed)quoted=true;
      else if(c===delimiter){row.push(cell);cell='';closed=false;}
      else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))matrix.push(row);row=[];cell='';closed=false;}
      else {if(closed)throw new Error('CSV inválido após aspas.');cell+=c;}
      if(matrix.length>501||row.length>7||cell.length>10000)throw new Error('CSV excede os limites.');
    }
    if(quoted)throw new Error('CSV com aspas não fechadas.');
    row.push(cell);if(row.some(x=>x!==''))matrix.push(row);
    return fromMatrix(matrix);
  }
  function fromMatrix(matrix) {
    const headers=matrix.shift()?.map(x=>clean(x).toLowerCase());
    if(!headers||new Set(headers).size!==headers.length||headers.some(k=>!keys.includes(k))||keys.filter(k=>k!=='status').some(k=>!headers.includes(k)))throw new Error('Cabeçalho: tipo, descricao, valor, data, categoria, conta, status (opcional).');
    return matrix.map(row=>row.length!==headers.length?{erro:'Número incorreto de colunas'}:Object.fromEntries(headers.map((k,i)=>[k,row[i]])));
  }
  root.FinanceImport={normalize,fingerprint,preview,csv,fromMatrix,keys};
})(globalThis);
