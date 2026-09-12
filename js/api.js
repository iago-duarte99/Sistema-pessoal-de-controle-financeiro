/* JWT fica apenas em memória; nenhum segredo ou senha é salvo no navegador. */
const api = (() => {
  const base = document.querySelector('meta[name="api-url"]')?.content || '/api';
  let token = null, generation = 0;
  async function request(path, { method = 'GET', body, signal } = {}) {
    let response;const current=generation;
    try {
      response = await fetch(base + path, {
        method, signal: signal || AbortSignal.timeout(20000),
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new Error('Não foi possível confirmar a operação. Verifique a conexão e recarregue os dados antes de repetir uma gravação.'); }
    if(current!==generation)throw new Error('Sessão encerrada.');
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || `Falha na API (${response.status}).`);
      error.status = response.status;
      if (response.status === 401) { token = null; document.dispatchEvent(new Event('session-expired')); }
      throw error;
    }
    return payload;
  }
  return { request, hasToken:()=>Boolean(token), setToken(value) { generation++;token = value; }, get: path => request(path), post: (path, body) => request(path, { method: 'POST', body }), put: (path, body) => request(path, { method: 'PUT', body }), delete: path => request(path, { method: 'DELETE' }) };
})();
