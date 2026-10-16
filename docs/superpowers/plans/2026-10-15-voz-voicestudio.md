# Voz do Beto pelo VoiceStudio: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda fala do Beto (app web e serviço `voice/`) sai do VoiceStudio local, com a voz fixa "Beto"; ElevenLabs e Google TTS somem.

**Architecture:** O navegador do Mac chama `POST http://localhost:3900/v1/audio/speech` direto (a Vercel não alcança o Mac). O serviço `voice/` chama o mesmo endpoint pedindo PCM. Um LaunchAgent mantém o VoiceStudio sempre ligado com as origens do Beto liberadas no CORS.

**Tech Stack:** Next.js 14 (TypeScript, testes `node --test`), Python 3.11 + Pipecat 1.12 (pytest), VoiceStudio 0.5.7 em `~/Dev/VoiceStudio`, launchd.

**Spec:** `docs/superpowers/specs/2026-10-15-voz-voicestudio-design.md`

## Global Constraints

- Endpoint: `POST {url}/v1/audio/speech` com `{ model: "omnivoice", input, voice: "Beto", language: "pt", num_step: 8, speed }`.
- URL padrão `http://localhost:3900`; voz padrão `Beto`; passos padrão `8`; `input` com no máximo 4096 caracteres (limite da API).
- Origens liberadas no VoiceStudio: `https://betoia.vercel.app`, `http://localhost:3000` (via `OMNIVOICE_ALLOWED_ORIGINS`, somadas às padrão `http://localhost:3900,http://127.0.0.1:3900`).
- Perfil "Beto": referência `voice/assets/beto-ref.wav` (2,85 s), texto "Hoje você tem três tarefas no MyHub e uma reunião às dez.", instruct `male, young adult, moderate pitch`, `language=pt`, `kind=clone`. Nome único.
- Silêncio de abertura (`lead`): 0,4 s, só na primeira frase de uma resposta e nas saudações.
- Nenhuma voz reserva: falhou, o texto fica na tela `min(8000, 1500 + 55 × caracteres)` ms e a conversa segue.
- Nada de `ELEVENLABS_*`, `GOOGLE_TTS_*`, `api.elevenlabs.io` ou `texttospeech.googleapis.com` no repositório ao final (exceto em `docs/superpowers/` históricos).
- Comentários e textos em português, no estilo do código vizinho.

## Review Focus

1. **VoiceStudio parado ou permissão de rede local negada no Chrome** (fetch lança `TypeError`): o Beto não trava, o texto aparece, e o aviso "sem voz" surge no canto. Teste em Task 2 (`fetchSpeech` devolve `null` quando o fetch lança).
2. **Resposta longa (> 4096 caracteres) numa fala só** (briefing): a API recusaria com 400. `speechBody` corta no fim da última frase antes do limite. Teste em Task 2.
3. **Dois perfis chamados "Beto"** (a API responde 409 e o Beto fica mudo): o script de perfil apaga os duplicados antes de criar. Verificação em Task 1.
4. **WAV com bloco extra antes de `data`** (`LIST`, etc.): `prependSilence` procura os blocos `fmt ` e `data` em vez de assumir cabeçalho de 44 bytes. Teste em Task 2.
5. **Saudações gravadas com a voz antiga no Cache Storage**: `GREETING_CACHE` sobe para `beto-fillers-v5` e `beto-fillers-v4` entra em `OLD_GREETING_CACHES`. Verificação em Task 3.

---

### Task 1: VoiceStudio sempre ligado e perfil "Beto"

**Files:**
- Create: `voice/assets/beto-ref.wav` (cópia de `ref-curta.wav` desta sessão, gerada de `candidata-3.wav` com `ffmpeg -ss 1.85 -to 4.7`)
- Create: `scripts/voicestudio/com.beto.voicestudio.plist` (modelo com `__VOICESTUDIO_DIR__`, `__BUN__`, `__LOG_DIR__`)
- Create: `scripts/voicestudio/install.sh`
- Create: `scripts/voicestudio/setup-profile.sh`

**Interfaces:**
- Produces: VoiceStudio respondendo em `http://localhost:3900/health` após login; perfil único com `name == "Beto"`.

