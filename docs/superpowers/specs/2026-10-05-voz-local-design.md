# Voz local do Beto (Fase 1): design

Data: 2026-10-05. Fase 1 da missão "Beto nível Jarvis". Diagnóstico da Etapa 0 na conversa de origem; este
documento guarda só as decisões.

## O problema

Hoje a voz inteira roda no navegador com a Web Speech API: o Chrome manda o áudio para o Google, devolve texto
sem aceitar vocabulário, e o app decide que o Rodrigo terminou de falar por um debounce de 700 ms sobre os
resultados parciais (`app/page.tsx`). Resultado: nomes próprios errados (Muno, MyHub) e frases cortadas em pausas
naturais. Não há VAD, não há detecção semântica de turno, não há barge-in por voz, e o microfone fica fechado
enquanto o Beto fala.

## A decisão

O cérebro continua na Vercel (`/api/chat`, ferramentas, memória, bateria de testes). Nasce um **serviço local de
voz** no Mac, em Python com **Pipecat 1.12**, na pasta `voice/`:

```
navegador (PWA do Beto)  ←WebRTC→  beto-voice (Mac, :7860)
                                     ├─ Silero VAD (stop 0,2 s) + smart-turn v3 (local, CPU)
                                     ├─ Whisper large-v3-turbo via MLX (GPU Metal), initial_prompt com vocabulário
                                     ├─ BetoBrainLLMService → POST {BRAIN_URL}/api/chat  (NDJSON, token de serviço)
                                     └─ ElevenLabs TTS por WebSocket (streaming, interrompível)
```

Por que Pipecat e não pipeline próprio: VAD, smart-turn, interrupção, agregação de turno, TTS streaming e
transporte WebRTC já vêm prontos e mantidos. Por que não LiveKit Agents: exige servidor LiveKit; só vale se o
celular virar o canal principal. Por que MLX e não faster-whisper: no Mac o faster-whisper roda só em CPU
(CTranslate2 não tem Metal); o MLX usa a GPU. O faster-whisper fica como motor alternativo (`engine = "faster"`),
e é o único dos dois que o Pipecat já suporta com `initial_prompt`; para o MLX, o serviço do Beto estende a classe
do Pipecat e passa o `initial_prompt` direto ao `mlx_whisper.transcribe`.

Custo aceito: a voz nova só existe com o Mac ligado e o serviço rodando. Sem ele, o app cai no caminho atual
(Web Speech), inclusive no iPhone.

## Fora do escopo desta fase

Perfil, estado do dia, memória semântica (Fase 2); ferramentas novas (Fase 3); wake word por áudio
(openWakeWord, Fase 6); transcrição parcial de verdade (só com STT em nuvem; aqui a parcial é por reprocessamento
periódico do buffer, ver abaixo).

## Componentes

### 1. `voice/` (Python, uv)

```
voice/
  pyproject.toml
  beto-voice.toml           # todos os parâmetros (nada fixo no código)
  .env.example              # ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, VOICE_SERVICE_TOKEN, BRAIN_URL
  beto_voice/
    config.py               # TOML + env -> Config (dataclasses), validado
    reply_filter.py         # texto do cérebro em pedaços -> eventos (emoção, texto falável, tag de ação)
    gate.py                 # ConversationGate: máquina de estados pura (wake word, follow-up, PTT, encerramento)
    gate_processor.py       # FrameProcessor do Pipecat que aplica o gate às transcrições
    stt.py                  # BetoWhisperMLX (initial_prompt + parcial periódica) e build_stt()
    brain.py                # BrainClient (httpx, NDJSON) e BetoBrainLLMService (LLMService do Pipecat)
    bot.py                  # monta o pipeline e roda uma sessão
    server.py               # FastAPI: POST/PATCH /api/offer, GET /health, CORS; `uv run beto-voice`
  tests/                    # pytest, sem rede e sem modelo: config, reply_filter, gate, brain (cliente com servidor falso)
```

**Config (`beto-voice.toml`)**, seções e padrões iniciais:

- `[brain]` `url`, `history = 20`, `timeout_secs = 60`.
- `[stt]` `engine = "mlx"`, `model = "mlx-community/whisper-large-v3-turbo"`, `language = "pt"`,
  `vocabulary = [MyHub, Beto, Muno, Spring Boot, pomodoro, Ubatuba, AWS, Rocketseat, …]`, `initial_prompt = ""`
  (texto livre somado ao vocabulário), `no_speech_prob = 0.6`, `interim_every_secs = 1.5` (0 desliga).
