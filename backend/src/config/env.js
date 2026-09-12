import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
export const config = {
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  smtp: { host: process.env.SMTP_HOST || '', port: Number(process.env.SMTP_PORT || 587), user: process.env.SMTP_USER || '', password: process.env.SMTP_PASSWORD || '', from: process.env.SMTP_FROM || '' },
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production',
  origins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(x => x.trim()),
  secret: process.env.JWT_SECRET || '',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
};
export function validateConfig() {
  const appUrl = new URL(config.appUrl);
  if (!['http:', 'https:'].includes(appUrl.protocol) || appUrl.username || appUrl.password || (config.production && appUrl.protocol !== 'https:')) throw new Error('APP_URL deve ser uma URL HTTP válida (HTTPS em production).');
  if (config.production && (!config.smtp.host || !config.smtp.from)) throw new Error('Configure SMTP_HOST e SMTP_FROM em production.');
  if (!Number.isInteger(config.smtp.port) || config.smtp.port < 1 || config.smtp.port > 65535 || Boolean(config.smtp.user) !== Boolean(config.smtp.password)) throw new Error('Configuração SMTP inválida.');
  if (config.secret.length < 48) throw new Error('Configure JWT_SECRET com pelo menos 48 caracteres em backend/.env.');
  if ((process.env.DB_USER || 'finance_app').toLowerCase() === 'root') throw new Error('Configure um usuário MySQL próprio da aplicação; root não é permitido.');
}