- [ ] **Step 1:** Escrever o plist: `Label com.beto.voicestudio`, `ProgramArguments` rodando o backend a partir de `__VOICESTUDIO_DIR__` sem recarregar em mudança de arquivo (confirmar em `scripts/dev-backend.mjs` se `dev:api` observa arquivos; se observar, chamar o uvicorn do `.venv` do VoiceStudio direto, como o `dev-backend.mjs` faz), `EnvironmentVariables.OMNIVOICE_ALLOWED_ORIGINS` com as quatro origens, `PATH` incluindo `~/bin` (ffmpeg), `RunAtLoad true`, `KeepAlive true`, `StandardOutPath`/`StandardErrorPath` em `~/Library/Logs/voicestudio.log`.
- [ ] **Step 2:** `install.sh`: preenche o modelo, grava em `~/Library/LaunchAgents/com.beto.voicestudio.plist`, faz `launchctl bootout` (ignora erro) e `launchctl bootstrap gui/$(id -u)`, depois espera até 3 min por `/health` com `"status":"ok"`.
- [ ] **Step 3:** `setup-profile.sh`: lista `GET /profiles`, apaga (`DELETE /profiles/{id}`) todo perfil chamado `Beto` ou `Beto curto`, cria o perfil com os valores das Global Constraints e imprime o id.
- [ ] **Step 4:** Parar o backend manual desta sessão, rodar `scripts/voicestudio/install.sh` e depois `scripts/voicestudio/setup-profile.sh`.
Expected: `/health` ok; `GET /profiles` com exatamente um `Beto`.
- [ ] **Step 5:** Checar o CORS: `curl -s -i -X OPTIONS http://localhost:3900/v1/audio/speech -H 'Origin: https://betoia.vercel.app' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'`.
Expected: `access-control-allow-origin: https://betoia.vercel.app`. Depois um `POST` com esse `Origin` e o corpo das Global Constraints devolve 200 `audio/wav`.
- [ ] **Step 6:** Commit `feat(voz): VoiceStudio sempre ligado e perfil Beto`.

### Task 2: Cliente do VoiceStudio (`lib/voicestudio.ts`)

**Files:**
- Create: `lib/voicestudio.ts`
- Test: `scripts/voicestudio.test.mjs`

**Interfaces:**
- Produces:
  - `export const LEAD_SECS = 0.4`
  - `export function voiceStudioConfig(env?: Record<string, string | undefined>): { url: string; voice: string; steps: number; speed: number }` (lê `NEXT_PUBLIC_VOICESTUDIO_URL`, `_VOICE`, `_STEPS`, `_SPEED`; padrões das Global Constraints; `speed` 1.0; `url` sem barra final)
  - `export function speechBody(text: string, cfg): { model: "omnivoice"; input: string; voice: string; language: "pt"; num_step: number; speed: number; response_format: "wav" }`
  - `export function prependSilence(wav: ArrayBuffer, secs: number): ArrayBuffer`
  - `export async function fetchSpeech(text: string, opts?: { lead?: boolean; fetchImpl?: typeof fetch; cfg? }): Promise<Blob | null>` (`null` em resposta não-ok ou exceção; loga `[voz]` no console)
  - `export async function voiceStudioOnline(fetchImpl?: typeof fetch, cfg?): Promise<boolean>` (`GET {url}/health` com timeout de 3 s; `true` só com `status === "ok"`)

- [ ] **Step 1: Escrever os testes**

```js
test("config: padrões e env", () => {
  assert.deepEqual(voiceStudioConfig({}), { url: "http://localhost:3900", voice: "Beto", steps: 8, speed: 1 });
  assert.equal(voiceStudioConfig({ NEXT_PUBLIC_VOICESTUDIO_URL: "http://x:1/" }).url, "http://x:1");
  assert.equal(voiceStudioConfig({ NEXT_PUBLIC_VOICESTUDIO_STEPS: "abc" }).steps, 8);
});
test("corpo do pedido: voz, idioma e passos", () => {
  const b = speechBody("Oi chefe.", voiceStudioConfig({}));
  assert.deepEqual(b, { model: "omnivoice", input: "Oi chefe.", voice: "Beto", language: "pt", num_step: 8, speed: 1, response_format: "wav" });
});
test("texto longo corta no fim da última frase antes de 4096", () => {
  const s = "Frase curta. ".repeat(400);             // 5200 caracteres
  const input = speechBody(s, voiceStudioConfig({})).input;
  assert.ok(input.length <= 4096);
  assert.ok(input.endsWith("."));
});
test("silêncio na frente: amostras zeradas e tamanhos do cabeçalho certos", () => {
  // WAV 24 kHz, 16 bits, mono, com um bloco LIST antes de data e 4 amostras não zeradas
  const out = new DataView(prependSilence(makeWav({ rate: 24000, samples: [1, 2, 3, 4], extraChunk: true }), 0.001));
  // 0,001 s a 24 kHz = 24 amostras de silêncio: data passa a ter (24 + 4) × 2 bytes
  assert.equal(dataSize(out), 56);
  assert.equal(out.getUint32(4, true), out.byteLength - 8);    // RIFF size
  assert.deepEqual(samples(out).slice(0, 24), Array(24).fill(0));
  assert.deepEqual(samples(out).slice(24), [1, 2, 3, 4]);
});
test("fetchSpeech: rede fora ou erro do servidor viram null", async () => {
  assert.equal(await fetchSpeech("oi", { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), null);
  assert.equal(await fetchSpeech("oi", { fetchImpl: async () => new Response("x", { status: 409 }) }), null);
});
test("fetchSpeech: lead acrescenta 0,4 s ao áudio", async () => { /* resposta 200 com makeWav; tamanho do blob = original + 0,4 × 24000 × 2 */ });
test("voiceStudioOnline: só status ok conta", async () => { /* {status:"ok"} → true; {status:"starting"} → false; throw → false */ });
```

