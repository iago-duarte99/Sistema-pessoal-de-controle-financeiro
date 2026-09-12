async function migrarDadosLocalStorage() {
  if(!currentUser||busy)return;
  let legacyUsers;
  try{legacyUsers=JSON.parse(localStorage.getItem('controleFinanceiroUsersV2')||'[]');}catch{throw new Error('Cadastro legado contém JSON inválido. Preserve uma cópia antes de corrigir.');}
  if(!Array.isArray(legacyUsers))throw new Error('Cadastro legado deve ser uma lista de perfis.');
  const matches=legacyUsers.filter(u=>String(u.email).trim().toLowerCase()===currentUser.email.toLowerCase());
  if(matches.length!==1)throw new Error('Não foi encontrado um único perfil local com o mesmo e-mail. Abra a aplicação na mesma origem do navegador usada anteriormente.');
  const legacy=matches[0],key=`controleFinanceiroDataV2:${legacy.id}`;
  const raw=localStorage.getItem(key);
  if(!raw)throw new Error('Dados locais não encontrados. O backup permanece intacto; consulte o plano de migração.');
  let data;try{data=JSON.parse(raw);}catch{throw new Error('Dados locais não são um JSON válido.');}
  $('#migrationInfo').textContent=`Serão importadas ${data.accounts?.length||0} contas, ${data.expenses?.length||0} despesas/planejamentos, investimentos, metas e notas. A renda antiga é um total sem histórico. As transações serão associadas à primeira conta, com ajuste do saldo inicial para preservar o saldo atual. O perfil de destino deve estar vazio. Nenhum dado local será apagado.`;
  $('#migrationDate').value=localDay();$('#legacyPassword').value='';$('#migrationMessage').textContent='';
  $('#migrationDialog').showModal();
  $('#migrationForm').onsubmit=async event=>{
    event.preventDefault();
    const password=$('#legacyPassword').value,reference=$('#migrationDate').value;
    const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
    try{
      const cryptoKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
      const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(legacy.salt),iterations:210000,hash:'SHA-256'},cryptoKey,256);
      const hash=btoa(String.fromCharCode(...new Uint8Array(bits)));
      if(hash!==legacy.hash)throw new Error('Senha do perfil local inválida.');
      await run(async()=>{
        try{
          const result=await api.post('/migracoes/localstorage',{origem:key,data_referencia:reference,dados:data});
          const receipts=await api.get('/migracoes/localstorage');
          if(!result.concluida||!receipts.some(r=>r.origem===key&&r.checksum===result.checksum))throw new Error('A confirmação da importação não foi obtida. Os dados antigos foram preservados.');
          // Marcador só depois do commit e da leitura independente do recibo.
          try{localStorage.setItem(`${key}:mysql:${currentUser.id}:migracao`,JSON.stringify({checksum:result.checksum,concluidaEm:new Date().toISOString(),dataReferencia:reference}));}catch{ /* O recibo durável no servidor permite repetir sem duplicar. */ }
          selectedMonth=reference.slice(0,7);$('#monthFilter').value=selectedMonth;$('#migrationDialog').close();$('#legacyPassword').value='';
        }catch(error){$('#migrationMessage').textContent=error.message;throw error;}
      });
    }catch(error){$('#migrationMessage').textContent=error.message;}
  };
}
