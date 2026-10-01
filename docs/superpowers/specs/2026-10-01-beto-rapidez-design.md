# Beto mais rápido, mais barato e mais confiável — design

Data: 2026-10-01. Origem: brainstorm `docs/superpowers/brainstorms/2026-10-01-beto-features.md` e pedido "faça todas as 6".

## Objetivo

Reduzir o tempo até o Beto começar a falar, gastar menos da cota da voz e deixar de falhar em silêncio, sem mudar a personalidade nem o que ele já sabe fazer.

## Escopo desta rodada

1. **Telemetria mínima:** tempos e modelo por resposta, sem o texto da conversa.
2. **Streaming da resposta + voz por frase.**
3. **Roteador de intenção:** prompt curto para conversa, completo para ações.
4. **Respostas mais curtas por padrão + indicador da cota da ElevenLabs.**
5. **Verificador de modelos da Groq** (cron diário) e memória de modelo morto.
6. **Item "depois" decomposto:** nesta rodada entra só a **entrada por texto**. O resto (ferramentas nativas, Calendar e Gmail que agem, pesquisa na web, briefing automático, atalho do Siri, memória semântica) fica para rodadas próprias: dependem de chaves externas ou de decisões sobre o que o Beto pode fazer sozinho.

## Decisões

### 1. Telemetria
- O servidor escreve uma linha JSON por resposta em `console.log` com prefixo `[beto-metrics]`: `{evt:"chat", mode, stream, model, ctx_ms, ttft_ms, total_ms, chars, retried}`. Nada de texto de conversa.
- O navegador manda `sendBeacon("/api/metrics", {evt:"ttfa", ms, via})` quando o primeiro áudio de uma resposta começa a tocar. `ms` é o tempo desde o fim da fala do usuário. `via` é `stream`, `full` ou `greeting`.
- `/api/metrics` valida e só aceita números e valores de uma lista fixa; atrás do login (middleware).

### 2. Streaming + voz por frase
- `POST /api/chat` com `{messages, stream:true}` responde `text/plain` em pedaços (só o texto do modelo). Sem `stream`, o comportamento atual continua igual (JSON).
- `groqChatStream` mantém a mesma lista de modelos e a troca de modelo, mas só troca **antes do primeiro token**.
- Cliente: `ReplyStream` (função pura, testada) lê os pedaços e decide:
  - tags de emoção `[emo:X]` do início viram o rosto e saem do texto;
  - se o começo for tag de ação (`[SPOTIFY:…]` etc.) ou `[NEEDTOOLS]`, **segura tudo** e usa o caminho antigo com o texto completo;
  - se for conversa, corta em frases e entrega cada uma assim que fecha. A primeira frase pode fechar numa vírgula se passar de ~70 caracteres.
- Fila de voz: cada frase pede `/api/tts` (só a primeira com `lead`), no máximo 2 pedidos ao mesmo tempo (a ElevenLabs gratuita limita concorrência), e toca em ordem.
- Falha do TTS numa frase: o texto fica na tela pelo tempo de ler e a fila segue (mesma regra de "uma voz só").
- O streaming só roda quando o pedido não parece registro/ação (`needsTools`), para não perder a rede de proteção do "disse que anotou sem a tag". Qualquer erro antes do primeiro token cai no caminho antigo.

### 3. Roteador de intenção
- `lib/intent.ts`: `needsTools(messages)` conservador. Só devolve `false` (conversa) se a última fala do usuário não casa com nenhuma palavra de integração, a fala anterior do Beto não ofereceu nada ("quer que eu…") e há pelo menos 3 palavras. Na dúvida, `true` (prompt completo).
- `lib/prompt.ts`: o prompt vira `core` (personalidade, tamanho, tom, horário, honestidade, voz, emoção) + `tools` (regra de tags e blocos de integração + contexto do My Hub). Modo `chat` leva só o `core` e uma linha: se o chefe pedir uma ação, responder somente `[NEEDTOOLS]`.
- Se o modelo responder `[NEEDTOOLS]`, o servidor refaz a chamada com o prompt completo (uma ida extra só nesses casos). O cliente nunca vê `[NEEDTOOLS]`.
- O modo `chat` também pula a busca do My Hub.

### 4. Curto por padrão + cota da voz
- O trecho TAMANHO do prompt passa a pedir respostas técnicas de 30 a 80 palavras (antes 50 a 150), com "quer que eu detalhe?" no fim quando houver mais a dizer. Bate-papo continua em 1 a 3 frases.
- `GET /api/tts/quota` lê a assinatura da ElevenLabs e devolve `{remainingPct, used, limit, resetUnix}` (ou `{unavailable:true}` se a chave não tiver permissão). O Beto mostra um texto discreto no canto só quando restar 25% ou menos, ou quando acabar.

### 5. Modelos da Groq
- `lib/groq.ts` lembra por 6 horas, na instância, o modelo que respondeu 404 e não tenta de novo.
- `GET /api/cron/models` (mesmo `CRON_SECRET` dos avisos) compara a lista `PREFERRED` com os modelos disponíveis, registra os mortos nos logs e manda push se sobrarem menos de 3. Workflow diário no GitHub Actions.

### 6. Entrada por texto
- Botão discreto "digitar" abre uma linha de texto; enviar chama o mesmo `sendToJarvis`. Em turno digitado o Beto não reabre o microfone depois de falar.

## Fora de escopo e riscos

- Sem teste de voz real em produção: o ambiente local não tem `GROQ_API_KEY` nem `ELEVENLABS_API_KEY`. A validação usa um servidor falso compatível com a Groq e um falso da ElevenLabs.
- O streaming por frase pode soar com pausas curtas entre frases. Se incomodar, o ajuste é aumentar o tamanho mínimo da frase.
- Rodadas futuras: ferramentas nativas, Calendar completo, Gmail com rascunho e confirmação, pesquisa na web (precisa de chave de busca), briefing automático por push, atalho do Siri, memória semântica, troca de autenticação (passkey).

## Rulings

- Sem documento de plano separado: o usuário delegou a execução; as tarefas estão na ordem acima e cada uma é implementada com teste primeiro quando é função pura.
- Item 6 reduzido à entrada por texto (motivo acima).
