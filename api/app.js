import { q, garantirSchema } from '../lib/db.js';
import { hash, confere, assinar, verificar } from '../lib/auth.js';
import { enviar } from '../lib/whatsapp.js';
import { AREAS, SLOT, normCel, Erro } from '../lib/util.js';
import { enviarEscalaSeCompleta, msgLembrete } from '../lib/servico.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/, HORA = /^\d{2}:\d{2}$/;
const areasOk = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => AREAS.includes(x));
const admin = (u) => { if (!u.admin) throw new Erro('Acesso restrito a administradores.', 403); };
const celOk = (c) => c.length >= 10 && c.length <= 11;
const dup = (e) => { if (e.code === '23505') throw new Erro('Este celular já está cadastrado.', 409); };
const SEL_USER = `select id,nome,coalesce(to_char(nasc,'YYYY-MM-DD'),'') nasc,cel,atua,deseja,is_admin admin,
  coalesce((select array_agg(treino_id) from presencas p where p.user_id=users.id),'{}'::int[]) presencas from users`;
const tentarEscala = async (id) => { try { return await enviarEscalaSeCompleta(id); } catch (e) { console.error('escala:', e); return 'erro'; } };

// Insere uma inscrição respeitando as vagas da função (confere de novo depois, para corridas)
async function inserir(culto, uid, role) {
  const [c] = await q('select vagas from cultos where id=$1', [culto]);
  if (!c) throw new Erro('Culto não encontrado.', 404);
  const max = Number(c.vagas[SLOT[role]] || 0);
  if ((await q('select 1 from inscricoes where culto_id=$1 and user_id=$2', [culto, uid])).length) throw new Erro('Esta pessoa já está inscrita neste culto.', 409);
  const semVaga = new Erro('Infelizmente não há mais vagas disponíveis para a sua função!', 409, 'sem_vaga');
  const [ins] = await q(
    `insert into inscricoes(culto_id,user_id,role) select $1::int,$2::int,$3::text
     where (select count(*) from inscricoes where culto_id=$1::int and role=$3::text) < $4::int returning id`,
    [culto, uid, role, max]);
  if (!ins) throw semVaga;
  const [{ n }] = await q('select count(*)::int n from inscricoes where culto_id=$1 and role=$2', [culto, role]);
  if (n > max) { await q('delete from inscricoes where id=$1', [ins.id]); throw semVaga; }
}

async function estado(u) {
  const cultos = await q(`select c.id,c.nome,to_char(c.data,'YYYY-MM-DD') data,to_char(c.hora,'HH24:MI') hora,c.vagas,
    (select coalesce(json_agg(json_build_object('uid',i.user_id,'role',i.role) order by i.id),'[]'::json) from inscricoes i where i.culto_id=c.id) insc
    from cultos c order by c.data,c.hora`);
  const treinos = await q(`select id,area,to_char(data,'YYYY-MM-DD') data,to_char(hora,'HH24:MI') hora,tema from treinos order by data,hora`);
  const out = { me: u, cultos, treinos, users: [u], notif: [] };
  if (u.admin) {
    out.users = await q(SEL_USER + ' order by nome');
    out.notif = (await q(`select u.nome,i.role,c.nome culto,to_char(c.data,'DD/MM/YYYY') d from inscricoes i
      join users u on u.id=i.user_id join cultos c on c.id=i.culto_id order by i.criado_em desc limit 5`))
      .map((r) => `${r.nome} se inscreveu em ${r.culto} (${r.d}) como ${r.role}`);
  }
  return out;
}

