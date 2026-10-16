# Voz do Beto pelo VoiceStudio: design

Data: 2026-10-15. Substitui a ElevenLabs (e a reserva do Google) pelo VoiceStudio rodando no Mac.

## Por quê

A ElevenLabs gratuita trava o Beto: cota mensal de caracteres e no máximo 2 pedidos ao mesmo tempo
(`lib/speechqueue.ts`). O VoiceStudio (k2-fsa/OmniVoice, código aberto) roda localmente no Mac, sem cota e sem
limite de pedidos. O Rodrigo usa o Beto só no navegador do Mac, então a voz pode vir de `localhost`.

## Decisões do Rodrigo

- **Só VoiceStudio.** A ElevenLabs sai e o Google TTS sai junto. Não existe voz reserva.
- **Só no navegador do Mac.** iPhone e uso fora de casa estão fora.
- **Voz nova, não a Will.** Escolhida a "voz 3": OmniVoice com instruct `male, young adult, moderate pitch`,
  clonada de uma referência fixa para não variar entre frases.
- **Modo rápido.** `num_step = 8` com a referência curta (cerca de 2,9 s de áudio). Medido no Mac (MPS, modelo
  carregado): cerca de 2,0 s por frase curta e 3,2 s por frase de cerca de 100 caracteres.
- **O VoiceStudio fica sempre ligado.** Abre sozinho no login do Mac e volta se cair.

## Metas

- Toda fala do Beto sai do VoiceStudio, com a mesma voz em todas as frases.
- Nenhuma referência à ElevenLabs ou ao Google TTS sobra no código, na configuração, nos testes ou no README.
- O serviço local `voice/` (Pipecat) também fala pelo VoiceStudio.

## Fora do escopo

iPhone, acesso pela internet ao VoiceStudio, streaming real de áudio (o VoiceStudio gera a frase inteira antes
de enviar), voz idêntica à Will e a troca do motor de STT.

## Seria fracasso mesmo funcionando

- A voz muda de timbre de uma frase para outra.
- O Beto fica mudo porque o VoiceStudio caiu, e nada na tela mostra isso.
- A espera por frase passa muito de 3 s no uso normal.

## Como funciona

```
navegador do Mac (app na Vercel ou localhost:3000)
   └─ POST http://localhost:3900/v1/audio/speech   ← VoiceStudio (launchd, sempre ligado)
        { model: "omnivoice", input, voice: "Beto", response_format: "mp3",
          language: "pt", num_step: 8 }

voice/ (Pipecat, :7860)
   └─ mesmo endpoint, pelo cliente compatível com OpenAI
```

A Vercel não alcança o `localhost` do Mac, então quem chama o VoiceStudio é o navegador. Isso já funciona hoje
com o serviço `voice/` em `localhost:7860`.

### 1. VoiceStudio sempre ligado

- Um LaunchAgent (`~/Library/LaunchAgents/…voicestudio.plist`) com `RunAtLoad` e `KeepAlive` sobe o backend do
  VoiceStudio a partir de `~/Dev/VoiceStudio`. O modelo do plist e o script que o instala ficam no repositório do
  Beto (em `scripts/voicestudio/`). Os logs vão para um arquivo conhecido.
- O ambiente do serviço define `OMNIVOICE_ALLOWED_ORIGINS` com as origens do Beto (`https://betoia.vercel.app`
  e `http://localhost:3000`). Sem isso, o CORS e o guarda de navegador do VoiceStudio recusam o pedido.
- No primeiro uso, o Chrome pode pedir permissão de acesso à rede local. O Rodrigo aceita uma vez.

### 2. Perfil de voz "Beto"

