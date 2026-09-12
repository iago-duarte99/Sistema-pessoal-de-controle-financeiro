importScripts('/js/import-schema.js');
self.onmessage=async({data})=>{
  try{
    let rows;
    if(data.extension==='xlsx'){
      // Limita ZIP antes da descompressão. XLSX criptografado/ZIP64 não é aceito.
      const bytes=new Uint8Array(data.buffer),view=new DataView(data.buffer);
      let total=0,entries=0;
      if(view.byteLength<22||view.getUint32(0,true)!==0x04034b50)throw new Error('XLSX inválido.');
      for(let i=0;i+46<bytes.length;i++)if(view.getUint32(i,true)===0x02014b50){
        const size=view.getUint32(i+24,true);total+=size;entries++;
        if(size===0xffffffff||total>20*1024*1024||entries>2000)throw new Error('Planilha descompactada excede 20 MB.');
        i+=45+view.getUint16(i+28,true)+view.getUint16(i+30,true)+view.getUint16(i+32,true);
      }
      if(!entries)throw new Error('Estrutura XLSX inválida.');
      importScripts('/vendor/exceljs.min.js');
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(data.buffer);
      if(workbook.worksheets.length!==1)throw new Error('Use uma planilha com uma única aba.');
      const sheet=workbook.worksheets[0];
      if(sheet.rowCount>501||sheet.columnCount>7)throw new Error('Limite de 500 registros e 7 colunas.');
      const matrix=[];
      sheet.eachRow(row=>matrix.push(Array.from({length:sheet.columnCount},(_,i)=>{
        const value=row.getCell(i+1).value;
        if(value instanceof Date)return value.toISOString().slice(0,10);
        if(value!==null&&typeof value==='object')throw new Error('Fórmulas, links e células complexas não são aceitos.');
        return value??'';
      })));
      rows=FinanceImport.fromMatrix(matrix);
    }else {
      let text;
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(data.buffer);}catch{if(data.extension==='json')throw new Error('JSON deve usar UTF-8.');text=new TextDecoder('windows-1252').decode(data.buffer);}
      rows=data.extension==='csv'?FinanceImport.csv(text):JSON.parse(text);
    }
    if(!Array.isArray(rows)||!rows.length||rows.length>500)throw new Error('Informe de 1 a 500 registros em uma lista.');
    self.postMessage({rows});
  }catch(error){self.postMessage({error:error instanceof SyntaxError?'JSON inválido.':error.message});}
};