const PUBLICAS = {
  async register(b) {
    const nome = String(b.nome || '').trim(), cel = normCel(b.cel);
    if (nome.length < 2 || !DATA.test(b.nasc) || !celOk(cel) || String(b.senha || '').length < 4 || !areasOk(b.atua) || !areasOk(b.deseja))
      throw new Erro('Preencha todos os campos e marque ao menos uma área em cada pergunta.');
    try {
      const [u] = await q('insert into users(nome,nasc,cel,senha_hash,atua,deseja) values($1,$2,$3,$4,$5,$6) returning id',
        [nome, b.nasc, cel, hash(b.senha), b.atua, b.deseja]);
      return { token: assinar(u.id) };
    } catch (e) { dup(e); throw e; }
  },
  async login(b) {
    const [u] = await q('select id,senha_hash from users where cel=$1', [normCel(b.cel)]);
    if (!u || !confere(b.senha || '', u.senha_hash)) throw new Erro('Celular ou senha incorretos.', 401);
    return { token: assinar(u.id) };
  },
  // Passo 1 da recuperação: confere celular + data de nascimento. Se baterem, devolve um token
  // de 10 min que só serve para trocar a senha desse usuário. 5 erros por celular = bloqueio de 15 min.
  async recVerificar(b) {
    const cel = normCel(b.cel);
    if (!celOk(cel)) throw new Erro('Informe o celular com DDD.');
    if (!DATA.test(b.nasc)) throw new Erro('Informe a data de nascimento.');
    const [lim] = await q('select tentativas from reset_codes where cel=$1 and expira > now()', [cel]);
    if (lim && lim.tentativas >= 5) throw new Erro('Muitas tentativas. Tente de novo em 15 minutos.', 429);
    const [u] = await q('select id,(nasc = $2::date) as ok,(nasc is null) as sem from users where cel=$1', [cel, b.nasc]);
    const falha = !u ? 'Número de celular não encontrado.'
      : u.sem ? 'Este cadastro não tem data de nascimento. Peça a um administrador para redefinir a senha.'
      : !u.ok ? 'Data de nascimento incorreta para este número.' : null;
    if (falha) {
      await q(`insert into reset_codes(cel,code_hash,expira,tentativas) values($1,'-',now()+interval '15 minutes',1)
        on conflict(cel) do update set
          tentativas = case when reset_codes.expira > now() then reset_codes.tentativas+1 else 1 end,
          expira = case when reset_codes.expira > now() then reset_codes.expira else now()+interval '15 minutes' end`, [cel]);
      throw new Erro(falha);
    }
    await q('delete from reset_codes where cel=$1', [cel]);
    return { token: assinar(u.id, 'reset', 10 * 60e3) };
  },
  // Passo 2: troca a senha de quem passou no passo 1 (sem o token, nada é alterado)
  async recSenha(b) {
    const uid = verificar(b.token, 'reset');
    if (!uid) throw new Erro('Verificação expirada. Informe o celular e a data de nascimento de novo.');
    if (String(b.senha || '').length < 4) throw new Erro('Use ao menos 4 caracteres na senha.');
    const r = await q('update users set senha_hash=$2 where id=$1 returning id', [uid, hash(b.senha)]);
    if (!r.length) throw new Erro('Não foi possível alterar a senha.');
    return { ok: true };
  },
};