- `[turn]` `vad_stop_secs = 0.2`, `vad_start_secs = 0.2`, `vad_confidence = 0.7`, `smart_turn_stop_secs = 1.3`,
  `smart_turn_max_duration_secs = 8`, `follow_up_secs = 9`, `listen_secs = 12`, `barge_in = true`,
  `wake_words = [...]`, `end_phrases = [...]`.
- `[tts]` `model = "eleven_turbo_v2_5"`, `stability`, `similarity_boost`, `style`, `speed`.
- `[server]` `host = "127.0.0.1"`, `port = 7860`, `cors_origins = [http://localhost:3000, https://<app>.vercel.app]`.

**Pipeline** (uma sessão por conexão WebRTC):

```
transport.input() → rtvi → stt → gate → user_aggregator → brain_llm → tts → transport.output() → assistant_aggregator
```

- Turno do usuário: `LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer(VADParams(stop_secs, start_secs,
  confidence)), user_turn_strategies=UserTurnStrategies(start=[VADUserTurnStartStrategy(enable_interruptions=barge_in),
  TranscriptionUserTurnStartStrategy()], stop=[TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3(
  params=SmartTurnParams(stop_secs, max_duration_secs)))]), empty_user_turn=EmptyUserTurnConfig(interrupted_prompt=None,
  idle_prompt=None))`. Turno vazio (tosse, ruído) não gera resposta.
- Se o Rodrigo volta a falar enquanto o Beto processa ou fala: o Pipecat interrompe (barge-in) e abre novo turno;
  o cérebro recebe as duas falas como uma só (o cliente do cérebro junta mensagens de usuário consecutivas).
- Barge-in também por toque no mascote: mensagem `interrupt` do cliente → `rtvi.interrupt_bot()`.

**Gate de conversa** (`gate.py`, puro): reproduz o UX atual sem Web Speech. Estados: fechado (só wake word),
aberto até `open_until`, PTT. Regras:
- transcrição com wake word no começo ("ei beto, …"): abre, tira o wake word e encaminha o resto; wake word sozinho
  abre por `listen_secs` e manda estado `listening` ao cliente, sem chamar o cérebro;
- aberto ou PTT: encaminha;
- frase de encerramento ("valeu", "tchau", "é isso"): fecha, não encaminha;
- fechado: descarta (o cliente recebe `{"type":"ignored","text":…}` para a legenda poder mostrar o que foi ouvido);
- fim da fala do Beto: abre por `follow_up_secs`; `listen` (toque) abre por `listen_secs`; PTT segurado = aberto.
Enquanto o Beto fala, a interrupção por VAD vale sempre (quem fala por cima quer interromper).

**STT** (`stt.py`): `BetoWhisperMLX(WhisperSTTServiceMLX)` com `initial_prompt` = vocabulário + texto livre, e
`condition_on_previous_text=False` (menos alucinação em loop). Parcial: enquanto o VAD diz que o usuário fala, a cada
`interim_every_secs` roda o mesmo modelo sobre o buffer acumulado (um por vez, com lock) e emite
`InterimTranscriptionFrame`; a final espera a parcial em andamento terminar. `engine = "faster"` usa
`WhisperSTTService` do Pipecat com `initial_prompt` e `hotwords`.

**Cérebro** (`brain.py`): `BetoBrainLLMService(LLMService)` trata `LLMContextFrame`: monta as últimas `history`
mensagens (assistente com `[emo:X]` na frente, como o navegador fazia; usuários consecutivos juntos), chama
`POST /api/chat` com `{"messages", "stream": "ndjson", "undo"}` e `Authorization: Bearer VOICE_SERVICE_TOKEN`,
passa cada pedaço pelo `ReplyFilter` e empurra `LLMTextFrame` só com texto falável. Tag de emoção vira
`RTVIServerMessageFrame({"type":"emotion","emotion":X})`; tag de ação vira `{"type":"action","tag":"SPOTIFY",
"payload":{…}}` (o navegador executa, como hoje); `meta.undo` fica guardado no serviço e volta na próxima chamada;
`meta.needsGoogleLogin` vira `{"type":"needs_login","service":"google"}`. Erro de rede: fala "Não consegui falar com
o cérebro agora." via `TTSSpeakFrame`.

