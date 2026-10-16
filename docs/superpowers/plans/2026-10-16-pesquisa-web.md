# Pesquisa na web: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Beto pesquisa na web (notícia, cotação, placar, versão, previsão do tempo, ou quando pedem "pesquisa") e responde falando, citando a fonte pelo nome.

**Architecture:** O roteador (`lib/intent.ts` + `lib/turnplan.ts`) marca o turno como de pesquisa. A rota chama `webAnswer` (`lib/web.ts`), que usa a ferramenta embutida `browser_search` do `openai/gpt-oss-120b` (reserva `gpt-oss-20b`) sem stream, limpa os marcadores de citação e devolve o texto nos três caminhos (NDJSON da voz, stream do navegador, JSON). A voz ganha o ack `"web"`.

**Tech Stack:** Next.js 14 + TypeScript (`node:test` via `npm test`), groq-sdk, Python 3.12 + Pipecat (`uv run pytest`) só para o ack.

**Spec:** `docs/superpowers/specs/2026-10-16-pesquisa-web-design.md`

## Global Constraints

- Modelos de pesquisa, nesta ordem: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`. Parâmetros: `tools: [{"type": "browser_search"}]`, `tool_choice: "required"`, `reasoning_effort: "low"`, `temperature: 0.3`, `max_tokens: 900`, sem stream.
- Turno de pesquisa é só pesquisa: com qualquer conjunto de ferramentas pedido (agenda, My Hub, memória, conteúdo), não há pesquisa.
- `TurnPlan.web` é `true` ou ausente; `TurnEnv.web` ausente = desligado. A rota passa `web: process.env.WEB_SEARCH === "on"` (desligada por padrão; decisão da revisão final).
- Texto de falha, exato: `[emo:triste] Não consegui pesquisar agora. Tenta de novo daqui a pouco.`
- Métrica: `tools: ["browser_search"]` com sucesso, `["browser_search:erro"]` com falha.
- Ack de pesquisa: tipo `"web"`; frases padrão `["Deixa eu pesquisar.", "Vou dar uma olhada."]`.
- A fala nunca contém `【...】` nem URL.
- Comentários, logs e commits em português do Brasil, no estilo do código vizinho.
- Comandos: TS `npm test` e `npx tsc --noEmit -p .`; Python `cd voice && uv run pytest -q`.

## Review Focus

1. Pergunta de pesquisa com a Groq devolvendo 429 nos dois modelos: o chefe ouve o texto de falha, nunca silêncio nem erro HTTP 500. Teste na Task 3.
2. Resposta só com marcadores e URL (sobra vazio depois da limpeza): conta como falha do modelo e passa ao próximo. Teste na Task 3.
3. "pesquisa" sozinho (uma palavra) não dispara. Teste na Task 2.
4. Pergunta de pesquisa no caminho de stream do navegador: o navegador recebe texto, não JSON. Conferido no ensaio (Task 6) e no tipo de resposta da Task 5.
5. Sem `WEB_SEARCH=on`: a pergunta atual cai na conversa comum, HONESTIDADE usa a frase antiga e a busca não é chamada. Teste na Task 2 (env desligado) e no teste de prompt.

---

### Task 1: Sondagem da busca com a chave real

**Files:**
- Create: `scripts/web-probe.mjs`

**Interfaces:**
- Produces: nada consumido por código; o resultado vai para a seção "Resultado da sondagem" no fim deste plano.

- [ ] **Step 1: Write `scripts/web-probe.mjs`**

Script ESM, sem dependências além do `groq-sdk` do projeto. Lê `GROQ_API_KEY` do ambiente (sai com mensagem clara se faltar) e a pergunta do primeiro argumento (padrão: `"cotação do dólar hoje"`). Faz as quatro chamadas da spec (seção 1) em sequência e imprime, para cada uma: rótulo, status (`ok` ou mensagem de erro com `status` HTTP), latência em ms, os primeiros 600 caracteres de `message.content`, `Object.keys(message)`. Na chamada 3 (stream), imprime quantos pedaços de texto chegaram. Na 4, a function tool é `{"type": "function", "function": {"name": "noop", "description": "não faz nada", "parameters": {"type": "object", "properties": {}}}}` com `tool_choice: "auto"`; imprima também `message.tool_calls`.

- [ ] **Step 2: Conferir que o script roda sem chave**

Run: `node scripts/web-probe.mjs`
Expected: sai com código 1 e a mensagem `Defina GROQ_API_KEY para rodar a sondagem.`

- [ ] **Step 3: Commit**

```bash
git add scripts/web-probe.mjs
git commit -m "chore(web): sondagem do browser_search da Groq"
```

- [ ] **Step 4: PARAR — o Rodrigo roda a sondagem**

O controlador pede ao Rodrigo: `GROQ_API_KEY=... node scripts/web-probe.mjs "cotação do dólar hoje"` e cola a saída. Registre o resumo na seção "Resultado da sondagem". Se a chamada 1 falhar por plano ou permissão, pare o plano e avise. Se a 1 funciona, siga.

---

### Task 2: Roteamento (`wantsWeb` e `TurnPlan.web`) + casos da bateria

**Files:**
- Modify: `lib/intent.ts`, `lib/turnplan.ts`, `evals/cases.json`
- Test: `scripts/intent.test.mjs`, `scripts/turnplan.test.mjs`

**Interfaces:**
- Produces: `export function wantsWeb(messages: ChatMsg[]): boolean` em `lib/intent.ts`; `TurnEnv.web?: boolean`; `TurnPlan.web?: true`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/intent.test.mjs (acrescentar; importe wantsWeb)
test("wantsWeb: pedido explícito e coisa atual disparam", () => {
  for (const t of [
    "pesquisa como está o trânsito na marginal", "procura na internet o horário do jogo", "busca no google o que é o Pipecat",
    "quais as notícias de hoje", "o que aconteceu hoje no mercado de IA", "o que saiu sobre o Next 16",
    "qual a cotação do euro", "quanto tá o dólar agora", "quanto fechou o ibovespa", "preço do bitcoin hoje",
    "qual foi o placar do jogo do Santos", "quem ganhou o jogo ontem", "como tá a tabela do brasileirão",
    "qual a última versão do Next.js", "já lançou o iPhone novo", "já saiu o novo Zelda",
    "previsão do tempo pra amanhã", "vai chover em Ubatuba amanhã",
  ]) assert.equal(wantsWeb([u(t)]), true, t);
});

test("wantsWeb: opinião, conta, agenda, GitHub e memória não disparam", () => {
  for (const t of [
    "quanto custa fazer um mvp", "gastei 10 dólares no uber", "qual a minha agenda de hoje",
    "o que aconteceu com o meu deploy", "lembra que eu prefiro reunião à tarde", "saiu o deploy?",
    "o que você acha do dólar alto pra quem exporta", "pesquisa",
  ]) assert.equal(wantsWeb([u(t)]), false, t);
});

test("wantsWeb: só a última fala do chefe conta", () => {
  assert.equal(wantsWeb([u("quanto tá o dólar"), a("[emo:neutro] Cinco e dez."), u("valeu, e o que você acha disso?")]), false);
});
```

