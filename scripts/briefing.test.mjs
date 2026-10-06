import test from "node:test";
import assert from "node:assert/strict";
import { buildBriefingRequest } from "../lib/briefing.ts";

const base = { dateLabel: "terça-feira, 6 de outubro de 2026", time: "08:30", period: "manhã",
  events: "Nenhum evento agendado para hoje.", emails: "Nenhum email não lido.", weather: "" };

test("o briefing recebe o My Hub (tarefas e projetos do dia), não só agenda e email", () => {
  const r = buildBriefingRequest({ ...base, myhub: { hoje: "2026-10-06", entrevistasProximas: [], topicos: { tarefas: ["Enviar proposta"] }, indisponiveis: [] } });
  const user = r.messages.at(-1).content;
  assert.ok(user.includes("Enviar proposta"));
  assert.ok(user.includes("My Hub"));
});

test("sem My Hub, o briefing diz que não viu (em vez de deixar o modelo supor)", () => {
  const user = buildBriefingRequest({ ...base, myhub: null }).messages.at(-1).content;
  assert.match(user, /My Hub: não consegui ver/);
});

test("o briefing não inventa: temperatura baixa, regra de vazio e nada de 'motivador'", () => {
  const r = buildBriefingRequest({ ...base, myhub: null });
  const sys = r.messages[0].content;
  assert.ok(r.temperature <= 0.3, `temperature ${r.temperature}`);
  assert.ok(sys.includes("nada registrado"));
  assert.ok(sys.includes("NUNCA"));
  assert.ok(!/motivador/i.test(sys));
});

test("My Hub muito grande é cortado (o prompt não estoura o modelo)", () => {
  const big = { hoje: "x", entrevistasProximas: [], topicos: { lixo: "a".repeat(20000) }, indisponiveis: [] };
  const user = buildBriefingRequest({ ...base, myhub: big }).messages.at(-1).content;
  assert.ok(user.length < 6000, String(user.length));
});
