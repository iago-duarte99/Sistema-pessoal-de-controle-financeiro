import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { resetMail } from '../src/services/resetMail.js';
import { passwordResetController } from '../src/controllers/passwordResetController.js';

test('conta existente e inexistente recebem a mesma confirmação sem token ou link', async () => {
  const responses = [];
  let deliveries = 0;
  for (const exists of [true, false]) {
    const controller = passwordResetController({
      transact: work => work({ execute: async sql => [sql.startsWith('SELECT') ? (exists ? [{ id: 1, email: 'test@example.test' }] : []) : {}] }),
      deliver: async () => { deliveries++; },
      report: () => assert.fail('Não deve falhar')
    });
    await controller.forgot({ body: { email: 'test@example.test' } }, { json: value => responses.push(value) });
  }
  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(Object.keys(responses[0]), ['message']);
  assert.match(responses[0].message, /^Se existir uma conta/);
  assert.equal(deliveries, 1);
});

test('sem SMTP, somente development informa configuração ausente sem revelar link ou token', async () => {
  for (const environment of ['production', 'test', undefined, 'development']) {
    const logs = [], send = resetMail({ environment: environment || 'unset', smtp: {}, appUrl: 'http://localhost:3000', log: value => logs.push(value) });
    if (environment === 'development') {
      await send('test@example.test', 'test-token'); assert.equal(logs.length, 1);
      assert.ok(!logs.join('').includes('test-token'));
      assert.ok(!logs.join('').includes('http://localhost:3000'));
      assert.ok(!logs.join('').includes('test@example.test'));
    }
    else { await assert.rejects(send('test@example.test', 'test-token')); assert.equal(logs.length, 0); }
  }
});

test('SMTP envia link por email e sanitiza falhas do provedor em todos os ambientes', async t => {
  let failure = false, sent;
  t.mock.method(nodemailer, 'createTransport', () => ({
    async verify() { if (failure) throw Object.assign(new Error('fixture-password fixture-key'), { response: 'fixture-token' }); },
    async sendMail(message) { sent = message; return { messageId: 'private-provider-id' }; }
  }));
  for (const environment of ['development', 'production', 'test']) {
    const logs = [];
    const send = resetMail({ environment, smtp: { host: 'smtp.example.test', from: 'test@example.test', port: 587 }, appUrl: 'https://example.test', log: message => logs.push(message) });
    failure = false;
    await send('recipient@example.test', 'fixture-token');
    assert.ok(sent.text.includes('https://example.test/reset-password?token=fixture-token'));
    failure = true;
    await assert.rejects(send('recipient@example.test', 'fixture-token'), { message: 'Falha ao enviar email de recuperação.' });
    assert.equal(logs.at(-1), 'Falha ao enviar email de recuperação.');
    for (const secret of ['fixture-password', 'fixture-key', 'fixture-token', 'private-provider-id', 'recipient@example.test']) assert.ok(!logs.join('').includes(secret));
  }
});

test('falha no banco mantém resposta genérica e não expõe detalhes', async () => {
  let result, reported = 0;
  const controller = passwordResetController({ transact: async () => { throw new Error('private'); }, deliver: async () => assert.fail('Não deve enviar'), report: () => reported++ });
  await controller.forgot({ body: { email: 'test@example.test' } }, { json: value => { result = value; } });
  assert.equal(reported, 1); assert.deepEqual(Object.keys(result), ['message']); assert.ok(!JSON.stringify(result).includes('private'));
});
