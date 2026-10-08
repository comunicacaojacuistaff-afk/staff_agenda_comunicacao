// SMS via Twilio (exemplo). Para Zenvia, Comtele etc., troque só o corpo desta função.
import { fone } from './whatsapp.js';

export const smsConfigurado = () =>
  process.env.WHATSAPP_DRY_RUN === '1' ||
  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));

export async function enviarSms(cel, mensagem) {
  if (process.env.WHATSAPP_DRY_RUN === '1') {
    console.log('[SMS TESTE]', '+' + fone(cel), '\n' + mensagem);
    return;
  }
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM: from, TWILIO_MESSAGING_SERVICE_SID: ms } = process.env;
  if (!sid || !tok || !(from || ms)) throw new Error('SMS não configurado (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_FROM).');
  const corpo = new URLSearchParams({ To: '+' + fone(cel), Body: mensagem });
  if (ms) corpo.set('MessagingServiceSid', ms); else corpo.set('From', from);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  });
  if (!r.ok) throw new Error(`SMS ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
