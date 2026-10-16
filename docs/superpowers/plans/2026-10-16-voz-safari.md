# Voz do Beto no Safari Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servir o Beto em `https://localhost:3443` por um proxy local, para o Safari falar com o VoiceStudio, e fazer Agenda e Spotify valerem nesse endereço pelo token guardado no servidor.

**Architecture:** Script Node sem dependências (`scripts/proxy/proxy.mjs`) repassa tudo para a Vercel, reescrevendo cabeçalhos; LaunchAgent o mantém ligado. Na app, `getGoogleToken`/`getSpotifyToken` caem no refresh token cifrado do Supabase quando o pedido não traz cookie.

**Tech Stack:** Node 24 (`node:https`, `node:test`), launchd, mkcert, Next.js 14, Supabase.

**Spec:** `docs/superpowers/specs/2026-10-16-voz-safari-design.md`

## Global Constraints

- Proxy escuta só em `127.0.0.1:3443`; upstream padrão `https://betoia.vercel.app`.
- Sem dependências novas no `package.json`.
- `Strict-Transport-Security` nunca chega ao navegador pelo proxy.
- Corpo da resposta passa sem buffer e sem descompactar.
- Memória do proxy parado: menos de 60 MB em `footprint <pid>`.
- Comentários e mensagens em português, no estilo do repositório.

## Review Focus

- Vários `Set-Cookie` na mesma resposta (login + tokens): todos chegam, nenhum vira um só.
- Stream de `/api/chat`: o primeiro bloco chega antes de a Vercel terminar a resposta.
- Corpo de POST (login, chat) repassado inteiro.
- Vercel fora do ar ou DNS falhando: 502 rápido, o proxy não cai.
- Cliente desiste no meio (turno interrompido): o pedido à Vercel é cancelado e o proxy segue de pé.

---

### Task 1: Proxy

**Files:**
- Create: `scripts/proxy/proxy.mjs`
- Test: `scripts/proxy.test.mjs`

**Interfaces:**
- Produces: `requestHeaders(headers: IncomingHttpHeaders, o: {local: string, upstream: string}) -> Record<string,string|string[]>`;
  `responseHeaders(headers: IncomingHttpHeaders, o) -> Record<string,string|string[]>`;
  `createHandler(o: {local: string, upstream: string}) -> (req, res) => void`.
  Rodado direto (`node proxy.mjs`), lê `BETO_UPSTREAM`, `BETO_PROXY_PORT` (3443), `BETO_PROXY_CERT`, `BETO_PROXY_KEY`
  e sobe `https.createServer` em `127.0.0.1`.

- [ ] **Step 1: Testes** (upstream `http` falso + proxy `http` com `createHandler`, em portas livres):
  - `requestHeaders`: `host` vira o host do upstream; `origin: https://localhost:3443` vira `https://betoia.vercel.app`;
    `referer: https://localhost:3443/x` vira `https://betoia.vercel.app/x`; somem `connection`, `keep-alive`,
    `transfer-encoding`, `upgrade`, `x-forwarded-for`.
  - `responseHeaders`: `location: https://betoia.vercel.app/?calendar=ok` vira `https://localhost:3443/?calendar=ok`;
    `location: /login` fica igual; `location: https://accounts.google.com/...` fica igual; `strict-transport-security`
    some; `set-cookie` com 2 valores continua com 2, e `; Domain=betoia.vercel.app` sai.
  - ponta a ponta: POST com corpo chega igual ao upstream; o upstream manda um bloco, espera, manda outro, e o cliente
    recebe o primeiro antes do segundo ser enviado; upstream desligado dá 502; cliente que aborta no meio não derruba
    o proxy (pedido seguinte responde).
- [ ] **Step 2:** `npm test` falha (módulo não existe).
- [ ] **Step 3:** Implementar. `http`/`https` conforme o protocolo do upstream, `Agent({keepAlive: true})`,
  `pipe` nos dois sentidos, `res.on("close")` destrói o pedido ao upstream, `setNoDelay`.