- A referência curta (`voice/assets/beto-ref.wav`, cerca de 2,9 s, texto "Hoje você tem três tarefas no MyHub
  e uma reunião às dez.") fica versionada no repositório, junto com o instruct.
- Um script idempotente cria ou atualiza no VoiceStudio o perfil com o nome único `Beto`, usando `POST /profiles`
  com `kind=clone`, `language=pt`, a referência, o texto e o instruct. Os perfis de teste desta conversa
  (`Beto` com a referência longa e `Beto curto`) são apagados, para o nome `Beto` não ficar ambíguo
  (a API devolve 409 quando dois perfis têm o mesmo nome).
- O código passa a voz pelo nome do perfil, nunca pelo id, para o perfil poder ser recriado.

### 3. App web (Next.js)

- Um módulo cliente (por exemplo `lib/voicestudio.ts`) concentra a chamada: URL
  (`NEXT_PUBLIC_VOICESTUDIO_URL`, padrão `http://localhost:3900`), voz (`NEXT_PUBLIC_VOICESTUDIO_VOICE`, padrão
  `Beto`), passos (`NEXT_PUBLIC_VOICESTUDIO_STEPS`, padrão 8) e velocidade.
- As três chamadas a `/api/tts` em `app/page.tsx` (fala principal, frases pré-geradas e saudações) passam a usar
  esse módulo. O `lead` (silêncio antes da fala para o áudio do aparelho "acordar") deixa de ser a tag `<break>` da
  ElevenLabs e passa a ser feito no navegador.
- Se o VoiceStudio falhar, vale o comportamento atual: o texto fica na tela pelo tempo de leitura e a conversa
  segue. O motivo vai para o console.
- O indicador de cota da ElevenLabs vira um indicador de voz: só aparece quando o VoiceStudio não responde em
  `/health`, com um aviso de que o Beto está sem voz. Isso cobre o fracasso "mudo sem sinal".
- `GREETING_CACHE` sobe de versão para regerar as saudações com a voz nova.
- O limite de concorrência do `speechqueue` deixa de ser por causa da ElevenLabs. O VoiceStudio processa um pedido
  por vez na GPU, então o limite fica pequeno: o suficiente para preparar a próxima frase enquanto a atual toca.

### 4. Serviço local `voice/`

- `ElevenLabsTTSService` é trocado por um TTS que fala com o mesmo endpoint, com voz `Beto`, `language=pt` e
  `num_step=8`. Se o cliente OpenAI do Pipecat não repassar os campos extras, o serviço do Beto o estende.
- `[tts]` em `beto-voice.toml` passa a ter `url`, `voice`, `num_step` e `speed`. `ELEVENLABS_API_KEY` e
  `ELEVENLABS_VOICE_ID` somem de `config.py`, `server.py`, `.env.example`, README e testes.

### 5. O que sai

`app/api/tts/route.ts`, `app/api/tts/quota/route.ts`, `quotaStatus` em `lib/ops.ts`, `scripts/quota.test.mjs`,
a entrada `app/api/tts/route.ts` em `vercel.json`, as variáveis `ELEVENLABS_*` e `GOOGLE_TTS_*` em
`.env.local.example` e no README, e os trechos de README e comentários que falam da ElevenLabs. O caso de
`/api/tts` em `scripts/auth.test.mjs` é ajustado para uma rota que continue existindo. As variáveis na Vercel são
removidas pelo Rodrigo, ou com a CLI, se ele pedir.

## Como verificar

- Testes existentes passam (`scripts/*.test.mjs`, `pytest` em `voice/`), com os de cota removidos e os de
  configuração do `voice/` atualizados.
- Ponta a ponta no navegador do Mac: o Beto cumprimenta, responde a duas perguntas e encerra, sempre com a voz 3,
  sem pedido à ElevenLabs ou ao Google na aba de rede.
- Com o VoiceStudio parado: aparece o aviso de "sem voz", o texto fica na tela e a conversa não trava. Depois de
  religado (ou após o `KeepAlive` reerguê-lo), a voz volta.
- Depois de reiniciar o Mac, o VoiceStudio sobe sozinho e responde em `/health`.

## Escolhas deixadas para quem implementa

- Como gerar o silêncio do `lead` no navegador.
- Formato de resposta (`mp3` ou `wav`) e se mantém o caminho de `MediaSource`, já que o áudio chega inteiro.
- O comando exato que o LaunchAgent roda (`bun run dev:api` ou o uvicorn direto), contanto que reinicie sozinho e
  não recarregue a cada mudança de arquivo.
- O limite exato de concorrência, medido na prática.
