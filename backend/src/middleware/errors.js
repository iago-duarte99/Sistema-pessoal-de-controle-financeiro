export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Dados excedem o limite permitido.' });
  const errors = {
    ER_DUP_ENTRY: [409, 'Já existe um registro com estes dados.'],
    ER_ROW_IS_REFERENCED_2: [409, 'Registro possui vínculos. Remova os vínculos ou desative a conta.'],
    ER_ROW_IS_REFERENCED: [409, 'Registro possui vínculos. Remova os vínculos ou desative a conta.'],
    ER_NO_REFERENCED_ROW_2: [400, 'Relacionamento inválido.'],
    ER_NO_REFERENCED_ROW: [400, 'Relacionamento inválido.'],
    ER_LOCK_DEADLOCK: [409, 'Conflito de gravação. Tente novamente.'],
    ER_LOCK_WAIT_TIMEOUT: [409, 'Registro ocupado. Tente novamente.']
  };
  const [status, message] = errors[error.code] || [503, 'Serviço indisponível. Tente novamente em instantes.'];
  console.error('Falha na API:', error.code || error.name);
  res.status(status).json({ error: message });
}
