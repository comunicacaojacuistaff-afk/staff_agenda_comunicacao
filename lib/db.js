import { neon } from '@neondatabase/serverless';
import { hash } from './auth.js';
import { normCel, normEmail, emailOk } from './util.js';

// Aceita DATABASE_URL, POSTGRES_URL ou o mesmo nome com prefixo (ex.: STORAGE_DATABASE_URL)
const achar = () => {
  const e = process.env;
  if (e.DATABASE_URL || e.POSTGRES_URL) return e.DATABASE_URL || e.POSTGRES_URL;
  const k = Object.keys(e).find((n) => /(DATABASE_URL|POSTGRES_URL)$/.test(n) && !/UNPOOLED|NON_POOLING/.test(n));
  return k ? e[k] : undefined;
};
const url = achar();
const conn = url ? neon(url) : null;
export const q = (text, params = []) => {
  if (!conn) throw new Error('DATABASE_URL não configurada.');
  return conn.query(text, params);
};

const SCHEMA = [
  `create table if not exists users(
     id serial primary key, nome text not null, nasc date, cel text not null unique, senha_hash text not null,
     atua text[] not null default '{}', deseja text[] not null default '{}',
     is_admin boolean not null default false, criado_em timestamptz not null default now())`,
  `create table if not exists cultos(
     id serial primary key, nome text not null, data date not null, hora time not null,
     vagas jsonb not null default '{"som":1,"pc":1,"foto":1,"video":1}', escala_enviada_em timestamptz)`,
  `create table if not exists inscricoes(
     id serial primary key, culto_id int not null references cultos(id) on delete cascade,
     user_id int not null references users(id) on delete cascade, role text not null,
     lembrete_enviado_em timestamptz, criado_em timestamptz not null default now(), unique(culto_id, user_id))`,
  `create table if not exists treinos(
     id serial primary key, area text not null, data date not null, hora time not null, tema text not null)`,
  `create table if not exists presencas(
     treino_id int references treinos(id) on delete cascade, user_id int references users(id) on delete cascade,
     primary key(treino_id, user_id))`,
  `create table if not exists reset_codes(
     cel text primary key, code_hash text not null, expira timestamptz not null, tentativas int not null default 0)`,
  `alter table users add column if not exists email text`,
  `create unique index if not exists users_email_uq on users(lower(email)) where email is not null`,
];

let pronto;
export function garantirSchema() {
  pronto ??= (async () => {
    for (const s of SCHEMA) await q(s);
    const [{ n }] = await q('select count(*)::int n from users where is_admin');
    if (!n && process.env.ADMIN_CEL && process.env.ADMIN_SENHA) {
      const em = normEmail(process.env.ADMIN_EMAIL);
      await q(
        `insert into users(nome,cel,senha_hash,is_admin,email) values($1,$2,$3,true,$4)
         on conflict(cel) do update set is_admin=true`,
        [process.env.ADMIN_NOME || 'Administrador', normCel(process.env.ADMIN_CEL), hash(process.env.ADMIN_SENHA), emailOk(em) ? em : null]);
    }
  })().catch((e) => { pronto = undefined; throw e; });
  return pronto;
}