```js
// scripts/turnplan.test.mjs (acrescentar)
const WEB = { ...ON, web: true };

test("pesquisa: modo completo, sem conjuntos, web ligado", () => {
  assert.deepEqual(planTurn([u("quanto tá o dólar agora")], WEB), { mode: "full", sets: null, web: true });
});

test("pesquisa junto de agenda vira só agenda", () => {
  const p = planTurn([u("pesquisa a previsão do tempo e marca reunião amanhã às 10")], WEB);
  assert.equal(p.web, undefined);
  assert.equal(p.sets?.calendar, true);
});

test("web desligado ou ausente nunca pesquisa; conversa comum não muda", () => {
  assert.equal(planTurn([u("quanto tá o dólar agora")], ON).web, undefined);
  assert.equal(planTurn([u("quanto tá o dólar agora")], { ...ON, web: false }).web, undefined);
  assert.deepEqual(planTurn([u("como você está hoje de manhã")], WEB), { mode: "chat", sets: null });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -E "wantsWeb|pesquisa|fail"`
Expected: FAIL (`wantsWeb` não exportado; `web` ausente no plano).

- [ ] **Step 3: Implement `wantsWeb` and the plan rule**

Regex sobre a última fala do usuário normalizada (`norm` do arquivo), com menos de duas palavras devolvendo `false`. Os grupos e frases exatos estão na spec, seção 2. Em `planTurn`, depois de calcular `wanted`: se nenhum conjunto foi pedido, `env.web` é verdadeiro e `wantsWeb(messages)`, devolva `{ mode: "full", sets: null, web: true }`. Nos outros casos, o retorno de hoje, sem a chave `web`.

