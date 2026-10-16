# Fluidez da conversa no serviço de voz: design

Data: 2026-10-16. Continua a Fase 1 da voz local (`2026-10-05-voz-local-design.md`). O objetivo é a conversa um a um
entre o Rodrigo e o Beto, no Mac com o serviço `voice/` rodando, soar contínua: sem silêncio longo, sem fala ignorada e
sem a conversa fechar no meio.

## O problema

Três coisas quebram o ritmo da conversa hoje.

1. **Silêncio nos turnos com ferramenta.** Quando a fala precisa de ferramenta (agenda, My Hub, memória, plano de
   conteúdo), `/api/chat` vai pelo caminho completo, que não faz stream: o loop de ferramentas faz várias chamadas à
   Groq e só então devolve o texto. O serviço de voz não recebe nada até o fim, e o Beto fica mudo por alguns segundos.
2. **Fala ignorada e conversa que fecha.** O `ConversationGate` abre uma janela de 9 s depois de cada resposta e
   confere a janela quando a transcrição chega, não quando o Rodrigo começa a falar. Quem começa a falar aos 7 s e fala
   por 5 s é descartado. Além disso, a janela fecha em qualquer pausa maior que 9 s, e "beleza" ou "fechou" ditos
   sozinhos encerram a conversa, embora quase sempre sejam só uma confirmação.
3. **Sem medida.** Ninguém sabe quanto cada etapa custa (STT, cérebro, TTS), então qualquer ajuste de latência é chute.

## Fora do escopo

O caminho do navegador sem o serviço local (Web Speech), continuidade entre sessões, funcionalidades novas (pesquisa
na web, controle do Mac, lembretes, visão de tela). Cada um vira um design próprio.

## A. Reconhecimento imediato (ack)

### Protocolo

`lib/voicewire.ts` ganha um tipo de linha:

```
{"ack": "Deixa eu ver a agenda."}
```

Regras:

- Só a rota manda `ack`, só no modo `stream: "ndjson"`, e só quando o turno vai para `replyWithTools`.
  Conversa simples não leva ack: o stream já começa em poucas centenas de milissegundos.
- No máximo um `ack` por resposta, sempre antes de qualquer `{"t": ...}`. A rede de proteção que refaz a chamada com
  todas as ferramentas não manda um segundo ack.
- O texto do ack é só fala: sem tag de emoção, sem tag de ação.
- Cliente que não conhece a linha a ignora (`parseLine` e `parse_line` já devolvem `null` para linha desconhecida).

### Escolha da frase

Função pura nova, `ackFor(sets: ToolSets, seed: number): string`, em `lib/ack.ts`. Ela escolhe pela ferramenta mais
específica do turno, nesta ordem: plano de conteúdo, agenda, My Hub, memória, e uma frase genérica quando nenhuma se
aplica. Cada grupo tem de duas a três variações, todas curtas (até seis palavras) e sem "chefe". A variação sai de
`seed` (a rota passa `Date.now()`), para não repetir a mesma frase sempre.

Frases iniciais:

| Grupo | Variações |
|---|---|
| conteúdo | "Deixa eu abrir o roteiro." / "Vou pegar o plano." |
| agenda | "Deixa eu ver a agenda." / "Só um segundo, olhando a agenda." / "Vou checar a agenda." |
| My Hub | "Deixa eu ver no My Hub." / "Um instante, abrindo o My Hub." |
| memória | "Deixa eu ver o que eu guardei." / "Um segundo." |
| genérica | "Um segundo." / "Deixa eu ver." / "Já vejo isso." |

### Serviço de voz

- `parse_line` (Python) reconhece `{"ack": str}` com texto não vazio e devolve `{"ack": texto}`.
- `BetoBrainLLMService.respond`, ao receber o primeiro `ack` da resposta:
  - manda ao navegador `{"type": "emotion", "emotion": "pensativo"}`;
  - emite `TTSSpeakFrame(texto, append_to_context=False)`, para a frase ser falada na hora sem entrar no histórico.
    Assim o modelo não vê o ack nas respostas anteriores e não aprende a repeti-lo.
- Um `ack` depois do primeiro, ou depois de algum `t`, é ignorado com um aviso no log.
- O texto da resposta que chega depois segue o caminho de hoje (`LLMTextFrame`) e é falado em seguida ao ack, na
  mesma fila do TTS. A emoção da resposta, quando chega, substitui o "pensativo".

## B. Conversa contínua

Todas as mudanças ficam em `voice/beto_voice/gate.py` e `gate_processor.py`, com parâmetros em `beto-voice.toml`.

### Janela contada pelo início da fala

- `ConversationGate.on_user_started(now)`: se a janela está aberta nesse instante, marca a fala em curso como
  aceita (`_speech_open = True`).