- [ ] **Step 4:** `npm test` passa.
- [ ] **Step 5:** Commit `feat(proxy): Beto servido de https://localhost:3443 para o Safari`.

### Task 2: Sempre ligado + origem no VoiceStudio

**Files:**
- Create: `scripts/proxy/com.beto.proxy.plist`, `scripts/proxy/install.sh`
- Modify: `scripts/voicestudio/com.beto.voicestudio.plist` (`OMNIVOICE_ALLOWED_ORIGINS` + `https://localhost:3443`)

- [ ] **Step 1:** Plist com `__NODE__`, `__DIR__`, `__HOME__`, `__CERT__`, `__KEY__`; `node --max-old-space-size=32`;
  `RunAtLoad`, `KeepAlive`, `ThrottleInterval` 10, log `~/Library/Logs/beto-proxy.log`.
- [ ] **Step 2:** `install.sh`: exige `node` e o certificado do VoiceStudio; copia `proxy.mjs` para
  `~/Library/Application Support/beto-proxy/`; preenche o plist; `plutil -lint`; bootout/bootstrap com nova tentativa;
  espera `curl --cacert <CA mkcert> https://localhost:3443/login` dar 200 (até 30 s).
- [ ] **Step 3:** Rodar os dois instaladores; `curl -sI https://localhost:3443/login` dá 200 sem
  `strict-transport-security`; `footprint <pid>` do proxy menor que 60 MB.
- [ ] **Step 4:** Commit `feat(proxy): LaunchAgent do proxy e origem local no VoiceStudio`.

### Task 3: Agenda e Spotify pelo token do servidor

**Files:**
- Create: `lib/tokens.ts`; Test: `scripts/tokens.test.mjs`
- Modify: `lib/secrets.ts`, `lib/google.ts`, `lib/spotify.ts`, `app/api/spotify/callback/route.ts`,
  `app/api/calendar/status/route.ts`, `app/api/spotify/status/route.ts`

**Interfaces:**
- Produces: `refreshTokenFor(cookieRt: string | undefined, loadStored: () => Promise<string | null>) -> Promise<string | null>`
  (cookie primeiro; só consulta o servidor sem cookie; erro ao carregar vale null);
  `lib/secrets.ts`: `saveSpotifyRefreshToken(rt)`, `loadSpotifyRefreshToken()`, mesmo formato das do Google
  (nome `spotify_refresh_token`).

- [ ] **Step 1:** Testes de `refreshTokenFor`: cookie presente devolve o cookie sem chamar o loader; sem cookie
  devolve o do loader; loader que lança devolve null.
- [ ] **Step 2:** `npm test` falha.
- [ ] **Step 3:** Implementar `lib/tokens.ts` (sem imports) e ligar: `getGoogleToken` usa
  `refreshTokenFor(gc_rt, loadGoogleRefreshToken)` (env `GOOGLE_REFRESH_TOKEN` antes do Supabase, como
  `getServerGoogleToken`); `getSpotifyToken` usa `refreshTokenFor(sp_rt, loadSpotifyRefreshToken)` e grava
  `data.refresh_token` quando vier; callback do Spotify chama `saveSpotifyRefreshToken`; os dois `status` respondem
  `connected` com cookie ou token guardado.
- [ ] **Step 4:** `npm test` e `npx tsc --noEmit` passam.
- [ ] **Step 5:** Commit `feat(tokens): Agenda e Spotify valem no endereço local pelo token guardado`.

### Task 4: Verificação no Safari e no Dock

- [ ] Safari em `https://localhost:3443`, Rodrigo loga, resposta longa falada até o fim; `voicestudio.log` com os
  `POST /v1/audio/speech` no horário. Se o autoplay bloquear, ajustar Reprodução Automática para o site e anotar no README.
- [ ] Arquivo > Adicionar ao Dock; repetir.
- [ ] README: seção curta "Safari e app do Dock" com o endereço e o instalador.
