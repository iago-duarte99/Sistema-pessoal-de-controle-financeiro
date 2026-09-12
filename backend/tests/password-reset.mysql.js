import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { config } from '../src/config/env.js';
import { pool, transaction } from '../src/config/database.js';
import { tokenHash, passwordResetController } from '../src/controllers/passwordResetController.js';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

test('recuperação segura com MySQL real', { skip: process.env.MYSQL_INTEGRATION !== '1' }, async t => {
  assert.match(process.env.DB_NAME, /_test$/);
  const messages = [];
  config.smtp = { host: 'smtp.example.test', from: 'noreply@example.test', port: 587 };
  t.mock.method(nodemailer, 'createTransport', () => ({ async verify() {}, async sendMail(message) { messages.push(message); } }));
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const email = 'recovery@example.test', oldPassword = 'Original-123!', newPassword = 'Atualizada-456!';
  async function request(path, body, status = 200, jwt) {
    const response = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    assert.equal(response.status, status, 'Status inesperado em ' + path);
    assert.ok(!('token' in result) || ['/auth/login', '/auth/register'].includes(path));
    return result;
  }
  let user, first, second;
  const deliveredToken = () => new URL(messages.at(-1).text.split('\n')[0].split('abra: ')[1]).searchParams.get('token');
  async function seed(expired = false, used = false) {
    const token = randomBytes(32).toString('hex');
    await pool.execute(`INSERT INTO password_reset_tokens(usuario_id,token_hash,expira_em,usado_em) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${expired ? '-1' : '15'} MINUTE),${used ? 'UTC_TIMESTAMP()' : 'NULL'})`, [user.user.id, tokenHash(token)]);
    return token;
  }
  try {
    user = await request('/auth/register', { nome: 'Recuperação', email, senha: oldPassword }, 201);
    await t.test('e-mails existente e inexistente recebem mesma resposta, apenas existente recebe link', async () => {
      const existing = await request('/auth/forgot-password', { email });
      const missing = await request('/auth/forgot-password', { email: 'missing@example.test' });
      assert.deepEqual(existing, missing); assert.equal(messages.length, 1); first = deliveredToken();
      const [rows] = await pool.execute('SELECT token_hash,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),expira_em) AS remaining FROM password_reset_tokens WHERE usuario_id=?', [user.user.id]);
      assert.equal(rows[0].token_hash === tokenHash(first), true); assert.equal(rows[0].token_hash === first, false);
      assert.ok(rows[0].remaining > 850 && rows[0].remaining <= 900);
    });
    await t.test('formato de e-mail inválido', () => request('/auth/forgot-password', { email: 'invalid' }, 400));
    await t.test('validação prévia de token válido e rejeição de inválido, expirado e usado', async () => {
      await request('/auth/validate-reset-token', { token: first });
      for (const token of ['invalid', randomBytes(32).toString('hex'), await seed(true), await seed(false, true)]) {
        await request('/auth/validate-reset-token', { token }, 400);
        await request('/auth/reset-password', { token, novaSenha: newPassword }, 400);
      }
    });
    await t.test('nova solicitação invalida links anteriores', async () => {
      await request('/auth/forgot-password', { email });
      // Espera somente a entrega simulada, sem imprimir o token.
      for (let i = 0; messages.length < 2 && i < 20; i++) await new Promise(r => setTimeout(r, 10));
      second = deliveredToken();
      await request('/auth/reset-password', { token: first, novaSenha: newPassword }, 400);
      await request('/auth/validate-reset-token', { token: second });
    });
    await t.test('rejeita senha vazia, curta, acima de 72 bytes e igual ao e-mail', async () => {
      for (const novaSenha of ['', '        ', 'short', 'á'.repeat(37), email]) await request('/auth/reset-password', { token: second, novaSenha }, 400);
    });
    await t.test('reset salva bcrypt, invalida todos os links e JWT, preserva outro usuário', async () => {
      const other = await request('/auth/register', { nome: 'Outro', email: 'recovery-other@example.test', senha: oldPassword }, 201);
      const previous = await seed();
      const result = await request('/auth/reset-password', { token: second, novaSenha: newPassword });
      assert.equal(result.message, 'Senha redefinida com sucesso. Faça login com sua nova senha.');
      const [rows] = await pool.execute('SELECT senha_hash FROM usuarios WHERE id=?', [user.user.id]);
      assert.match(rows[0].senha_hash, /^\$2[aby]\$12\$/); assert.ok(await bcrypt.compare(newPassword, rows[0].senha_hash));
      await request('/auth/login', { email, senha: oldPassword }, 401);
      const login = await request('/auth/login', { email, senha: newPassword });
      await request('/auth/me', null, 401, user.token); await request('/auth/me', null, 200, login.token);
      await request('/auth/me', null, 200, other.token);
      for (const token of [second, previous]) await request('/auth/reset-password', { token, novaSenha: oldPassword }, 400);
    });
    await t.test('usuário legado sem app_perfis e resets concorrentes: só um vence', async () => {
      await pool.execute('DELETE FROM app_perfis WHERE usuario_id=?', [user.user.id]);
      const token = await seed();
      const responses = await Promise.all([1, 2].map(() => fetch(base + '/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, novaSenha: newPassword }) })));
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
      const [rows] = await pool.execute('SELECT versao_token FROM app_perfis WHERE usuario_id=?', [user.user.id]); assert.equal(rows[0].versao_token, 1);
    });
    await t.test('falha ao revogar JWT desfaz hash e consumo dos tokens', async () => {
      const token = await seed();
      const [before] = await pool.execute('SELECT senha_hash FROM usuarios WHERE id=?', [user.user.id]);
      const controller = passwordResetController({
        transact: work => transaction(connection => work({ execute(sql, params) {
          if (sql.startsWith('INSERT INTO app_perfis')) throw new Error('Falha simulada');
          return connection.execute(sql, params);
        } }))
      });
      await assert.rejects(controller.reset({ body: { token, novaSenha: 'Nao-deve-salvar-123!' } }, { json() { assert.fail('Não deve confirmar'); } }), /Falha simulada/);
      const [after] = await pool.execute('SELECT senha_hash FROM usuarios WHERE id=?', [user.user.id]);
      assert.equal(before[0].senha_hash === after[0].senha_hash, true);
      await request('/auth/validate-reset-token', { token });
    });
    await t.test('rate limit de recuperação', async () => {
      await request('/auth/forgot-password', { email: 'missing@example.test' });
      await request('/auth/forgot-password', { email }, 429);
    });
    await t.test('rota de reset protege cache e referrer; formulário valida antes de habilitar', async () => {
      const response = await fetch(base + '/reset-password?token=redacted');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.equal(response.headers.get('cache-control'), 'no-store');
      const dom = new JSDOM(await response.text(), { url: base + '/reset-password?token=redacted', runScripts: 'outside-only' });
      const calls = []; let validate;
      dom.window.api = { post: (path, body) => { calls.push(path); return new Promise(resolve => { validate = resolve; }); } };
      dom.window.showAuth = () => {};
      dom.window.eval(await readFile(new URL('../../js/password-reset.js', import.meta.url), 'utf8'));
      const form = dom.window.document.querySelector('#resetPasswordForm');
      assert.equal(form.hidden, false); assert.equal(form.elements.password.disabled, true); assert.equal(dom.window.location.search, '');
      assert.deepEqual(calls, ['/auth/validate-reset-token']); validate({ valid: true }); await new Promise(r => setTimeout(r, 0));
      assert.equal(form.elements.password.disabled, false);
      dom.window.close();
    });
  } finally { await new Promise(resolve => server.close(resolve)); await pool.end(); }
});
