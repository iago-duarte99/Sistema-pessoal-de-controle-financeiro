import test from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../src/services/validation.js';
import { owner } from '../src/middleware/auth.js';

test('valores monetários, IDs, tipos e e-mails inválidos são rejeitados',()=>{
  for(const value of [0,-1,'1.001','NaN',null,{},'1e2',''])assert.throws(()=>v.amount(value));
  assert.equal(v.amount('150.00'),'150.00');assert.equal(v.amount(0,'previsto',0),'0.00');
  for(const value of [0,-1,'1 OR 1=1',1.2,2147483648])assert.throws(()=>v.id(value));
  assert.throws(()=>v.type('transferencia'));assert.throws(()=>v.email('invalid@'));
  assert.equal(v.email(' Teste@Example.com '),'teste@example.com');
});
test('datas reais, anos bissextos e períodos consistentes',()=>{
  assert.equal(v.date('2024-02-29'),'2024-02-29');
  for(const date of ['2026-02-29','2026-04-31','2026-13-01','2026-9-01','0999-12-31'])assert.throws(()=>v.date(date));
  assert.throws(()=>v.period({data_inicio:'2026-09-30',data_fim:'2026-09-01'}));
});
test('isolamento exige usuário autenticado mesmo para administrador',()=>{
  const req={user:{id:1,role:'admin'},query:{usuario_id:'2'},params:{},body:{}};
  assert.throws(()=>owner(req),e=>e.status===403);
  req.query={};req.body.usuario_id=1;assert.equal(owner(req),1);
});
test('dados auxiliares validam metas e IDs repetidos',()=>{
  assert.throws(()=>v.extra({investments:[],goals:[{id:1,name:'Meta',target:0,current:0,deadline:'',action:''}],notes:''}));
  const item={id:1,name:'Reserva',balance:100,contribution:0,note:''};
  assert.throws(()=>v.extra({investments:[item,item],goals:[],notes:''}));
  assert.equal(v.extra({investments:[item],goals:[],notes:'Nota'}).investments[0].balance,'100.00');
  assert.equal(v.extra({investments:[],goals:[],notes:'  \n  '}).notes,'  \n  ');
});
