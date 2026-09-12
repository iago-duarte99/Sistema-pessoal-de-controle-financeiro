import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { pool } from '../config/database.js';
import { HttpError } from './errors.js';
import { id } from '../services/validation.js';

export async function authenticate(req, res, next) {
  let claims;
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    claims = jwt.verify(token || '', config.secret, { algorithms: ['HS256'], issuer: 'controle-financeiro', audience: 'finance-web' });
  } catch { throw new HttpError(401, 'Sessão expirada ou inválida. Entre novamente.'); }
  const [rows] = await pool.execute('SELECT u.id,u.nome,u.email,u.criado_em,COALESCE(p.papel,\'user\') AS role,COALESCE(p.versao_token,0) AS versao_token FROM usuarios u LEFT JOIN app_perfis p ON p.usuario_id=u.id WHERE u.id=?', [claims.sub]);
  if (!rows.length || rows[0].versao_token !== claims.version) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  req.user = rows[0];
  next();
}
export function tokenFor(user) {
  return jwt.sign({ version: user.versao_token || 0 }, config.secret, { algorithm: 'HS256', subject: String(user.id), issuer: 'controle-financeiro', audience: 'finance-web', expiresIn: '2h' });
}
export function publicUser(user) {
  return { id: user.id, nome: user.nome, email: user.email, role: user.role || 'user', criado_em: user.criado_em };
}
export function owner(req) {
  for (const candidate of [req.query.usuario_id, req.params.usuarioId, req.body?.usuario_id]) {
    if (candidate !== undefined && id(candidate, 'usuario_id') !== req.user.id) throw new HttpError(403, 'Acesso restrito aos seus próprios dados financeiros.');
  }
  return req.user.id;
}
export function admin(req) {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Apenas administradores podem gerenciar outros perfis.');
}
