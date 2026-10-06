import test from "node:test";
import assert from "node:assert/strict";
import { myHubPromptBlock } from "../lib/myhubprompt.ts";

const ctx = {
  hoje: "2026-10-02", entrevistasProximas: [], topicos: { financas: { saldo: "R$ 1.000,00" } }, indisponiveis: [],
  acoes: "registrarTransacao (tipo*, valorEmReais*, descricao*, categoria, conta, data)\nregistrarCheckinHabito (habito*, quantidade)",
  referencias: { contas: ["Carteira", "PJ"], categoriasDeDespesa: ["Mercado", "Gasolina"], categoriasDeReceita: ["Freelance"], habitos: ["Beber água"], projetos: [], trilhas: [] },
};

test("sem contexto não há bloco", () => {
  assert.equal(myHubPromptBlock(null, "2026-10-02", { writeConfigured: true, tools: true }), "");
});

test("sem escrita configurada: só leitura, e avisa que registrar é direto no My Hub", () => {
  const p = myHubPromptBlock(ctx, "2026-10-02", { writeConfigured: false, tools: true });
  assert.ok(p.includes("DADOS:"));
  assert.ok(p.includes("só LÊ"));
  assert.ok(!p.includes("my_hub_register"));
});

test("com ferramentas: instruções de ferramenta, catálogo, nomes e regra de valor; nenhuma tag antiga", () => {
  const p = myHubPromptBlock(ctx, "2026-10-02", { writeConfigured: true, tools: true });
  for (const k of ["my_hub_register", "my_hub_undo", "registrarTransacao", "registrarCheckinHabito", "Carteira, PJ", "Mercado, Gasolina",
    "ask_with", "ALGARISMOS", "NÚMERO em reais", "needs_confirmation", "status registered", "2026-10-02", "treino de academia"]) assert.ok(p.includes(k), k);
  assert.ok(!p.includes("[MYHUB:"), "sem tag");
});

test("com escrita mas sem as ferramentas nesta conversa: manda escalar com [NEEDTOOLS] e não ensina a registrar", () => {
  const p = myHubPromptBlock(ctx, "2026-10-02", { writeConfigured: true, tools: false });
  assert.ok(p.includes("[NEEDTOOLS]"));
  assert.ok(!p.includes("registrarTransacao (tipo*"), "o catálogo só vai junto das ferramentas");
  assert.ok(p.includes("DADOS:"));
});

test("dados enormes são cortados para não estourar o prompt", () => {
  const big = { ...ctx, topicos: { lixo: "x".repeat(20_000) } };
  const p = myHubPromptBlock(big, "2026-10-02", { writeConfigured: true, tools: true });
  assert.ok(p.includes("cortado por tamanho"));
  assert.ok(p.length < 20_000);
});

test("seções indisponíveis são avisadas", () => {
  const p = myHubPromptBlock({ ...ctx, indisponiveis: ["treinos"] }, "2026-10-02", { writeConfigured: true, tools: true });
  assert.ok(p.includes("treinos"));
});

test("planos de conteúdo saem dos DADOS e entram num bloco próprio (o roteiro é pela ferramenta)", () => {
  const ctx = { hoje: "06/10/2026", entrevistasProximas: [], topicos: { financas: { saldo: "R$ 10,00" },
    planos: [{ plano: "Marca 10K", prazo: "31/12/2026", pendentes: ["Esta semana: Gravar Ep. 2"], secoes: ["Ep. 2 — A conta"] }] }, indisponiveis: [] };
  const b = myHubPromptBlock(ctx, "2026-10-06", { writeConfigured: false, tools: false });
  assert.ok(b.includes("PLANOS DE CONTEÚDO"));
  assert.ok(b.includes("Gravar Ep. 2"));
  assert.ok(b.includes("content_plan"));
  const dados = b.slice(b.indexOf("DADOS:"), b.indexOf("PLANOS DE CONTEÚDO"));
  assert.ok(!dados.includes("Marca 10K"), "planos não ocupam o teto dos DADOS");
});
