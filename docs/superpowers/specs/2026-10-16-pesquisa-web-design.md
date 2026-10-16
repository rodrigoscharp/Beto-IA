# Pesquisa na web: design

Data: 2026-10-16. Primeira das três funcionalidades "Jarvis" escolhidas (pesquisa na web, lembretes e rotinas,
controle do Mac com visão de tela), nesta ordem. Cada uma tem spec própria.

## O problema

O Beto não sabe nada que aconteceu depois do treino do modelo: notícia, cotação, placar, preço, versão nova de uma
biblioteca, previsão do tempo fora do briefing. Hoje a regra HONESTIDADE do prompt manda ele dizer que não consegue
ver isso. É a maior lacuna de conhecimento numa conversa do dia a dia.

## A decisão

Usar a ferramenta embutida **`browser_search`** da Groq (busca da Exa, executada no servidor da Groq), disponível nos
modelos `openai/gpt-oss-120b` e `openai/gpt-oss-20b` ([docs](https://console.groq.com/docs/browser-search)). O
`gpt-oss-120b` já é o primeiro modelo da fila do Beto, então não há chave nem provedor novos.

Alternativa descartada: `groq/compound-mini`, descontinuado pela Groq em 21/09/2026.

A busca é ligada **por intenção**, decidida pelo roteador, como as outras ferramentas: só os turnos que pedem coisa
atual pagam a busca e a latência dela.

### O que ainda não se sabe (e como a primeira tarefa resolve)

A documentação não diz o preço por busca, se a busca existe no plano da conta, se funciona em stream nem se convive com
ferramentas próprias (function tools) na mesma chamada. O design não depende das três últimas: o turno de web é
separado, sem stream e sem ferramentas próprias. A primeira tarefa é uma sondagem com a chave real que confirma o
básico (a busca responde, formato e latência) antes de qualquer código de produção.

## Fora do escopo

Busca junto com agenda, My Hub, memória ou conteúdo no mesmo turno; busca em segundo plano; abrir e ler uma página
inteira; busca no modo conversa decidida pelo modelo.

## Componentes

### 1. Sondagem (`scripts/web-probe.mjs`)

Script de linha de comando, fora da suíte de testes, rodado pelo Rodrigo uma vez:

```
GROQ_API_KEY=... node scripts/web-probe.mjs "cotação do dólar hoje"
```

Faz quatro chamadas e imprime, para cada uma, status, latência em ms, os primeiros 600 caracteres de
`message.content` e as chaves de topo de `message` (para ver se há campo de fontes):

1. `gpt-oss-120b`, `tools: [{"type": "browser_search"}]`, `tool_choice: "required"`, `reasoning_effort: "low"`,
   sem stream.
2. O mesmo com `gpt-oss-20b`.
3. O mesmo do item 1 com `stream: true` (imprime se chegaram pedaços de texto).
4. O mesmo do item 1 com uma function tool fictícia junto (`noop`), `tool_choice: "auto"` (imprime se a busca
   continua acontecendo).

O resultado vai, colado pelo Rodrigo ou resumido, para uma seção "Resultado da sondagem" no fim do plano. Se a chamada
1 falhar por plano ou permissão, o projeto para aqui e volta para o Rodrigo.

### 2. Roteamento

**`wantsWeb(messages: ChatMsg[]): boolean`** em `lib/intent.ts`. Olha só a última fala do usuário, normalizada como
as outras funções do arquivo (minúscula, sem acento). Conservadora: na dúvida, `false`.

Dispara com qualquer um destes:

- **Pedido explícito:** `pesquisa`, `pesquise`, `pesquisar`, `procura na internet`, `procura na web`, `busca na
  internet`, `busca na web`, `busca no google`, `da um google`, `ve na internet`, `olha na internet`.
- **Notícia:** `noticia(s)`, `manchete(s)`, `o que aconteceu (hoje|ontem|essa semana) (no|na|com)`, `o que saiu sobre`,
  `alguma novidade sobre`.
- **Mercado:** `cotacao`, `quanto (ta|esta|ficou|fechou) o (dolar|euro|bitcoin|ibovespa|real)`, `preco (do|da) (bitcoin|
  acao|acoes|gasolina)`, `bolsa hoje`.
- **Esporte:** `placar`, `quanto (foi|ficou|ta|esta) o jogo`, `resultado do jogo`, `quem ganhou o jogo`, `tabela do
  brasileirao`, `classificacao do`.
- **Versões e lançamentos:** `ultima versao (do|da|de)`, `versao mais recente`, `ja lancou`, `quando lanca`, `ja saiu (o|a) (novo|nova)`.
- **Tempo:** `previsao do tempo`, `vai chover`, `temperatura (hoje|amanha|agora) em`.

Não dispara (cada um vira teste de falso positivo):

- `quanto custa fazer um mvp` (opinião), `gastei 10 dolares no uber` (My Hub), `qual a minha agenda de hoje` (agenda),
  `o que aconteceu com o meu deploy` (GitHub), `lembra que eu prefiro reuniao a tarde` (memória), `saiu o deploy?`
  (GitHub), `o que voce acha do dolar alto pra quem exporta` (opinião, sem pedido de valor atual).
- Uma fala com menos de duas palavras nunca dispara.

Caso aceito de propósito: "me conta uma notícia boa" dispara (notícia é gatilho), e o Beto pesquisa uma notícia boa do
dia.

**`TurnPlan` ganha `web?: true`** em `lib/turnplan.ts` (só presente quando o turno é de pesquisa, para não mudar a
forma dos planos de hoje), e `TurnEnv` ganha `web?: boolean` (busca ligada no servidor; ausente = desligada, o que
mantém a bateria de avaliação sem busca). Regra: web quando `env.web && wantsWeb(messages)` e nenhum dos conjuntos de
ferramentas foi pedido. Nesse caso o plano é `{ mode: "full", sets: null, web: true }`. `ToolSets` não muda, então o caminho de ferramentas
e a rede de proteção que liga "todas" (`all`, `everything`) não são afetados.

**Liga e desliga:** a busca fica desligada por padrão e só liga com `WEB_SEARCH=on` (a rota passa `web: process.env.WEB_SEARCH === "on"`), até a sondagem confirmar que ela funciona na conta. O prompt só fala da pesquisa automática quando ela está ligada; desligada, HONESTIDADE mantém a frase antiga. A pesquisa inteira tem prazo único de 40 s (até 30 s por modelo; o segundo só é tentado se sobrarem 8 s).

### 3. Chamada (`lib/web.ts`)

```ts
export const WEB_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
export function cleanCitations(text: string): string;
export function webGuide(): string;
export async function webAnswer(apiKey: string, system: string, messages: ChatMsg[]): Promise<WebResult>;
export interface WebResult { text: string; model: string | null; ok: boolean }
```

- `cleanCitations` é pura: tira os marcadores `【...】` (por exemplo `【2†L6-L10】`), qualquer URL (`http://` ou
  `https://`), e junta espaços repetidos que sobrarem. Não mexe na tag `[emo:X]`.
- `webGuide()` devolve o bloco de prompt da pesquisa, em português, com estas regras: você acabou de pesquisar na web;
  responda falando, no tamanho das regras de TAMANHO; cite a fonte pelo nome do site ou do veículo ("segundo o g1"),
  nunca pela URL; quando a data importar (cotação, placar, notícia), diga de quando é; se a busca não trouxe nada
  confiável, diga isso em uma frase e não invente; nunca leia marcadores de citação.
- `webAnswer` tenta os modelos de `WEB_MODELS` em ordem, com `groqCompleteOn` (sem a fila de reserva geral, porque só
  esses dois têm a ferramenta), com `tools: [{"type": "browser_search"}]`, `tool_choice: "required"`,
  `reasoning_effort: "low"`, `temperature: 0.3`, `max_tokens: 900` e `messages: [system, ...messages]`. Devolve o
  texto passado por `cleanCitations`. Se os dois falharem ou vierem vazios, devolve
  `{ text: "[emo:triste] Não consegui pesquisar agora. Tenta de novo daqui a pouco.", model: null, ok: false }` e
  registra o erro no console com `[Beto API] web:`.

O `system` é o prompt completo do Beto (`promptFor("full", ...)`, sem ferramentas) mais `webGuide()`. Assim a
pesquisa sai com a mesma personalidade, regra de voz e tag de emoção.

### 4. Rota (`app/api/chat/route.ts`)

O turno de web é tratado antes de `plan.sets` nos três caminhos:

- **NDJSON (serviço de voz):** `write({ ack: "web" })`, depois `webAnswer`, depois `write({ t: text })`. A meta leva
  `mode: "full"`.
- **Stream de texto do navegador (`stream === true`):** devolve a resposta inteira como um único pedaço do mesmo
  formato de stream, com o cabeçalho `x-beto-mode: full`.
- **JSON:** `reply = text`.

Nos três, a métrica `[beto-metrics]` leva `tools: ["browser_search"]` quando `ok`, ou `["browser_search:erro"]`.

### 5. Ack de pesquisa

- `lib/ack.ts`: `AckKind` ganha `"web"`. `ackKind` não muda (web não é um `ToolSets`); a rota manda `"web"` direto.
- `lib/voicewire.ts`: `parseLine` aceita `"web"`.
- `voice/beto_voice/config.py`: `AckCfg` ganha `web: list[str]` com padrão `["Deixa eu pesquisar.", "Vou dar uma
  olhada."]`, com a mesma validação de lista não vazia. `voice/beto-voice.toml` ganha `web` em `[ack]`. O áudio entra
  no mesmo `prewarm`.

### 6. Prompt

Na regra HONESTIDADE de `lib/prompt.ts`, a frase sobre não ter internet passa a dizer: a pesquisa na web acontece
automaticamente quando ele pede notícia, cotação, placar, preço, versão ou previsão do tempo, ou fala "pesquisa"; se ele
perguntar algo atual e não houver resultado de pesquisa nesta conversa, diga que não pesquisou e sugira que ele peça
"pesquisa" seguido do assunto; nunca invente dado atual.

## Testes

- `scripts/intent.test.mjs`: `wantsWeb` com pelo menos dois exemplos de cada grupo que dispara e todos os falsos
  positivos listados acima.
- `scripts/turnplan.test.mjs`: web sozinho dá `{ mode: "full", sets: null, web: true }`; web com agenda pedida não
  tem `web` e tem os `sets` da agenda; `env.web` falso ou ausente nunca liga web; conversa comum continua
  `{ mode: "chat", sets: null }`.
- `scripts/web.test.mjs`: `cleanCitations` (marcador, vários marcadores, URL, espaço duplo, tag de emoção intacta);
  `webGuide` cita fonte e proíbe inventar; `webAnswer` com um cliente falso: primeiro modelo responde, primeiro falha e
  o segundo responde, os dois falham e vem o texto de erro com `ok: false`. (Para isso, `webAnswer` recebe a função de
  chamada por parâmetro opcional; o padrão é `groqCompleteOn`.)
- `scripts/voicewire.test.mjs` e `scripts/ack.test.mjs`: `"web"` aceito.
- `voice/tests/test_config.py`: `[ack].web` com padrão e validação.
- `scripts/prompt.test.mjs`: HONESTIDADE menciona a pesquisa automática e a sugestão de pedir "pesquisa".
- Bateria (`evals/cases.json`): cinco casos de conversa que lembram busca mas não são ("quanto custa fazer um app?",
  "o que você acha do dólar alto pra quem exporta?") esperando `nenhumaFerramenta`. A bateria não chama a busca de
  verdade.

## Ordem

1. Sondagem com a chave (Rodrigo roda). Se a busca não funcionar na conta, para aqui.
2. Roteamento (`wantsWeb`, `TurnPlan.web`).
3. `lib/web.ts`.
4. Ack `web` (TS e voz) e prompt.
5. Rota nos três caminhos.
6. Ensaio: cinco perguntas atuais por voz, olhando a fonte citada, o ack e as métricas.
