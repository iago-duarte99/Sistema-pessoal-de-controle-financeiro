import { createHash } from 'node:crypto';
import * as v from './validation.js';
import { HttpError } from '../middleware/errors.js';

export const empty = () => ({ investments: [], goals: [], notes: '' });
export const hash = raw => createHash('sha256').update(raw).digest('hex');
export async function available(db) {
  const [r] = await db.execute("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('investimentos','aportes','metas','notas','app_estado_migracoes') AND ENGINE='InnoDB'");
  return Number(r[0].n) === 5;
}
export async function marker(db, userId) {
  if (!await available(db)) return null;
  const [r] = await db.execute('SELECT * FROM app_estado_migracoes WHERE usuario_id=?', [userId]);
  return r[0] || null;
}
export function parseLegacy(raw) {
  const result = empty(), rejected = [];
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return { data: result, rejected: ['JSON inválido'] }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { data: result, rejected: ['Estrutura inválida'] };
  for (const key of ['investments','goals']) {
    if (!Array.isArray(data[key])) { rejected.push(key + ': lista inválida'); continue; }
    const seen = new Set();
    for (const [index, item] of data[key].entries()) {
      try {
        const valid = v.extra({ ...empty(), [key]: [item] })[key][0];
        if (seen.has(valid.id)) throw new Error();
        seen.add(valid.id); result[key].push(valid);
      } catch { rejected.push(`${key}[${index}]: registro inválido ou duplicado`); }
    }
  }
  if (typeof data.notes === 'string' && data.notes.length <= 30000) result.notes = data.notes;
  else rejected.push('notes: conteúdo inválido');
  return { data: result, rejected };
}
export async function readRelational(db, userId, query = {}) {
  const { start, end } = v.period(query);
  const [investments] = await db.execute('SELECT * FROM investimentos WHERE usuario_id=? ORDER BY id', [userId]);
  const values = [userId]; let period = '';
  if (start) { period += ' AND (data_prevista IS NULL OR data_prevista>=?)'; values.push(start); }
  if (end) { period += ' AND (data_prevista IS NULL OR data_prevista<=?)'; values.push(end); }
  const [contributions] = await db.execute("SELECT investimento_id,SUM(valor) total FROM aportes WHERE usuario_id=? AND tipo='planejado'" + period + ' GROUP BY investimento_id', values);
  const [goals] = await db.execute('SELECT * FROM metas WHERE usuario_id=? ORDER BY id', [userId]);
  const [notes] = await db.execute('SELECT * FROM notas WHERE usuario_id=? ORDER BY id', [userId]);
  return {
    investments: investments.map(x => ({ id: x.id, name: x.nome, balance: x.saldo_atual, note: x.observacao || '', active: Boolean(x.ativo), contribution: contributions.find(a => a.investimento_id === x.id)?.total || '0.00' })),
    goals: goals.map(x => ({ id: x.id, name: x.nome, target: x.valor_meta, current: x.valor_atual, deadline: x.data_limite || '', action: x.descricao || '', status: x.status })),
    notes: notes.map(x => x.conteudo).join('\n\n'), noteRecords: notes
  };
}
export async function readState(db, userId, query = {}) {
  const m = await marker(db, userId);
  if (m?.ativo) return { dados: await readRelational(db,userId,query), versao: m.versao, armazenamento: 'relacional' };
  const [r] = await db.execute('SELECT dados,versao FROM app_estado WHERE usuario_id=?', [userId]);
  if (!r.length) return { dados: empty(), versao: 0, armazenamento: await available(db) ? 'relacional' : 'legado' };
  const parsed = parseLegacy(r[0].dados);
  if (parsed.rejected.length) throw new HttpError(409,'Há registros que precisam de revisão antes de carregar os dados. Contate o responsável pelo sistema.');
  return { dados: parsed.data, versao: r[0].versao, armazenamento: 'legado' };
}
// Deve ser chamado dentro de transação, após bloquear usuarios.
export async function requireActive(db,userId) {
  if (!await available(db)) throw new HttpError(409,'Este recurso aguarda atualização pelo responsável pelo sistema.');
  let m = await marker(db,userId);
  if (!m) {
    const [legacy] = await db.execute('SELECT usuario_id FROM app_estado WHERE usuario_id=?',[userId]);
    if (legacy.length) throw new HttpError(409,'Seus registros aguardam migração validada pelo responsável pelo sistema.');
    const raw = JSON.stringify(empty());
    await db.execute('INSERT INTO app_estado_migracoes(usuario_id,original,checksum,versao_original,versao,ativo,contagens,rejeitados) VALUES(?,?,?,0,0,1,?,?)',[userId,raw,hash(raw),'{}','[]']);
    m = await marker(db,userId);
  }
  if (!m.ativo) throw new HttpError(409,'Migração em revisão. Nenhuma alteração foi realizada.');
  return m;
}
export async function bump(db,userId) {
  await db.execute('UPDATE app_estado_migracoes SET versao=versao+1 WHERE usuario_id=?',[userId]);
}
export async function migrateUser(db,userId) {
  await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
  const previous = await marker(db,userId);
  if (previous) return { repetida:true, ativo:Boolean(previous.ativo) };
  const [rows] = await db.execute('SELECT CAST(dados AS CHAR) original,versao FROM app_estado WHERE usuario_id=? FOR UPDATE',[userId]);
  if (!rows.length) return { ausente:true };
  const { original, versao } = rows[0], { data, rejected } = parseLegacy(original);
  for (const table of ['investimentos','metas','notas']) {
    const [existing] = await db.execute(`SELECT id FROM ${table} WHERE usuario_id=? LIMIT 1`,[userId]);
    if (existing.length) throw new Error('Destino não vazio: revisão manual necessária.');
  }
  const counts = { investimentos:data.investments.length, aportes:0, metas:data.goals.length, notas:data.notes ? 1 : 0 };
  // Snapshot inserido antes da transformação e confirmado atomicamente com ela.
  await db.execute('INSERT INTO app_estado_migracoes(usuario_id,original,checksum,versao_original,versao,ativo,contagens,rejeitados) VALUES(?,?,?,?,?,0,?,?)',[userId,original,hash(original),versao,versao,JSON.stringify(counts),JSON.stringify(rejected)]);
  for (const x of data.investments) {
    const [r] = await db.execute('INSERT INTO investimentos(usuario_id,legado_id,nome,saldo_atual,observacao) VALUES(?,?,?,?,?)',[userId,x.id,x.name,x.balance,x.note]);
    if (Number(x.contribution)>0) {
      await db.execute("INSERT INTO aportes(usuario_id,investimento_id,legado,valor,tipo) VALUES(?,?,1,?,'planejado')",[userId,r.insertId,x.contribution]); counts.aportes++;
    }
  }
  for (const x of data.goals) await db.execute('INSERT INTO metas(usuario_id,legado_id,nome,descricao,valor_meta,valor_atual,data_limite) VALUES(?,?,?,?,?,?,?)',[userId,x.id,x.name,x.action,x.target,x.current,x.deadline||null]);
  if (data.notes) await db.execute("INSERT INTO notas(usuario_id,legado,titulo,conteudo) VALUES(?,1,'Notas migradas',?)",[userId,data.notes]);
  const actual = await readRelational(db,userId);
  const expected = { ...data, investments:data.investments.map(({id,...x})=>x), goals:data.goals.map(({id,...x})=>x) };
  const comparable = { investments:actual.investments.map(({id,active,...x})=>x), goals:actual.goals.map(({id,status,...x})=>x), notes:actual.notes };
  // Comparação normalizada inclui valores, textos e datas, não apenas contagens.
  const normalize = x => JSON.stringify(x, Object.keys(x).sort());
  if (data.notes!==actual.notes || ['investments','goals'].some(k=>expected[k].length!==comparable[k].length || expected[k].some((x,i)=>normalize(x)!==normalize(comparable[k][i])))) throw new Error('Validação da migração falhou.');
  await db.execute('UPDATE app_estado_migracoes SET contagens=?,ativo=? WHERE usuario_id=?',[JSON.stringify(counts),rejected.length===0?1:0,userId]);
  return { contagens:counts,rejeitados:rejected,ativo:rejected.length===0 };
}
