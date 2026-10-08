// ÚNICO ponto que fala com o WhatsApp (Z-API). Para usar outro serviço, troque só esta função.
export const fone = (cel) => {
  const d = String(cel).replace(/\D/g, '');
  return d.startsWith('55') && d.length > 11 ? d : '55' + d;
};

export async function enviar(cel, mensagem) {
  if (process.env.WHATSAPP_DRY_RUN === '1') {
    console.log('[WHATSAPP TESTE]', fone(cel), '\n' + mensagem);
    return;
  }
  const { ZAPI_INSTANCE: inst, ZAPI_TOKEN: tok, ZAPI_CLIENT_TOKEN: ct } = process.env;
  if (!inst || !tok || !ct) throw new Error('Z-API não configurada (ZAPI_INSTANCE, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN).');
  const r = await fetch(`https://api.z-api.io/instances/${inst}/token/${tok}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ct },
    body: JSON.stringify({ phone: fone(cel), message: mensagem }),
  });
  if (!r.ok) throw new Error(`Z-API ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
