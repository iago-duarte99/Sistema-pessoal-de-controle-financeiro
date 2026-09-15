import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../../js/password-reset.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(path, post) {
  const dom = new JSDOM(html, { url: 'http://localhost:3000' + path, runScripts: 'outside-only' });
  dom.window.TextEncoder = TextEncoder;
  dom.window.api = { post };
  dom.window.showAuth = () => { dom.window.document.querySelector('#loginForm').hidden = false; };
  dom.window.eval(script);
  return dom;
}
function submit(dom, form) { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }

test('solicitação mostra loading, resposta genérica e retorno ao login', async () => {
  let finish, calls = 0;
  const dom = setup('/', () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  try {
    const doc = dom.window.document, form = doc.querySelector('#forgotPasswordForm');
    doc.querySelector('#forgotPasswordBtn').click(); assert.equal(form.hidden, false);
    form.elements.email.value = 'example@example.test'; submit(dom, form);
    assert.equal(form.querySelector('[type=submit]').disabled, true);
    assert.equal(form.querySelector('[type=submit]').textContent, 'Enviando...');
    submit(dom, form); assert.equal(calls, 1);
    finish({ message: 'Mensagem genérica' }); await tick();
    assert.equal(doc.querySelector('#forgotMessage').textContent, 'Solicitação recebida. Se existir uma conta com este e-mail, enviaremos as instruções de recuperação.');
    assert.equal(doc.querySelector('#forgotMessage').dataset.state, 'success');
    assert.equal(doc.querySelector('#forgotMessage').getAttribute('role'), 'status');
    assert.equal(form.querySelector('[type=submit]').disabled, false);
    assert.equal(form.querySelector('[type=submit]').textContent, 'Enviar instruções');
    form.querySelector('[data-back-login]').click(); assert.equal(form.hidden, true);
  } finally { dom.window.close(); }
});

test('erro técnico é amigável e restaura botão para nova tentativa', async () => {
  let calls = 0;
  const dom = setup('/', async () => { calls++; throw new Error('Detalhe interno simulado'); });
  try {
    const doc = dom.window.document, form = doc.querySelector('#forgotPasswordForm');
    doc.querySelector('#forgotPasswordBtn').click();
    submit(dom, form); await tick();
    assert.equal(doc.querySelector('#forgotMessage').textContent, 'Não foi possível confirmar a solicitação. Tente novamente em instantes.');
    assert.equal(doc.querySelector('#forgotMessage').dataset.state, 'error');
    assert.equal(form.querySelector('[type=submit]').disabled, false);
    assert.equal(form.querySelector('[type=submit]').textContent, 'Enviar instruções');
    submit(dom, form); await tick(); assert.equal(calls, 2);
  } finally { dom.window.close(); }
});

test('resposta tardia não reaparece após sair da recuperação', async () => {
  let finish;
  const dom = setup('/', () => new Promise(resolve => { finish = resolve; }));
  try {
    const doc = dom.window.document, form = doc.querySelector('#forgotPasswordForm');
    doc.querySelector('#forgotPasswordBtn').click(); submit(dom, form);
    form.querySelector('[data-back-login]').click();
    doc.querySelector('#forgotPasswordBtn').click();
    finish({}); await tick();
    assert.equal(doc.querySelector('#forgotMessage').textContent, '');
    assert.equal(form.querySelector('[type=submit]').disabled, false);
    assert.equal(form.querySelector('[type=submit]').textContent, 'Enviar instruções');
  } finally { dom.window.close(); }
});

test('confirmação divergente não envia; sucesso limpa senha e volta ao login', async () => {
  const calls = [];
  const dom = setup('/reset-password?token=redacted', async (path) => {
    calls.push(path); return path.includes('validate') ? { valid: true } : { message: 'Senha redefinida com sucesso. Faça login com sua nova senha.' };
  });
  try {
    await tick();
    const doc = dom.window.document, form = doc.querySelector('#resetPasswordForm');
    form.elements.password.value = 'Senha-nova-123'; form.elements.confirmation.value = 'Diferente-123';
    submit(dom, form); assert.equal(calls.length, 1); assert.match(doc.querySelector('#resetMessage').textContent, /não coincidem/);
    form.elements.confirmation.value = form.elements.password.value; submit(dom, form); await tick();
    assert.deepEqual(calls, ['/auth/validate-reset-token', '/auth/reset-password']);
    assert.equal(form.hidden, true); assert.equal(form.elements.password.value, ''); assert.equal(dom.window.location.pathname, '/');
    assert.match(doc.querySelector('#loginMessage').textContent, /Senha redefinida com sucesso/);
  } finally { dom.window.close(); }
});

test('token inválido mantém formulário bloqueado', async () => {
  const dom = setup('/reset-password?token=redacted', async () => { throw new Error('Link inválido ou expirado.'); });
  try {
    await tick(); const doc = dom.window.document;
    assert.equal(doc.querySelector('#resetPasswordForm [type=submit]').disabled, true);
    assert.match(doc.querySelector('#resetMessage').textContent, /inválido/);
  } finally { dom.window.close(); }
});
