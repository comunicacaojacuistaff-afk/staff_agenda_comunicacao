// E-mail via Brevo (plano grátis: 300 e-mails/dia). Para outro serviço, troque só esta função.
export const emailConfigurado = () =>
  process.env.WHATSAPP_DRY_RUN === '1' || !!(process.env.BREVO_API_KEY && process.env.EMAIL_REMETENTE);

export async function enviarEmail(para, assunto, texto) {
  if (process.env.WHATSAPP_DRY_RUN === '1') {
    console.log('[EMAIL TESTE]', para, '|', assunto, '\n' + texto);
    return;
  }
  const { BREVO_API_KEY: chave, EMAIL_REMETENTE: de } = process.env;
  if (!chave || !de) throw new Error('E-mail não configurado (BREVO_API_KEY e EMAIL_REMETENTE).');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': chave, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'Comunicação ADVEC', email: de }, to: [{ email: para }], subject: assunto, textContent: texto }),
  });
  if (!r.ok) throw new Error(`E-mail ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
