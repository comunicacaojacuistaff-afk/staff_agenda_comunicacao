import { q } from './db.js';
import { enviar } from './whatsapp.js';
import { fmt } from './util.js';

const CULTO = `select c.id,c.nome,to_char(c.data,'YYYY-MM-DD') data,to_char(c.hora,'HH24:MI') hora,c.vagas,
  (select count(*) from inscricoes i where i.culto_id=c.id)::int n from cultos c where c.id=$1`;

export const msgLembrete = (r) =>
  `Olá, ${r.nome}! ⏰ Lembrete: o *${r.culto}* começa às ${r.hora} (${fmt(r.data)}) e você está escalado(a) em *${r.role}*. Contamos com você! — Comunicação ADVEC`;

// Envia a escala completa a TODOS os administradores quando o culto lota (uma vez por lotação).
export async function enviarEscalaSeCompleta(cultoId, { forcar = false } = {}) {
  const [c] = await q(CULTO, [cultoId]);
  if (!c) return 'culto_inexistente';
  const total = Object.values(c.vagas).reduce((a, b) => a + Number(b), 0);
  if (!forcar) {
    if (total === 0 || c.n < total) return 'incompleta';
    const r = await q('update cultos set escala_enviada_em=now() where id=$1 and escala_enviada_em is null returning id', [cultoId]);
    if (!r.length) return 'ja_enviada';
  }
  const equipe = await q('select u.nome,i.role from inscricoes i join users u on u.id=i.user_id where i.culto_id=$1 order by i.role,u.nome', [cultoId]);
  const admins = await q('select cel from users where is_admin');
  const msg = `✅ *Escala completa*\n*${c.nome}* — ${fmt(c.data)} às ${c.hora}\n\n` + equipe.map((m) => `• ${m.nome} — ${m.role}`).join('\n');
  const res = await Promise.allSettled(admins.map((a) => enviar(a.cel, msg)));
  res.forEach((x) => x.status === 'rejected' && console.error('WhatsApp (escala):', x.reason?.message));
  if (!res.some((x) => x.status === 'fulfilled')) {
    if (!forcar) await q('update cultos set escala_enviada_em=null where id=$1', [cultoId]); // o cron tenta de novo
    return 'falhou';
  }
  if (forcar) await q('update cultos set escala_enviada_em=now() where id=$1', [cultoId]);
  return 'enviada';
}

// Rede de segurança: escalas completas que ainda não foram enviadas
export async function escalasPendentes() {
  const rows = await q(`select c.id from cultos c
    where c.escala_enviada_em is null and ((c.data+c.hora) at time zone 'America/Sao_Paulo') > now()`);
  const out = [];
  for (const r of rows) {
    const s = await enviarEscalaSeCompleta(r.id);
    if (s !== 'incompleta') out.push({ culto: r.id, status: s });
  }
  return out;
}

// Lembrete no número do próprio voluntário, a partir de 2h antes do culto (horário de Brasília)
export async function enviarLembretes() {
  const rows = await q(`select i.id,u.nome,u.cel,c.nome culto,to_char(c.data,'YYYY-MM-DD') data,to_char(c.hora,'HH24:MI') hora,i.role
    from inscricoes i join cultos c on c.id=i.culto_id join users u on u.id=i.user_id
    where i.lembrete_enviado_em is null
    and ((c.data+c.hora) at time zone 'America/Sao_Paulo') between now() and now()+interval '2 hours'`);
  let enviados = 0; const erros = [];
  for (const r of rows) {
    const claim = await q('update inscricoes set lembrete_enviado_em=now() where id=$1 and lembrete_enviado_em is null returning id', [r.id]);
    if (!claim.length) continue;
    try { await enviar(r.cel, msgLembrete(r)); enviados++; }
    catch (e) {
      erros.push(`#${r.id}: ${e.message}`);
      await q('update inscricoes set lembrete_enviado_em=null where id=$1', [r.id]); // tenta de novo no próximo ciclo
    }
  }
  return { enviados, erros };
}
