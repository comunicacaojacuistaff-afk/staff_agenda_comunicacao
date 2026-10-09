# Comunicação ADVEC — gestão de voluntários

App completo para Vercel + Neon Postgres, com WhatsApp automático (Z-API).

- `public/` — o app (React). `api/app.js` — API. `api/cron.js` — lembretes. `lib/` — banco, login, WhatsApp.
- As tabelas são criadas sozinhas na primeira chamada (não precisa rodar SQL).

## O que é automático
- **Escala completa:** quando a última vaga de um culto é preenchida, a escala (culto, data, hora, nomes e funções) vai para **todos os administradores**, no número do cadastro de cada um. Se alguém sair e ela lotar de novo, é enviada outra vez.
- **Lembrete:** cada voluntário escalado recebe no **próprio número** uma mensagem a partir de 2 h antes do culto (horário de Brasília). Quem se inscreve dentro dessa janela recebe no ciclo seguinte.
- **Recuperar senha:** o código de 6 dígitos vai por **e-mail** (vale 15 min, 5 tentativas). Quem não tiver acesso ao e-mail pede ao administrador (aba Usuários → *Redefinir senha*).

## Publicar
1. Suba esta pasta para um repositório no **GitHub**.
2. Na **Vercel**: *Add New → Project* → importe o repositório (preset "Other", sem build).
3. Na Vercel: *Storage → Neon (Marketplace) → conectar ao projeto*. Isso cria `DATABASE_URL` sozinho.
4. Em *Settings → Environment Variables* crie (veja `.env.example`):
   `AUTH_SECRET`, `ADMIN_NOME`, `ADMIN_CEL`, `ADMIN_SENHA`, `CRON_SECRET`, `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`.
   Para testar sem enviar de verdade, use `WHATSAPP_DRY_RUN=1` (as mensagens aparecem em *Logs* da Vercel). Depois faça *Redeploy*.
5. No **GitHub** → *Settings → Secrets and variables → Actions*: crie `APP_URL` (ex.: `https://seu-app.vercel.app`, sem barra no fim) e `CRON_SECRET` (o mesmo da Vercel). O arquivo `.github/workflows/lembretes.yml` chama `/api/cron` a cada 5 min. Também dá para usar cron-job.org ou, no plano Pro da Vercel, Vercel Cron.
6. Em **z-api.io**: crie uma instância, conecte o WhatsApp da igreja por QR code e copie ID da instância, token e Client-Token (em Segurança).
7. Entre no app com `ADMIN_CEL` / `ADMIN_SENHA` (o primeiro admin é criado automaticamente).

## Teste antes de usar de verdade
1. Com `WHATSAPP_DRY_RUN=1`: crie um culto com 1 vaga em cada função, inscreva voluntários até lotar e veja a escala nos logs.
2. Crie um culto para daqui a ~1 h 30, inscreva-se e rode o workflow manualmente (*Actions → lembretes-whatsapp → Run workflow*): o lembrete deve aparecer nos logs.
3. Troque para `WHATSAPP_DRY_RUN=0` e repita com seu número.

## Observações
- Cadastros guardam senha com hash (scrypt); login por token assinado (30 dias). Dados pessoais (celular, nascimento) ficam só no seu banco — trate conforme a LGPD.
- Z-API é paga e usa o WhatsApp comum: mantenha só mensagens esperadas e baixo volume (risco de bloqueio do número). Para outro serviço, edite apenas `lib/whatsapp.js`.
- O GitHub pode atrasar execuções agendadas em alguns minutos, e pausa agendamentos de repositórios sem atividade por 60 dias; o cron-job.org é uma alternativa mais pontual.
- Para rodar local: `npm i -g vercel`, `vercel dev` (com as variáveis em `.env`).

## E-mail de recuperação (Brevo, grátis)
1. Crie conta em brevo.com (o plano gratuito inclui envio transacional, até 300 e-mails por dia).
2. Confirme um e-mail remetente em *Senders*, *Domains & Dedicated IPs → Senders* (ou nome parecido): vai chegar um link de confirmação.
3. Em *SMTP & API → API Keys*, crie uma chave.
4. Na Vercel, crie `BREVO_API_KEY` (a chave), `EMAIL_REMETENTE` (o e-mail confirmado) e, se quiser, `ADMIN_EMAIL`. Faça *Redeploy*.
5. Com `WHATSAPP_DRY_RUN=1` o e-mail não é enviado: o código aparece nos Logs como `[EMAIL TESTE]`.