const PRIVADAS = {
  state: (u) => estado(u),
  async salvarPerfil(u, b) {
    const nome = String(b.nome || '').trim(), cel = normCel(b.cel);
    const nasc = DATA.test(b.nasc) ? b.nasc : null;
    if (nome.length < 2 || !celOk(cel) || (!nasc && !u.admin)) throw new Erro('Preencha nome, nascimento e celular com DDD.');
    try { await q('update users set nome=$2,nasc=$3,cel=$4 where id=$1', [u.id, nome, nasc, cel]); }
    catch (e) { dup(e); throw e; }
    return { ok: true };
  },
  async salvarAreas(u, b) {
    if (!areasOk(b.atua) || !areasOk(b.deseja)) throw new Erro('Marque ao menos uma área em cada pergunta.');
    await q('update users set atua=$2,deseja=$3 where id=$1', [u.id, b.atua, b.deseja]);
    return { ok: true };
  },
  async trocarSenha(u, b) {
    if (String(b.senha || '').length < 4) throw new Erro('Use ao menos 4 caracteres.');
    await q('update users set senha_hash=$2 where id=$1', [u.id, hash(b.senha)]);
    return { ok: true };
  },
  async presenca(u, b) {
    const t = Number(b.treino);
    const [t0] = await q('select 1 from treinos where id=$1', [t]);
    if (!t0) throw new Erro('Treinamento não encontrado.', 404);
    await q(`with d as (delete from presencas where treino_id=$1::int and user_id=$2::int returning 1)
      insert into presencas(treino_id,user_id) select $1::int,$2::int where not exists (select 1 from d)`, [t, u.id]);
    return { ok: true };
  },
  async inscrever(u, b) {
    if (!u.atua.includes(b.role)) throw new Erro('Você não atua nessa função.');
    const [c] = await q(`select 1 from cultos where id=$1 and ((data+hora) at time zone 'America/Sao_Paulo') > now()`, [b.culto]);
    if (!c) throw new Erro('Culto não encontrado ou já iniciado.', 404);
    await inserir(b.culto, u.id, b.role);
    return { ok: true, escala: (await tentarEscala(b.culto)) === 'enviada' };
  },

  // ---- administração ----
  async cultoSalvar(u, b) {
    admin(u);
    const nome = String(b.nome || '').trim();
    if (!nome || !DATA.test(b.data) || !HORA.test(b.hora)) throw new Erro('Preencha nome, data e horário.');
    const v = {};
    for (const k of ['som', 'pc', 'foto', 'video']) {
      const n = Number(b.vagas?.[k]);
      if (!Number.isInteger(n) || n < 0 || n > 9) throw new Erro('As vagas devem ficar entre 0 e 9.');
      v[k] = n;
    }
    if (b.id) {
      for (const r of await q('select role,count(*)::int n from inscricoes where culto_id=$1 group by role', [b.id]))
        if (v[SLOT[r.role]] < r.n) throw new Erro(`Há mais voluntários em ${r.role} do que a nova quantidade de vagas. Remova alguém da escala primeiro.`);
      const [old] = await q(`select to_char(data,'YYYY-MM-DD') data,to_char(hora,'HH24:MI') hora from cultos where id=$1`, [b.id]);
      if (!old) throw new Erro('Culto não encontrado.', 404);
      await q('update cultos set nome=$2,data=$3,hora=$4,vagas=$5::jsonb,escala_enviada_em=null where id=$1', [b.id, nome, b.data, b.hora, JSON.stringify(v)]);
      if (old.data !== b.data || old.hora !== b.hora) await q('update inscricoes set lembrete_enviado_em=null where culto_id=$1', [b.id]);
      await tentarEscala(b.id);
    } else {
      await q('insert into cultos(nome,data,hora,vagas) values($1,$2,$3,$4::jsonb)', [nome, b.data, b.hora, JSON.stringify(v)]);
    }
    return { ok: true };
  },
  async cultoRemover(u, b) { admin(u); await q('delete from cultos where id=$1', [b.id]); return { ok: true }; },
  async inscRemover(u, b) {
    admin(u);
    await q('delete from inscricoes where culto_id=$1 and user_id=$2', [b.culto, b.user]);
    await q('update cultos set escala_enviada_em=null where id=$1', [b.culto]);
    return { ok: true };
  },
  async inscAdd(u, b) {
    admin(u);
    const [p] = await q('select atua from users where id=$1', [b.user]);
    if (!p || !p.atua.includes(b.role)) throw new Erro('Esse voluntário não atua em ' + b.role + '.');
    await inserir(b.culto, b.user, b.role);
    await tentarEscala(b.culto);
    return { ok: true };
  },
  async inscTrocar(u, b) {
    admin(u);
    const [i] = await q('select role from inscricoes where culto_id=$1 and user_id=$2', [b.culto, b.de]);
    if (!i) throw new Erro('Inscrição não encontrada.', 404);
    const [p] = await q('select atua from users where id=$1', [b.para]);
    if (!p || !p.atua.includes(i.role)) throw new Erro('Esse voluntário não atua em ' + i.role + '.');
    if ((await q('select 1 from inscricoes where culto_id=$1 and user_id=$2', [b.culto, b.para])).length) throw new Erro('Esse voluntário já está nesta escala.');
    await q('update inscricoes set user_id=$3,lembrete_enviado_em=null where culto_id=$1 and user_id=$2', [b.culto, b.de, b.para]);
    await q('update cultos set escala_enviada_em=null where id=$1', [b.culto]);
    await tentarEscala(b.culto);
    return { ok: true };
  },
  async lembrar(u, b) {
    admin(u);
    const [r] = await q(`select u.nome,u.cel,c.nome culto,to_char(c.data,'YYYY-MM-DD') data,to_char(c.hora,'HH24:MI') hora,i.role
      from inscricoes i join cultos c on c.id=i.culto_id join users u on u.id=i.user_id where i.culto_id=$1 and i.user_id=$2`, [b.culto, b.user]);
    if (!r) throw new Erro('Inscrição não encontrada.', 404);
    try { await enviar(r.cel, msgLembrete(r)); } catch (e) { throw new Erro('Não foi possível enviar: ' + e.message, 502); }
    return { ok: true };
  },
  async reenviarEscala(u, b) {
    admin(u);
    if ((await enviarEscalaSeCompleta(b.culto, { forcar: true })) !== 'enviada') throw new Erro('Não foi possível enviar a escala. Confira a configuração do WhatsApp.', 502);
    return { ok: true };
  },
  async treinoSalvar(u, b) {
    admin(u);
    const tema = String(b.tema || '').trim();
    if (!AREAS.includes(b.area) || !tema || !DATA.test(b.data) || !HORA.test(b.hora)) throw new Erro('Preencha área, tema, data e horário.');
    await q('insert into treinos(area,data,hora,tema) values($1,$2,$3,$4)', [b.area, b.data, b.hora, tema]);
    return { ok: true };
  },
  async treinoRemover(u, b) { admin(u); await q('delete from treinos where id=$1', [b.id]); return { ok: true }; },
  async redefinirSenha(u, b) {
    admin(u);
    if (String(b.senha || '').length < 4) throw new Erro('Use ao menos 4 caracteres.');
    await q('update users set senha_hash=$2 where id=$1', [b.id, hash(b.senha)]);
    return { ok: true };
  },
  async rebaixar(u, b) {
    admin(u);
    if (Number(b.id) === u.id) throw new Erro('Você não pode remover a si mesmo. Use o botão "Usuário" para alternar a visão.');
    await q('update users set is_admin=false where id=$1', [b.id]);
    return { ok: true };
  },
  async excluirUsuario(u, b) {
    admin(u);
    if (Number(b.id) === u.id) throw new Erro('Você não pode excluir a própria conta.');
    const [t] = await q('select cel from users where id=$1', [b.id]);
    if (!t) throw new Erro('Usuário não encontrado.', 404);
    await q('update cultos set escala_enviada_em=null where id in (select culto_id from inscricoes where user_id=$1)', [b.id]);
    await q('delete from users where id=$1', [b.id]);
    await q('delete from reset_codes where cel=$1', [t.cel]);
    return { ok: true };
  },
  async nomear(u, b) { admin(u); await q('update users set is_admin=true where id=$1', [b.id]); return { ok: true }; },
  async criarAdmin(u, b) {
    admin(u);
    const nome = String(b.nome || '').trim(), cel = normCel(b.cel);
    if (!nome || !celOk(cel) || String(b.senha || '').length < 4) throw new Erro('Informe nome, celular com DDD e senha (mín. 4 caracteres).');
    try { await q('insert into users(nome,cel,senha_hash,is_admin) values($1,$2,$3,true)', [nome, cel, hash(b.senha)]); }
    catch (e) { if (e.code === '23505') throw new Erro('Celular já cadastrado.', 409); throw e; }
    return { ok: true };
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  try {
    await garantirSchema();
    const { action, ...b } = req.body || {};
    if (PUBLICAS[action]) return res.json(await PUBLICAS[action](b));
    const uid = verificar((req.headers.authorization || '').replace(/^Bearer /, ''));
    const [u] = uid ? await q(SEL_USER + ' where id=$1', [uid]) : [];
    if (!u) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
    if (!PRIVADAS[action]) return res.status(404).json({ erro: 'Ação desconhecida.' });
    return res.json(await PRIVADAS[action](u, b));
  } catch (e) {
    if (e instanceof Erro) return res.status(e.status).json({ erro: e.message, codigo: e.codigo });
    console.error(e);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
}
