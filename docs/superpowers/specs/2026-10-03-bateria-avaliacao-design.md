# Bateria de avaliação de fala

Spec de 2026-10-03. Item 1 de `docs/superpowers/brainstorms/2026-10-03-beto-proximos-passos.md`, com o escopo revisto.

## Por que

Cerca de 15 dos últimos 40 commits são `fix:` de frase mal interpretada (falso positivo do My Hub, confirmação presa, memória, "terminei o treino virou check-in"). Os testes que existem (`scripts/intent.test.mjs` e os testes de ferramentas) cobrem as regex do roteador e as travas do servidor. Nada testa o **modelo de verdade** com o prompt e as ferramentas de produção. A bateria preenche essa lacuna e mostra qual modelo da lista `PREFERRED` acerta mais.

A ideia original, "modelo por tipo de turno", foi descartada. O primeiro modelo da lista já é o `openai/gpt-oss-120b`. O risco real é cair em silêncio para um modelo pior quando o 120b falha, e o placar por modelo responde a isso.

## Resultado esperado

- `npm run eval` mostra a nota do modelo principal por área e a lista dos casos reprovados, com o motivo.
- `npm run eval -- --all` mostra o placar de todos os modelos.
- Toda noite, um GitHub Action roda a bateria. Se a nota cair mais de 5 pontos abaixo do baseline, o job falha e chega um push.
- Cada bug de interpretação corrigido daqui em diante ganha um caso novo.

## Restrições

- Plano gratuito da Groq: uma chamada por vez, com intervalo entre elas.
- O repositório é público: os fixtures não podem ter dado pessoal real.
- Nada é executado de verdade: nenhuma escrita em agenda, My Hub ou memória.

## Fora do escopo

Laço de ferramentas com vários passos, travas do servidor (já têm testes determinísticos), streaming, painel web, histórico de notas e execução em cada PR.

---

## Arquitetura

### 1. `lib/turnplan.ts` (novo, puro)

```ts
export interface TurnEnv { myhubWrite: boolean; memory: boolean }
export interface ToolSets { calendar: boolean; myhub: boolean; memory: boolean }
export interface TurnPlan { mode: "chat" | "full"; sets: ToolSets | null }
export function planTurn(messages: ChatMsg[], env: TurnEnv, forceFull = false): TurnPlan
```

A função contém exatamente a decisão que hoje está no `POST` de `app/api/chat/route.ts`:
- `mode = forceFull || needsTools(messages) ? "full" : "chat"`;
- `wanted = { calendar: wantsCalendar, myhub: env.myhubWrite && (wantsMyHubWrite || wantsMyHubUndo), memory: env.memory && (wantsMemory || wantsMemoryTopic) }`;
- `sets` recebe `wanted` quando `mode === "full"` e algum conjunto está ligado; caso contrário, recebe `null` (caminho sem ferramentas).

A rota passa a usar `planTurn` sem mudar o comportamento. `ToolSets` sai da rota e vai para esse arquivo.

### 2. `groqCompleteOn` em `lib/groq.ts`

```ts
export async function groqCompleteOn(apiKey: string, model: string, params: ChatParams): Promise<CompleteResult>
```

Usa um modelo fixo: sem reserva, sem cooldown e sem mexer em `working`. Aplica o mesmo `fastFor` e a mesma limpeza de `<think>` que o `groqComplete`. Erros são repassados, com `status` e cabeçalhos, para o executor tratar o 429. Uma resposta vazia não conta como erro aqui: o executor reprova o caso.

### 3. Executor (`scripts/eval/`)

- `run.mjs`: ponto de entrada, que lê os argumentos, o `.env.local` e os casos, chama o modelo e imprime e grava o resultado.
- `match.mjs`: o comparador puro (expectativa contra resultado), testável sem rede.
- `context.mjs`: monta o system prompt de cada caso a partir dos fixtures.

