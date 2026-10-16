# Fluidez da conversa no serviço de voz: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A conversa por voz no Mac fica contínua: ack falado na hora nos turnos com ferramenta, fala nunca ignorada por causa da janela, conversa que só fecha quando o Rodrigo encerra, e latência medida por etapa.

**Architecture:** O cérebro (`/api/chat`, Next.js) passa a mandar `{"ack": tipo}` no NDJSON antes do loop de ferramentas. O serviço de voz (`voice/`, Python + Pipecat) escolhe a frase do tipo, toca o áudio já sintetizado em cache pelo `VoiceStudioTTSService` e mede a latência com o `UserBotLatencyObserver`. O `ConversationGate` passa a contar a janela pelo início da fala, ganha modo contínuo e frases de hesitação.

**Tech Stack:** Next.js 14 + TypeScript (`node:test` via `npm test`), Python 3.12 + Pipecat 1.12 + httpx (`uv run pytest`).

**Spec:** `docs/superpowers/specs/2026-10-16-voz-fluidez-design.md`

## Global Constraints

- Pré-condição: a troca para o VoiceStudio (`voice/beto_voice/tts.py`, `bot.py`, `config.py`, `beto-voice.toml`, `pyproject.toml`, `uv.lock`, `tests/test_tts.py`, `tests/test_config.py`, `.env.example`, `server.py`) está commitada antes da Task 1. Sem isso, pare e avise.
- Tipos de ack, exatos: `"conteudo"`, `"agenda"`, `"myhub"`, `"memoria"`, `"geral"`. Prioridade: conteudo > agenda > myhub > memoria > geral.
- Ack só no modo `stream: "ndjson"`, só no ramo `if (plan.sets)`, no máximo um por resposta, antes de qualquer `{"t": ...}`.
- Frases de ack: até seis palavras, sem "chefe". O ack nunca entra no histórico (`TTSSpeakFrame(..., append_to_context=False)`).
- Frase de ack fora do cache não é falada.
- Padrões novos do `[turn]`: `continuous = true`, `idle_close_secs = 60`, `hold_phrases = ["hmm", "hum", "peraí", "pera", "espera", "deixa eu pensar", "deixa eu ver", "calma"]`.
- `end_phrases` no TOML perde "fechou" e "beleza".
- Comentários, mensagens de log e de commit em português, no estilo do código vizinho.
- Comandos: TS `npm test` (na raiz); Python `cd voice && uv run pytest -q`.

## Review Focus

1. "Beto, peraí" com o gate fechado: o wake word abre a escuta (`listen`), não encaminha "peraí" ao cérebro. Teste na Task 6.
2. VoiceStudio fora do ar no início da sessão: `prewarm` falha frase a frase, registra no log e a sessão segue; o ack fica mudo. Teste na Task 4.
3. Primeiro turno com ferramenta antes de o aquecimento terminar: nenhum ack é falado e a resposta sai normal. Teste na Task 5.
4. Fala começada com a janela aberta que termina em "tchau": encerra, não encaminha. Teste na Task 6.
5. Hesitação no meio de resposta longa do Beto (barge-in) seguida de silêncio: a janela continua aberta por `idle_close_secs` no modo contínuo. Teste na Task 6.

---

### Task 1: Linha `[latency]` por turno

**Files:**
- Create: `voice/beto_voice/latency.py`
- Modify: `voice/beto_voice/bot.py` (observer no `PipelineWorker`)
- Modify: `voice/beto_voice/brain.py` (`clock` injetável, `last_reply_secs`, `last_acked`)
- Test: `voice/tests/test_latency.py`, `voice/tests/test_brain.py`

**Interfaces:**
- Produces: `latency_line(total: float, turn: float | None, ttfb: list[tuple[str, float]], acked: bool) -> str` em `latency.py`.
- Produces: `BetoBrainLLMService(client, *, clock: Callable[[], float] = time.monotonic, ...)` com `last_reply_secs: float | None` (do início de `respond` ao primeiro `t`) e `last_acked: bool` (sempre `False` nesta task; a Task 5 liga).

- [ ] **Step 1: Write the failing tests**