- `on_transcript` trata `_speech_open` como janela aberta e limpa a marca depois de decidir.
- `GateProcessor` chama `on_user_started` ao ver `VADUserStartedSpeakingFrame`. O agregador de usuário do Pipecat
  transmite esse frame nas duas direções, então ele chega ao gate subindo o pipeline. Um teste de integração confere
  isso. Se o frame não chegar, o plano B é chamar `on_user_started` na primeira `InterimTranscriptionFrame` da fala.

### Modo contínuo

- `[turn] continuous = true` (padrão) e `[turn] idle_close_secs = 60`.
- Em `on_bot_stopped`, a janela vai até `now + idle_close_secs` quando `continuous` está ligado, e até
  `now + follow_up_secs` quando está desligado (o comportamento de hoje).
- A janela também se renova a cada fala aceita, então a conversa só fecha com encerramento explícito ou com
  `idle_close_secs` sem nenhuma fala.

### Encerramento e hesitação

- `end_phrases` perde "fechou" e "beleza". Continuam: "valeu", "obrigado", "obrigada", "tchau", "é isso", "só isso",
  "era isso", "por hoje é isso", "pode parar". A regra de frase inteira continua igual.
- `[turn] hold_phrases = ["hmm", "hum", "peraí", "pera", "espera", "deixa eu pensar", "deixa eu ver", "calma"]`.
  Quando a transcrição inteira, normalizada, for só uma dessas frases (com ou sem "Beto"), o gate devolve a decisão
  nova `"hold"`: nada vai para o cérebro e a janela é renovada. O `GateProcessor` manda ao navegador
  `{"type": "state", "state": "listening"}`.

### Risco aceito

Com o modo contínuo, uma pessoa falando perto do Mac durante a janela pode ser respondida. Por isso o modo é
configurável e o tempo ocioso é curto.

## C. Medir a latência

- `bot.py` registra o `UserBotLatencyObserver` do Pipecat no `PipelineWorker`. No evento `on_latency_breakdown`, o
  serviço escreve uma linha por turno:

  ```
  [latency] total=1.42s turno=0.31s stt=0.28s brain=0.62s tts=0.18s ack=sim
  ```

  `total` é do fim da fala do Rodrigo até o primeiro áudio do Beto. `turno` é o `user_turn_secs` (VAD, smart-turn e
  finalização do STT). `stt`, `brain` e `tts` são os TTFB de cada serviço, quando aparecem no detalhamento. `ack=sim`
  quando o primeiro áudio foi um ack.
- Como o ack antecipa o primeiro áudio, `BetoBrainLLMService` também escreve `[latency] resposta=2.80s` com o tempo
  do início do pedido ao cérebro até o primeiro texto de verdade (o primeiro `t`), para o loop de ferramentas não
  sumir da medida.
- Experimento, só no TOML: `[tts] model = "eleven_flash_v2_5"` no lugar de `eleven_turbo_v2_5`. Fica se a voz em
  português continuar boa no ouvido do Rodrigo e o TTFB do TTS cair. O código não muda.

## Testes

- `scripts/voicewire.test.mjs` (já existe): `parseLine` lê `ack`, recusa `ack` vazio ou que não seja texto, e
  `encodeLine` faz ida e volta.
- `scripts/ack.test.mjs`: `ackFor` escolhe o grupo certo para cada combinação de `ToolSets`, respeita a ordem de
  prioridade, varia com `seed` e nenhuma frase contém "chefe" nem passa de seis palavras.
- A rota não tem teste hoje. A mudança nela é uma linha: a função `viaTools` do modo ndjson chama
  `write({ ack: ackFor(sets, Date.now()) })` antes de `replyWithTools`. Ela é conferida no ensaio (passo 4 da ordem),
  olhando o log `[latency]` com `ack=sim` nos turnos com ferramenta e `ack=não` na conversa.
- `voice/tests/test_brain.py`: `parse_line` com `ack`; `respond` emite emoção "pensativo" e
  `TTSSpeakFrame(append_to_context=False)` antes dos `LLMTextFrame`; segundo `ack` é ignorado.
- `voice/tests/test_gate.py`: fala começada com a janela aberta e transcrita depois do fim da janela é aceita; fala
  começada com a janela fechada continua ignorada; modo contínuo mantém aberto até `idle_close_secs`; desligado volta
  aos 9 s; "beleza" sozinho não encerra; "tchau beto" encerra; "hmm" e "deixa eu pensar" viram `hold` e renovam a
  janela.
- `voice/tests/test_gate_processor.py`: `VADUserStartedSpeakingFrame` subindo chama `on_user_started`; `hold` manda o
  estado `listening`.
- `voice/tests/test_config.py`: as chaves novas têm padrão e validação (`idle_close_secs > 0`).

## Ordem de implementação

1. Medida de latência (C), para ter o antes.
2. Ack (A): protocolo, frase, rota, serviço de voz.
3. Gate (B): início da fala, modo contínuo, encerramento, hesitação.
4. Ensaio de 10 minutos de conversa real, com a medida antes e depois, e decisão sobre o modelo flash do TTS.
