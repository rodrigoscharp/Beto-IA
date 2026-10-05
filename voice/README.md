# beto-voice: serviço local de voz do Beto

Roda no Mac e substitui a Web Speech API do navegador: Silero VAD + smart-turn v3 decidem quando você terminou de
falar, o Whisper large-v3-turbo (MLX, GPU) transcreve com o seu vocabulário, o cérebro continua sendo o `/api/chat`
do app (Vercel ou `npm run dev`) e a voz sai pela ElevenLabs em streaming, interrompível. Design em
`docs/superpowers/specs/2026-10-05-voz-local-design.md`.

## Rodar

```bash
cd voice
cp .env.example .env            # ELEVENLABS_API_KEY, VOICE_SERVICE_TOKEN (openssl rand -hex 32), BRAIN_URL
uv sync
uv run beto-voice               # http://127.0.0.1:7860 — a primeira vez baixa o modelo (~1,6 GB)
```

- `VOICE_SERVICE_TOKEN` tem de ser o mesmo no app (variável na Vercel, ou `.env.local` com `npm run dev`).
- `BRAIN_URL` aponta para o cérebro: `http://localhost:3000` em desenvolvimento, `https://<app>.vercel.app` em produção.
- No app, `NEXT_PUBLIC_VOICE_URL` (padrão `http://localhost:7860`) diz onde procurar o serviço. Com ele no ar, o
  canto superior esquerdo mostra `BETO · VOZ LOCAL`; sem ele, o app segue com a Web Speech.

Página de desenvolvimento em `http://localhost:7860/` (conectar, ouvir, interromper, dizer, push-to-talk, log de eventos).

## Parâmetros

Tudo em `beto-voice.toml` (comentado): vocabulário e `initial_prompt` do Whisper, tempos do VAD e do smart-turn,
janela de follow-up, wake words, frases de encerramento, voz e velocidade da ElevenLabs, CORS. Nada é fixo no código.

## Como funciona a escuta

- Fechado: só "Beto", "ei Beto", "oi Beto"… acorda ("ei Beto, que horas são?" vai direto ao cérebro; "Beto." sozinho
  abre a escuta por `listen_secs`).
- Depois de o Beto responder, ele continua ouvindo por `follow_up_secs` sem precisar do nome.
- Toque no mascote abre a escuta; barra de espaço segurada é push-to-talk; "valeu", "tchau", "é isso" encerram.
- Falar por cima do Beto o interrompe (`barge_in`).
- Pausas: o smart-turn classifica se a frase está completa; se não ("é, então…"), espera até `smart_turn_stop_secs`
  de silêncio antes de fechar o turno.

## Testes

```bash
uv run pytest          # config, filtro da resposta, gate, cliente do cérebro, STT (sem rede e sem modelo)
```

## Limitações

- Só com o Mac ligado e o serviço rodando; no iPhone o app usa a Web Speech.
- Chrome recomendado: a página https da Vercel fala com `http://localhost:7860` (o Chrome trata localhost como origem
  segura; o Safari pode recusar).
- Transcrição parcial é por reprocessamento do buffer (`interim_every_secs`), grosseira; `0` desliga.
- O wake word é textual: o Whisper transcreve tudo que o VAD captura na sala (custo de GPU constante).
