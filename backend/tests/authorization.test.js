import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../src/config/env.js';
import { pool } from '../src/config/database.js';
import { tokenFor } from '../src/middleware/auth.js';
import { password } from '../src/services/validation.js';

test('cadastro e administração usam autorização do backend com banco simulado', async t => {
  // Nenhuma conexão MySQL ou entrega SMTP é permitida neste teste.
  const secret = config.secret, adminEmail = config.adminEmail, smtp = config.smtp;
  config.secret = randomBytes(48).toString('hex');
  config.adminEmail = 'reserved@example.test';
  config.smtp = {};
  const users = new Map([
    [1, { id: 1, nome: 'Admin fictício', email: 'admin@example.test', role: 'admin', versao_token: 0 }],
    [2, { id: 2, nome: 'Comum fictício', email: 'user@example.test', role: 'user', versao_token: 0 }],
    [3, { id: 3, nome: 'Outro fictício', email: 'other@example.test', role: 'user', versao_token: 0 }]
  ]);
  let nextId = 4, writes = 0;
  const execute = async (sql, values = []) => {
    if (sql.startsWith('SELECT')) {
      const user = sql.includes('WHERE u.email=?')
        ? [...users.values()].find(u => u.email === values[0])
        : users.get(Number(values[0]));
      return [user ? [{ ...user }] : []];
    }
    writes++;
    if (sql.startsWith('INSERT INTO usuarios')) {
      const id = nextId++;
      users.set(id, { id, nome: values[0], email: values[1], senha_hash: values[2], role: 'user', versao_token: 0 });
      return [{ insertId: id }];
    }
    if (sql.startsWith('INSERT INTO app_perfis')) users.get(values[0]).role = values[1];
    else if (sql.startsWith('INSERT IGNORE INTO app_perfis')) { /* Perfil existente preservado. */ }
    else if (sql.startsWith('UPDATE usuarios SET')) {
      const user = users.get(values.at(-1));
      user.nome = values[0]; user.email = values[1];
      if (sql.includes('senha_hash=?')) user.senha_hash = values[2];
    }
    else if (sql.startsWith('UPDATE app_perfis SET papel')) users.get(values[1]).role = values[0];
    else if (sql.startsWith('UPDATE app_perfis SET versao_token')) users.get(values[0]).versao_token++;
    else if (!sql.startsWith('UPDATE password_reset_tokens')) throw new Error('SQL não previsto no banco simulado');
    return [{ affectedRows: 1 }];
  };
  t.mock.method(pool, 'execute', execute);
  t.mock.method(pool, 'query', async () => { throw new Error('Acesso MySQL não permitido'); });
  t.mock.method(pool, 'getConnection', async () => ({ execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }));
  let server;
  try {
    const { app } = await import('../src/app.js');
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, method, body, actor) => {
      const res = await fetch(base + path, { method, headers: {
        'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${tokenFor(users.get(actor))}` } : {})
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, data: await res.json() };
    };
    const body = { nome: 'Pessoa fictícia', email: 'normal@example.test', senha: 'Fixture-only-123' };
    const edit = id => ({ nome: users.get(id).nome, email: users.get(id).email });

    await t.test('cadastro público normal cria usuário comum', async () => {
      const result = await request('/auth/register', 'POST', body);
      assert.equal(result.status, 201); assert.equal(result.data.user.role, 'user');
      assert.equal(users.get(result.data.user.id).role, 'user');
    });
    await t.test('endereço exato de ADMIN_EMAIL continua comum', async () => {
      const result = await request('/auth/register', 'POST', { ...body, email: config.adminEmail });
      assert.equal(result.status, 201); assert.equal(result.data.user.role, 'user');
      assert.equal(users.get(result.data.user.id).role, 'user');
    });
    await t.test('campos públicos de privilégio são ignorados', async () => {
      const result = await request('/auth/register', 'POST', { ...body, email: 'payload@example.test', role: 'admin', perfil: 'admin', tipo: 'admin', admin: true, isAdmin: true, administrator: true, usuario_id: 1 });
      assert.equal(result.status, 201); assert.equal(result.data.user.role, 'user');
      assert.equal(users.get(result.data.user.id).role, 'user'); assert.equal(users.get(1).role, 'admin');
    });
    await t.test('usuário comum não promove a si nem outro usuário', async () => {
      const before = writes;
      for (const id of [2, 3, 1]) {
        const result = await request('/usuarios/' + id, 'PUT', { ...edit(id), role: 'admin', usuario_id: 1 }, 2);
        assert.equal(result.status, 403);
      }
      assert.equal(writes, before); assert.equal(users.get(2).role, 'user'); assert.equal(users.get(3).role, 'user');
    });
    await t.test('aliases de privilégio na edição não promovem usuário comum', async () => {
      const result = await request('/usuarios/2', 'PUT', { ...edit(2), perfil: 'admin', tipo: 'admin', admin: true, isAdmin: true }, 2);
      assert.equal(result.status, 200); assert.equal(result.data.role, 'user'); assert.equal(users.get(2).role, 'user');
    });
    await t.test('rotas administrativas sem autenticação são bloqueadas antes do banco', async () => {
      const before = writes;
      for (const [path, method] of [['/usuarios', 'POST'], ['/usuarios/3', 'PUT'], ['/usuarios/3', 'DELETE'], ['/usuarios', 'GET']]) {
        const result = await request(path, method, method === 'GET' ? null : { ...body, role: 'admin' });
        assert.equal(result.status, 401);
      }
      assert.equal(writes, before);
    });
    await t.test('usuário comum não cria perfil administrativo', async () => {
      const before = writes;
      assert.equal((await request('/usuarios', 'POST', { ...body, role: 'admin' }, 2)).status, 403);
      assert.equal(writes, before);
    });
    await t.test('administrador autenticado cria e promove perfis', async () => {
      const result = await request('/usuarios', 'POST', { ...body, email: 'managed@example.test', role: 'admin' }, 1);
      assert.equal(result.status, 201); assert.equal(result.data.role, 'admin');
      assert.equal(users.get(result.data.id).role, 'admin');
      const updated = await request('/usuarios/3', 'PUT', { ...edit(3), role: 'admin' }, 1);
      assert.equal(updated.status, 200); assert.equal(users.get(3).role, 'admin');
      assert.equal(users.get(1).role, 'admin');
    });
    await t.test('cadastro e edição rejeitam senha só de espaços sem gravar', async () => {
      const before = writes;
      assert.equal((await request('/auth/register', 'POST', { ...body, senha: '        ' })).status, 400);
      assert.equal((await request('/usuarios/2', 'PUT', { ...edit(2), senha: '        ' }, 2)).status, 400);
      assert.equal((await request('/usuarios', 'POST', { ...body, senha: '        ' }, 1)).status, 400);
      assert.equal(writes, before);
    });
    await t.test('senha válida mantém espaços, bcrypt e login após cadastro e edição', async () => {
      const senha = '  Fixture-only-123  ';
      const result = await request('/auth/register', 'POST', { ...body, email: 'login@example.test', senha });
      assert.equal(result.status, 201);
      const user = users.get(result.data.user.id);
      assert.equal(await bcrypt.compare(senha, user.senha_hash), true);
      assert.equal(await bcrypt.compare(senha.trim(), user.senha_hash), false);
      assert.equal((await request('/auth/login', 'POST', { email: user.email, senha })).status, 200);
      assert.equal((await request('/auth/login', 'POST', { email: user.email, senha: senha.trim() })).status, 401);
      const nova = '  Another-fixture-456  ';
      assert.equal((await request('/usuarios/' + user.id, 'PUT', { ...edit(user.id), senha: nova }, user.id)).status, 200);
      assert.equal((await request('/auth/login', 'POST', { email: user.email, senha: nova })).status, 200);
      assert.equal((await request('/auth/login', 'POST', { email: user.email, senha })).status, 401);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    config.secret = secret; config.adminEmail = adminEmail; config.smtp = smtp;
  }
});

test('validação compartilhada preserva limites e rejeita whitespace sem normalizar senha', () => {
  for (const value of ['        ', '\t'.repeat(8), '\u00a0'.repeat(8), 'short', 'á'.repeat(37)]) assert.throws(() => password(value), e => e.status === 400);
  assert.equal(password('a'.repeat(8)), 'a'.repeat(8));
  assert.equal(password('á'.repeat(36)), 'á'.repeat(36));
  assert.equal(password('  válida-123  '), '  válida-123  ');
});
