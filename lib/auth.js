import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const segredo = () => {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET não configurado.');
  return process.env.AUTH_SECRET;
};
export const hash = (s) => {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(String(s), salt, 32).toString('hex');
};
export const confere = (s, h) => {
  const [salt, k] = String(h).split(':');
  if (!salt || !k) return false;
  const a = Buffer.from(k, 'hex'), b = scryptSync(String(s), salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
};
const assina = (p) => createHmac('sha256', segredo()).update(p).digest('base64url');
export const assinar = (uid, tipo, ms = 30 * 864e5) => {
  const p = Buffer.from(JSON.stringify({ uid, tipo, exp: Date.now() + ms })).toString('base64url');
  return p + '.' + assina(p);
};
export const verificar = (tok, tipo) => {
  const [p, s] = String(tok || '').split('.');
  if (!p || !s) return null;
  const a = Buffer.from(s), b = Buffer.from(assina(p));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.exp > Date.now() && d.tipo === tipo ? d.uid : null; }
  catch { return null; }
};
