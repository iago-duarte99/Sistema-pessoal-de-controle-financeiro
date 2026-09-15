import { available } from '../services/relational.js';
import bcrypt from 'bcryptjs';
import { pool, transaction } from '../config/database.js';
import { HttpError } from '../middleware/errors.js';
import { admin, tokenFor, publicUser } from '../middleware/auth.js';
import * as v from '../services/validation.js';

const select = 'SELECT u.id,u.nome,u.email,u.criado_em,COALESCE(p.papel,\'user\') AS role FROM usuarios u LEFT JOIN app_perfis p ON p.usuario_id=u.id';
export async function create(body, administrator = false) {
  const nome = v.text(body.nome, 'nome', 120), email = v.email(body.email);
  const hash = await bcrypt.hash(v.password(body.senha), 12);
  const role = administrator ? (body.role || 'user') : 'user';
  if (!['admin', 'user'].includes(role)) v.invalid('Perfil inválido.');
  return transaction(async db => {
    const [result] = await db.execute('INSERT INTO usuarios(nome,email,senha_hash) VALUES(?,?,?)', [nome, email, hash]);
    await db.execute('INSERT INTO app_perfis(usuario_id,papel) VALUES(?,?)', [result.insertId, role]);
    return { id: result.insertId, nome, email, role, versao_token: 0 };
  });
}
export async function register(req, res) {
  const user = await create(req.body);
  res.status(201).json({ user: publicUser(user), token: tokenFor(user) });
}
const dummyHash = await bcrypt.hash('invalid-account-password', 12);
export async function login(req, res) {
  const email = v.email(req.body.email), senha = v.password(req.body.senha);
  const [rows] = await pool.execute('SELECT u.*,COALESCE(p.papel,\'user\') AS role,COALESCE(p.versao_token,0) AS versao_token FROM usuarios u LEFT JOIN app_perfis p ON p.usuario_id=u.id WHERE u.email=?', [email]);
  const valid = await bcrypt.compare(senha, rows[0]?.senha_hash || dummyHash);
  if (!valid || !rows.length) throw new HttpError(401, 'E-mail ou senha inválidos.');
  res.json({ user: publicUser(rows[0]), token: tokenFor(rows[0]) });
}
export async function list(req, res) {
  const [rows] = await pool.execute(select + (req.user.role === 'admin' ? ' ORDER BY u.nome' : ' WHERE u.id=?'), req.user.role === 'admin' ? [] : [req.user.id]);
  res.json(rows);
}
export async function get(req, res) {
  const userId = v.id(req.params.id);
  if (userId !== req.user.id) admin(req);
  const [rows] = await pool.execute(select + ' WHERE u.id=?', [userId]);
  if (!rows.length) throw new HttpError(404, 'Usuário não encontrado.');
  res.json(rows[0]);
}
export async function post(req, res) { admin(req); res.status(201).json(publicUser(await create(req.body, true))); }
export async function put(req, res) {
  const userId = v.id(req.params.id);
  if (userId !== req.user.id) admin(req);
  const nome = v.text(req.body.nome, 'nome', 120), email = v.email(req.body.email);
  if (req.body.role !== undefined && !['admin','user'].includes(req.body.role)) v.invalid('Perfil inválido.');
  if (req.user.role !== 'admin' && req.body.role !== undefined && req.body.role !== req.user.role) throw new HttpError(403, 'Sem permissão para alterar o perfil.');
  if (userId === req.user.id && req.body.role && req.body.role !== req.user.role) throw new HttpError(409, 'Um administrador não pode rebaixar o próprio perfil.');
  const hash = req.body.senha ? await bcrypt.hash(v.password(req.body.senha), 12) : null;
  await transaction(async db => {
    const [rows] = await db.execute('SELECT id,email FROM usuarios WHERE id=? FOR UPDATE', [userId]);
    if (!rows.length) throw new HttpError(404, 'Usuário não encontrado.');
    await db.execute('UPDATE usuarios SET nome=?,email=?' + (hash ? ',senha_hash=?' : '') + ' WHERE id=?', hash ? [nome,email,hash,userId] : [nome,email,userId]);
    await db.execute('INSERT IGNORE INTO app_perfis(usuario_id,papel) VALUES(?,?)', [userId, 'user']);
    if (req.user.role === 'admin' && req.body.role) await db.execute('UPDATE app_perfis SET papel=? WHERE usuario_id=?', [req.body.role,userId]);
    if (hash) await db.execute('UPDATE app_perfis SET versao_token=versao_token+1 WHERE usuario_id=?', [userId]);
    if (hash || email !== rows[0].email) await db.execute('UPDATE password_reset_tokens SET usado_em=UTC_TIMESTAMP() WHERE usuario_id=? AND usado_em IS NULL', [userId]);
  });
  const [rows] = await pool.execute(select + ' WHERE u.id=?', [userId]);
  res.json(rows[0]);
}
export async function remove(req, res) {
  admin(req);
  const userId = v.id(req.params.id);
  if (userId === req.user.id) throw new HttpError(409, 'Não é possível excluir seu próprio perfil.');
  await transaction(async db => {
    const [rows] = await db.execute('SELECT id,email FROM usuarios WHERE id=? FOR UPDATE', [userId]);
    if (!rows.length) throw new HttpError(404, 'Usuário não encontrado.');
    if(await available(db)) for(const table of ['aportes','investimentos','metas','notas','app_estado_migracoes']) await db.execute(`DELETE FROM ${table} WHERE usuario_id=?`,[userId]);
    for (const table of ['password_reset_tokens','app_planejamentos','transacoes','categorias','contas','app_migracoes','app_estado','app_perfis']) await db.execute(`DELETE FROM ${table} WHERE usuario_id=?`, [userId]);
    await db.execute('DELETE FROM usuarios WHERE id=?', [userId]);
  });
  res.status(204).end();
}