`makeWav`, `dataSize` e `samples` são helpers do próprio arquivo de teste.

- [ ] **Step 2:** `npm test` → falha (módulo não existe).
- [ ] **Step 3:** Implementar `lib/voicestudio.ts` sem imports de Next (roda no teste). `prependSilence` percorre os blocos RIFF a partir do byte 12, lê `fmt ` (canais, taxa, bits) e `data`, e monta um WAV novo só com `fmt ` + `data` (silêncio + amostras originais). Se não achar `fmt `/`data`, devolve a entrada intacta.
- [ ] **Step 4:** `npm test` → todos passam.
- [ ] **Step 5:** Commit `feat(voz): cliente do VoiceStudio no navegador`.

### Task 3: App fala pelo VoiceStudio

**Files:**
- Modify: `app/page.tsx` (saudações ~l.461, `refreshQuota` ~l.519, `speak` ~l.618-711, fila ~l.1153, indicador ~l.1497, estado `voiceQuota` l.182, import l.9, `GREETING_CACHE` l.120-122)

**Interfaces:**
- Consumes: `fetchSpeech`, `voiceStudioOnline` (Task 2).

- [ ] **Step 1:** Saudações: `fetchSpeech(text, { lead: true })`; guarda no cache `new Response(blob, { headers: { "Content-Type": "audio/wav" } })`. `GREETING_CACHE = "beto-fillers-v5"`, `OLD_GREETING_CACHES` ganha `"beto-fillers-v4"`.
- [ ] **Step 2:** `speak`: troca o `fetch("/api/tts")` e os dois caminhos (MediaSource e blob) por um só: `fetchSpeech(text, { lead: true })` → `URL.createObjectURL` → `Audio`, com os mesmos `onplaying`/`onended`/`onerror`. Sem blob → `silent()`. Remove `PREBUFFER_S` se ficar sem uso. Atualiza o comentário da seção (nada de ElevenLabs).
- [ ] **Step 3:** Fila: `fetchAudio: async (t, first) => { const b = await fetchSpeech(t, { lead: first }); return b ? URL.createObjectURL(b) : null; }`.
- [ ] **Step 4:** Indicador: `voiceQuota`/`QuotaInfo`/`refreshQuota`/`quotaAt` viram `voiceOnline: boolean | null` e `refreshVoice()` (no máximo 1 consulta a cada 60 s via `voiceStudioOnline`, chamada na abertura, em `endTurn` e logo depois de qualquer `fetchSpeech` que devolveu `null`, ignorando o limite de 60 s nesse caso). Quando `voiceOnline === false`, o canto inferior direito mostra `sem voz` em `rgba(255,120,110,0.75)`, com `title="VoiceStudio não respondeu em localhost:3900"`.
- [ ] **Step 5:** `npx tsc --noEmit` e `npm test` passam; `npm run build` passa.
- [ ] **Step 6:** Commit `feat(voz): Beto fala pelo VoiceStudio`.

### Task 4: Tirar ElevenLabs e Google do app

**Files:**
- Delete: `app/api/tts/route.ts`, `app/api/tts/quota/route.ts`
- Modify: `lib/ops.ts` (remove `QuotaInfo`, `quotaStatus`, `num` se ficar sem uso; cabeçalho do arquivo), `vercel.json` (remove a entrada `app/api/tts/route.ts`), `lib/speechqueue.ts` (comentário: a janela de 2 existe para preparar a próxima frase enquanto a atual toca, o VoiceStudio processa uma por vez), `.env.local.example` (seção TTS vira as 4 `NEXT_PUBLIC_VOICESTUDIO_*` comentadas com os padrões), `scripts/auth.test.mjs` (`/api/tts` → `/api/spotify/command`)
- Rename: `scripts/quota.test.mjs` → `scripts/ops.test.mjs`, sem os 3 testes de cota

- [ ] **Step 1:** Fazer as mudanças acima.
- [ ] **Step 2:** `grep -rniE "eleven|GOOGLE_TTS|texttospeech|api/tts" app lib scripts middleware.ts vercel.json .env.local.example` → vazio.
- [ ] **Step 3:** `npm test` e `npm run build` passam.
- [ ] **Step 4:** Commit `refactor(voz): remover ElevenLabs e Google TTS`.

### Task 5: Serviço `voice/` fala pelo VoiceStudio

