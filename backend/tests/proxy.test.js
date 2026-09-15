import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { config } from '../src/config/env.js';
import { pool } from '../src/config/database.js';

test('proxy de produção mantém limites por cliente e ignora IPs adicionais forjados', async t => {
  const previous = { production: config.production, smtp: config.smtp };
  config.production = true;
  config.smtp = {};
  const rejectDatabase = async () => { throw new Error('Banco não permitido neste teste'); };
  t.mock.method(pool, 'execute', rejectDatabase);
  t.mock.method(pool, 'query', rejectDatabase);
  t.mock.method(pool, 'getConnection', rejectDatabase);
  let server;
  try {
    const { app } = await import('../src/app.js');
    assert.equal(app.get('trust proxy'), 1);
    const trust = app.get('trust proxy fn');
    assert.equal(trust('127.0.0.1', 0), true);
    assert.equal(trust('192.0.2.1', 1), false);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, forwarded) {
      // Invalid email/token stops at validation, before any database or SMTP access.
      const response = await fetch(base + path, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Forwarded-For': forwarded
      }, body: JSON.stringify({ email: 'invalid', token: 'invalid' }) });
      await response.text();
      return response.status;
    }
    for (const [path, limit, client] of [
      ['/auth/forgot-password', 5, '192.0.2.10'],
      ['/auth/login', 30, '192.0.2.11'],
      ['/auth/validate-reset-token', 30, '192.0.2.12']
    ]) {
      for (let i = 0; i < limit; i++) {
        assert.equal(await request(path, `198.51.100.${i + 1}, ${client}`), 400);
      }
      assert.equal(await request(path, `203.0.113.1, ${client}`), 429);
      assert.equal(await request(path, '192.0.2.99'), 400);
    }
    assert.equal((await fetch(base.replace('/api', '') + '/')).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    Object.assign(config, previous);
  }
});
