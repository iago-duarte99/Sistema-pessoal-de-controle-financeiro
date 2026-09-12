import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
const worker=await readFile(new URL('../../js/import-worker.js',import.meta.url),'utf8');
const schema=await readFile(new URL('../../js/import-schema.js',import.meta.url),'utf8');
async function parse(buffer,extension) {
  let result;
  const sandbox={Uint8Array,DataView,TextDecoder,Date,ExcelJS,self:{postMessage:data=>{result=data;}}};
  const context=vm.createContext(sandbox);sandbox.importScripts=path=>{if(path.includes('import-schema'))vm.runInContext(schema,context);};
  vm.runInContext(worker,context);await sandbox.self.onmessage({data:{extension,buffer:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)}});return result;
}
test('XLSX válido é lido localmente; fórmulas e múltiplas abas são rejeitadas',async()=>{
  const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Dados');
  sheet.addRow(['tipo','descricao','valor','data','categoria','conta']);sheet.addRow(['receita','Salário',100,'2026-09-01','Salário','Banco']);
  const valid=await parse(await wb.xlsx.writeBuffer(),'xlsx');assert.equal(valid.rows.length,1);assert.equal(valid.rows[0].valor,100);
  sheet.getCell('C2').value={formula:'1+1',result:2};assert.match((await parse(await wb.xlsx.writeBuffer(),'xlsx')).error,/Fórmulas/);
  wb.addWorksheet('Outra');assert.match((await parse(await wb.xlsx.writeBuffer(),'xlsx')).error,/única aba/);
});
test('CSV e JSON válidos; assinatura e conteúdo inválidos rejeitados',async()=>{
  assert.equal((await parse(Buffer.from('[{"tipo":"receita"}]'),'json')).rows.length,1);
  assert.equal((await parse(Buffer.from('tipo;descricao;valor;data;categoria;conta\nreceita;Salário;10;2026-09-01;Salário;Banco'),'csv')).rows.length,1);
  assert.match((await parse(Buffer.from('{bad'),'json')).error,/inválido/);
  assert.match((await parse(Buffer.from('not a workbook'),'xlsx')).error,/inválido/);
});
