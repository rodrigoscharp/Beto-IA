# Beto com rosto expressivo — design

Data: 2026-09-30

## Objetivo

Trocar a aura/esfera de partículas do Beto por um rosto plano 2D formado pelas mesmas partículas, com 9 expressões. O Beto precisa parecer ter humor e personalidade: olhar para ele e saber se está alegre, bravo, pensativo etc.

## Decisões já tomadas

- **Estilo:** híbrido. Partículas continuam, mas formam olhos, sobrancelhas e boca (rosto plano 2D, sem esfera 3D).
- **Fonte da emoção:** o LLM marca o tom da resposta com uma tag. Os estados de voz atuais continuam como base.
- **Repertório (9):** `neutro`, `alegre`, `animado`, `pensativo`, `bravo`, `nervoso`, `surpreso`, `triste`, `sarcastico`.

## Contexto atual

- `components/Orb.tsx`: canvas, 320 partículas em esfera de Fibonacci, estados `wake | listening | thinking | speaking`, props `state`, `onClick`, `theme`.
- `app/page.tsx`: usa `Orb`; `orbState` via `useState`; resposta do chat é JSON (sem streaming); `parseTag` (linha ~132) já extrai tags de ação do texto da resposta; saudações puras respondidas na hora sem modelo; fillers em áudio pré-gerado.
- `app/api/chat/route.ts`: `buildSystemPrompt` (linha 7) monta o system prompt; resposta volta como `{ reply }`.
- Não há framework de teste. Scripts: `dev`, `build`, `start`, `lint`.

## Design

### 1. Fluxo da emoção

- `buildSystemPrompt` passa a exigir que toda resposta comece com `[emo:X]`, `X` em uma das 9 emoções, com orientação de quando usar cada uma.
- `parseEmotion(reply)` no front (mesmo padrão do `parseTag`):
  - remove a tag do texto antes de exibir e antes do TTS;
  - tag ausente, inválida ou desconhecida resulta em `neutro`;
  - roda antes das outras tags de ação e não interfere nelas.
- Novo estado `emotion` em `page.tsx`, passado ao `Orb` como prop ao lado de `state`. É definido quando a resposta chega, antes do áudio começar. Volta a `neutro` quando o Beto volta ao `wake`.
- Caminhos sem LLM usam emoção fixa: saudações instantâneas = `alegre`; erros de comunicação = `triste`; filler = `pensativo`. Comandos de música, agenda e similares seguem a tag do LLM se existir, senão `neutro`.

### 2. Rosto no `Orb`

- **Modelo:** um rosto é um objeto de parâmetros:
  - olho (cada): `abertura`, `inclinação`, olhar `(x, y)`;
  - sobrancelha (cada): `altura`, `ângulo`;
  - boca: `curva` (-1 a +1), `abertura`, `largura`;
  - `tilt` leve da cabeça.
- **Presets:** mapa `EXPRESSIONS` com 9 conjuntos de parâmetros.
- **Parâmetros para pontos:** a cada frame, os parâmetros viram curvas (elipses, arcos, traços), amostradas em pontos-alvo distribuídos entre as 320 partículas (olhos ~35%, sobrancelhas ~20%, boca ~30%, resto vira poeira ao redor). Cada partícula segue seu alvo com mola suave e tremor leve.
- **Transição:** parâmetros atuais interpolam para os do preset em ~300ms com easing.
- **Vida própria:** piscar a cada 3-6s (~120ms); deriva lenta do olhar (no `thinking`, olha para cima e para o lado); respiração mínima de tamanho/posição.
- **Estados de voz por cima:**
  - `wake`: rosto pequeno, sonolento (olhos semicerrados), partículas espalhadas como hoje, clicável;
  - `listening`: olhos bem abertos, sobrancelhas levemente erguidas; ondas concêntricas atuais ao fundo;
  - `thinking`: olhar para cima, sobrancelha franzida, boca pequena; arcos tracejados atuais ao redor;
  - `speaking`: rosto da emoção da tag; boca abre e fecha em ritmo de fala via LFO irregular (TTS é `msedge-tts`, sem analisador de áudio).
