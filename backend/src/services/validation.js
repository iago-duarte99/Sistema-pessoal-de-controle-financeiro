import { HttpError } from '../middleware/errors.js';
export const invalid = message => { throw new HttpError(400, message); };
export function id(value, field = 'id') {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) invalid(`${field} inválido.`);
  return Number(value);
}
export function text(value, field, max, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(`${field} é obrigatório e deve ter até ${max} caracteres.`);
  return value.trim();
}
export function amount(value, field = 'valor', minimum = 0.01) {
  if (!['number', 'string'].includes(typeof value) || !/^-?\d+(\.\d{1,2})?$/.test(String(value))) invalid(`${field} deve ser um valor com até duas casas decimais.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || Math.abs(result) > 9999999999999.99) invalid(`${field} fora do limite permitido.`);
  return result.toFixed(2);
}
export function date(value, field = 'data_transacao') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01' || value > '9999-12-31') invalid(`${field} inválida.`);
  const parsed = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(`${field} inválida.`);
  return value;
}
export function type(value) {
  if (!['receita', 'despesa'].includes(value)) invalid('tipo deve ser receita ou despesa.');
  return value;
}
export function email(value) {
  const normalized = text(value, 'email', 150).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) invalid('E-mail inválido.');
  return normalized;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value) > 72) invalid('Senha deve ter no mínimo 8 caracteres e no máximo 72 bytes.');
  if (!value.trim()) invalid('Senha não pode ser vazia.');
  return value;
}
export function period(query) {
  const start = query.data_inicio === undefined ? null : date(query.data_inicio, 'data_inicio');
  const end = query.data_fim === undefined ? null : date(query.data_fim, 'data_fim');
  if (start && end && start > end) invalid('data_inicio deve ser anterior ou igual a data_fim.');
  return { start, end };
}
export function extra(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Estado complementar inválido.');
  const notes=value.notes??'';
  if(typeof notes!=='string'||notes.length>30000)invalid('Notas devem ter até 30000 caracteres.');
  const result = { notes };
  const schemas = {
    investments: { name: 100, balance: 'money', contribution: 'money', note: 1000 },
    goals: { name: 100, target: 'positive', current: 'money', deadline: 'date', action: 1000 }
  };
  for (const [key, fields] of Object.entries(schemas)) {
    if (!Array.isArray(value[key]) || value[key].length > 1000) invalid(`${key} inválido.`);
    const seen = new Set();
    result[key] = value[key].map(item => {
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || seen.has(item.id)) invalid('Identificador complementar inválido ou duplicado.');
      seen.add(item.id);
      const record = { id: item.id };
      for (const [field, spec] of Object.entries(fields)) record[field] = spec === 'date' ? (item[field] ? date(item[field], field) : '') : spec === 'money' || spec === 'positive' ? amount(item[field], field, spec === 'positive' ? 0.01 : 0) : text(item[field], field, spec, ['note','action'].includes(field));
      return record;
    });
  }
  return result;
}
