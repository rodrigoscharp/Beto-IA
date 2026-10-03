# Bateria de avaliação de fala: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a bateria manda frases reais ao modelo da Groq, com o prompt e as ferramentas de produção, e dá uma nota de acerto por modelo e por área. Roda no computador e toda noite no GitHub Actions, com push quando a nota cai.

**Architecture:** a decisão de rota sai do `POST` de `/api/chat` e vira a função pura `planTurn`, que a rota e a bateria passam a compartilhar. O executor em `scripts/eval/` monta o pedido exatamente como a rota monta, faz uma chamada por caso com `groqCompleteOn` (modelo fixo, sem reserva) e compara a resposta com o esperado em `evals/cases.json`. Nenhuma ferramenta é executada.

**Tech Stack:** Next.js 14, TypeScript, `groq-sdk` 0.7, testes em `node:test` com `scripts/register-ts.mjs` (Node 24, type stripping), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-03-bateria-avaliacao-design.md`

## Global Constraints

- Plano gratuito da Groq: uma chamada por vez, com `EVAL_GAP_MS` entre elas (padrão de 2500), e até 3 novas tentativas em 429, respeitando `retry-after` (10 s se o cabeçalho não vier).
- Queda: total mais de 5 pontos percentuais abaixo do baseline do mesmo modelo.
- "Não rodou": mais de 20% dos casos com `erro`.
- Códigos de saída do `--ci`: 0 sem queda, 1 com queda, 2 quando não rodou.
- Repositório público: nenhum dado pessoal real em `evals/`. O snapshot cru fica em `evals/out/`, que está no `.gitignore`.
- Nenhuma escrita real em agenda, My Hub ou memória.
- O comportamento da rota `/api/chat` não muda.
- Áreas válidas: `agenda`, `myhub`, `memoria`, `spotify`, `timer`, `email`, `github`, `briefing`, `conversa`, `confirmacao`. A spec citava 7; `email`, `github` e `briefing` entram porque o prompt tem essas tags.
- Comentários e textos em português, no estilo do código ao redor.

## Review Focus

1. **Modelo que devolve argumentos com JSON inválido:** conta como `args: null` e reprova só quando o caso confere argumentos. Teste na Task 3.
2. **Valor numérico vindo como texto (`"35"`):** `{min,max}` e o número exato aceitam texto numérico, e `""` e `null` nunca batem. Teste na Task 3.
3. **Tag de emoção antes de `[NEEDTOOLS]` ou de uma tag de ação:** precisa ser reconhecida. Teste na Task 3.
4. **Groq fora do ar a noite inteira:** vira "não rodou" (código 2), não queda (código 1). Teste na Task 5.
5. **Corpo forjado ou estranho na rota de relatório:** responde 400, sem texto livre no push. Teste na Task 7.

---

## Estrutura de arquivos

| Arquivo | Papel |
|---|---|
| `lib/turnplan.ts` (novo) | `planTurn`: modo e conjunto de ferramentas do turno. Puro. |
| `app/api/chat/route.ts` (alterado) | Passa a usar `planTurn`. |
| `lib/groq.ts` (alterado) | `groqCompleteOn` com modelo fixo e `parseCompletion` compartilhado. |
| `lib/ops.ts` (alterado) | `EVAL_AREAS` e `validEvalReport`. |
| `scripts/eval/match.mjs` (novo) | Comparador, nota, queda e validação dos casos. Puro. |
| `scripts/eval/context.mjs` (novo) | Monta o pedido à Groq de um caso. Puro. |
| `scripts/eval/run.mjs` (novo) | Executor, CLI, relatório e baseline. |
| `scripts/eval/snapshot-myhub.mjs` (novo) | Baixa o contexto real do My Hub para anonimizar. |
| `evals/cases.json`, `evals/fixtures.json`, `evals/baseline.json` (novos) | Dados da bateria. |
| `app/api/cron/eval-report/route.ts` (novo) | Push quando a noite reprova. |
| `.github/workflows/eval-nightly.yml` (novo) | Execução noturna. |
| `scripts/turnplan.test.mjs`, `groqon.test.mjs`, `evalmatch.test.mjs`, `evalcontext.test.mjs`, `evalrun.test.mjs`, `evalcases.test.mjs`, `evalreport.test.mjs` (novos) | Testes. |

---

### Task 1: `planTurn` e a rota passando a usá-lo

**Files:**
- Create: `lib/turnplan.ts`
- Modify: `app/api/chat/route.ts` (o tipo `ToolSets` perto da linha 36; o bloco `mode` e `wanted` no `POST`, linhas 237 e 284 a 299)
- Test: `scripts/turnplan.test.mjs`

**Interfaces:**
- Produces: `planTurn(messages: ChatMsg[], env: TurnEnv, forceFull?: boolean): TurnPlan`, `TurnEnv { myhubWrite: boolean; memory: boolean }`, `ToolSets { calendar: boolean; myhub: boolean; memory: boolean }`, `TurnPlan { mode: "chat" | "full"; sets: ToolSets | null }`.

- [ ] **Step 1: Write the failing test** `scripts/turnplan.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { planTurn } from "../lib/turnplan.ts";

const u = (content) => ({ role: "user", content });
const a = (content) => ({ role: "assistant", content });
const ON = { myhubWrite: true, memory: true };

test("conversa solta: modo chat, sem ferramentas", () => {
  assert.deepEqual(planTurn([u("como você está hoje de manhã")], ON), { mode: "chat", sets: null });
});

test("agenda: modo completo com o conjunto de agenda", () => {
  const p = planTurn([u("marca reunião com o João amanhã às 15h")], ON);
  assert.equal(p.mode, "full");
  assert.equal(p.sets.calendar, true);
});

test("gasto: conjunto do My Hub só se a escrita estiver configurada", () => {
  assert.equal(planTurn([u("gastei 40 reais no mercado")], ON).sets.myhub, true);
  const off = planTurn([u("gastei 40 reais no mercado")], { myhubWrite: false, memory: true });
  assert.equal(off.mode, "full");
  assert.equal(off.sets?.myhub ?? false, false);
});

test("memória desligada não liga o conjunto de memória", () => {
  const p = planTurn([u("lembra que meu carro é um civic")], { myhubWrite: true, memory: false });
  assert.equal(p.sets?.memory ?? false, false);
});

test("pedido completo sem conjunto (música): modo completo, sem ferramentas nativas", () => {
  assert.deepEqual(planTurn([u("toca um rock aí")], ON), { mode: "full", sets: null });
});

test("forceFull força o modo completo mesmo em conversa", () => {
  assert.equal(planTurn([u("como você está hoje de manhã")], ON, true).mode, "full");
});