```python
# voice/tests/test_latency.py
from beto_voice.latency import latency_line

def test_linha_com_todas_as_etapas():
    ttfb = [("BetoWhisperMLX#0", 0.28), ("BetoBrainLLMService#0", 0.62), ("VoiceStudioTTSService#0", 2.1)]
    assert latency_line(3.31, 0.31, ttfb, acked=False) == "[latency] total=3.31s turno=0.31s stt=0.28s brain=0.62s tts=2.10s ack=não"

def test_etapa_ausente_some_da_linha_e_ack_sim():
    assert latency_line(0.4, None, [("VoiceStudioTTSService#0", 0.05)], acked=True) == "[latency] total=0.40s tts=0.05s ack=sim"

def test_processador_desconhecido_e_ignorado():
    assert latency_line(1.0, 0.2, [("Outro#0", 9.0)], acked=False) == "[latency] total=1.00s turno=0.20s ack=não"
```

```python
# voice/tests/test_brain.py (acrescentar)
async def test_respond_mede_tempo_ate_o_primeiro_texto():
    t = iter([10.0, 12.8])
    llm = BetoBrainLLMService(client_with(ndjson({"t": "[emo:neutro] Oi."}, {"meta": {"mode": "chat"}})), clock=lambda: next(t))
    await llm.respond([{"role": "user", "content": "oi"}], _collect())
    assert llm.last_reply_secs == pytest.approx(2.8)
    assert llm.last_acked is False
```

