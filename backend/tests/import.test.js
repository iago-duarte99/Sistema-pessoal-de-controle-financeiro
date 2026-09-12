import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/import-schema.js';
import { parseLegacy } from '../src/services/relational.js';
import { valuesFor } from '../src/controllers/relationalController.js';
import { financialTotals } from '../src/services/finance.js';
const schema=globalThis.FinanceImport;
const row={tipo:'receita',descricao:'Salário',valor:'1.234,56',data:'05/09/2026',categoria:'Salário',conta:'Banco'};
const context={accounts:[{id:1,nome:'Banco',ativa:1}],categories:[{id:1,nome:'Salário',tipo:'receita'}],existing:[]};
test('CSV com BOM, delimitador, aspas, vírgula decimal e quebra dentro da célula',()=>{
  const rows=schema.csv('\uFEFFtipo;descricao;valor;data;categoria;conta\r\nreceita;"Salário; extra\nsegunda linha";"1.234,56";05/09/2026;Salário;Banco');
  assert.equal(rows.length,1);assert.equal(schema.normalize(rows[0]).valor,'1234.56');assert.match(rows[0].descricao,/\n/);
  assert.throws(()=>schema.csv('tipo,descricao\nreceita,"aspas'));
});
test('JSON schema, duplicados, inválidos, conta/categoria e datas',()=>{
  const result=schema.preview([row,row,{...row,data:'31/02/2026'},{...row,conta:'Outro'},{...row,valor:'1e9'},{...row,usuario_id:2}],context);
  assert.deepEqual(result.map(x=>x.status),['válido','duplicado','inválido','inválido','inválido','inválido']);
  const existing=[schema.fingerprint(schema.normalize(row))];assert.equal(schema.preview([row],{...context,existing})[0].status,'duplicado');
  assert.throws(()=>schema.preview({},context));assert.throws(()=>schema.preview(Array(501).fill(row),context));
});
test('JSON legado inválido, IDs duplicados e notas preservadas',()=>{
  assert.equal(parseLegacy('{').rejected.length,1);
  const investment={id:1,name:'Reserva',balance:10,contribution:0,note:''};
  const result=parseLegacy({investments:[investment,investment,{id:2,balance:-1}],goals:[],notes:'  \n  '});
  assert.equal(result.data.investments.length,1);assert.equal(result.rejected.length,2);assert.equal(result.data.notes,'  \n  ');
});
test('validações relacionais, datas de realização e metas',()=>{
  assert.throws(()=>valuesFor('aportes',{tipo:'realizado',valor:10}));
  assert.throws(()=>valuesFor('metas',{nome:'x',valor_meta:0,valor_atual:0}));
  assert.throws(()=>valuesFor('investimentos',{nome:'x',saldo_atual:0,ativo:'false'}));
  assert.equal(valuesFor('notas',{conteudo:'  conteúdo  '}).conteudo,'  conteúdo  ');
});
test('totais exatos, investimentos inativos excluídos e histórico não descontado',()=>{
  assert.deepEqual(financialTotals({investments:[{balance:'1000.10',contribution:'50.25'},{balance:'999.99',contribution:'200.00',active:false}]},'500.00','100.00'),{patrimonio:'1000.10',aportes_planejados:'50.25',patrimonio_apos_aportes:'1050.35',saldo_livre:'349.75'});
  const many=Array(1000).fill({balance:'9999999999999.99',contribution:'0.01'});
  assert.equal(financialTotals({investments:many},'0.00','0.00').patrimonio,'9999999999999990.00');
});