Para cada caso:
1. `planTurn(conversa, { myhubWrite: true, memory: true })`.
2. System prompt com `buildSystemPrompt(...)` e `myHubPromptBlock(...)`, usando data, hora, memórias e My Hub de `evals/fixtures.json`. O modo e as flags `calendar`, `memory` e `myhub` seguem o plano, como a função `promptFor` da rota.
3. Se `sets` existir, chama `groqCompleteOn` com as ferramentas do plano (`CALENDAR_TOOLS`, `MYHUB_TOOLS`, `MEMORY_TOOLS`), `tool_choice: "auto"`, `temperature: 0.3` e `max_tokens: 700`, como em produção. Se não existir, chama sem ferramentas, com `temperature: 0.7`, como no caminho de conversa.
4. O resultado é `{ toolCalls: [{ name, args }], text, needTools: detectNeedTools(text) === "yes" }`, com os argumentos já lidos do JSON. Argumento com JSON inválido conta como `args: null`.
5. `match(espera, resultado)` devolve `{ ok, motivo }`.

**Ritmo:** uma chamada por vez, com `EVAL_GAP_MS` entre as chamadas (padrão de 2500). Em 429, espera `retry-after` (ou 10 s, se o cabeçalho não vier) e tenta de novo até 3 vezes. Outro erro de rede ou da Groq marca o caso como `erro`, que não é reprovação. Se mais de 20% dos casos derem `erro`, a execução vale como **não rodou**.

### 4. Casos (`evals/cases.json`)

Um array de casos:

```json
{
  "id": "hub-treino-nao-e-checkin",
  "area": "myhub",
  "origem": "e33a9c7",
  "conversa": [{ "role": "user", "content": "terminei o treino de academia" }],
  "espera": { "ferramenta": "my_hub_register", "args": { "acao": "registrarHabito" } },
  "nunca": ["memory_save"],
  "repete": 1
}
```

- `area` é uma de: `agenda`, `myhub`, `memoria`, `spotify`, `timer`, `conversa`, `confirmacao`.
- `espera` tem exatamente um destes formatos:
  - `{ "ferramenta": nome, "args"?: {...} }`: o modelo chamou essa ferramenta. Se houver várias chamadas, basta uma bater. Em `args`, cada chave é um caminho com ponto (`"entrada.valor"`), e o valor é um texto exato, um texto `"/regex/flags"`, um número exato ou `{ "min", "max" }`. Argumentos não citados são ignorados.
  - `{ "nenhumaFerramenta": true }`: nenhuma ferramenta, sem `[NEEDTOOLS]` e com texto não vazio.
  - `{ "needTools": true }`: o texto começa com `[NEEDTOOLS]` (aceita `[emo:X]` antes).
  - `{ "tag": "SPOTIFY" | "TIMER" | ..., "conteudo"?: "/regex/" }`: o texto contém `[TAG:...]`.
- `nunca` (opcional): ferramentas que reprovam o caso se forem chamadas.
- `repete` (opcional, padrão 1, máximo 3): o caso conta pela maioria das tentativas. Use só em casos instáveis.
- `origem` (opcional): o commit ou o motivo do caso.

**Bateria inicial: cerca de 120 casos.**
- Pelo menos um por `fix:` de interpretação do histórico do git.
- Uma amostra das frases de `scripts/intent.test.mjs`.
- Uns 20 de conversa pura, sem ferramenta.
- Casos de várias mensagens para as confirmações (o assistente pergunta, e o usuário responde "pode").

### 5. Fixtures (`evals/fixtures.json`)

- `agora`: `{ "date": "2026-10-01", "dateLabel": "quinta-feira, 1 de outubro de 2026", "time": "10:00", "period": "manhã" }` (os campos de `BrasiliaTime`).
- `memorias`: cerca de 5 memórias fictícias.
- `myhub`: um `MyHubContext` com o catálogo de ações (`acoes`) e as referências (contas e categorias) copiados da estrutura real e **anonimizados**. Ele é gerado uma vez por `scripts/eval/snapshot-myhub.mjs` (usa `MYHUB_URL` e `MYHUB_SERVICE_TOKEN` do `.env.local`), revisado à mão e só depois commitado. O snapshot cru fica em `evals/out/` (fora do git).

