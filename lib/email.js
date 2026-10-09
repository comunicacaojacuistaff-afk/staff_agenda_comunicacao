// E-mail grátis pelo Gmail (senha de app). Independente do WhatsApp/Z-API.
// Se GMAIL_USER e GMAIL_APP_PASSWORD existem, o e-mail é enviado de verdade.
// EMAIL_DRY_RUN=1 só escreve o e-mail no log (teste).
import nodemailer from 'nodemailer';

export const emailConfigurado = () =>
  process.env.EMAIL_DRY_RUN === '1' || !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

export async function enviarEmail(para, assunto, texto) {
  if (process.env.EMAIL_DRY_RUN === '1') {
    console.log('[EMAIL TESTE]', para, '|', assunto, '\n' + texto);
    return;
  }
  const { GMAIL_USER: user, GMAIL_APP_PASSWORD: pass } = process.env;
  if (!user || !pass) throw new Error('E-mail não configurado (GMAIL_USER e GMAIL_APP_PASSWORD).');
  const transporte = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass: pass.replace(/\s/g, '') },
  });
  await transporte.sendMail({ from: `"Comunicação ADVEC" <${user}>`, to: para, subject: assunto, text: texto });
}
