import { HttpError } from '../middleware/errors.js';
import { readState } from './relational.js';
import * as v from './validation.js';

export async function related(db, table, recordId, userId) {
  // Nomes de tabela vêm apenas dos controladores, nunca da requisição.
  const [rows] = await db.execute(`SELECT * FROM ${table} WHERE id=? AND usuario_id=? FOR UPDATE`, [v.id(recordId), userId]);
  if (!rows.length) throw new HttpError(400, 'Conta ou categoria inexistente ou pertencente a outro usuário.');
  return rows[0];
}
export async function transactionValues(db, body, userId) {
  const tipo = v.type(body.tipo), contaId = v.id(body.conta_id, 'conta_id'), categoriaId = v.id(body.categoria_id, 'categoria_id');
  const conta = await related(db, 'contas', contaId, userId), categoria = await related(db, 'categorias', categoriaId, userId);
  if (!conta.ativa) throw new HttpError(400, 'Conta inativa.');
  if (categoria.tipo !== tipo) throw new HttpError(400, 'Categoria incompatível com o tipo da transação.');
  return [contaId, categoriaId, v.text(body.descricao,'descricao',255), v.amount(body.valor), tipo, v.date(body.data_transacao), v.text(body.observacao,'observacao',10000,true)];
}
export function filters(query, userId, alias = 't') {
  const clauses = [`${alias}.usuario_id=?`], values = [userId];
  for (const key of ['conta_id','categoria_id']) if (query[key] !== undefined) { clauses.push(`${alias}.${key}=?`); values.push(v.id(query[key],key)); }
  if (query.tipo !== undefined) { clauses.push(`${alias}.tipo=?`); values.push(v.type(query.tipo)); }
  const { start, end } = v.period(query);
  if (start) { clauses.push(`${alias}.data_transacao>=?`); values.push(start); }
  if (end) { clauses.push(`${alias}.data_transacao<=?`); values.push(end); }
  return { sql: clauses.join(' AND '), values };
}
export function financialTotals(data, receitas, despesas) {
  const cents=value=>{
    const text=String(value),negative=text.startsWith('-'),[whole,fraction='']=text.replace('-','').split('.');
    return (BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*(negative?-1n:1n);
  };
  const decimal=value=>`${value<0n?'-':''}${(value<0n?-value:value)/100n}.${String((value<0n?-value:value)%100n).padStart(2,'0')}`;
  const active=data.investments.filter(x=>x.active!==false);
  const wealth=active.reduce((s,x)=>s+cents(x.balance),0n),contributions=active.reduce((s,x)=>s+cents(x.contribution),0n);
  return {patrimonio:decimal(wealth),aportes_planejados:decimal(contributions),patrimonio_apos_aportes:decimal(wealth+contributions),saldo_livre:decimal(cents(receitas)-cents(despesas)-contributions)};
}
export async function summary(db, userId, query) {
  const f = filters(query, userId);
  const [rows] = await db.execute(`SELECT COALESCE(SUM(CASE WHEN t.tipo='receita' THEN t.valor ELSE 0 END),0) receitas,COALESCE(SUM(CASE WHEN t.tipo='despesa' THEN t.valor ELSE 0 END),0) despesas,COALESCE(SUM(CASE WHEN t.tipo='receita' THEN t.valor ELSE -t.valor END),0) saldo_periodo,COUNT(*) quantidade_transacoes FROM transacoes t WHERE ${f.sql}`, f.values);
  const [balance] = await db.execute("SELECT COALESCE((SELECT SUM(saldo_inicial) FROM contas WHERE usuario_id=?),0)+COALESCE((SELECT SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END) FROM transacoes WHERE usuario_id=?),0) saldo_total", [userId,userId]);
  const [categories] = await db.execute(`SELECT c.id,c.nome,t.tipo,SUM(t.valor) total FROM transacoes t JOIN categorias c ON c.id=t.categoria_id WHERE ${f.sql} GROUP BY c.id,c.nome,t.tipo ORDER BY total DESC`, f.values);
  const {dados}=await readState(db,userId,query);
  return { ...financialTotals(dados,rows[0].receitas,rows[0].despesas), ...rows[0], ...balance[0], receitas_por_categoria: categories.filter(x=>x.tipo==='receita'), despesas_por_categoria: categories.filter(x=>x.tipo==='despesa') };
}
