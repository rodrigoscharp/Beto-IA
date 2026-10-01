import test from "node:test";
import assert from "node:assert/strict";
import { runToolLoop } from "../lib/toolloop.ts";

const turn = (content, calls = []) => ({ content, toolCalls: calls.map((c, i) => ({ id: c.id ?? `c${i}`, name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args ?? {}) })) });
const script = (turns) => { let i = 0; const seen = []; return { complete: async (msgs) => { seen.push(structuredClone(msgs)); return turns[i++]; }, seen }; };

test("sem chamada de ferramenta: devolve o texto direto, em 1 passo", async () => {
  const s = script([turn("  Oi, chefe.  ")]);
  const r = await runToolLoop({ messages: [{ role: "user", content: "oi" }], complete: s.complete, execute: async () => { throw new Error("não devia"); } });
  assert.equal(r.text, "Oi, chefe.");
  assert.equal(r.steps, 1);
  assert.deepEqual(r.calls, []);
});

test("executa a ferramenta, devolve o resultado ao modelo e usa a resposta final", async () => {
  const s = script([turn("", [{ name: "list_events", args: { start: "2026-10-02" } }]), turn("Você tem uma reunião às 15h.")]);
  const executed = [];
  const r = await runToolLoop({
    messages: [{ role: "user", content: "o que tenho amanhã" }],
    complete: s.complete,
    execute: async (name, args) => { executed.push([name, args]); return { events: [{ title: "Reunião" }] }; },
  });
  assert.deepEqual(executed, [["list_events", { start: "2026-10-02" }]]);
  assert.equal(r.text, "Você tem uma reunião às 15h.");
  assert.equal(r.steps, 2);
  const second = s.seen[1];
  const asst = second.at(-2), tool = second.at(-1);
  assert.equal(asst.role, "assistant");
  assert.equal(asst.tool_calls[0].function.name, "list_events");
  assert.equal(tool.role, "tool");
  assert.equal(tool.tool_call_id, "c0");
  assert.deepEqual(JSON.parse(tool.content), { events: [{ title: "Reunião" }] });
});

test("vários passos encadeados (achar horário, depois criar)", async () => {
  const s = script([
    turn("", [{ name: "find_free_slots", args: { date: "2026-10-02", duration_min: 60 } }]),
    turn("", [{ name: "create_event", args: { title: "João", start: "2026-10-02T10:00" } }]),
    turn("Marquei com o João às 10h."),
  ]);
  const names = [];
  const r = await runToolLoop({ messages: [], complete: s.complete, execute: async (n) => { names.push(n); return { ok: true }; } });
  assert.deepEqual(names, ["find_free_slots", "create_event"]);
  assert.equal(r.text, "Marquei com o João às 10h.");
  assert.equal(r.steps, 3);
  assert.deepEqual(r.calls.map((c) => c.name), ["find_free_slots", "create_event"]);
});

test("várias chamadas no mesmo passo rodam em ordem e cada resultado volta com o id certo", async () => {
  const s = script([turn("", [{ id: "a", name: "x" }, { id: "b", name: "y" }]), turn("ok")]);
  const order = [];
  await runToolLoop({ messages: [], complete: s.complete, execute: async (n) => { order.push(n); return n; } });
  assert.deepEqual(order, ["x", "y"]);
  const tools = s.seen[1].filter((m) => m.role === "tool");
  assert.deepEqual(tools.map((t) => t.tool_call_id), ["a", "b"]);
});

test("argumentos que não são JSON viram erro devolvido ao modelo, sem executar", async () => {
  const s = script([turn("", [{ name: "x", args: "{quebrado" }]), turn("Não deu, chefe.")]);
  let ran = false;
  const r = await runToolLoop({ messages: [], complete: s.complete, execute: async () => { ran = true; return 1; } });
  assert.equal(ran, false);
  assert.match(JSON.parse(s.seen[1].at(-1).content).error, /JSON/);
  assert.equal(r.text, "Não deu, chefe.");
  assert.equal(r.calls[0].ok, false);
});

test("ferramenta que lança erro: o erro volta ao modelo e o laço continua", async () => {
  const s = script([turn("", [{ name: "x" }]), turn("Tive um problema com a agenda.")]);
  const r = await runToolLoop({ messages: [], complete: s.complete, execute: async () => { throw new Error("google fora do ar"); } });
  assert.equal(JSON.parse(s.seen[1].at(-1).content).error, "google fora do ar");
  assert.equal(r.text, "Tive um problema com a agenda.");
  assert.equal(r.calls[0].ok, false);
});

test("limite de passos: para e avisa em vez de rodar para sempre", async () => {
  const s = script(Array.from({ length: 10 }, () => turn("", [{ name: "x" }])));
  const r = await runToolLoop({ messages: [], complete: s.complete, execute: async () => ({}), maxSteps: 3 });
  assert.equal(r.hitLimit, true);
  assert.equal(r.text, "");
  assert.equal(r.steps, 3);
});

test("resultado enorme é cortado antes de voltar ao modelo", async () => {
  const s = script([turn("", [{ name: "x" }]), turn("ok")]);
  await runToolLoop({ messages: [], complete: s.complete, execute: async () => ({ blob: "z".repeat(50_000) }) });
  assert.ok(s.seen[1].at(-1).content.length <= 6100);
});

test("mais de 4 chamadas no mesmo passo: só as 4 primeiras rodam", async () => {
  const calls = Array.from({ length: 7 }, (_, i) => ({ id: `k${i}`, name: "x" }));
  const s = script([turn("", calls), turn("ok")]);
  let n = 0;
  await runToolLoop({ messages: [], complete: s.complete, execute: async () => { n++; return {}; } });
  assert.equal(n, 4);
  assert.equal(s.seen[1].filter((m) => m.role === "tool").length, 7, "toda chamada recebe uma resposta, senão a API recusa");
});

test("erro do modelo (complete) sobe para quem chamou", async () => {
  await assert.rejects(runToolLoop({ messages: [], complete: async () => { throw new Error("groq caiu"); }, execute: async () => ({}) }), /groq caiu/);
});
