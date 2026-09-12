import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

export function resetMail({ environment = process.env.NODE_ENV, smtp = config.smtp, appUrl = config.appUrl, log = console.log } = {}) {
  const configured = Boolean(smtp.host && smtp.from);
  const transport = configured ? nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000
  }) : null;
  return async (email, token) => {
    const url = new URL('/reset-password', appUrl);
    url.searchParams.set('token', token);
    if (transport) {
  try {
    await transport.verify();

    await transport.sendMail({
      from: smtp.from,
      to: email,
      subject: 'Redefinição de senha — Meu Controle',
      text: `Para redefinir sua senha, abra: ${url.href}\nO link expira em 15 minutos e só pode ser usado uma vez. Se não solicitou, ignore esta mensagem.`
    });

    if (environment === 'development') {
      log('[SMTP] E-mail de recuperação enviado.');
    }
  } catch (error) {
    log('Falha ao enviar email de recuperação.');
    throw new Error('Falha ao enviar email de recuperação.');
  }
} else if (environment === 'development') {
      log('[DEV] SMTP não configurado; link e token de recuperação omitidos. Configure SMTP para receber o e-mail.');
    } else {
      throw new Error('SMTP não configurado');
    }
  };
}
