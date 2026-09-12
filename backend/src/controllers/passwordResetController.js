import { randomBytes, createHash, randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import bcrypt from 'bcryptjs';
import { pool, transaction } from '../config/database.js';
import { HttpError } from '../middleware/errors.js';
import * as v from '../services/validation.js';
import { resetMail } from '../services/resetMail.js';

export const resetMessage = 'Se existir uma conta com este e-mail, enviaremos instruções para redefinir a senha.';
const invalidToken = () => new HttpError(400, 'Link inválido ou expirado. Solicite uma nova recuperação.');
export function tokenHash(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidToken();
  return createHash('sha256').update(token).digest('hex');
}
// A entrega ocorre depois da resposta, sem expor a latência do SMTP ao solicitante.
// O limite por IP restringe também a quantidade de trabalhos de entrega.
export function passwordResetController({ db = pool, transact = transaction, deliver = resetMail(), report = () => console.error('Falha na entrega de recuperação de senha.') } = {}) {
  return {
    async forgot(req, res) {
      const email = v.email(req.body.email);
      const started = Date.now(), minimum = 350 + randomInt(100);
      const token = randomBytes(32).toString('hex'), hash = tokenHash(token);
      let recipient;
      try {
        await transact(async connection => {
          const [users] = await connection.execute('SELECT id,email FROM usuarios WHERE email=? FOR UPDATE', [email]);
          if (!users.length) return;
          const user = users[0];
          // Uma solicitação nova substitui todos os links anteriores.
          await connection.execute('UPDATE password_reset_tokens SET usado_em=UTC_TIMESTAMP() WHERE usuario_id=? AND usado_em IS NULL', [user.id]);
          await connection.execute('INSERT INTO password_reset_tokens(usuario_id,token_hash,expira_em) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))', [user.id, hash]);
          recipient = user.email;
        });
      } catch { report(); } // Falhas internas também não revelam a existência da conta.
      await delay(Math.max(0, minimum - (Date.now() - started)));
      res.json({ message: resetMessage });
      if (recipient) void Promise.resolve().then(() => deliver(recipient, token)).catch(report);
    },
    async validate(req, res) {
      const hash = tokenHash(req.body.token);
      const [rows] = await db.execute('SELECT t.id FROM password_reset_tokens t JOIN usuarios u ON u.id=t.usuario_id WHERE t.token_hash=? AND t.usado_em IS NULL AND t.expira_em>UTC_TIMESTAMP()', [hash]);
      if (!rows.length) throw invalidToken();
      res.json({ valid: true });
    },
    async reset(req, res) {
      const hash = tokenHash(req.body.token), password = v.password(req.body.novaSenha);
      if (!password.trim()) v.invalid('Senha não pode ser vazia.');
      const [candidates] = await db.execute('SELECT usuario_id FROM password_reset_tokens WHERE token_hash=?', [hash]);
      if (!candidates.length) throw invalidToken();
      await transact(async connection => {
        // Sempre bloqueia usuário antes dos tokens: serializa solicitações e resets concorrentes.
        const userId = candidates[0].usuario_id;
        const [users] = await connection.execute('SELECT id,email FROM usuarios WHERE id=? FOR UPDATE', [userId]);
        const [tokens] = await connection.execute('SELECT id FROM password_reset_tokens WHERE token_hash=? AND usuario_id=? AND usado_em IS NULL AND expira_em>UTC_TIMESTAMP() FOR UPDATE', [hash, userId]);
        if (!users.length || !tokens.length) throw invalidToken();
        if (password.trim().toLowerCase() === users[0].email.toLowerCase()) v.invalid('Senha não pode ser igual ao e-mail.');
        const passwordHash = await bcrypt.hash(password, 12);
        await connection.execute('UPDATE usuarios SET senha_hash=? WHERE id=?', [passwordHash, userId]);
        await connection.execute('UPDATE password_reset_tokens SET usado_em=UTC_TIMESTAMP() WHERE usuario_id=? AND usado_em IS NULL', [userId]);
        await connection.execute("INSERT INTO app_perfis(usuario_id,papel,versao_token) VALUES(?,'user',1) ON DUPLICATE KEY UPDATE versao_token=versao_token+1", [userId]);
      });
      res.json({ message: 'Senha redefinida com sucesso. Faça login com sua nova senha.' });
    }
  };
}