**Files:**
- Create: `voice/beto_voice/tts.py`
- Modify: `voice/beto_voice/config.py` (`TtsCfg`), `voice/beto_voice/bot.py` (`build_tts`), `voice/beto_voice/server.py` (l.76 e l.93-94), `voice/beto-voice.toml` (`[tts]` e o vocabulário que cita ElevenLabs pode ficar: é palavra que o Rodrigo fala), `voice/.env.example`, `voice/README.md`, `voice/pyproject.toml` (tira o extra `elevenlabs`), `voice/uv.lock`
- Test: `voice/tests/test_config.py`, `voice/tests/test_tts.py`

**Interfaces:**
- Produces:
  - `TtsCfg(url: str = "http://127.0.0.1:3900", voice: str = "Beto", num_step: int = 8, speed: float = 1.0, timeout_secs: float = 30.0)`; env `VOICESTUDIO_URL` sobrescreve `url`. `load_config` deixa de ler `ELEVENLABS_*`.
  - `speech_payload(text: str, cfg: TtsCfg) -> dict` em `tts.py`: `{"model": "omnivoice", "input": text, "voice": cfg.voice, "language": "pt", "num_step": cfg.num_step, "speed": cfg.speed, "response_format": "pcm"}` (PCM = 24 kHz, 16 bits, mono).
  - `class VoiceStudioTTSService` (subclasse do `TTSService` do Pipecat instalado, `sample_rate=24000`) cujo `run_tts` faz o POST com `httpx.AsyncClient` e emite os quadros de áudio em pedaços; em erro, loga `[voz]` e emite o quadro de erro do Pipecat.

- [ ] **Step 0:** Recriar o venv para arm64 (o atual é x86_64 e não tem Pipecat): `rm -rf voice/.venv && cd voice && uv sync --python-preference only-managed` (ou com um Python arm64 explícito). Expected: `uv run python -c "import pipecat, platform; print(platform.machine())"` → `arm64`.
- [ ] **Step 1: Testes**

```python
def test_tts_padroes():
    cfg = load_config(env={"VOICE_SERVICE_TOKEN": "tok"})
    assert (cfg.tts.url, cfg.tts.voice, cfg.tts.num_step) == ("http://127.0.0.1:3900", "Beto", 8)

def test_tts_env_sobrescreve_url():
    assert load_config(env={"VOICE_SERVICE_TOKEN": "tok", "VOICESTUDIO_URL": "http://x:9/"}).tts.url == "http://x:9"

def test_payload():
    assert speech_payload("Oi.", TtsCfg()) == {"model": "omnivoice", "input": "Oi.", "voice": "Beto", "language": "pt",
                                               "num_step": 8, "speed": 1.0, "response_format": "pcm"}
```

Os testes antigos que usam `ELEVENLABS_*` são reescritos com esses.
- [ ] **Step 2:** `uv run pytest` → falha.
- [ ] **Step 3:** Implementar. Checar a assinatura de `TTSService.run_tts` e os nomes dos quadros (`TTSStartedFrame`, `TTSAudioRawFrame`, `TTSStoppedFrame`, `ErrorFrame`) no Pipecat instalado antes de escrever. `server.py`: `"tts": True` vira o resultado de uma checagem de `/health` do VoiceStudio feita no início, e o aviso diz `VoiceStudio não respondeu em {url}: o Beto não vai falar`.
- [ ] **Step 4:** `uv run pytest` passa; `grep -rni eleven voice --include='*.py' --include='*.toml' --include='*.example' --include='*.md'` só acha o vocabulário do STT.
- [ ] **Step 5:** Commit `feat(voz): serviço local fala pelo VoiceStudio`.

### Task 6: README e verificação ponta a ponta

**Files:**
- Modify: `README.md` (linhas 29, 39, 66, 86, 180-181, 226, 266, 295, 319-320, 331: VoiceStudio no lugar da ElevenLabs; seção curta de instalação: clonar e preparar `~/Dev/VoiceStudio`, baixar o modelo, rodar `scripts/voicestudio/install.sh` e `setup-profile.sh`, aceitar a permissão de rede local do Chrome)

- [ ] **Step 1:** Atualizar o README.
- [ ] **Step 2:** `npm run dev`, abrir `http://localhost:3000` no navegador do Mac: saudação, duas perguntas e encerramento com a voz Beto. Na aba de rede, os áudios vêm de `localhost:3900/v1/audio/speech`; nenhum pedido a `/api/tts`.
- [ ] **Step 3:** `launchctl kill TERM gui/$(id -u)/com.beto.voicestudio`: durante a queda, a fala vira texto na tela e aparece `sem voz`; depois que o `KeepAlive` reergue o serviço, a voz volta e o aviso some.
- [ ] **Step 4:** Commit `docs(voz): README com o VoiceStudio`.
