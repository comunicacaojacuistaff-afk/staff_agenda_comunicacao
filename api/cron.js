import { garantirSchema } from '../lib/db.js';
import { enviarLembretes, escalasPendentes } from '../lib/servico.js';

// Chamado a cada 5 min pelo GitHub Actions (ou cron-job.org / Vercel Cron no plano Pro)
export default async function handler(req, res) {
  const seg = process.env.CRON_SECRET;
  if (!seg || req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'negado' });
  try {
    await garantirSchema();
    const lembretes = await enviarLembretes();
    const escalas = await escalasPendentes();
    res.json({ lembretes, escalas });
  } catch (e) { console.error(e); res.status(500).json({ erro: e.message }); }
}