- [ ] **Step 4: Add the eval cases**

Cinco casos novos em `evals/cases.json`, área `"conversa"`, ids `conv-web-01` a `conv-web-05`, cada um com `espera: { nenhumaFerramenta: true }` e o mesmo `nunca` dos casos `conv-*` vizinhos: "quanto custa fazer um app?", "o que você acha do dólar alto pra quem exporta?", "me explica como funciona a bolsa de valores", "por que o bitcoin oscila tanto?", "vale a pena estudar Rust em vez de Go?".

- [ ] **Step 5: Run the suite and typecheck**

Run: `npm test && npx tsc --noEmit -p .`
Expected: tudo passa.

- [ ] **Step 6: Commit**

```bash
git add lib/intent.ts lib/turnplan.ts evals/cases.json scripts/intent.test.mjs scripts/turnplan.test.mjs
git commit -m "feat(web): roteador reconhece pedido de pesquisa e de coisa atual"
```

---

### Task 3: `lib/web.ts` (chamada, limpeza e guia)

**Files:**
- Create: `lib/web.ts`
- Test: `scripts/web.test.mjs`

**Interfaces:**
- Consumes: `groqCompleteOn(apiKey, model, params)` de `lib/groq.ts`; `ChatMsg` de `lib/intent.ts`.
- Produces: `WEB_MODELS`, `cleanCitations(text: string): string`, `webGuide(): string`, `webAnswer(apiKey: string, system: string, messages: ChatMsg[], call?: CallFn): Promise<WebResult>`, `interface WebResult { text: string; model: string | null; ok: boolean }`, `WEB_FAIL_TEXT` (o texto de falha exato), `type CallFn = (apiKey: string, model: string, params: unknown) => Promise<{ content: string }>`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/web.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { cleanCitations, webGuide, webAnswer, WEB_MODELS, WEB_FAIL_TEXT } from "../lib/web.ts";

test("cleanCitations tira marcadores e URL e mantém a emoção", () => {
  assert.equal(cleanCitations("[emo:neutro] O dólar fechou a cinco e dez【2†L6-L10】, segundo o g1【3†L1-L2】."),
    "[emo:neutro] O dólar fechou a cinco e dez, segundo o g1.");
  assert.equal(cleanCitations("Veja em https://g1.globo.com/economia e  http://x.io hoje."), "Veja em e hoje.");
});

test("webGuide pede fonte pelo nome e proíbe inventar", () => {
  const g = webGuide();
  for (const k of ["fonte", "nunca pela URL", "não invente", "de quando"]) assert.ok(g.includes(k), k);
});

const call = (plan) => async (_k, model, params) => {
  assert.deepEqual(params.tools, [{ type: "browser_search" }]);
  assert.equal(params.tool_choice, "required");
  const r = plan[model];
  if (r instanceof Error) throw r;
  return { content: r };
};