**Mensagens do cliente** (RTVI `on_client_message`): `listen` (abre o gate), `ptt` `{down}`, `interrupt`,
`say` `{text}` (resultado de ação ou aviso proativo → `TTSSpeakFrame(text, append_to_context=True)`),
`text` `{text}` (fala digitada → `LLMMessagesAppendFrame(run_llm=True)`), `end` (fecha o gate).

**Servidor** (`server.py`): FastAPI com `SmallWebRTCRequestHandler`; `GET /health` → `{"ok":true,"stt":…}`; CORS
só para `cors_origins`; escuta em `127.0.0.1`. Comando `uv run beto-voice` (script em `pyproject`).

### 2. Cérebro (`/api/chat`, Vercel)

- `stream: "ndjson"`: uma linha JSON por evento. `{"t":"…"}` texto; `{"retry":true}` quando a rede de proteção
  refez a resposta (o que já foi falado fica); `{"meta":{"mode","undo","undoCleared","needsGoogleLogin","usedTools"}}`
  última linha. Decisão de rota no servidor (`planTurn`): turno com ferramentas → caminho completo sem stream, texto
  numa linha só; conversa → stream do modelo. A rede de proteção "disse que fez sem fazer" roda ao fim do stream e
  emite `retry` + a resposta nova. Módulo puro `lib/voicewire.ts` com o formato (codificar linhas) e testes.
- `middleware.ts`: aceita `Authorization: Bearer ${VOICE_SERVICE_TOKEN}` em `/api/chat` (só esse caminho, só
  com a env definida). Regra pura em `lib/auth.ts` (`voiceTokenOk`) com teste.

### 3. Navegador (`app/page.tsx`)

- `lib/voicelink.ts`: `VoiceLink` embrulha `PipecatClient` + `SmallWebRTCTransport` (`@pipecat-ai/client-js`,
  `@pipecat-ai/small-webrtc-transport`). Microfone com `echoCancellation`, `noiseSuppression`, `autoGainControl`,
  `channelCount: 1`, `sampleRate: 16000`. Parte pura e testada: `parseServerMessage` (emoção, ação, estado,
  ignored, needs_login) e `micConstraints()`.
- `components/useVoiceLink.ts`: ao montar, `GET {NEXT_PUBLIC_VOICE_URL}/health` (padrão `http://localhost:7860`);
  ok → conecta e devolve `{active, say, listen, interrupt, ptt, sendText, end}`; falha → `active=false` e a página
  segue com a Web Speech.
- `page.tsx` com o link ativo: não liga o ouvinte de wake word; estados do mascote vêm dos eventos (user speaking →
  `listening`, LLM started → `thinking`, bot speaking → `speaking`, bot stopped → `wake`); legenda = transcrição
  (parcial e final) e `bot-tts-text`; emoção pela mensagem do servidor; ações executadas pelo dispatcher existente e o
  resultado vai por `say`; toque no mascote = `listen` ou `interrupt`; barra de espaço segurada = PTT; texto digitado
  = `sendText`; aviso proativo = `say`; "sair" fecha o link.

## Critério de pronto (do pedido)

Falar frases longas com pausas ("é, então… deixa eu pensar… acho que sim") sem ser cortado; termos do vocabulário
transcritos certos na grande maioria das vezes; falar por cima do Beto o interrompe; a transcrição aparece na tela.

## Como testar

1. `cd voice && cp .env.example .env` (chaves), `uv sync`, `uv run beto-voice`. Primeira execução baixa o modelo.
2. `VOICE_SERVICE_TOKEN` igual na Vercel (ou `.env.local` do Next) e no `voice/.env`.
3. Abrir o app; o canto superior esquerdo mostra `voz: local`. Falar "ei Beto, …".
4. Testes: `cd voice && uv run pytest`; na raiz `npm test`.

## Riscos

- Mixed content: página https na Vercel falando com `http://localhost:7860`. Chrome trata `localhost` como origem
  segura; Safari pode recusar. Alternativa documentada: rodar o Next local (`npm run dev`).
- Whisper sobre todo áudio da sala (o wake word é textual): custo de GPU constante enquanto a aba está aberta.
  Mitigação: VAD descarta silêncio; `no_speech_prob` descarta ruído; a Fase 6 traz wake word por áudio.
- Parcial por reprocessamento: grosseira e custa GPU; desligável (`interim_every_secs = 0`).