(`_collect()` devolve um `emit` assíncrono que guarda os frames; use o helper que o arquivo já tiver ou crie um local.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd voice && uv run pytest tests/test_latency.py tests/test_brain.py -q`
Expected: FAIL (`ModuleNotFoundError: beto_voice.latency`, `unexpected keyword argument 'clock'`).

- [ ] **Step 3: Implement `latency_line` and the brain timing**

Etapa pelo nome do processador: contém `Whisper` ou `STT` vira `stt`; contém `Brain` vira `brain`; contém `TTS` vira `tts`; o resto é ignorado. Dois casas decimais, ordem fixa `total turno stt brain tts ack`. No `respond`, o relógio é lido no início e no primeiro `t`; `last_reply_secs` fica `None` se nenhum `t` chegar.

- [ ] **Step 4: Wire the observer in `bot.py`**

`UserBotLatencyObserver()` de `pipecat.observers.user_bot_latency_observer` vai em `PipelineWorker(..., observers=[obs])`. Em `on_latency_breakdown(obs, b)`: `logger.info(latency_line(b.total_secs, b.user_turn_secs, [(m.processor, m.duration_secs) for m in b.ttfb], llm.last_acked))`. No fim de `respond`, o brain escreve `logger.info(f"[latency] resposta={secs:.2f}s")` quando `last_reply_secs` não é `None`.

- [ ] **Step 5: Run all Python tests**

Run: `cd voice && uv run pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add voice/beto_voice/latency.py voice/beto_voice/bot.py voice/beto_voice/brain.py voice/tests/test_latency.py voice/tests/test_brain.py
git commit -m "feat(voz): linha [latency] por turno com o tempo de cada etapa"
```

---

### Task 2: Ack no protocolo e na rota

**Files:**
- Create: `lib/ack.ts`
- Modify: `lib/voicewire.ts`, `app/api/chat/route.ts` (ramo `if (plan.sets)` do modo ndjson)
- Test: `scripts/ack.test.mjs`, `scripts/voicewire.test.mjs`

**Interfaces:**
- Consumes: `ToolSets` de `lib/turnplan.ts`.
- Produces: `export type AckKind = "conteudo" | "agenda" | "myhub" | "memoria" | "geral"`; `export function ackKind(sets: ToolSets): AckKind`; `WireLine` ganha `{ ack: AckKind }`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/ack.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { ackKind } from "../lib/ack.ts";

const S = (o = {}) => ({ calendar: false, myhub: false, memory: false, content: false, ...o });

test("cada ferramenta sozinha dá o seu tipo", () => {
  assert.equal(ackKind(S({ content: true })), "conteudo");
  assert.equal(ackKind(S({ calendar: true })), "agenda");
  assert.equal(ackKind(S({ myhub: true })), "myhub");
  assert.equal(ackKind(S({ memory: true })), "memoria");
  assert.equal(ackKind(S()), "geral");
});

test("prioridade: conteudo > agenda > myhub > memoria", () => {
  assert.equal(ackKind(S({ content: true, calendar: true, myhub: true, memory: true })), "conteudo");
  assert.equal(ackKind(S({ calendar: true, myhub: true })), "agenda");
  assert.equal(ackKind(S({ myhub: true, memory: true })), "myhub");
  assert.equal(ackKind({ calendar: false, myhub: false, memory: true }), "memoria");   // content ausente
});
```

```js
// scripts/voicewire.test.mjs (acrescentar)
test("ack: ida e volta, e só tipos conhecidos", () => {
  assert.deepEqual(parseLine(encodeLine({ ack: "agenda" })), { ack: "agenda" });
  assert.equal(parseLine('{"ack":""}'), null);
  assert.equal(parseLine('{"ack":3}'), null);
  assert.equal(parseLine('{"ack":"outro"}'), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -E "ack|fail"`
Expected: FAIL (`Cannot find module '../lib/ack.ts'`, `ack` devolvendo `null`).

- [ ] **Step 3: Implement `ackKind`, the wire type and the route line**

`lib/ack.ts` puro, sem imports de runtime (só o tipo `ToolSets`). Em `voicewire.ts`, `parseLine` aceita `ack` só se for um dos cinco tipos (o servidor só escreve esses; quem tolera tipo novo é o serviço de voz, Task 5); o comentário do topo ganha a linha `{"ack": "agenda"}`. Na rota, dentro de `if (plan.sets) {`, antes de `await viaTools(plan.sets)`: `write({ ack: ackKind(plan.sets) });`.

- [ ] **Step 4: Run the suite and the typecheck**

Run: `npm test && npx tsc --noEmit -p .`
Expected: todos passam, `tsc` sem erro.

- [ ] **Step 5: Commit**

```bash
git add lib/ack.ts lib/voicewire.ts app/api/chat/route.ts scripts/ack.test.mjs scripts/voicewire.test.mjs
git commit -m "feat(voz): /api/chat manda o tipo do ack antes do loop de ferramentas"
```

---

### Task 3: Configuração nova (`[ack]` e `[turn]`)

**Files:**
- Modify: `voice/beto_voice/config.py`, `voice/beto-voice.toml`
- Test: `voice/tests/test_config.py`

**Interfaces:**
- Produces: `AckCfg` (dataclass) com `conteudo`, `agenda`, `myhub`, `memoria`, `geral: list[str]`, padrões iguais à tabela da spec; método `phrases() -> dict[str, list[str]]` e `all() -> list[str]` (todas, sem repetir, na ordem). `Config.ack: AckCfg`. A seção `[ack]` é opcional no TOML (ausente = padrões).
- Produces: `TurnCfg.continuous: bool = True`, `TurnCfg.idle_close_secs: float = 60.0`, `TurnCfg.hold_phrases: list[str]` (padrão da Global Constraints).

- [ ] **Step 1: Write the failing tests**

```python
def test_padroes_novos_do_turno_e_do_ack(tmp_path):
    cfg = load_config(write_toml(tmp_path), env={})          # helper do arquivo: TOML mínimo válido sem [ack]
    assert cfg.turn.continuous is True
    assert cfg.turn.idle_close_secs == 60
    assert "deixa eu pensar" in cfg.turn.hold_phrases
    assert cfg.ack.phrases()["agenda"][0] == "Deixa eu ver a agenda."
    assert set(cfg.ack.phrases()) == {"conteudo", "agenda", "myhub", "memoria", "geral"}
    assert all(len(f.split()) <= 6 and "chefe" not in f.lower() for f in cfg.ack.all())

def test_idle_close_e_ack_vazio_sao_erro(tmp_path):
    with pytest.raises(ValueError, match="idle_close_secs"):
        load_config(write_toml(tmp_path, turn_extra="idle_close_secs = 0"), env={})
    with pytest.raises(ValueError, match=r"\[ack\]"):
        load_config(write_toml(tmp_path, ack='agenda = []'), env={})

def test_toml_do_repo_nao_encerra_com_beleza_nem_fechou():
    cfg = load_config(env={})
    assert "beleza" not in cfg.turn.end_phrases and "fechou" not in cfg.turn.end_phrases
```

(Se `test_config.py` não tiver um helper que escreve um TOML mínimo, crie `write_toml(tmp_path, turn_extra="", ack=None) -> Path` no próprio arquivo.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd voice && uv run pytest tests/test_config.py -q`
Expected: FAIL (`AttributeError: 'Config' object has no attribute 'ack'`).

- [ ] **Step 3: Implement the config**

`[ack]` fica fora de `_SECTIONS` (opcional). Validação: `idle_close_secs > 0`; cada lista de `[ack]` não vazia, com a mensagem `beto-voice.toml: [ack].<tipo> precisa de pelo menos uma frase`. No TOML do repo: tirar "fechou" e "beleza" de `end_phrases`, acrescentar `continuous`, `idle_close_secs` e `hold_phrases` em `[turn]` e a seção `[ack]` com a tabela da spec, cada chave com um comentário curto como as vizinhas.

- [ ] **Step 4: Run all Python tests**

Run: `cd voice && uv run pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add voice/beto_voice/config.py voice/beto-voice.toml voice/tests/test_config.py
git commit -m "feat(voz): config do ack, do modo contínuo e das frases de hesitação"
```

---

### Task 4: Cache de áudio no TTS

**Files:**
- Modify: `voice/beto_voice/tts.py`
- Test: `voice/tests/test_tts.py`

**Interfaces:**
- Produces: `VoiceStudioTTSService(cfg, *, client: httpx.AsyncClient | None = None, **kwargs)`; `async prewarm(texts: list[str]) -> int` (quantas frases ficaram no cache); `cached(text: str) -> bool`. `run_tts` toca do cache quando `text.strip()` está nele.

- [ ] **Step 1: Write the failing tests**

```python
async def test_prewarm_guarda_pcm_e_segue_quando_uma_falha():
    def handler(req):
        body = json.loads(req.content)
        return httpx.Response(500) if body["input"] == "Falha." else httpx.Response(200, content=b"\x01\x00" * 480)
    tts = VoiceStudioTTSService(TtsCfg(), client=httpx.AsyncClient(base_url="http://vs", transport=httpx.MockTransport(handler)))
    assert await tts.prewarm(["Um segundo.", "Falha.", "Deixa eu ver."]) == 2
    assert tts.cached("Um segundo.") and tts.cached(" Deixa eu ver. ") and not tts.cached("Falha.")

async def test_prewarm_com_voicestudio_fora_nao_lanca():
    def down(_r):
        raise httpx.ConnectError("recusado")
    tts = VoiceStudioTTSService(TtsCfg(), client=httpx.AsyncClient(base_url="http://vs", transport=httpx.MockTransport(down)))
    assert await tts.prewarm(["Um segundo."]) == 0

async def test_run_tts_do_cache_nao_chama_o_voicestudio():
    calls = []
    def handler(req):
        calls.append(req)
        return httpx.Response(200, content=b"\x01\x00" * 480)
    tts = VoiceStudioTTSService(TtsCfg(), client=httpx.AsyncClient(base_url="http://vs", transport=httpx.MockTransport(handler)))
    await tts.prewarm(["Um segundo."])
    calls.clear()
    frames = [f async for f in tts.run_tts("Um segundo.", "ctx")]
    assert calls == []
    assert frames   # quadros de áudio saíram
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd voice && uv run pytest tests/test_tts.py -q`
Expected: FAIL (`unexpected keyword argument 'client'`).

- [ ] **Step 3: Implement the cache**

Cache `dict[str, bytes]` com a chave `text.strip()`. `prewarm` pede cada frase com `speech_payload` e lê o corpo inteiro; erro HTTP ou de rede numa frase vira `logger.warning` e segue. No `run_tts`, o caminho do cache usa o mesmo `_stream_audio_frames_from_iterator` com um iterador assíncrono que entrega o PCM em pedaços de `self.chunk_size`. Se o teste do `run_tts` fora de um pipeline exigir inicialização do `TTSService` (taxa de amostragem), faça o setup mínimo no teste, sem mudar o código de produção para isso.

- [ ] **Step 4: Run all Python tests**

Run: `cd voice && uv run pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add voice/beto_voice/tts.py voice/tests/test_tts.py
git commit -m "feat(voz): cache de áudio no VoiceStudio para frases curtas já conhecidas"
```

---

### Task 5: Ack falado no serviço de voz

**Files:**
- Create: `voice/beto_voice/ack.py`
- Modify: `voice/beto_voice/brain.py`, `voice/beto_voice/bot.py`
- Test: `voice/tests/test_ack.py`, `voice/tests/test_brain.py`

**Interfaces:**
- Consumes: `AckCfg.phrases()` e `AckCfg.all()` (Task 3); `VoiceStudioTTSService.prewarm` e `.cached` (Task 4).
- Produces: `AckPhrases(phrases: dict[str, list[str]])` com `next(kind: str) -> str` (rodízio por tipo; tipo desconhecido usa `"geral"`). `BetoBrainLLMService(client, *, acks: AckPhrases | None = None, is_cached: Callable[[str], bool] = lambda _t: False, clock=...)`. `parse_line` devolve `{"ack": tipo}` para qualquer texto não vazio (tipo que o serviço não conhece vira `"geral"` no `AckPhrases`, como a spec pede).

- [ ] **Step 1: Write the failing tests**

```python
# voice/tests/test_ack.py
from beto_voice.ack import AckPhrases

def test_rodizio_por_tipo_e_desconhecido_vira_geral():
    a = AckPhrases({"agenda": ["A1", "A2"], "geral": ["G1"]})
    assert [a.next("agenda"), a.next("agenda"), a.next("agenda")] == ["A1", "A2", "A1"]
    assert a.next("xyz") == "G1"
```

```python
# voice/tests/test_brain.py (acrescentar)
def test_parse_line_ack():
    assert parse_line('{"ack":"agenda"}') == {"ack": "agenda"}
    assert parse_line('{"ack":""}') is None
    assert parse_line('{"ack":"outro"}') == {"ack": "outro"}   # tipo novo do servidor: AckPhrases usa "geral"

async def test_ack_em_cache_e_falado_antes_da_resposta_e_fora_do_historico():
    body = ndjson({"ack": "agenda"}, {"t": "[emo:neutro] Amanhã você tem dentista."}, {"meta": {"mode": "full"}})
    llm = BetoBrainLLMService(client_with(body), acks=AckPhrases({"agenda": ["Deixa eu ver a agenda."], "geral": ["Um segundo."]}), is_cached=lambda t: True)
    out = []
    await llm.respond([{"role": "user", "content": "o que tenho amanhã?"}], _collect(out))
    speak = [f for f in out if isinstance(f, TTSSpeakFrame)]
    assert [(f.text, f.append_to_context) for f in speak] == [("Deixa eu ver a agenda.", False)]
    first_text = next(i for i, f in enumerate(out) if isinstance(f, LLMTextFrame))
    assert out.index(speak[0]) < first_text
    emo = [f.data["emotion"] for f in out if isinstance(f, RTVIServerMessageFrame) and f.data.get("type") == "emotion"]
    assert emo[0] == "pensativo"
    assert llm.last_acked is True

async def test_ack_fora_do_cache_fica_mudo():
    body = ndjson({"ack": "agenda"}, {"t": "Ok."}, {"meta": {"mode": "full"}})
    llm = BetoBrainLLMService(client_with(body), acks=AckPhrases({"agenda": ["X"], "geral": ["Y"]}), is_cached=lambda t: False)
    out = []
    await llm.respond([{"role": "user", "content": "agenda"}], _collect(out))
    assert not any(isinstance(f, TTSSpeakFrame) for f in out)
    assert llm.last_acked is False

async def test_segundo_ack_ou_ack_depois_de_texto_e_ignorado():
    body = ndjson({"ack": "agenda"}, {"ack": "myhub"}, {"t": "Ok."}, {"ack": "geral"}, {"meta": {"mode": "full"}})
    llm = BetoBrainLLMService(client_with(body), acks=AckPhrases({"agenda": ["A"], "myhub": ["M"], "geral": ["G"]}), is_cached=lambda t: True)
    out = []
    await llm.respond([{"role": "user", "content": "x"}], _collect(out))
    assert [f.text for f in out if isinstance(f, TTSSpeakFrame)] == ["A"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd voice && uv run pytest tests/test_ack.py tests/test_brain.py -q`
Expected: FAIL (`ModuleNotFoundError: beto_voice.ack`).

- [ ] **Step 3: Implement `AckPhrases` and the brain handling**

`respond` reseta `last_acked = False` no início. Só o primeiro `ack` antes de qualquer `t` conta; os outros viram `logger.warning("[brain] ack ignorado: ...")`. Frase fora do cache: `logger.info("[brain] ack sem áudio pronto: ...")` e nada é emitido.

- [ ] **Step 4: Wire it in `bot.py`**

`AckPhrases(cfg.ack.phrases())` e `is_cached=tts.cached` no `BetoBrainLLMService`. No `on_client_connected`, dispare `asyncio.create_task(tts.prewarm(cfg.ack.all()))` e registre no log quantas frases ficaram prontas quando terminar.

- [ ] **Step 5: Run all Python tests**

Run: `cd voice && uv run pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add voice/beto_voice/ack.py voice/beto_voice/brain.py voice/beto_voice/bot.py voice/tests/test_ack.py voice/tests/test_brain.py
git commit -m "feat(voz): ack falado na hora, com áudio em cache e fora do histórico"
```

---

### Task 6: Gate contínuo, pelo início da fala, com hesitação

**Files:**
- Modify: `voice/beto_voice/gate.py`, `voice/beto_voice/gate_processor.py`, `voice/beto_voice/bot.py`
- Test: `voice/tests/test_gate.py`, `voice/tests/test_gate_processor.py`

**Interfaces:**
- Consumes: `TurnCfg.continuous`, `.idle_close_secs`, `.hold_phrases` (Task 3).
- Produces: `ConversationGate(..., continuous: bool = False, idle_close_secs: float = 60.0, hold_phrases: list[str] | None = None)`; `on_user_started(now: float) -> None`; `Kind` ganha `"hold"`. Os padrões mantêm o comportamento de hoje para quem não passa os parâmetros novos.

- [ ] **Step 1: Write the failing tests**

```python
# voice/tests/test_gate.py (acrescentar)
def contínuo(**kw):
    return ConversationGate(wake_words=["beto"], end_phrases=["tchau", "valeu"], follow_up_secs=9, listen_secs=12,
                            continuous=kw.get("continuous", True), idle_close_secs=60, hold_phrases=["hmm", "peraí", "deixa eu pensar"])

def test_fala_comecada_na_janela_e_aceita_mesmo_transcrita_depois(gate):
    gate.on_transcript("Beto, oi", now=100); gate.on_bot_stopped(now=101)
    gate.on_user_started(now=108)                       # janela aberta até 110
    assert gate.on_transcript("e amanhã?", now=114) == Decision("forward", "e amanhã?")

def test_fala_comecada_com_a_janela_fechada_continua_ignorada(gate):
    gate.on_transcript("Beto, oi", now=100); gate.on_bot_stopped(now=101)
    gate.on_user_started(now=111)
    assert gate.on_transcript("e amanhã?", now=114).kind == "ignore"

def test_modo_continuo_fica_aberto_ate_o_tempo_ocioso():
    g = contínuo()
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    assert g.is_open(now=160) and not g.is_open(now=162)

def test_desligado_volta_aos_9s():
    g = contínuo(continuous=False)
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    assert g.is_open(now=109) and not g.is_open(now=111)

def test_hesitacao_nao_vai_ao_cerebro_e_renova_a_janela():
    g = contínuo()
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    assert g.on_transcript("Hmm...", now=150).kind == "hold"
    assert g.on_transcript("Deixa eu pensar, Beto", now=155).kind == "hold"
    assert g.is_open(now=214)

def test_beto_perai_com_gate_fechado_so_abre_a_escuta():
    g = contínuo()
    assert g.on_transcript("Beto, peraí", now=100).kind == "listen"

def test_fala_na_janela_que_termina_em_tchau_encerra():
    g = contínuo()
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    g.on_user_started(now=150)
    assert g.on_transcript("tchau Beto", now=152).kind == "end"
    assert not g.is_open(now=153)

def test_barge_in_com_hesitacao_mantem_aberto_no_continuo():
    g = contínuo()
    g.on_transcript("Beto, me explica kafka", now=100)   # turno aberto enquanto ele fala
    assert g.on_transcript("peraí", now=105).kind == "hold"
    g.on_bot_stopped(now=106)
    assert g.is_open(now=165)
```

```python
# voice/tests/test_gate_processor.py (acrescentar)
async def test_vad_subindo_marca_inicio_da_fala(proc):
    proc.gate.on_transcript("Beto, oi", now=100); proc.gate.on_bot_stopped(now=101)
    proc.clock.t = 108
    await proc.process_frame(VADUserStartedSpeakingFrame(), FrameDirection.UPSTREAM)
    proc.clock.t = 114
    await proc.process_frame(tf("e amanhã?"), FrameDirection.DOWNSTREAM)
    assert any(isinstance(f, TranscriptionFrame) and f.text == "e amanhã?" for f in proc.pushed)

async def test_hold_manda_estado_listening(proc_continuo):
    await proc_continuo.process_frame(tf("Beto, oi"), FrameDirection.DOWNSTREAM)
    proc_continuo.gate.on_bot_stopped(now=proc_continuo.clock.t)
    proc_continuo.pushed.clear()
    await proc_continuo.process_frame(tf("hmm"), FrameDirection.DOWNSTREAM)
    assert [f.data for f in proc_continuo.pushed if isinstance(f, RTVIServerMessageFrame)] == [{"type": "state", "state": "listening"}]
```

(`proc_continuo`: fixture igual a `proc`, com o gate em `continuous=True` e `hold_phrases=["hmm"]`. O VAD-frame tem de seguir adiante: confira que ele também aparece em `proc.pushed`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd voice && uv run pytest tests/test_gate.py tests/test_gate_processor.py -q`
Expected: FAIL (`unexpected keyword argument 'continuous'`, `no attribute 'on_user_started'`).

- [ ] **Step 3: Implement the gate**

`on_user_started` marca `_speech_open` só se `is_open(now)`. Em `on_transcript`, "aberto" passa a ser `is_open(now) or _speech_open`, e `_speech_open` é limpo em toda decisão. Encerramento é checado antes da hesitação. Hesitação: depois de tirar o wake word, se o texto normalizado for uma das `hold_phrases` normalizadas (com "beto" opcional no fim, como o encerramento) e o gate estiver aberto, devolve `hold` e renova a janela (`idle_close_secs` no contínuo, `follow_up_secs` fora). Com o gate fechado e wake word, "beto peraí" devolve `listen`. `on_bot_stopped` usa `idle_close_secs` quando `continuous`. Uma fala encaminhada no contínuo também renova a janela quando o Beto termina, pelo `on_bot_stopped` de sempre.

- [ ] **Step 4: Implement the processor and the wiring**

`GateProcessor`: `VADUserStartedSpeakingFrame` (qualquer direção) chama `gate.on_user_started(now)` e segue adiante na mesma direção. Decisão `hold` manda `{"type": "state", "state": "listening"}`. Em `bot.py`, passe `continuous`, `idle_close_secs` e `hold_phrases` do `cfg.turn` ao `ConversationGate`. Atualize a docstring do topo do `gate.py` com o modo contínuo e a hesitação.

- [ ] **Step 5: Run all Python tests**

Run: `cd voice && uv run pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add voice/beto_voice/gate.py voice/beto_voice/gate_processor.py voice/beto_voice/bot.py voice/tests/test_gate.py voice/tests/test_gate_processor.py
git commit -m "feat(voz): conversa contínua, janela pelo início da fala e hesitação que não encerra"
```

---

### Task 7: Ensaio com o Rodrigo

Verificação manual; nenhum código novo, a não ser correção do que o ensaio achar.

- [ ] **Step 1: Subir tudo**

Run: `npm run dev` na raiz (cérebro local) e `cd voice && uv run beto-voice`, com o VoiceStudio no ar.
Expected: log do serviço mostra `ack` com 12 frases prontas logo depois da conexão do navegador.

- [ ] **Step 2: Roteiro de 10 minutos, conduzido pelo Rodrigo**

Cumprimento; pergunta técnica; "o que tenho amanhã?" (agenda); "gastei 30 no mercado" (My Hub); pausa de 15 s pensando e continuar sem dizer "Beto"; "hmm, deixa eu pensar" no meio; "beleza" sozinho seguido de outra pergunta; começar a falar 8 s depois de uma resposta e falar por 5 s; "tchau Beto".
Expected: nenhum turno ignorado; ack nos turnos de agenda e My Hub; a conversa só fecha no "tchau".

- [ ] **Step 3: Ler as medidas**

Run: `grep "\[latency\]"` na saída do serviço.
Expected: `ack=sim` nos turnos com ferramenta e `ack=não` na conversa; anote a mediana de `total`, `stt`, `brain`, `tts` e `resposta` no fim deste plano, numa seção "Medidas do ensaio". Esse número decide se o próximo design é sobre o TTS.

- [ ] **Step 4: Commit das medidas**

```bash
git add docs/superpowers/plans/2026-10-16-voz-fluidez.md
git commit -m "docs(voz): medidas do ensaio da fluidez"
```