test("confirmação curta depois de pergunta de agenda segue no modo completo", () => {
  const p = planTurn([u("cancela a reunião de amanhã"), a("[emo:neutro] Cancelo a Reunião X de amanhã às 10h?"), u("pode")], ON);
  assert.equal(p.mode, "full");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test scripts/turnplan.test.mjs`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `lib/turnplan.ts`.

- [ ] **Step 3: Write `lib/turnplan.ts`**

```ts
/* Decisão de rota de um turno: modo do prompt (conversa ou completo) e quais ferramentas nativas vão junto.
   A rota /api/chat e a bateria de avaliação (scripts/eval) usam a MESMA função, para a bateria testar o que
   a produção faz. Pura: quem chama informa o que está configurado. */
import { needsTools, wantsCalendar, wantsMemory, wantsMemoryTopic, wantsMyHubUndo, wantsMyHubWrite, type ChatMsg } from "./intent";

export interface TurnEnv { myhubWrite: boolean; memory: boolean }
export interface ToolSets { calendar: boolean; myhub: boolean; memory: boolean }
export interface TurnPlan { mode: "chat" | "full"; sets: ToolSets | null }

export function planTurn(messages: ChatMsg[], env: TurnEnv, forceFull = false): TurnPlan {
  const mode = forceFull || needsTools(messages) ? "full" : "chat";
  const wanted: ToolSets = {
    calendar: wantsCalendar(messages),
    myhub: env.myhubWrite && (wantsMyHubWrite(messages) || wantsMyHubUndo(messages)),
    memory: env.memory && (wantsMemory(messages) || wantsMemoryTopic(messages)),
  };
  // `full` do cliente só força o prompt completo; não liga ferramentas por si.
  const any = wanted.calendar || wanted.myhub || wanted.memory;
  return { mode, sets: mode === "full" && any ? wanted : null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test scripts/turnplan.test.mjs`
Expected: PASS. Se o teste "gasto" ou "confirmação" falhar porque as regex do `intent` decidem diferente, ajuste o **teste** à decisão real do `intent` (a função só reorganiza o que já existe) e anote no commit.

- [ ] **Step 5: Use `planTurn` na rota**

Em `app/api/chat/route.ts`:
1. Troque `interface ToolSets { calendar: boolean; myhub: boolean; memory: boolean }` por `import { planTurn, type ToolSets } from "@/lib/turnplan";`, junto dos outros imports.
2. Tire `needsTools`, `wantsCalendar`, `wantsMemory` e `wantsMemoryTopic` do import de `@/lib/intent` **só se** não forem mais usados no arquivo. `wantsMemoryTopic` continua sendo usado em `replyWithTools`, então fica.
3. Troque a linha do `mode` por:

```ts
    const hubOn = myHubWriteConfigured();
    const plan = planTurn(messages, { myhubWrite: hubOn, memory: memoryConfigured() }, forceFull === true);
    const mode: PromptMode = plan.mode;
```

4. Mais abaixo, apague a linha `const hubOn = myHubWriteConfigured();` repetida e a linha `const wanted: ToolSets = {...}`. Troque `if (mode === "full" && (wanted.calendar || wanted.myhub || wanted.memory)) {` por `if (plan.sets) {` e `reply = await viaTools(wanted);` por `reply = await viaTools(plan.sets);`.

- [ ] **Step 6: Run full suite and type check**

Run: `npm test && npx tsc --noEmit`
Expected: todos passam, sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add lib/turnplan.ts scripts/turnplan.test.mjs app/api/chat/route.ts
git commit -m "refactor: decisão de rota do turno vira planTurn, compartilhada com a bateria"
```

---

### Task 2: `groqCompleteOn` (modelo fixo)

**Files:**
- Modify: `lib/groq.ts` (o `groqComplete`, perto da linha 133)
- Test: `scripts/groqon.test.mjs`

**Interfaces:**
- Produces: `groqCompleteOn(apiKey: string, model: string, params: ChatParams): Promise<CompleteResult>`. Repassa o erro do SDK sem tratar (`err.status`, `err.headers`). Resposta vazia **não** lança.

- [ ] **Step 1: Write the failing test** `scripts/groqon.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

function fakeGroq(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push(JSON.parse(body || "{}"));
        const { status = 200, json, headers = {} } = handler(seen.length);
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(json));
      });
    });
    srv.listen(0, () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() }));
  });
}

const completion = (message) => ({ id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", ...message } }] });

test("usa o modelo pedido, limpa <think> e devolve as ferramentas", async () => {
  const g = await fakeGroq(() => ({ json: completion({ content: "<think>hm</think> Oi", tool_calls: [{ id: "c1", type: "function", function: { name: "list_events", arguments: "{\"a\":1}" } }] }) }));
  process.env.GROQ_BASE_URL = g.url;
  const { groqCompleteOn } = await import("../lib/groq.ts");
  const r = await groqCompleteOn("k", "modelo-x", { messages: [{ role: "user", content: "oi" }] });
  g.close();
  assert.equal(g.seen[0].model, "modelo-x");
  assert.equal(r.content, "Oi");
  assert.deepEqual(r.toolCalls, [{ id: "c1", name: "list_events", arguments: "{\"a\":1}" }]);
  assert.equal(r.model, "modelo-x");
});

test("resposta vazia não lança", async () => {
  const g = await fakeGroq(() => ({ json: completion({ content: "" }) }));
  process.env.GROQ_BASE_URL = g.url;
  const { groqCompleteOn } = await import("../lib/groq.ts");
  const r = await groqCompleteOn("k", "m", { messages: [] });
  g.close();
  assert.deepEqual(r, { content: "", toolCalls: [], model: "m" });
});

test("429 é repassado com status e retry-after", async () => {
  const g = await fakeGroq(() => ({ status: 429, headers: { "retry-after": "7" }, json: { error: { message: "rate limit" } } }));
  process.env.GROQ_BASE_URL = g.url;
  const { groqCompleteOn } = await import("../lib/groq.ts");
  await assert.rejects(groqCompleteOn("k", "m", { messages: [] }), (e) => e.status === 429 && e.headers["retry-after"] === "7");
  g.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test scripts/groqon.test.mjs`
Expected: FAIL com `groqCompleteOn is not a function`.

- [ ] **Step 3: Implement in `lib/groq.ts`**

Troque o corpo do `groqComplete` para usar um `parseCompletion` comum e acrescente `groqCompleteOn` logo abaixo:

```ts
function parseCompletion(res: Groq.Chat.ChatCompletion, model: string): CompleteResult {
  const msg = res.choices[0]?.message;
  const content = (msg?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const toolCalls = (msg?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments ?? "" }));
  return { content, toolCalls, model };
}

export async function groqComplete(apiKey: string, params: ChatParams): Promise<CompleteResult> {
  return withModels(apiKey, async (groq, model) => {
    const res = await groq.chat.completions.create({ ...params, ...fastFor(model), model, stream: false } as never) as Groq.Chat.ChatCompletion;
    const r = parseCompletion(res, model);
    if (!r.content && r.toolCalls.length === 0) throw new Error(`O modelo ${model} não devolveu nada.`);
    working = model;
    return r;
  }, "tools");
}

/* Um modelo só, sem reserva nem cooldown e sem mexer no `working`: a bateria de avaliação precisa saber que
   AQUELE modelo respondeu. Erro (429 inclusive) volta para quem chamou. */
export async function groqCompleteOn(apiKey: string, model: string, params: ChatParams): Promise<CompleteResult> {
  const res = await newClient(apiKey).chat.completions.create({ ...params, ...fastFor(model), model, stream: false } as never) as Groq.Chat.ChatCompletion;
  return parseCompletion(res, model);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/groq.ts scripts/groqon.test.mjs
git commit -m "feat: groqCompleteOn chama um modelo fixo, sem reserva (para a bateria)"
```

---

### Task 3: comparador, nota e validação dos casos

**Files:**
- Modify: `lib/ops.ts` (acrescentar `EVAL_AREAS`)
- Create: `scripts/eval/match.mjs`
- Test: `scripts/evalmatch.test.mjs`

**Interfaces:**
- Consumes: `EVAL_AREAS` de `lib/ops.ts`.
- Produces:
  - `matchCase(caso, r) → { ok: boolean, motivo: string }`, onde `r = { toolCalls: { name, args }[], text: string, needTools: boolean }`;
  - `majority(results) → { ok, motivo }`;
  - `score(rows) → { total, areas, ok, falhou, erro, n }`, onde `rows = { id, area, status: "ok" | "falhou" | "erro" }[]`;
  - `isDrop(sc, base) → boolean`;
  - `notRun(sc) → boolean`;
  - `exitCode(sc, base) → 0 | 1 | 2`;
  - `validateCases(cases, toolNames) → string[]`.

- [ ] **Step 1: Add `EVAL_AREAS` to `lib/ops.ts`**

```ts
/** Áreas da bateria de avaliação (evals/cases.json). A rota de relatório só aceita estes nomes. */
export const EVAL_AREAS = ["agenda", "myhub", "memoria", "spotify", "timer", "email", "github", "briefing", "conversa", "confirmacao"] as const;
```

- [ ] **Step 2: Write the failing test** `scripts/evalmatch.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { matchCase, majority, score, isDrop, notRun, exitCode, validateCases } from "./eval/match.mjs";

const R = (o = {}) => ({ toolCalls: [], text: "", needTools: false, ...o });
const call = (name, args) => ({ name, args });

test("ferramenta certa sem conferir args", () => {
  assert.equal(matchCase({ espera: { ferramenta: "create_event" } }, R({ toolCalls: [call("create_event", {})] })).ok, true);
});

test("ferramenta errada explica o que veio", () => {
  const m = matchCase({ espera: { ferramenta: "my_hub_register" } }, R({ toolCalls: [call("memory_save", {})] }));
  assert.equal(m.ok, false);
  assert.match(m.motivo, /esperava my_hub_register, veio memory_save/);
});

test("args: exato, regex, intervalo e caminho com ponto", () => {
  const caso = { espera: { ferramenta: "my_hub_register", args: { acao: "registrarTransacao", "entrada.valor": { min: 39, max: 41 }, "entrada.descricao": "/mercado/i" } } };
  assert.equal(matchCase(caso, R({ toolCalls: [call("my_hub_register", { acao: "registrarTransacao", entrada: { valor: 40, descricao: "Mercado" } })] })).ok, true);
  assert.equal(matchCase(caso, R({ toolCalls: [call("my_hub_register", { acao: "registrarTransacao", entrada: { valor: 400, descricao: "Mercado" } })] })).ok, false);
});

test("número vindo como texto vale; vazio e null nunca batem", () => {
  const caso = { espera: { ferramenta: "x", args: { v: 35, w: { min: 1 } } } };
  assert.equal(matchCase(caso, R({ toolCalls: [call("x", { v: "35", w: "2" })] })).ok, true);
  assert.equal(matchCase(caso, R({ toolCalls: [call("x", { v: "", w: null })] })).ok, false);
});

test("args com JSON inválido (null) reprova só quando o caso confere args", () => {
  assert.equal(matchCase({ espera: { ferramenta: "x" } }, R({ toolCalls: [call("x", null)] })).ok, true);
  assert.equal(matchCase({ espera: { ferramenta: "x", args: { a: 1 } } }, R({ toolCalls: [call("x", null)] })).ok, false);
});

test("várias chamadas: basta uma bater", () => {
  const r = R({ toolCalls: [call("list_events", {}), call("create_event", { title: "Dentista" })] });
  assert.equal(matchCase({ espera: { ferramenta: "create_event", args: { title: "/dentista/i" } } }, r).ok, true);
});

test("nunca reprova mesmo com a esperada presente", () => {
  const r = R({ toolCalls: [call("my_hub_register", {}), call("memory_save", {})] });
  const m = matchCase({ espera: { ferramenta: "my_hub_register" }, nunca: ["memory_save"] }, r);
  assert.equal(m.ok, false);
  assert.match(m.motivo, /memory_save/);
});

test("nenhumaFerramenta: texto sim; ferramenta, NEEDTOOLS ou vazio não", () => {
  const caso = { espera: { nenhumaFerramenta: true } };
  assert.equal(matchCase(caso, R({ text: "[emo:alegre] Tudo certo!" })).ok, true);
  assert.equal(matchCase(caso, R({ text: "ok", toolCalls: [call("x", {})] })).ok, false);
  assert.equal(matchCase(caso, R({ text: "[NEEDTOOLS]", needTools: true })).ok, false);
  assert.equal(matchCase(caso, R({ text: "  " })).ok, false);
});

test("needTools", () => {
  assert.equal(matchCase({ espera: { needTools: true } }, R({ text: "[emo:neutro] [NEEDTOOLS]", needTools: true })).ok, true);
  assert.equal(matchCase({ espera: { needTools: true } }, R({ text: "Claro!" })).ok, false);
});

test("tag com emoção antes e conteúdo por regex", () => {
  const r = R({ text: "[emo:animado] [SPOTIFY:{\"action\":\"play\",\"query\":\"Drake\"}] Vai." });
  assert.equal(matchCase({ espera: { tag: "SPOTIFY", conteudo: "/drake/i" } }, r).ok, true);
  assert.equal(matchCase({ espera: { tag: "SPOTIFY", conteudo: "/pause/" } }, r).ok, false);
  assert.equal(matchCase({ espera: { tag: "TIMER" } }, r).ok, false);
});

test("majority: maioria aprova, empate reprova", () => {
  assert.equal(majority([{ ok: true }, { ok: false, motivo: "a" }, { ok: true }]).ok, true);
  assert.equal(majority([{ ok: true }, { ok: false, motivo: "a" }]).ok, false);
});

test("score ignora erros; queda acima de 5 pontos; não rodou acima de 20% de erro", () => {
  const rows = [
    { area: "agenda", status: "ok" }, { area: "agenda", status: "falhou" },
    { area: "myhub", status: "ok" }, { area: "myhub", status: "ok" }, { area: "myhub", status: "erro" },
  ];
  const sc = score(rows);
  assert.equal(sc.total, 0.75);
  assert.deepEqual(sc.areas, { agenda: 0.5, myhub: 1 });
  assert.equal(sc.erro, 1);
  assert.equal(isDrop(sc, { total: 0.81 }), true);
  assert.equal(isDrop(sc, { total: 0.80 }), false);
  assert.equal(isDrop(sc, undefined), false);
  assert.equal(notRun(sc), false);
  assert.equal(notRun(score([{ area: "a", status: "erro" }, { area: "a", status: "ok" }])), true);
  assert.equal(exitCode(sc, { total: 0.95 }), 1);
  assert.equal(exitCode(sc, { total: 0.75 }), 0);
  assert.equal(exitCode(score([{ area: "a", status: "erro" }]), { total: 0.9 }), 2);
});

test("validateCases acha id repetido, área inválida, espera ambígua, regex quebrada e ferramenta inexistente", () => {
  const ok = { id: "a", area: "agenda", conversa: [{ role: "user", content: "x" }], espera: { ferramenta: "create_event" } };
  assert.deepEqual(validateCases([ok], ["create_event"]), []);
  const erros = validateCases([
    ok, { ...ok },
    { ...ok, id: "b", area: "nada" },
    { ...ok, id: "c", espera: { ferramenta: "create_event", needTools: true } },
    { ...ok, id: "d", espera: { tag: "SPOTIFY", conteudo: "/(/" } },
    { ...ok, id: "e", espera: { ferramenta: "nao_existe" } },
    { ...ok, id: "f", conversa: [] },
    { ...ok, id: "g", repete: 5 },
  ], ["create_event"]);
  for (const id of ["a", "b", "c", "d", "e", "f", "g"]) assert.ok(erros.some((e) => e.startsWith(id + ":")), `faltou erro de ${id}: ${erros}`);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test scripts/evalmatch.test.mjs`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` (`scripts/eval/match.mjs`).

- [ ] **Step 4: Write `scripts/eval/match.mjs`**

```js
/* Comparador da bateria de avaliação: o que o modelo fez contra o que o caso espera. Puro, sem rede. */
import { EVAL_AREAS } from "../../lib/ops.ts";

const DROP = 0.05;            // queda: mais de 5 pontos percentuais abaixo do baseline
const NOT_RUN = 0.2;          // mais de 20% dos casos com erro: a noite não vale
const KINDS = ["ferramenta", "nenhumaFerramenta", "needTools", "tag"];

export function parseRegex(s) {
  const m = typeof s === "string" ? /^\/([\s\S]*)\/([a-z]*)$/.exec(s) : null;
  return m ? new RegExp(m[1], m[2]) : null;
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const asNumber = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" ? NaN : Number(v));

function matchValue(exp, act) {
  if (typeof exp === "number") return asNumber(act) === exp;
  if (typeof exp === "boolean") return act === exp;
  if (typeof exp === "string") {
    const re = parseRegex(exp);
    if (!re) return act === exp;
    return act !== null && act !== undefined && re.test(typeof act === "string" ? act : JSON.stringify(act));
  }
  if (exp && typeof exp === "object") {
    const n = asNumber(act);
    return Number.isFinite(n) && (exp.min === undefined || n >= exp.min) && (exp.max === undefined || n <= exp.max);
  }
  return false;
}

const argsMatch = (exp, args) => args !== null && typeof args === "object" && Object.entries(exp).every(([p, v]) => matchValue(v, getPath(args, p)));

const short = (s, n = 160) => (s.length > n ? s.slice(0, n) + "…" : s);
function describe(r) {
  if (r.toolCalls.length) return r.toolCalls.map((c) => c.name).join(", ");
  if (r.needTools) return "[NEEDTOOLS]";
  return `texto "${short(r.text.trim(), 80)}"`;
}

export function matchCase(caso, r) {
  const proibida = r.toolCalls.find((c) => (caso.nunca ?? []).includes(c.name));
  if (proibida) return { ok: false, motivo: `chamou ${proibida.name}, que é proibida neste caso` };
  const e = caso.espera;
  if (e.ferramenta) {
    const cands = r.toolCalls.filter((c) => c.name === e.ferramenta);
    if (!cands.length) return { ok: false, motivo: `esperava ${e.ferramenta}, veio ${describe(r)}` };
    if (e.args && !cands.some((c) => argsMatch(e.args, c.args))) {
      return { ok: false, motivo: `${e.ferramenta} com args diferentes: ${short(JSON.stringify(cands[0].args))}` };
    }
    return { ok: true, motivo: "" };
  }
  if (e.nenhumaFerramenta) {
    if (r.toolCalls.length || r.needTools || !r.text.trim()) return { ok: false, motivo: `esperava só texto, veio ${describe(r)}` };
    return { ok: true, motivo: "" };
  }
  if (e.needTools) return r.needTools ? { ok: true, motivo: "" } : { ok: false, motivo: `esperava [NEEDTOOLS], veio ${describe(r)}` };
  if (e.tag) {
    const m = new RegExp(`\\[\\s*${e.tag}\\s*:([\\s\\S]*?)\\]`, "i").exec(r.text);
    if (!m) return { ok: false, motivo: `esperava a tag [${e.tag}:…], veio ${describe(r)}` };
    if (e.conteudo && !parseRegex(e.conteudo).test(m[1])) return { ok: false, motivo: `tag [${e.tag}] com conteúdo diferente: ${short(m[1])}` };
    return { ok: true, motivo: "" };
  }
  return { ok: false, motivo: "caso sem expectativa" };
}

export function majority(results) {
  const ok = results.filter((x) => x.ok).length;
  if (ok * 2 > results.length) return { ok: true, motivo: "" };
  const falha = results.find((x) => !x.ok);
  return { ok: false, motivo: `${ok}/${results.length} tentativas certas; ${falha?.motivo ?? ""}` };
}

const rate = (ok, n) => (n ? Math.round((ok / n) * 1000) / 1000 : 0);

export function score(rows) {
  const per = {};
  let ok = 0, falhou = 0, erro = 0;
  for (const r of rows) {
    if (r.status === "erro") { erro++; continue; }
    per[r.area] ??= { ok: 0, n: 0 };
    per[r.area].n++;
    if (r.status === "ok") { ok++; per[r.area].ok++; } else falhou++;
  }
  const areas = Object.fromEntries(Object.entries(per).map(([a, v]) => [a, rate(v.ok, v.n)]));
  return { total: rate(ok, ok + falhou), areas, ok, falhou, erro, n: rows.length };
}

export const notRun = (sc) => sc.n === 0 || sc.erro / sc.n > NOT_RUN;
export const isDrop = (sc, base) => !!base && sc.total < base.total - DROP - 1e-9;
export const exitCode = (sc, base) => (notRun(sc) ? 2 : isDrop(sc, base) ? 1 : 0);

/** A área com a maior queda em relação ao baseline (ou a pior nota, sem baseline). */
export function worstArea(sc, base) {
  const entries = Object.entries(sc.areas);
  if (!entries.length) return null;
  const delta = ([a, v]) => (base?.areas?.[a] ?? 1) - v;
  return entries.sort((x, y) => delta(y) - delta(x))[0][0];
}

export function validateCases(cases, toolNames) {
  const erros = [];
  const ids = new Set();
  for (const c of cases) {
    const id = c?.id ?? "?";
    const err = (m) => erros.push(`${id}: ${m}`);
    if (typeof c?.id !== "string" || !c.id) err("sem id");
    else if (ids.has(c.id)) err("id repetido");
    ids.add(c?.id);
    if (!EVAL_AREAS.includes(c?.area)) err(`área inválida "${c?.area}"`);
    if (!Array.isArray(c?.conversa) || !c.conversa.length || c.conversa.at(-1)?.role !== "user") err("conversa vazia ou sem fala do usuário no fim");
    else if (c.conversa.some((m) => !["user", "assistant"].includes(m.role) || typeof m.content !== "string")) err("mensagem inválida na conversa");
    const e = c?.espera ?? {};
    const kinds = KINDS.filter((k) => e[k] !== undefined);
    if (kinds.length !== 1) err(`espera precisa de exatamente um de ${KINDS.join(", ")}`);
    if (e.ferramenta !== undefined && !toolNames.includes(e.ferramenta)) err(`ferramenta inexistente ${e.ferramenta}`);
    for (const n of c?.nunca ?? []) if (!toolNames.includes(n)) err(`ferramenta inexistente em nunca: ${n}`);
    const regexes = [e.conteudo, ...Object.values(e.args ?? {})].filter((v) => typeof v === "string" && v.startsWith("/"));
    for (const r of regexes) { try { if (!parseRegex(r)) err(`regex mal formada ${r}`); } catch { err(`regex inválida ${r}`); } }
    if (c?.repete !== undefined && !(Number.isInteger(c.repete) && c.repete >= 1 && c.repete <= 3)) err("repete deve ser 1, 2 ou 3");
  }
  return erros;
}
```

- [ ] **Step 5: Run tests**

Run: `node --import ./scripts/register-ts.mjs --test scripts/evalmatch.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ops.ts scripts/eval/match.mjs scripts/evalmatch.test.mjs
git commit -m "feat: comparador da bateria de avaliação (expectativas, nota, queda, validação)"
```

---

### Task 4: contexto do pedido, fixtures e snapshot do My Hub

**Files:**
- Create: `scripts/eval/context.mjs`, `scripts/eval/snapshot-myhub.mjs`, `evals/fixtures.json`
- Modify: `.gitignore` (acrescentar `evals/out/`)
- Test: `scripts/evalcontext.test.mjs`

**Interfaces:**
- Consumes: `planTurn` (Task 1).
- Produces:
  - `buildRequest(conversa, fixtures) → { plan, params }`, onde `params` vai direto para `groqCompleteOn`;
  - `toolNames() → string[]` (todas as ferramentas nativas);
  - formato de `evals/fixtures.json`: `{ agora: { date, dateLabel, time, period }, memorias: { content, category }[], myhub: MyHubContext }`.

- [ ] **Step 1: Write the failing test** `scripts/evalcontext.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRequest, toolNames } from "./eval/context.mjs";

const fx = JSON.parse(readFileSync(new URL("../evals/fixtures.json", import.meta.url), "utf8"));
const u = (content) => ({ role: "user", content });

test("conversa: prompt curto, sem ferramentas, temperatura 0.7", () => {
  const { plan, params } = buildRequest([u("como você está hoje de manhã")], fx);
  assert.equal(plan.mode, "chat");
  assert.equal(params.tools, undefined);
  assert.equal(params.temperature, 0.7);
  assert.equal(params.messages[0].role, "system");
  assert.match(params.messages[0].content, /NEEDTOOLS/);
  assert.equal(params.messages.at(-1).content, "como você está hoje de manhã");
});

test("agenda: ferramentas do Calendar, data congelada no prompt, temperatura 0.3", () => {
  const { params } = buildRequest([u("marca dentista amanhã às 15h")], fx);
  const names = params.tools.map((t) => t.function.name);
  assert.ok(names.includes("create_event"));
  assert.ok(!names.includes("my_hub_register"));
  assert.equal(params.tool_choice, "auto");
  assert.equal(params.temperature, 0.3);
  assert.ok(params.messages[0].content.includes(fx.agora.date));
});

test("toolNames lista as ferramentas nativas", () => {
  const n = toolNames();
  for (const t of ["create_event", "list_events", "my_hub_register", "my_hub_undo", "memory_save", "memory_forget"]) assert.ok(n.includes(t), t);
});

test("fixtures não têm email nem telefone", () => {
  const raw = JSON.stringify(fx);
  assert.doesNotMatch(raw, /[\w.+-]+@[\w-]+\.[\w.]+/);
  assert.doesNotMatch(raw, /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test scripts/evalcontext.test.mjs`
Expected: FAIL (módulo e fixtures ausentes).

- [ ] **Step 3: Write `scripts/eval/context.mjs`**

```js
/* Monta o pedido à Groq de um caso exatamente como /api/chat monta: mesma decisão de rota (planTurn), mesmo prompt,
   mesmas ferramentas e mesmos parâmetros. Data, memórias e My Hub vêm dos fixtures, para as notas serem comparáveis. */
import { planTurn } from "../../lib/turnplan.ts";
import { buildSystemPrompt } from "../../lib/prompt.ts";
import { myHubPromptBlock } from "../../lib/myhubprompt.ts";
import { CALENDAR_TOOLS } from "../../lib/tools/calendar.ts";
import { MYHUB_TOOLS } from "../../lib/tools/myhub.ts";
import { MEMORY_TOOLS } from "../../lib/tools/memory.ts";

const ENV = { myhubWrite: true, memory: true };   // em produção os dois estão configurados

export const toolNames = () => [...CALENDAR_TOOLS, ...MYHUB_TOOLS, ...MEMORY_TOOLS].map((t) => t.function.name);

export function buildRequest(conversa, fx) {
  const plan = planTurn(conversa, ENV);
  const sets = plan.sets ?? { calendar: false, myhub: false, memory: false };
  const myhub = plan.mode === "full" ? fx.myhub : null;   // a rota só busca o My Hub no modo completo
  const system = buildSystemPrompt({
    memories: fx.memorias,
    myhubBlock: myHubPromptBlock(myhub, fx.agora.date, { writeConfigured: ENV.myhubWrite, tools: sets.myhub }),
    date: fx.agora.date, dateLabel: fx.agora.dateLabel, time: fx.agora.time, period: fx.agora.period,
    calendar: sets.calendar, memory: sets.memory,
  }, plan.mode);
  const messages = [{ role: "system", content: system }, ...conversa];
  if (!plan.sets) return { plan, params: { messages, temperature: 0.7, max_tokens: 700 } };
  const tools = [...(sets.calendar ? CALENDAR_TOOLS : []), ...(sets.myhub ? MYHUB_TOOLS : []), ...(sets.memory ? MEMORY_TOOLS : [])];
  return { plan, params: { messages, tools, tool_choice: "auto", temperature: 0.3, max_tokens: 700 } };
}
```

- [ ] **Step 4: Write `scripts/eval/snapshot-myhub.mjs`**

```js
/* Baixa o contexto real do My Hub (catálogo de ações, contas, categorias) para virar o fixture da bateria.
   O arquivo cru vai para evals/out/ (fora do git). ANONIMIZE à mão antes de copiar para evals/fixtures.json:
   o repositório é público. Uso: node scripts/eval/snapshot-myhub.mjs */
import { mkdirSync, writeFileSync } from "node:fs";

try { process.loadEnvFile(".env.local"); } catch { /* sem .env.local: usa o ambiente */ }
const base = process.env.MYHUB_URL?.replace(/\/+$/, "");
const token = process.env.MYHUB_SERVICE_TOKEN;
if (!base || !token) { console.error("Defina MYHUB_URL e MYHUB_SERVICE_TOKEN (.env.local)."); process.exit(1); }

const res = await fetch(`${base}/api/v1/service/beto-contexto`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) { console.error(`My Hub respondeu ${res.status}`); process.exit(1); }
mkdirSync("evals/out", { recursive: true });
writeFileSync("evals/out/myhub-snapshot.json", JSON.stringify(await res.json(), null, 2));
console.log("Salvo em evals/out/myhub-snapshot.json. Anonimize antes de usar em evals/fixtures.json.");
```

- [ ] **Step 5: Gerar os fixtures**

1. Acrescente `evals/out/` ao `.gitignore`.
2. Garanta `MYHUB_URL`, `MYHUB_SERVICE_TOKEN` e `GROQ_API_KEY` no `.env.local`. Use `vercel env pull .env.local --environment=development`, ou peça ao usuário que cole as chaves. Nunca imprima os valores.
3. Rode `node scripts/eval/snapshot-myhub.mjs`.
4. Monte `evals/fixtures.json` assim:
   - `agora`: `{ "date": "2026-10-01", "dateLabel": "quinta-feira, 1 de outubro de 2026", "time": "10:00", "period": "manhã" }`;
   - `memorias`: 5 memórias fictícias, por exemplo `{ "content": "O carro dele é um Civic 2019", "category": "fact" }`;
   - `myhub`: a **mesma estrutura** do snapshot, com `hoje: "2026-10-01"`, `acoes` igual ao snapshot (é o catálogo de ações, não dado pessoal; confira assim mesmo), `referencias` com nomes trocados por genéricos (contas como "Conta Corrente" e "Cartão"; categorias e hábitos genéricos como "Mercado", "Academia" e "Estudar"), `topicos` reduzido a 2 ou 3 entradas fictícias e `indisponiveis: []`. Sem valor de saldo real, nome de pessoa, email ou telefone.
5. **Pare e mostre o `evals/fixtures.json` ao usuário** antes do commit.

Se o My Hub não estiver acessível, monte `myhub` só com `acoes` e `referencias` inferidos de `lib/myhubprompt.ts` e de `scripts/myhubtools.test.mjs`, e avise o usuário que o fixture é aproximado.

- [ ] **Step 6: Run tests**

Run: `node --import ./scripts/register-ts.mjs --test scripts/evalcontext.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit** (depois do ok do usuário nos fixtures)

```bash
git add scripts/eval/context.mjs scripts/eval/snapshot-myhub.mjs scripts/evalcontext.test.mjs evals/fixtures.json .gitignore
git commit -m "feat: contexto da bateria (pedido igual ao da rota, fixtures anonimizados)"
```

---

### Task 5: executor e CLI

**Files:**
- Create: `scripts/eval/run.mjs`
- Modify: `package.json` (script `eval`)
- Test: `scripts/evalrun.test.mjs`

**Interfaces:**
- Consumes: `buildRequest` (Task 4), `matchCase`, `majority`, `score`, `exitCode`, `worstArea` (Task 3), `groqCompleteOn` e `PREFERRED` (Task 2).
- Produces:
  - `runSuite({ cases, fixtures, model, apiKey, gapMs = 2500, sleep, call, log }) → { model, rows, score, avgMs }`, onde `rows = { id, area, status, motivo, ms }[]`;
  - CLI `npm run eval -- [--model id] [--all] [--only prefixo] [--update-baseline] [--ci]`.

- [ ] **Step 1: Write the failing test** `scripts/evalrun.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSuite } from "./eval/run.mjs";

const fx = JSON.parse(readFileSync(new URL("../evals/fixtures.json", import.meta.url), "utf8"));
const caso = (id, content, espera, extra = {}) => ({ id, area: "conversa", conversa: [{ role: "user", content }], espera, ...extra });
const reply = (content, toolCalls = []) => ({ content, toolCalls, model: "m" });
const err = (status, headers = {}) => Object.assign(new Error(`status ${status}`), { status, headers });
const noSleep = async () => {};

test("aprova, reprova e marca erro; 429 com retry-after espera e tenta de novo", async () => {
  const waits = [];
  let n = 0;
  const call = async (_k, _m, params) => {
    const last = params.messages.at(-1).content;
    if (last === "limite") { n++; if (n === 1) throw err(429, { "retry-after": "3" }); return reply("[emo:neutro] Oi"); }
    if (last === "quebra") throw err(500);
    if (last === "args") return reply("", [{ id: "1", name: "create_event", arguments: "{nao json" }]);
    return reply("[emo:alegre] Tudo certo");
  };
  const r = await runSuite({
    cases: [
      caso("ok", "como você está hoje de manhã", { nenhumaFerramenta: true }),
      caso("limite", "limite", { nenhumaFerramenta: true }),
      caso("falha", "como vai a vida hoje em dia", { needTools: true }),
      caso("quebra", "quebra", { nenhumaFerramenta: true }),
    ],
    fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, log: () => {},
    sleep: async (ms) => { waits.push(ms); },
  });
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x.status]));
  assert.deepEqual(by, { ok: "ok", limite: "ok", falha: "falhou", quebra: "erro" });
  assert.ok(waits.includes(3000));
  assert.equal(r.score.total, 2 / 3);
});

test("429 quatro vezes seguidas vira erro, sem travar", async () => {
  const call = async () => { throw err(429); };
  const r = await runSuite({ cases: [caso("a", "oi tudo bem contigo", { nenhumaFerramenta: true })], fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, sleep: noSleep, log: () => {} });
  assert.equal(r.rows[0].status, "erro");
});

test("repete usa a maioria", async () => {
  let i = 0;
  const call = async () => reply(i++ === 0 ? "" : "[emo:neutro] Oi");
  const r = await runSuite({ cases: [caso("a", "oi tudo bem contigo", { nenhumaFerramenta: true }, { repete: 3 })], fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, sleep: noSleep, log: () => {} });
  assert.equal(r.rows[0].status, "ok");
});

test("Groq fora do ar: todos erro, nota não conta como queda", async () => {
  const { exitCode } = await import("./eval/match.mjs");
  const call = async () => { throw err(503); };
  const r = await runSuite({ cases: [caso("a", "x y z", { nenhumaFerramenta: true }), caso("b", "x y w", { nenhumaFerramenta: true })], fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, sleep: noSleep, log: () => {} });
  assert.equal(exitCode(r.score, { total: 0.9 }), 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test scripts/evalrun.test.mjs`
Expected: FAIL (`scripts/eval/run.mjs` ausente).

- [ ] **Step 3: Write `scripts/eval/run.mjs`**

```js
/* Bateria de avaliação de fala: manda cada caso de evals/cases.json ao modelo (prompt e ferramentas de produção,
   nada é executado) e dá a nota. Uso: npm run eval -- [--model id] [--all] [--only prefixo] [--update-baseline] [--ci]
   Plano gratuito da Groq: uma chamada por vez, com intervalo (EVAL_GAP_MS) e espera no 429. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildRequest } from "./context.mjs";
import { matchCase, majority, score, exitCode, isDrop, notRun, worstArea } from "./match.mjs";
import { detectNeedTools } from "../../lib/prompt.ts";

const RETRIES = 3;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callWithRetry(fn, sleep) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (e?.status !== 429 || i >= RETRIES) throw e;
      const s = Number(e.headers?.["retry-after"]);
      await sleep((Number.isFinite(s) && s > 0 ? s : 10) * 1000);
    }
  }
}

function toResult(c) {
  const toolCalls = c.toolCalls.map((t) => {
    let args = null;
    try { args = t.arguments.trim() ? JSON.parse(t.arguments) : {}; } catch { /* JSON inválido: args null */ }
    return { name: t.name, args };
  });
  return { toolCalls, text: c.content, needTools: detectNeedTools(c.content) === "yes" };
}

export async function runSuite({ cases, fixtures, model, apiKey, gapMs = 2500, sleep = realSleep, call, log = console.log }) {
  const rows = [];
  let msTotal = 0, calls = 0, first = true;
  for (const caso of cases) {
    const tries = [];
    let status = "ok", motivo = "", ms = 0;
    try {
      for (let t = 0; t < (caso.repete ?? 1); t++) {
        if (!first && gapMs) await sleep(gapMs);
        first = false;
        const { params } = buildRequest(caso.conversa, fixtures);
        const t0 = Date.now();
        const c = await callWithRetry(() => call(apiKey, model, params), sleep);
        ms = Date.now() - t0; msTotal += ms; calls++;
        tries.push(matchCase(caso, toResult(c)));
      }
      const m = tries.length > 1 ? majority(tries) : tries[0];
      status = m.ok ? "ok" : "falhou";
      motivo = m.motivo;
    } catch (e) {
      status = "erro";
      motivo = e instanceof Error ? e.message : String(e);
    }
    rows.push({ id: caso.id, area: caso.area, status, motivo, ms });
    log(`${status === "ok" ? "✓" : status === "falhou" ? "✗" : "!"} ${caso.id}${motivo ? ` — ${motivo}` : ""}`);
  }
  return { model, rows, score: score(rows), avgMs: calls ? Math.round(msTotal / calls) : 0 };
}

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

function parseArgs(argv) {
  const o = { all: false, ci: false, update: false, model: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") o.all = true;
    else if (a === "--ci") o.ci = true;
    else if (a === "--update-baseline") o.update = true;
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--only") o.only = argv[++i];
  }
  return o;
}

async function main() {
  try { process.loadEnvFile(".env.local"); } catch { /* CI: variáveis vêm do ambiente */ }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) { console.error("GROQ_API_KEY não definida (.env.local ou ambiente)."); process.exit(2); }
  const { groqCompleteOn, PREFERRED } = await import("../../lib/groq.ts");   // depois do .env: PREFERRED lê GROQ_MODEL
  const opts = parseArgs(process.argv.slice(2));
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  let cases = read("evals/cases.json");
  if (opts.only) cases = cases.filter((c) => c.id.startsWith(opts.only));
  const fixtures = read("evals/fixtures.json");
  const baselines = existsSync("evals/baseline.json") ? read("evals/baseline.json") : {};
  const gapMs = Number(process.env.EVAL_GAP_MS ?? 2500);
  const models = opts.all ? PREFERRED : [opts.model ?? PREFERRED[0]];
  mkdirSync("evals/out", { recursive: true });

  const results = [];
  for (const model of models) {
    console.log(`\n== ${model} (${cases.length} casos) ==`);
    const r = await runSuite({ cases, fixtures, model, apiKey, gapMs, call: groqCompleteOn });
    results.push(r);
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(`evals/out/${day}-${model.replace(/[^\w.-]+/g, "_")}.json`, JSON.stringify(r, null, 2));
    const base = baselines[model];
    console.log(`\nNota: ${pct(r.score.total)} (${r.score.ok} ok, ${r.score.falhou} falharam, ${r.score.erro} erros)${base ? ` | baseline ${pct(base.total)}` : ""}`);
    for (const [a, v] of Object.entries(r.score.areas)) console.log(`  ${a.padEnd(12)} ${pct(v)}${base?.areas?.[a] !== undefined ? `  (base ${pct(base.areas[a])})` : ""}`);
    if (opts.update && !notRun(r.score) && !opts.only) {
      baselines[model] = { total: r.score.total, areas: r.score.areas, casos: cases.length, data: day };
      writeFileSync("evals/baseline.json", JSON.stringify(baselines, null, 2) + "\n");
      console.log("Baseline atualizado.");
    }
  }
  if (opts.all) {
    console.log("\nPlacar:");
    for (const r of [...results].sort((x, y) => y.score.total - x.score.total)) {
      console.log(`  ${pct(r.score.total).padStart(6)}  ${String(r.avgMs).padStart(5)} ms  ${r.model}${notRun(r.score) ? "  (não rodou)" : ""}`);
    }
  }
  if (opts.ci) {
    const r = results[0];
    const base = baselines[r.model];
    const code = exitCode(r.score, base);
    writeFileSync("evals/out/ci.json", JSON.stringify({
      status: code === 2 ? "nao_rodou" : isDrop(r.score, base) ? "queda" : "ok",
      total: r.score.total, baseline: base?.total ?? null, piorArea: worstArea(r.score, base),
    }));
    process.exit(code);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
```

- [ ] **Step 4: Add the npm script**

Em `package.json`, dentro de `scripts`:

```json
"eval": "node --import ./scripts/register-ts.mjs scripts/eval/run.mjs",
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS (inclui `evalrun.test.mjs`).

- [ ] **Step 6: Commit**

```bash
git add scripts/eval/run.mjs scripts/evalrun.test.mjs package.json
git commit -m "feat: executor da bateria (ritmo do plano gratuito, 429, repete, placar, baseline, --ci)"
```

---

### Task 6: casos da bateria

**Files:**
- Create: `evals/cases.json`
- Test: `scripts/evalcases.test.mjs`

**Interfaces:**
- Consumes: `validateCases` (Task 3), `toolNames` (Task 4).

- [ ] **Step 1: Write the test** `scripts/evalcases.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCases } from "./eval/match.mjs";
import { toolNames } from "./eval/context.mjs";

const cases = JSON.parse(readFileSync(new URL("../evals/cases.json", import.meta.url), "utf8"));

test("evals/cases.json é válido", () => {
  assert.deepEqual(validateCases(cases, toolNames()), []);
});

test("bateria tem tamanho e cobertura mínimos", () => {
  assert.ok(cases.length >= 100, `só ${cases.length} casos`);
  const areas = new Set(cases.map((c) => c.area));
  for (const a of ["agenda", "myhub", "memoria", "spotify", "timer", "conversa", "confirmacao"]) assert.ok(areas.has(a), `sem casos de ${a}`);
  assert.ok(cases.filter((c) => c.area === "conversa").length >= 20, "menos de 20 casos de conversa pura");
});
```

- [ ] **Step 2: Write the cases**

Fontes, nesta ordem:
1. Os `fix:` de interpretação: `git log --format='%h %s' | grep -E '^[0-9a-f]+ fix'`. Para cada um, leia o diff do teste correspondente (`git show <hash> -- scripts/`). As frases dos testes adicionados são a fonte dos casos. Coloque o hash em `origem`.
2. Frases de `scripts/intent.test.mjs`, `scripts/myhubtools.test.mjs`, `scripts/memorytools.test.mjs` e `scripts/calendartools.test.mjs`.
3. 20 ou mais casos de conversa pura (`nenhumaFerramenta: true`), incluindo frases com palavras-gatilho em sentido comum ("o que você acha de marcar presença no evento de tecnologia?" não deve criar evento; "eu gastei muita energia hoje" não registra gasto).

Regras:
- A expectativa segue o **comportamento correto** descrito no commit, não o atual.
- Quando o modo for conversa e o pedido for de ação (música em conversa, por exemplo), use `needTools` só se `planTurn` der `chat` para aquela frase. Confira com `node --import ./scripts/register-ts.mjs -e "import('./lib/turnplan.ts').then(m=>console.log(m.planTurn([{role:'user',content:'FRASE'}],{myhubWrite:true,memory:true})))"`.
- Dado faltando (gasto sem valor, evento sem horário) usa `nenhumaFerramenta: true` com `nunca: ["create_event"]` ou a ferramenta correspondente: o Beto deve perguntar.
- Confirmações: conversa com 3 mensagens (pedido, pergunta do assistente que cita o item e "pode"), na área `confirmacao`.
- Datas relativas usam os fixtures: "amanhã" é `2026-10-02`. Por exemplo, `"start": "/^2026-10-02T15:00/"`.
- Os nomes de `acao` e de categorias vêm de `evals/fixtures.json`.

Casos-semente (escreva estes primeiro e complete até cerca de 120):

```json
[
  { "id": "conv-oi", "area": "conversa", "conversa": [{ "role": "user", "content": "e aí beto, tudo certo contigo hoje?" }], "espera": { "nenhumaFerramenta": true } },
  { "id": "conv-opiniao-mvp", "area": "conversa", "conversa": [{ "role": "user", "content": "qual a sua opinião sobre começar com um mvp pequeno" }], "espera": { "nenhumaFerramenta": true } },
  { "id": "conv-energia-nao-e-gasto", "area": "conversa", "conversa": [{ "role": "user", "content": "cara, gastei muita energia nessa reunião de hoje" }], "espera": { "nenhumaFerramenta": true }, "nunca": ["my_hub_register"] },
  { "id": "agenda-criar-dentista", "area": "agenda", "conversa": [{ "role": "user", "content": "marca dentista amanhã às 15h" }], "espera": { "ferramenta": "create_event", "args": { "title": "/dentista/i", "start": "/^2026-10-02T15:00/" } } },
  { "id": "agenda-listar-amanha", "area": "agenda", "conversa": [{ "role": "user", "content": "o que eu tenho na agenda amanhã?" }], "espera": { "ferramenta": "list_events" } },
  { "id": "agenda-sem-horario-pergunta", "area": "agenda", "conversa": [{ "role": "user", "content": "marca uma reunião com o João" }], "espera": { "nenhumaFerramenta": true }, "nunca": ["create_event"] },
  { "id": "agenda-cancelar-procura-antes", "area": "agenda", "conversa": [{ "role": "user", "content": "cancela a reunião de amanhã com o João" }], "espera": { "ferramenta": "list_events" }, "nunca": ["delete_event"] },
  { "id": "hub-mercado-40", "area": "myhub", "conversa": [{ "role": "user", "content": "gastei 40 reais no mercado" }], "espera": { "ferramenta": "my_hub_register", "args": { "entrada.valor": 40 } } },
  { "id": "hub-gasto-sem-valor", "area": "myhub", "conversa": [{ "role": "user", "content": "registra um gasto no mercado" }], "espera": { "nenhumaFerramenta": true }, "nunca": ["my_hub_register"] },
  { "id": "hub-treino-nao-e-checkin", "area": "myhub", "origem": "e33a9c7", "conversa": [{ "role": "user", "content": "terminei o treino de academia" }], "espera": { "ferramenta": "my_hub_register" }, "nunca": ["memory_save"] },
  { "id": "hub-desfaz", "area": "myhub", "conversa": [{ "role": "user", "content": "gastei 40 no mercado" }, { "role": "assistant", "content": "[emo:neutro] Registrei R$ 40 em Mercado, chefe." }, { "role": "user", "content": "opa, errei, desfaz isso" }], "espera": { "ferramenta": "my_hub_undo" } },
  { "id": "mem-lembra-carro", "area": "memoria", "conversa": [{ "role": "user", "content": "lembra que meu carro agora é um corolla" }], "espera": { "ferramenta": "memory_save", "args": { "content": "/corolla/i" } } },
  { "id": "mem-esquece", "area": "memoria", "conversa": [{ "role": "user", "content": "esquece aquela história do civic" }], "espera": { "ferramenta": "memory_forget" } },
  { "id": "mem-pergunta-nao-salva", "area": "memoria", "conversa": [{ "role": "user", "content": "o que você sabe sobre mim?" }], "espera": { "ferramenta": "memory_list" }, "nunca": ["memory_save"] },
  { "id": "spot-toca-drake", "area": "spotify", "conversa": [{ "role": "user", "content": "toca algo do Drake" }], "espera": { "tag": "SPOTIFY", "conteudo": "/drake/i" } },
  { "id": "spot-pausa", "area": "spotify", "conversa": [{ "role": "user", "content": "pausa a música aí" }], "espera": { "tag": "SPOTIFY", "conteudo": "/pause/" } },
  { "id": "timer-10min", "area": "timer", "conversa": [{ "role": "user", "content": "põe um timer de 10 minutos" }], "espera": { "tag": "TIMER" } },
  { "id": "conf-cancela-pode", "area": "confirmacao", "conversa": [{ "role": "user", "content": "cancela a reunião com o João amanhã" }, { "role": "assistant", "content": "[emo:neutro] Achei \"Reunião com João\" amanhã às 10h. Cancelo, chefe?" }, { "role": "user", "content": "pode" }], "espera": { "ferramenta": "list_events" } }
]
```

Atenção ao `conf-cancela-pode`: o modelo não tem o `event_id` no histórico, então o primeiro passo certo é `list_events`. Se, ao escrever os casos, o histórico de produção já levar o id na fala, troque por `delete_event`. Confirme lendo `scripts/calendartools.test.mjs`.

Os nomes dos argumentos (`entrada.valor`, `content` em `memory_save`) precisam bater com as definições em `lib/tools/myhub.ts`, com o catálogo nos fixtures e com `lib/tools/memory.ts`. Confira antes de fechar.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add evals/cases.json scripts/evalcases.test.mjs
git commit -m "feat: casos iniciais da bateria de avaliação (histórico de fixes, testes e conversa pura)"
```

---

### Task 7: rota de relatório e push

**Files:**
- Modify: `lib/ops.ts` (acrescentar `validEvalReport` e `evalReportMessage`)
- Create: `app/api/cron/eval-report/route.ts`
- Test: `scripts/evalreport.test.mjs`

**Interfaces:**
- Produces:
  - `validEvalReport(body) → { status: "queda" | "nao_rodou"; total: number | null; baseline: number | null; piorArea: EvalArea | null } | null`;
  - `evalReportMessage(r) → { title, body }`.

- [ ] **Step 1: Write the failing test** `scripts/evalreport.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { validEvalReport, evalReportMessage } from "../lib/ops.ts";

test("aceita queda e não rodou com números de 0 a 1 e área conhecida", () => {
  assert.deepEqual(validEvalReport({ status: "queda", total: 0.81, baseline: 0.92, piorArea: "agenda" }), { status: "queda", total: 0.81, baseline: 0.92, piorArea: "agenda" });
  assert.deepEqual(validEvalReport({ status: "nao_rodou", total: 0, baseline: null, piorArea: null }), { status: "nao_rodou", total: 0, baseline: null, piorArea: null });
});

test("recusa status, número ou área fora do esperado e texto livre", () => {
  for (const b of [null, "x", {}, { status: "ok" }, { status: "queda", total: 2 }, { status: "queda", total: 0.5, baseline: -1 },
    { status: "queda", total: 0.5, baseline: 0.9, piorArea: "<script>" }, { status: "queda", total: "0.5", baseline: 0.9 }]) {
    assert.equal(validEvalReport(b), null, JSON.stringify(b));
  }
});

test("mensagem do push", () => {
  assert.deepEqual(evalReportMessage({ status: "queda", total: 0.81, baseline: 0.92, piorArea: "agenda" }), { title: "Beto: avaliação caiu", body: "A nota caiu de 92% para 81% (pior área: agenda)." });
  assert.equal(evalReportMessage({ status: "nao_rodou", total: null, baseline: null, piorArea: null }).body, "A avaliação noturna não rodou (Groq fora do ar ou sem cota).");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test scripts/evalreport.test.mjs`
Expected: FAIL (`validEvalReport` não existe).

- [ ] **Step 3: Implement in `lib/ops.ts`**

```ts
export type EvalArea = (typeof EVAL_AREAS)[number];
export interface EvalReport { status: "queda" | "nao_rodou"; total: number | null; baseline: number | null; piorArea: EvalArea | null }

const frac = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;

/** Corpo enviado pelo GitHub Actions quando a avaliação noturna reprova. Só números e nomes fixos: nada vira texto livre no push. */
export function validEvalReport(body: unknown): EvalReport | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (o.status !== "queda" && o.status !== "nao_rodou") return null;
  const total = frac(o.total), baseline = frac(o.baseline);
  if (total === undefined || baseline === undefined) return null;
  const area = o.piorArea ?? null;
  if (area !== null && !EVAL_AREAS.includes(area as EvalArea)) return null;
  return { status: o.status, total, baseline, piorArea: area as EvalArea | null };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function evalReportMessage(r: EvalReport): { title: string; body: string } {
  if (r.status === "nao_rodou") return { title: "Beto: avaliação não rodou", body: "A avaliação noturna não rodou (Groq fora do ar ou sem cota)." };
  const de = r.baseline !== null ? `de ${pct(r.baseline)} ` : "";
  const para = r.total !== null ? `para ${pct(r.total)}` : "";
  const area = r.piorArea ? ` (pior área: ${r.piorArea})` : "";
  return { title: "Beto: avaliação caiu", body: `A nota caiu ${de}${para}${area}.`.replace(/\s+\./, ".") };
}
```

- [ ] **Step 4: Write `app/api/cron/eval-report/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { evalReportMessage, validEvalReport } from "@/lib/ops";
import { pushConfigured, sendToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

/* Chamada pelo GitHub Actions (eval-nightly.yml) quando a avaliação noturna cai ou não roda: avisa por push. */
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const r = validEvalReport(await req.json().catch(() => null));
  if (!r) return NextResponse.json({ error: "Relatório inválido." }, { status: 400 });
  console.log("[beto-eval]", JSON.stringify(r));
  const pushed = pushConfigured() ? await sendToAll({ ...evalReportMessage(r), tag: "beto-eval" }) : 0;
  return NextResponse.json({ pushed });
}
```

- [ ] **Step 5: Run tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ops.ts app/api/cron/eval-report/route.ts scripts/evalreport.test.mjs
git commit -m "feat: rota de relatório da avaliação noturna com push"
```

---

### Task 8: workflow noturno, primeira execução e baseline

**Files:**
- Create: `.github/workflows/eval-nightly.yml`, `evals/baseline.json`

- [ ] **Step 1: Write `.github/workflows/eval-nightly.yml`**

```yaml
# Bateria de avaliação de fala, 1x por noite (3h em Brasília). Manda as frases de evals/cases.json ao modelo
# principal e compara com evals/baseline.json. Queda de mais de 5 pontos ou Groq fora do ar: job falha e chega push.
# Precisa dos secrets GROQ_API_KEY e CRON_SECRET.
name: Beto eval nightly

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Rodar a bateria
        id: eval
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
        run: npm run eval -- --ci
      - name: Guardar o relatório
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: eval-report
          path: evals/out/
          if-no-files-found: ignore
      - name: Avisar por push
        if: failure()
        run: |
          body=$(cat evals/out/ci.json 2>/dev/null || echo '{"status":"nao_rodou","total":null,"baseline":null,"piorArea":null}')
          curl -fsS -m 30 -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            -d "$body" \
            https://betoia.vercel.app/api/cron/eval-report
```

- [ ] **Step 2: First local run**

Run: `EVAL_GAP_MS=2500 npm run eval`
Expected: imprime ✓, ✗ e ! por caso e a nota por área. Para cada ✗, decida com o usuário se é **erro do caso** (corrija o caso) ou **erro real do Beto** (fica reprovando; vira item de correção futura). Não "conserte" o caso para passar.

- [ ] **Step 3: Grave o baseline**

Run: `npm run eval -- --update-baseline`
Expected: `evals/baseline.json` criado com a nota do modelo principal.

- [ ] **Step 4: Full suite e build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/eval-nightly.yml evals/baseline.json
git commit -m "feat: avaliação noturna no GitHub Actions e baseline inicial"
```

- [ ] **Step 6: Passos do usuário**

Avise o usuário para:
1. Cadastrar o secret `GROQ_API_KEY` no GitHub (Settings → Secrets → Actions).
2. Depois do merge e do deploy, disparar o workflow uma vez à mão (`workflow_dispatch`).
3. Opcional: rodar `npm run eval -- --all` para ver o placar dos modelos. Leva cerca de 7 minutos por modelo.
