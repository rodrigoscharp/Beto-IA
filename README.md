<div align="center">

<img src="public/logo.svg" alt="BETO IA" width="120" />

# BETO IA

**Seu brother e sócio de inteligência artificial**

Assistente pessoal de voz e texto, sci-fi, com simpatia e sotaque, rodando no seu próprio servidor.

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss)](https://tailwindcss.com)
[![Deploy on Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

---

> Clone, configure suas chaves e tenha seu próprio Beto rodando em menos de 10 minutos.

---

## O que é isso

Um assistente pessoal que você hospeda. Sem assinaturas, sem dados de terceiros, sem rastreamento. Você conecta suas próprias contas (Spotify, Google, GitHub) e o Beto passa a controlar tudo por voz.

A interface é o Beto em pessoa: um mascote 3D, o Fantasminha, que reage ao que está acontecendo — dorme esperando o nome dele, fica atento ouvindo, pensa de óculos e prancheta, fala com a emoção da resposta, acena nas saudações, avisa notificações e vira DJ quando o Spotify toca. A voz vem do [VoiceStudio](https://github.com/debpalash/VoiceStudio) rodando no próprio Mac, sem cota, e o [Groq](https://groq.com) cuida da inferência rápida do LLM.

---

## Funcionalidades

**Voz e conversa**
- Ativação por palavra-chave: "Beto", "Ei Beto", "Olá Beto"
- Personalidade de brother e empresário parceiro — direto no trabalho, leve na resenha, e sabe quando cada tom cabe
- Reconhecimento em português via Web Speech API (Chrome/Edge)
- Síntese de voz local com o VoiceStudio (OmniVoice, perfil "Beto": jovem, tom médio) — sem voz reserva: se ele cair, o texto fica na tela e aparece o aviso "sem voz"
- Histórico de contexto das últimas 20 mensagens por sessão

**Integrações**
- **Spotify** — tocar músicas/artistas/playlists, pausar, pular, controlar volume
- **Google Calendar** — criar eventos, listar agenda do dia/semana
- **Gmail** — resumo dos emails não lidos dos últimos N dias
- **GitHub** — listar PRs abertos, issues, commits recentes
- **Briefing matinal** — agenda + emails + clima em um único comando
- **Memória persistente** — salva preferências, fatos e tarefas no Supabase

**Interface**
- Mascote 3D Fantasminha (three.js) com expressões, aceno, notificação e modo DJ; modo claro e escuro
- Mini player do Spotify com controles e barra de progresso
- Tipografia futurista: Orbitron + Share Tech Mono
- Grid animado, glow cyan, totalmente responsivo

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | Next.js 14 (App Router) |
| Linguagem | TypeScript 5 |
| Estilo | Tailwind CSS 3 |
| LLM | Groq — `llama-3.1-8b-instant` |
| TTS | VoiceStudio local (k2-fsa/OmniVoice, 8 passos) |
| Voz (input) | Web Speech API (nativa) |
| Memória | Supabase (PostgreSQL) |
| Deploy | Vercel |

**Dependências de runtime:**

```
next, react, react-dom
groq-sdk
@supabase/supabase-js
msedge-tts
```

---

## Pré-requisitos

- **Node.js 18+**
- Conta no [Groq](https://console.groq.com) — gratuita, sem cartão
- Mac com Apple Silicon e o [VoiceStudio](https://github.com/debpalash/VoiceStudio) instalado em `~/Dev/VoiceStudio` (ver "Voz do Beto" abaixo)
- Conta no [Supabase](https://supabase.com) — gratuita
- (Opcional) Conta Spotify Premium para controle de playback
- (Opcional) Projeto no Google Cloud para Calendar e Gmail
- (Opcional) Personal Access Token do GitHub

---

## Setup

### 1. Clone e instale

```bash
git clone https://github.com/rodrigoscharp/Own-Jarvis.git
cd Own-Jarvis
npm install
cp .env.local.example .env.local
```

### 2. Configure as variáveis de ambiente

Edite `.env.local` com suas chaves. Veja a [tabela completa](#variáveis-de-ambiente) abaixo.

### 3. Configure o Supabase

No painel do Supabase, abra o **SQL Editor** e execute:

```sql
create table jarvis_memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  category text not null default 'general',
  created_at timestamptz default now()
);
```

A anon key padrão do Supabase já tem permissão de leitura e escrita nessa tabela.

### Push com o app fechado (opcional)

O Beto avisa por push (Mac e celular) o que é importante mesmo sem a aba aberta: email importante, reunião chegando, review pedido e CI/deploy falhando. Hábito, treino e conflitos de agenda ficam só na voz.

1. Rode `supabase/push.sql` no SQL Editor do Supabase (tabelas `push_subscriptions` e `push_seen`).
2. Variáveis na Vercel: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (gere com `npx web-push generate-vapid-keys`), `CRON_SECRET` e `TOKEN_ENC_KEY` (`openssl rand -hex 32`).
   Autorize o Google uma vez em `/api/calendar/login`: o callback guarda o refresh token cifrado (AES-GCM com `TOKEN_ENC_KEY`) na tabela `push_secrets`. Se preferir, `GOOGLE_REFRESH_TOKEN` na env tem prioridade.
3. Secret `CRON_SECRET` (mesmo valor) no GitHub: o workflow `.github/workflows/alerts-cron.yml` chama `/api/cron/alerts` a cada 5 min (o cron gratuito da Vercel só roda 1x por dia).
4. No app, clique em `push: off` para ativar neste aparelho. No iPhone o Beto precisa estar instalado na tela de início.

O cron fica em silêncio das 23h às 7h e envia no máximo 5 avisos por rodada.

### 4. (Opcional) Configure o Spotify

1. Acesse [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Crie um app — anote o **Client ID** e o **Client Secret**
3. Em **Redirect URIs**, adicione:
   - `http://localhost:3000/api/spotify/callback` (desenvolvimento)
   - `https://seu-dominio.vercel.app/api/spotify/callback` (produção)
4. Preencha `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` e `SPOTIFY_REDIRECT_URI` no `.env.local`
5. Com o servidor rodando, acesse `/api/spotify/login` para autorizar

### 5. (Opcional) Configure Google Calendar e Gmail

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto e ative as APIs: **Google Calendar API** e **Gmail API**
3. Em **Credenciais**, crie um **OAuth 2.0 Client ID** (tipo: Web Application)
4. Adicione os URIs de redirecionamento:
   - `http://localhost:3000/api/calendar/callback`
   - `https://seu-dominio.vercel.app/api/calendar/callback`
5. Baixe as credenciais e preencha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
6. Com o servidor rodando, acesse `/api/calendar/login` para autorizar

### 6. (Opcional) Configure o GitHub

1. Gere um **Personal Access Token** em [github.com/settings/tokens](https://github.com/settings/tokens)
2. Permissões necessárias: `repo`, `read:user`
3. Preencha `GITHUB_TOKEN`, `GITHUB_USER` e `GITHUB_DEFAULT_REPO`

### 7. Rode localmente

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

---

## Variáveis de ambiente

Copie `.env.local.example` para `.env.local` e preencha:

| Variável | Descrição | Obrigatória |
|----------|-----------|:-----------:|
| `GROQ_API_KEY` | Chave da API do Groq (LLM) | ✅ |
| `NEXT_PUBLIC_VOICESTUDIO_URL` | Onde o navegador pede a voz (padrão: `https://localhost:3900`) | — |
| `NEXT_PUBLIC_VOICESTUDIO_VOICE` | Perfil de voz no VoiceStudio (padrão: `Beto`) | — |
| `NEXT_PUBLIC_VOICESTUDIO_STEPS` | Passos de geração: 8 rápido, 16 melhor e mais lento (padrão: `8`) | — |
| `SUPABASE_URL` | URL do seu projeto Supabase | ✅ |
| `SUPABASE_ANON_KEY` | Chave pública do Supabase | ✅ |
| `SPOTIFY_CLIENT_ID` | Client ID do app Spotify | ⬜ |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do app Spotify | ⬜ |
| `SPOTIFY_REDIRECT_URI` | URI de callback do Spotify OAuth | ⬜ |
| `GOOGLE_CLIENT_ID` | Client ID do Google Cloud | ⬜ |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google Cloud | ⬜ |
| `GOOGLE_REDIRECT_URI` | URI de callback do Google OAuth | ⬜ |
| `GITHUB_TOKEN` | Personal Access Token do GitHub | ⬜ |
| `GITHUB_USER` | Seu usuário GitHub | ⬜ |
| `GITHUB_DEFAULT_REPO` | Repositório padrão para consultas | ⬜ |
| `OPENWEATHER_API_KEY` | Chave da OpenWeather (briefing matinal) | ⬜ |
| `OPENWEATHER_CITY` | Cidade para previsão do tempo | ⬜ |
| `VOICE_SERVICE_TOKEN` | Token do serviço local de voz (`voice/`) para chamar `/api/chat` | ⬜ |
| `NEXT_PUBLIC_VOICE_URL` | Onde o navegador procura o serviço local (padrão `http://localhost:7860`) | ⬜ |

---

## Deploy na Vercel

1. Fork este repositório para a sua conta GitHub
2. Acesse [vercel.com/new](https://vercel.com/new) e importe o repositório
3. Na aba **Environment Variables**, adicione todas as variáveis do `.env.local`
4. Para as URIs de OAuth (Spotify e Google), use o domínio da Vercel:
   - `https://seu-projeto.vercel.app/api/spotify/callback`
   - `https://seu-projeto.vercel.app/api/calendar/callback`
5. Clique em **Deploy**

Cada push para `main` faz deploy automático.

---

## PWA, senha e escuta em segundo plano

- **Senha única:** todas as páginas e `/api/*` exigem login (`middleware.ts`). O hash SHA-256 da senha fica em `lib/auth.ts`; a sessão é um cookie assinado (HMAC) de 30 dias. Opcional: defina `AUTH_SECRET` na Vercel para assinar com outra chave (trocar invalida as sessões). Para trocar a senha: `node -e "console.log(require('crypto').createHash('sha256').update('NOVA_SENHA').digest('hex'))"` e cole em `PASSWORD_SHA256`.
- **Instalar no Dock (Safari):** abra `https://localhost:3443` (o proxy local, ver "Safari e app do Dock") → Arquivo → **Adicionar ao Dock**. Pela URL da Vercel o app abre, mas fica sem voz. No Chrome/Edge: ícone de instalar na barra de endereço.
- **Escuta contínua:** o app mantém a tela ativa (Wake Lock), reinicia o reconhecimento de voz ao voltar o foco e tem watchdog a cada 5s. Deixe a janela aberta (pode ficar atrás de outros apps; minimizar pode pausar o navegador). No Mac, ligue **Ajustes → Teclado → Ditado** e libere o microfone para o app.
- **Ícones:** fonte em `scripts/assets/beto-3d.png` (render do próprio mascote 3D, fundo transparente); `npm run icons` compõe no fundo preto e regenera os PNGs e o favicon.
- **Vercel:** `SPOTIFY_REDIRECT_URI` e `GOOGLE_REDIRECT_URI` devem apontar para o domínio de produção (e estar cadastradas nos dashboards do Spotify/Google).

## Voz do Beto (VoiceStudio no Mac)

A voz sai do [VoiceStudio](https://github.com/debpalash/VoiceStudio), que roda no Mac em `https://localhost:3900` (certificado local do mkcert: `brew install mkcert && mkcert -install` antes do `scripts/voicestudio/install.sh`). Quem
pede cada frase é o navegador (a Vercel não alcança o localhost do Mac). Para instalar:

```bash
git clone https://github.com/debpalash/VoiceStudio.git ~/Dev/VoiceStudio
cd ~/Dev/VoiceStudio && bun install && bun run setup:api   # depois baixe o modelo k2-fsa/OmniVoice pelo app ou pela API
scripts/voicestudio/install.sh        # no repositório do Beto: LaunchAgent que mantém o VoiceStudio sempre ligado
scripts/voicestudio/setup-profile.sh  # cria o perfil de voz "Beto"
```

Logs em `~/Library/Logs/voicestudio.log`. Na primeira fala pela página da Vercel, o Chrome pode pedir permissão para
acessar a rede local: aceite.

### Safari e app do Dock

O Safari bloqueia qualquer pedido de um site público para o `localhost`, então pela URL da Vercel o Beto fica mudo.
Um proxy local serve o mesmo app em `https://localhost:3443` (repassa tudo para a Vercel), e daí a voz é
`localhost` para `localhost`:

```bash
scripts/proxy/install.sh   # LaunchAgent que mantém o proxy sempre ligado (depois do scripts/voicestudio/install.sh)
```

Abra `https://localhost:3443` no Safari e logue (o login é separado do da Vercel). Agenda e Spotify usam o token
guardado no servidor: conecte os dois uma vez pelo Chrome, na URL da Vercel (o login do Google e do Spotify volta
para a Vercel, não para o endereço local). Se a fala não tocar, Safari → Ajustes para Este Site → Reprodução
Automática → Permitir Toda. Logs em `~/Library/Logs/beto-proxy.log`.

## Voz local (serviço no Mac)

A Web Speech API corta frases nas pausas e erra nomes próprios. O serviço em `voice/` (Python, Pipecat) troca isso
por Silero VAD + smart-turn v3 (fim de fala semântico), Whisper large-v3-turbo local via MLX com o seu vocabulário
(`voice/beto-voice.toml`), a voz do VoiceStudio e barge-in (falar por cima interrompe). O cérebro continua sendo o
`/api/chat`, chamado com o token `VOICE_SERVICE_TOKEN`.

```bash
cd voice && cp .env.example .env && uv sync && uv run beto-voice
```

Com o serviço no ar, o app mostra `BETO · VOZ LOCAL` e deixa a Web Speech de lado; sem ele, nada muda. Detalhes,
parâmetros e limitações em `voice/README.md`.

## Como os comandos de voz funcionam

O Beto detecta ações pelo LLM usando tags estruturadas na resposta. Quando você pede algo como "toca Led Zeppelin", o modelo retorna:

```
[SPOTIFY:{"action":"play","query":"Led Zeppelin"}]
```

O frontend faz o parse dessa tag e chama a API correspondente. Nenhuma palavra-chave é hardcoded — o LLM decide qual ação usar com base no contexto.

**Tags disponíveis:**

| Tag | Exemplo | O que faz |
|-----|---------|-----------|
| `SPOTIFY` | `{"action":"play","query":"nome"}` | Controla o Spotify |
| `CALENDAR` | `{"action":"create","title":"Reunião","date":"2026-05-20","time":"15:00"}` | Cria eventos |
| `GMAIL` | `{"action":"summary","days":7}` | Resume emails |
| `GITHUB` | `{"action":"prs"}` | Lista PRs abertos |
| `TIMER` | `{"action":"start","minutes":25}` | Inicia contagem regressiva |
| `MEMORY` | `{"action":"save","content":"...","category":"preference"}` | Salva memória |
| `BRIEFING` | `{"action":"daily"}` | Briefing completo do dia |

---

## Personalizando o seu Beto

**Mudar a personalidade:**  
Edite o system prompt em `app/api/chat/route.ts`. É onde o Beto recebe sua identidade — nome, tom, idioma, instruções de comportamento.

**Mudar a voz:**  
A voz é o perfil "Beto" do VoiceStudio, clonado de `voice/assets/beto-ref.wav`. Troque esse arquivo (e o texto dele em `scripts/voicestudio/setup-profile.sh`) e rode o script de novo.

**Mudar o modelo LLM:**  
Em `app/api/chat/route.ts`, altere o campo `model`. O Groq suporta vários modelos — veja em [console.groq.com/docs/models](https://console.groq.com/docs/models).

**Adicionar novas integrações:**  
1. Crie uma rota em `app/api/sua-integracao/`
2. Defina uma nova tag no system prompt (ex: `[MINHA_TAG:{...}]`)
3. No `app/page.tsx`, adicione o parser e o handler da tag no dispatcher de ações

**Trocar o idioma:**  
O reconhecimento de voz usa `lang: 'pt-BR'` em `app/page.tsx`. Para inglês, mude para `en-US`. O system prompt também precisa ser ajustado para o idioma desejado.

---

## Estrutura do projeto

```
jarvis/
├── app/
│   ├── api/
│   │   ├── briefing/          # Briefing matinal (agenda + emails + clima)
│   │   ├── calendar/          # Google Calendar (OAuth + criação de eventos)
│   │   ├── chat/              # Endpoint principal do LLM
│   │   ├── github/            # PRs, issues, commits
│   │   ├── gmail/             # Resumo de emails
│   │   ├── memory/            # CRUD de memórias no Supabase
│   │   ├── music/             # Busca de músicas
│   │   ├── spotify/           # Spotify (OAuth + playback + now-playing)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx               # Interface principal e lógica de voz
├── components/
│   ├── mascot/                # Fantasminha 3D: modelo (ghost.ts), mapeamento de estados e palco (BetoGhost.tsx)
│   └── MiniPlayer.tsx         # Mini player do Spotify
├── lib/
│   ├── google.ts              # Gerenciamento de tokens Google
│   ├── spotify.ts             # Gerenciamento de tokens Spotify
│   ├── supabase.ts            # Cliente e CRUD de memórias
│   └── time.ts                # Utilitários de timezone (Brasília UTC-3)
├── .env.local.example
├── tailwind.config.ts
└── next.config.mjs
```

---

## Boas práticas adotadas

- **TypeScript estrito** — interfaces tipadas para todos os estados, ações e respostas de API
- **Cleanup de recursos** — AbortController e event listeners removidos no unmount do componente
- **Cache em memória** — memórias do Supabase são cacheadas por 5 minutos para reduzir queries
- **Voz local sem cota** — o navegador pede cada frase ao VoiceStudio no Mac; a fila prepara a próxima frase enquanto a atual toca
- **Debounce de fala** — 1.2s de debounce no reconhecimento para evitar submissões parciais
- **Sem secrets no cliente** — todas as chaves de API ficam exclusivamente nas rotas de servidor
- **OAuth com cookies HttpOnly** — tokens de refresh do Spotify e Google trafegam apenas em cookies seguros

---

## Limitações conhecidas

- **Web Speech API**: funciona bem no Chrome e Edge. Firefox e Safari têm suporte parcial ou ausente
- **Spotify**: requer conta **Premium** para controle de playback via API
- **Voz só no Mac**: o VoiceStudio roda em `localhost:3900`; em outro aparelho o Beto fica sem voz (texto na tela). Cada frase leva de 2 a 3 s para ficar pronta
- **Pesos do OmniVoice**: licença não comercial (CC-BY-NC)
- **OAuth Google**: em modo de teste, a tela de consentimento exibe aviso; publique o app no Google para remover

---

## Licença

MIT — faça o que quiser com isso.
