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
