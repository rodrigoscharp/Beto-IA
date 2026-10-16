# Voz do Beto no Safari: design

Data: 2026-10-16. Continua `2026-10-15-voz-voicestudio-design.md`.

## Por quê

A voz do Beto vem do VoiceStudio no Mac (`https://localhost:3900`), chamado direto pelo navegador. No Chrome isso
funciona (com a permissão de "Acesso à rede local"). O Safari bloqueia, por política do WebKit, qualquer pedido de um
site público (`https://betoia.vercel.app`) para o `localhost`, mesmo com certificado válido: nenhum pedido do Safari
chega ao log do VoiceStudio. O Rodrigo quer usar o Beto também no Safari e como app web no Dock (que é o Safari).

## Decisões do Rodrigo

- **Proxy local em Node** em `https://localhost:3443`: a página do Beto passa a vir do `localhost`, e o Safari trata a
  chamada ao VoiceStudio como `localhost` para `localhost`.
- **Spotify e Google Agenda pelo token guardado no servidor**: conectados uma vez (pelo Chrome, em
  `betoia.vercel.app`), passam a valer também no endereço local, sem login de novo.

## Metas

- Abrir `https://localhost:3443` no Safari, logar, e o Beto falar uma resposta longa inteira.
- Instalar o app no Dock a partir desse endereço, com o mesmo resultado.
- O Chrome em `https://betoia.vercel.app` continua igual.
- Agenda e Spotify aparecem conectados no endereço local quando já foram conectados no Chrome.

## Fora do escopo

- Uso fora do Mac (iPhone, outra máquina na rede).
- O serviço `voice/` (Pipecat, `http://localhost:7860`): o proxy não repassa WebSocket nem WebRTC.
- Fazer o login do Google ou do Spotify funcionar a partir do endereço local (os callbacks continuam na Vercel).
- Mudanças em `lib/voicestudio.ts`: a página no `localhost:3443` continua chamando `https://localhost:3900`.

## Seria fracasso mesmo funcionando

- O proxy deixa o Beto mais lento (resposta em stream chegando em blocos, ou espera extra por pedido).
- O proxy come memória visível no Mac (meta: menos de 60 MB no Monitor de Atividade, medido com `footprint`).
- O endereço local quebra o `http://localhost` de outras portas no Safari (ver HSTS abaixo).

## Como funciona

```
Safari / app do Dock
  ├─ https://localhost:3443/*  ── proxy Node (launchd) ──>  https://betoia.vercel.app/*
  └─ https://localhost:3900/v1/audio/speech  ──>  VoiceStudio (launchd)
```

### 1. Proxy (`scripts/proxy/`)

- Um script Node sem dependências (`node:https`), escutando só em `127.0.0.1:3443`, com o certificado do mkcert que o
  VoiceStudio já usa (`~/Library/Application Support/beto-voicestudio/localhost.pem`, cobre `localhost`, `127.0.0.1` e
  `::1`).
- Repassa todo pedido para `https://betoia.vercel.app` (configurável por variável de ambiente, para os testes),
  com conexões mantidas abertas (keep-alive) para não pagar o TLS a cada pedido.
- Pedido: `Host` passa a ser o da Vercel; `Origin` e `Referer` do endereço local são trocados pelos da Vercel; saem os
  cabeçalhos de salto (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`, `proxy-*`, `te`, `trailer`).
  O `x-forwarded-for` não é enviado: a Vercel põe o IP real, e o limite de tentativas do login continua valendo.
- Resposta: o corpo passa direto, sem buffer e sem descompactar, para o stream de `/api/chat` chegar na hora.
  `Location` absoluto da Vercel vira o endereço local. `Set-Cookie` perde o `Domain=` da Vercel, se houver (hoje não
  há: os cookies são host-only e passam sem mudança). **`Strict-Transport-Security` é removido**: a Vercel manda
  `max-age=63072000; includeSubDomains; preload`, e HSTS vale para o host inteiro, todas as portas. Se passasse, o
  Safari forçaria HTTPS em `http://localhost:3000` (dev) e `http://localhost:7860` (serviço de voz).
- Vercel fora do ar: responde 502 com uma mensagem curta em texto.
- Log em `~/Library/Logs/beto-proxy.log`: só a subida e os erros, não um registro por pedido.
- Memória: heap limitado (`--max-old-space-size`) e medido depois de instalado.

### 2. Sempre ligado

- LaunchAgent `com.beto.proxy` (`RunAtLoad`, `KeepAlive`), instalado por `scripts/proxy/install.sh`, no mesmo molde
  de `scripts/voicestudio/install.sh`.
- O instalador copia o script para `~/Library/Application Support/beto-proxy/`, para o serviço não depender de onde o
  repositório (ou um worktree) está.
- O instalador confere a saúde pedindo `https://localhost:3443/login` e esperando resposta 200.

### 3. VoiceStudio aceita a origem nova

- `OMNIVOICE_ALLOWED_ORIGINS` no modelo do plist do VoiceStudio ganha `https://localhost:3443`. Reinstalar o
  VoiceStudio reinicia o serviço (o modelo recarrega uma vez).

### 4. Tokens do Google e do Spotify no servidor

- Google: o refresh token já fica cifrado no Supabase (`push_secrets`, `lib/secrets.ts`). `getGoogleToken` passa a
  cair nele quando o pedido não traz `gc_at` nem `gc_rt`. `/api/calendar/status` mostra conectado quando há cookie ou
  token guardado.
- Spotify: o callback passa a guardar o refresh token cifrado no mesmo lugar (`spotify_refresh_token`).
  `getSpotifyToken` cai nele quando não há cookie, e grava o novo refresh token quando o Spotify devolver um.
  `/api/spotify/status` mostra conectado quando há cookie ou token guardado.
- Depois do deploy, o Rodrigo conecta o Spotify uma vez no Chrome para o token ir para o servidor.
- Os callbacks não mudam de endereço. Clicar em "conectar" no endereço local leva o login para a Vercel, onde o Safari
  não tem sessão: conectar continua sendo pelo Chrome.

## Riscos

- **Autoplay do Safari.** A fala toca com `audio.play()` depois de um `fetch`, fora de um clique. Se o Safari recusar,
  o Beto mostra o texto. Saída: Safari > Ajustes para Este Site > Reprodução Automática > Permitir Toda. Confirmar na
  verificação.
- **Service worker** (`/sw.js`) passa a valer também na origem local; é só cache da casca, sem efeito na voz.

## Verificação

1. `npm test` com os testes novos do proxy e da escolha de token.
2. Proxy instalado: `curl` em `https://localhost:3443/login` responde 200 sem `strict-transport-security`.
3. Safari em `https://localhost:3443`: logar, pedir uma resposta longa, ouvir até o fim; o
   `~/Library/Logs/voicestudio.log` mostra os `POST /v1/audio/speech` no horário do teste, com o Chrome fechado (o log
   não grava a origem).
4. Arquivo > Adicionar ao Dock, abrir pelo Dock, repetir o passo 3.
5. Memória do proxy parado com `footprint <pid>` (o `ps -o rss` conta páginas compartilhadas do Node e infla o número).