### 6. Nota e baseline

- Por caso: `ok`, `falhou` (com motivo) ou `erro`.
- Por área e no total: aprovados ÷ (aprovados + reprovados). Casos com `erro` ficam fora da conta.
- `evals/baseline.json`: `{ "<modelo>": { "total": 0.92, "areas": {...}, "casos": 118, "data": "..." } }`.
- `--update-baseline` grava a nota do modelo que acabou de rodar.
- **Queda:** o total fica mais de 5 pontos percentuais abaixo do baseline do mesmo modelo. Sem baseline, não há queda.

### 7. Linha de comando

| Comando | O que faz |
|---|---|
| `npm run eval` | Roda no primeiro modelo de `PREFERRED` (ignora `GROQ_MODEL` vazio). |
| `npm run eval -- --model <id>` | Roda em um modelo específico. |
| `npm run eval -- --all` | Roda em todos os modelos de `PREFERRED`, um depois do outro, e mostra o placar (nota e tempo médio por chamada). |
| `npm run eval -- --only <prefixo>` | Filtra os casos pelo prefixo do id. |
| `npm run eval -- --update-baseline` | Grava o baseline do modelo que rodou. |
| `npm run eval -- --ci` | Mesmo que o padrão, mais o código de saída: 0 sem queda, 1 com queda, 2 quando não rodou. |

O relatório completo vai para `evals/out/<data>-<modelo>.json`. A pasta `evals/out/` entra no `.gitignore`.

### 8. Noite (`.github/workflows/eval-nightly.yml`)

- Roda com `cron: "0 6 * * *"` (3h em Brasília) e com `workflow_dispatch`.
- Passos: checkout, Node 24, `npm ci`, `npm run eval -- --ci` com o secret `GROQ_API_KEY`.
- Sobe o relatório como artifact.
- Se o código de saída for 1 ou 2, chama `POST https://betoia.vercel.app/api/cron/eval-report` com `Authorization: Bearer CRON_SECRET` e o corpo `{ status: "queda" | "nao_rodou", total, baseline, piorArea }`, só com números e nomes de área. O job falha nos dois casos.

### 9. `app/api/cron/eval-report/route.ts` (novo)

- Protegida por `cronAuthorized`.
- Valida o corpo: `status` só aceita os dois valores; `total` e `baseline` são números entre 0 e 1; `piorArea` vem de uma lista fixa de áreas.
- Manda push com `sendToAll`:
  - queda: "Beto: nota caiu de 92% para 81% (pior área: agenda)";
  - não rodou: "Beto: a avaliação noturna não rodou (Groq fora ou sem cota)".
- Responde 400 se o corpo for inválido.

## Testes (sem rede, no `npm test`)

- `scripts/turnplan.test.mjs`: as decisões de `planTurn` para conversa, para cada integração, para `forceFull` e para My Hub ou memória desligados.
- `scripts/evalmatch.test.mjs`: o comparador (ferramenta e argumentos, regex, intervalo, caminho com ponto, várias chamadas, `nunca`, `nenhumaFerramenta`, `needTools` com emoção antes, `tag`, `repete` pela maioria, JSON inválido).
- `scripts/evalcases.test.mjs`: o formato de `evals/cases.json` (ids únicos, `area` válida, `espera` com exatamente um formato, regex que compilam, ferramentas que existem nas definições reais).
- `scripts/evalrun.test.mjs`: o executor contra um servidor falso local (via `GROQ_BASE_URL`): 429 com `retry-after` e nova tentativa, erro que vira `erro`, mais de 20% de erros vira "não rodou", e os códigos de saída do `--ci`.
- `scripts/evalreport.test.mjs`: a validação do corpo da rota de relatório (função pura exportada de `lib/ops.ts`).

## O que você precisa fazer

1. Cadastrar o secret `GROQ_API_KEY` no GitHub (o `CRON_SECRET` já existe).
2. Revisar o snapshot anonimizado do My Hub antes do commit.
3. Rodar a primeira vez e aceitar o baseline (`--update-baseline`).