- **Cor:** `hue` atual por estado, com matiz por emoção (`bravo` avermelhado, `triste` azul frio, `alegre` e `animado` quentes). Brilho e glow como hoje, em tema claro e escuro.
- **Acessibilidade:** com `prefers-reduced-motion`, sem tremor e sem piscar agressivo, só transições.
- **Escala:** o fator `k` atual continua; o rosto precisa ler bem em ~280px.

### 3. Arquivos

- `components/face.ts` (novo): tipos, `EXPRESSIONS`, funções puras que geram pontos-alvo a partir dos parâmetros, `parseEmotion`.
- `components/Orb.tsx`: desenho e animação; interface mantida (`state`, `onClick`, `theme`) mais a prop `emotion`.
- `app/page.tsx`: estado `emotion`, uso de `parseEmotion`, emoção fixa nos caminhos sem LLM.
- `app/api/chat/route.ts`: instrução da tag no system prompt.
- Página de preview de dev (`/preview-face`) com as 9 expressões lado a lado; não vai para produção.

## Testes e erros

- Sem framework novo. `parseEmotion` e `face.ts` (funções puras) verificados com script `node` descartável: tag válida, inválida, ausente, no meio do texto; nunca sobra `[emo:` no texto final; presets sem `NaN`; número de pontos-alvo estável.
- Validação visual na página de preview e no app rodando no browser embutido. `tsc` e `next build` devem passar.
- Degradação: tag ruim ou emoção desconhecida = `neutro`; `EXPRESSIONS[x]` nunca estoura. A contagem de partículas é constante (320), então o custo não cresce.

## Ordem de entrega

1. `face.ts` + página de preview. **Aprovação dos 9 rostos aqui, antes de tocar no app.**
2. `Orb.tsx` usa o rosto com `emotion` fixa em `neutro`; os 4 estados de voz funcionam.
3. Tag no backend e `parseEmotion` no front; emoção real entra.
4. Caminhos sem LLM (saudação, erro, filler) com emoção fixa; ajuste fino de cor e boca no `speaking`.

## Riscos

- **Modelo esquece a tag.** O fallback cobre, mas a emoção pode ficar monótona se o Groq ignorar o prompt. Plano B, só se os testes mostrarem necessidade: pedir a emoção como campo separado em JSON.
- **Legibilidade das 9 expressões com ~320 pontos** exige ajuste visual; por isso o passo 1 é o preview.

## Fora de escopo

Reagir ao tom do usuário, amplitude real do áudio na boca, acessórios, animação de corpo.

## Desvios da implementação (registrados depois da revisão)

- **Glow central:** o núcleo branco que ficava no meio da esfera foi removido, porque cobria o espaço entre os olhos. O brilho de fundo (glow ambiente) e os anéis continuam.
- **Emoção passada como argumento da fala:** `speak(text, onDone, gate, emotion)` define a emoção junto com o modo `speaking`, em vez de um `setEmotion` antes do `await`. Isso evita que um timer ou outra fala troque o rosto no meio do caminho.
- **Boca sincronizada com o áudio:** o Orb recebe `talking`, ligado no início real da voz (`onplaying`/`onstart`) e desligado no fim. Durante o fetch e o prebuffer do TTS a boca fica parada.
- **Resposta sem texto:** se depois de tirar a tag não sobra nada para falar, o fluxo segue sem entrar em `speaking`.
- **Filler:** não ganhou emoção própria; o rosto de `thinking` já é o pensativo.
- **`prefers-reduced-motion`:** desliga tremor, piscar, deriva do olhar, respiração, explosão ao voltar para `wake` e giro da poeira. A boca continua mexendo enquanto ele fala, porque comunica a fala.
