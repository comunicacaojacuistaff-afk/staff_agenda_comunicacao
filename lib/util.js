export const AREAS = ['Fotografia', 'Vídeo', 'Mesa de Som', 'PC'];
export const SLOT = { 'Fotografia': 'foto', 'Vídeo': 'video', 'Mesa de Som': 'som', 'PC': 'pc' };
// Guarda o celular só com DDD + número (sem 55)
export const normCel = (s) => { let d = String(s || '').replace(/\D/g, ''); if (d.startsWith('55') && d.length > 11) d = d.slice(2); return d; };
export const fmt = (d) => d.split('-').reverse().join('/');
export class Erro extends Error {
  constructor(msg, status = 400, codigo) { super(msg); this.status = status; this.codigo = codigo; }
}
export const normEmail = (s) => String(s || '').trim().toLowerCase();
export const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;
