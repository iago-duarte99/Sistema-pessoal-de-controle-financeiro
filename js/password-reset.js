(() => {
  const forgot = document.querySelector('#forgotPasswordForm');
  const reset = document.querySelector('#resetPasswordForm');
  const tabs = document.querySelector('.auth-tabs');
  let token = '', generation = 0;
  function closeRecovery() {
    generation++; token = ''; forgot.hidden = true; reset.hidden = true; tabs.hidden = false;
    forgot.reset(); reset.reset();
    if (location.pathname === '/reset-password') history.replaceState(null, '', '/');
  }
  document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', closeRecovery));
  document.querySelectorAll('[data-back-login]').forEach(button => button.addEventListener('click', () => {
    closeRecovery(); showAuth();
  }));
  function open(form, title) {
    document.querySelector('#loginForm').hidden = true;
    document.querySelector('#registerForm').hidden = true;
    forgot.hidden = form !== forgot; reset.hidden = form !== reset; tabs.hidden = true;
    document.querySelector('#authTitle').textContent = title;
  }
  document.querySelector('#forgotPasswordBtn').addEventListener('click', () => {
    open(forgot, 'Recuperar senha'); document.querySelector('#forgotMessage').textContent = ''; forgot.elements.email.focus();
  });
  forgot.addEventListener('submit', async event => {
    event.preventDefault(); const button = forgot.querySelector('[type=submit]');
    if (button.disabled) return;
    button.disabled = true; const current = generation;
    const message = document.querySelector('#forgotMessage'); message.textContent = 'Enviando…';
    try { const result = await api.post('/auth/forgot-password', { email: forgot.elements.email.value }); if (current === generation) message.textContent = result.message; }
    catch (error) { if (current === generation) message.textContent = error.message; }
    finally { button.disabled = false; }
  });
  reset.addEventListener('submit', async event => {
    event.preventDefault(); const button = reset.querySelector('[type=submit]');
    if (button.disabled) return;
    const message = document.querySelector('#resetMessage'), password = reset.elements.password.value;
    if (!password.trim() || password.length < 8 || new TextEncoder().encode(password).length > 72) { message.textContent = 'Senha deve ter no mínimo 8 caracteres e no máximo 72 bytes.'; return; }
    if (password !== reset.elements.confirmation.value) { message.textContent = 'As senhas não coincidem.'; return; }
    button.disabled = true; message.textContent = 'Redefinindo…'; const current = generation;
    try {
      const result = await api.post('/auth/reset-password', { token, novaSenha: password });
      if (current !== generation) return;
      closeRecovery(); showAuth(); document.querySelector('#loginMessage').textContent = result.message;
    } catch (error) { if (current === generation) { message.textContent = error.message; button.disabled = false; } }
  });
  if (location.pathname === '/reset-password') {
    token = new URLSearchParams(location.search).get('token') || '';
    // O segredo permanece só em memória; retire-o do histórico e do endereço.
    history.replaceState(null, '', '/reset-password');
    open(reset, 'Redefinir senha');
    const current = generation, message = document.querySelector('#resetMessage');
    message.textContent = 'Validando link…';
    api.post('/auth/validate-reset-token', { token }).then(() => {
      if (current !== generation) return;
      reset.querySelectorAll('input,[type=submit]').forEach(control => control.disabled = false);
      message.textContent = ''; reset.elements.password.focus();
    }).catch(error => { if (current === generation) message.textContent = error.message; });
  }
})();