test("primeiro modelo responde", async () => {
  const r = await webAnswer("k", "SYS", [{ role: "user", content: "dólar" }], call({ [WEB_MODELS[0]]: "[emo:neutro] Cinco e dez【1†L1】." }));
  assert.deepEqual(r, { text: "[emo:neutro] Cinco e dez.", model: WEB_MODELS[0], ok: true });
});

test("primeiro falha ou volta vazio depois da limpeza, segundo responde", async () => {
  const r1 = await webAnswer("k", "SYS", [], call({ [WEB_MODELS[0]]: new Error("429"), [WEB_MODELS[1]]: "Ok." }));
  assert.equal(r1.model, WEB_MODELS[1]);
  const r2 = await webAnswer("k", "SYS", [], call({ [WEB_MODELS[0]]: "【1†L1】 https://a.b", [WEB_MODELS[1]]: "Ok." }));
  assert.equal(r2.model, WEB_MODELS[1]);
});

test("os dois falham: texto de falha, ok false", async () => {
  const r = await webAnswer("k", "SYS", [], call({ [WEB_MODELS[0]]: new Error("429"), [WEB_MODELS[1]]: new Error("429") }));
  assert.deepEqual(r, { text: WEB_FAIL_TEXT, model: null, ok: false });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -E "web|fail"`
Expected: FAIL (`Cannot find module '../lib/web.ts'`).

- [ ] **Step 3: Implement `lib/web.ts`**

`webAnswer` monta `messages: [{ role: "system", content: system }, ...messages]` e os parâmetros da Global Constraints; para cada modelo de `WEB_MODELS`, chama `call` (padrão: `groqCompleteOn`), limpa com `cleanCitations` e devolve no primeiro texto não vazio. Erro ou vazio: `console.error("[Beto API] web:", model, erro)` e próximo. O texto do `webGuide` segue as regras da spec, seção 3, em português e em texto corrido (é prompt de voz); inclua as palavras que o teste confere.

- [ ] **Step 4: Run the suite and typecheck**

Run: `npm test && npx tsc --noEmit -p .`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add lib/web.ts scripts/web.test.mjs
git commit -m "feat(web): chamada ao browser_search com reserva, limpeza de citações e guia de fala"
```

---

### Task 4: Ack `"web"` (TS e voz) e regra HONESTIDADE

**Files:**
- Modify: `lib/ack.ts`, `lib/voicewire.ts`, `lib/prompt.ts`, `voice/beto_voice/config.py`, `voice/beto-voice.toml`
- Test: `scripts/ack.test.mjs`, `scripts/voicewire.test.mjs`, `scripts/prompt.test.mjs`, `voice/tests/test_config.py`

**Interfaces:**
- Produces: `AckKind` inclui `"web"`; `parseLine('{"ack":"web"}')` devolve `{ ack: "web" }`; `AckCfg.web: list[str]`, presente em `phrases()` (depois de `geral`) e em `all()`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/voicewire.test.mjs (acrescentar)
test("ack web", () => { assert.deepEqual(parseLine(encodeLine({ ack: "web" })), { ack: "web" }); });
```

```js
// scripts/prompt.test.mjs (acrescentar)
test("HONESTIDADE: pesquisa automática e sugestão de pedir 'pesquisa'", () => {
  for (const p of [full, chat]) {
    assert.ok(p.includes("a pesquisa na web acontece automaticamente"));
    assert.ok(p.includes('"pesquisa"'));
    assert.ok(!p.includes("Você não tem acesso à internet"));
  }
});
```

```python
# voice/tests/test_config.py (acrescentar)
def test_ack_web_padrao_e_validacao(tmp_path):
    cfg = load_config(write_toml(tmp_path), env={})
    assert cfg.ack.phrases()["web"] == ["Deixa eu pesquisar.", "Vou dar uma olhada."]
    assert "Deixa eu pesquisar." in cfg.ack.all()
    with pytest.raises(ValueError, match=r"\[ack\]\.web"):
        load_config(write_toml(tmp_path, ack="web = []"), env={})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -E "ack web|HONESTIDADE|fail"` e `cd voice && uv run pytest -q tests/test_config.py`
Expected: FAIL nos três.

- [ ] **Step 3: Implement**

`AckKind` e `ACK_KINDS` ganham `"web"`. Em `prompt.ts`, troque a frase "Você não tem acesso à internet nem a dados em tempo real ... com base no que você sabe." pelo texto da spec, seção 6, começando por "a pesquisa na web acontece automaticamente" e citando `"pesquisa"` entre aspas duplas. `AckCfg.web` com o padrão e a validação das outras listas; `[ack]` do TOML ganha `web` com comentário curto.

- [ ] **Step 4: Run both suites**

Run: `npm test && npx tsc --noEmit -p . && cd voice && uv run pytest -q`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add lib/ack.ts lib/voicewire.ts lib/prompt.ts voice/beto_voice/config.py voice/beto-voice.toml scripts/voicewire.test.mjs scripts/prompt.test.mjs voice/tests/test_config.py
git commit -m "feat(web): ack de pesquisa na voz e prompt que conhece a pesquisa automática"
```

---

### Task 5: Rota nos três caminhos

**Files:**
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `planTurn` com `web` (Task 2), `webAnswer` e `webGuide` (Task 3), ack `"web"` (Task 4).

- [ ] **Step 1: Ligar o env e montar o system da pesquisa**

`planTurn(messages, { ..., web: process.env.WEB_SEARCH === "on" }, forceFull === true)`. Função local `webSystem()` = `promptFor("full", memories, myhub) + "\n\n" + webGuide()`.

- [ ] **Step 2: NDJSON**

No modo `stream === "ndjson"`, antes de `if (plan.sets)`: se `plan.web`, `write({ ack: "web" })`, `const r = await webAnswer(apiKey, webSystem(), messages)`, `write({ t: r.text })`, `meta = { mode: "full" }`, `tools = [r.ok ? "browser_search" : "browser_search:erro"]`, `chars = r.text.length`; o `else` mantém o caminho de hoje.

- [ ] **Step 3: Stream de texto do navegador**

No `stream === true`, antes de `openReply`: se `plan.web`, devolva `new NextResponse(r.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "x-beto-mode": "full" } })` e registre a métrica com `stream: true` e `tools` como acima.

- [ ] **Step 4: JSON**

No caminho JSON, antes de `if (plan.sets)`: se `plan.web`, `reply = r.text` e `tools` como acima.

- [ ] **Step 5: Typecheck and suite**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tudo passa.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(web): /api/chat responde turnos de pesquisa na voz, no stream e no JSON"
```

---

### Task 6: Ensaio com o Rodrigo

- [ ] **Step 1: Subir e perguntar**

Com `npm run dev` e o serviço de voz: "quanto tá o dólar agora", "quais as notícias de IA de hoje", "quem ganhou o jogo do Santos ontem", "qual a última versão do Next.js", "vai chover amanhã em Ubatuba". E uma de controle: "me explica como funciona a bolsa".
Expected: ack "Deixa eu pesquisar." nas cinco primeiras; fonte falada pelo nome; nenhum marcador ou URL na fala; a de controle responde sem pesquisar.

- [ ] **Step 2: Conferir métricas**

Run: `grep "beto-metrics" ` no log do `npm run dev`.
Expected: `"tools":["browser_search"]` nas cinco; anote o `total_ms` mediano na seção "Resultado do ensaio" no fim deste plano.

- [ ] **Step 3: Commit das anotações**

```bash
git add docs/superpowers/plans/2026-10-16-pesquisa-web.md
git commit -m "docs(web): resultado da sondagem e do ensaio da pesquisa"
```

---

## Resultado da sondagem

(preenchido na Task 1, Step 4)

## Resultado do ensaio

(preenchido na Task 6)
