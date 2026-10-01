import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, NEED_TOOLS_TAG } from "../lib/prompt.ts";

const input = {
  memories: [{ content: "acorda cedo", category: "habit" }],
  myhubBlock: "\n\nMYHUB-CTX",
  date: "2026-10-01", dateLabel: "quinta-feira, 1 de outubro", time: "09:00", period: "manhã",
};
const full = buildSystemPrompt(input, "full");
const chat = buildSystemPrompt(input, "chat");

test("modo completo traz todas as integrações e o contexto do My Hub", () => {
  for (const block of ["━━━ SPOTIFY ━━━", "━━━ GOOGLE CALENDAR ━━━", "━━━ GITHUB ━━━", "━━━ TIMER / POMODORO ━━━",
    "━━━ GMAIL ━━━", "━━━ BRIEFING ━━━", "━━━ MEMÓRIA ━━━", "REGRA DE TAGS", "MYHUB-CTX"]) {
    assert.ok(full.includes(block), block);
  }
  assert.ok(full.includes("Hoje é 2026-10-01 (Brasília)"));
});

test("modo conversa não leva integrações nem My Hub, mas leva a personalidade e a emoção", () => {
  assert.ok(!chat.includes("━━━ SPOTIFY"));
  assert.ok(!chat.includes("REGRA DE TAGS"));
  assert.ok(!chat.includes("MYHUB-CTX"));
  for (const keep of ["Você é o BETO", "EMOÇÃO (OBRIGATÓRIO", "REGRA DE VOZ", "HONESTIDADE", "TAMANHO:", "acorda cedo", "quinta-feira, 1 de outubro"]) {
    assert.ok(chat.includes(keep), keep);
  }
  assert.ok(chat.includes(NEED_TOOLS_TAG));
});

test("modo conversa é bem menor que o completo", () => {
  assert.ok(chat.length < full.length * 0.7, `${chat.length} vs ${full.length}`);
});

test("o prompt pede respostas mais curtas e oferece detalhar", () => {
  for (const p of [full, chat]) {
    assert.ok(p.includes("30 a 80 palavras"));
    assert.ok(p.includes("quer que eu detalhe?"));
    assert.ok(!p.includes("50 a 150 palavras"));
  }
});

test("sem memórias não sobra bloco vazio", () => {
  const p = buildSystemPrompt({ ...input, memories: [] }, "chat");
  assert.ok(!p.includes("MEMÓRIAS SOBRE O RODRIGO"));
});

test("o marcador de ferramentas é o texto exato que o servidor procura", () => {
  assert.equal(NEED_TOOLS_TAG, "[NEEDTOOLS]");
});
