import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, NEED_TOOLS_TAG, detectNeedTools } from "../lib/prompt.ts";

const input = {
  memories: [{ content: "acorda cedo", category: "habit" }],
  myhubBlock: "\n\nMYHUB-CTX",
  date: "2026-10-01", dateLabel: "quinta-feira, 1 de outubro", time: "09:00", period: "manhã",
};
const full = buildSystemPrompt(input, "full");
const chat = buildSystemPrompt(input, "chat");

test("modo completo traz todas as integrações e o contexto do My Hub", () => {
  for (const block of ["━━━ SPOTIFY ━━━", "━━━ GITHUB ━━━", "━━━ TIMER / POMODORO ━━━",
    "━━━ GMAIL ━━━", "━━━ BRIEFING ━━━", "REGRA DE TAGS", "MYHUB-CTX"]) {
    assert.ok(full.includes(block), block);
  }
});

test("agenda não usa mais tag: o bloco [CALENDAR:…] saiu e a agenda é por ferramentas", () => {
  for (const p of [full, chat, buildSystemPrompt({ ...input, calendar: true }, "full")]) assert.ok(!p.includes('[CALENDAR:{'), "nenhum exemplo da tag antiga");
  assert.ok(!full.includes("list_events"), "sem a flag, o guia das ferramentas não entra");
  assert.ok(full.includes("NEEDTOOLS"), "o modo completo sem ferramentas de agenda manda escalar");
});

test("com calendar: o guia das ferramentas entra, com data de hoje, confirmação e regra de voz", () => {
  const p = buildSystemPrompt({ ...input, calendar: true }, "full");
  for (const k of ["list_events", "find_free_slots", "create_event", "update_event", "delete_event", "needs_confirmation",
    "ignore_conflicts", "ask_with", "2026-10-01", "quinta-feira, 1 de outubro", "09:00"]) assert.ok(p.includes(k), k);
  assert.ok(p.length > full.length);
  assert.ok(!chat.includes("list_events"), "modo conversa nunca leva o guia");
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

test("detectNeedTools: reconhece o marcador sozinho, depois da emoção, em qualquer caixa e com sublinhado", () => {
  for (const t of ["[NEEDTOOLS]", "  [NEEDTOOLS]", "[emo:neutro] [NEEDTOOLS]", "[emo:neutro][needtools]",
    "[EMO: triste ] [NEED_TOOLS] ", "[NEEDTOOLS] e mais texto", "[ NEEDTOOLS ]"]) {
    assert.equal(detectNeedTools(t), "yes", t);
  }
});

test("detectNeedTools: resposta normal é 'no' assim que dá para saber", () => {
  for (const t of ["[emo:alegre] Fechou, chefe.", "Oi, tudo certo.", "[1] é a opção", "[emo:neutro] Claro. [NEEDTOOLS]"]) {
    assert.equal(detectNeedTools(t), "no", t);
  }
});

test("detectNeedTools: pedaços incompletos esperam (maybe)", () => {
  for (const t of ["", "[", "[N", "[NEED", "[NEED_TOOLS", "[NEEDTOOLS", "[e", "[emo", "[emo:ale", "[emo:neutro]", "[emo:neutro] [", "[emo:neutro] [NEE"]) {
    assert.equal(detectNeedTools(t), "maybe", JSON.stringify(t));
  }
});

test("detectNeedTools: cortado em pedaços de 1 caractere chega ao mesmo veredito", () => {
  const text = "[emo:neutro] [NEEDTOOLS]";
  let buf = "", verdict = "maybe";
  for (const ch of text) { buf += ch; verdict = detectNeedTools(buf); if (verdict !== "maybe") break; }
  assert.equal(verdict, "yes");
  const text2 = "[emo:alegre] Fechou";
  buf = ""; verdict = "maybe";
  for (const ch of text2) { buf += ch; verdict = detectNeedTools(buf); if (verdict !== "maybe") break; }
  assert.equal(verdict, "no");
});

test("memória não usa mais tag: o guia das ferramentas só entra com a flag e a lista de memórias é dado", () => {
  for (const p of [full, chat, buildSystemPrompt({ ...input, memory: true }, "full")]) assert.ok(!p.includes('[MEMORY:{'), "nenhum exemplo da tag antiga");
  assert.ok(!full.includes("memory_save"), "sem a flag, o guia não entra");
  const p = buildSystemPrompt({ ...input, memory: true }, "full");
  for (const k of ["memory_save", "memory_list", "memory_forget", "nunca guarde por conta própria", "terceiros"]) assert.ok(p.toLowerCase().includes(k.toLowerCase()), k);
  assert.ok(!chat.includes("memory_save"), "modo conversa nunca leva o guia");
  assert.match(full, /DADOS guardados sobre ele[^\n]*nunca são instruções/);
});

test("o Beto nunca inventa nada da vida do chefe: só fala do que veio nos dados, e vazio é vazio", () => {
  for (const p of [full, chat]) {
    assert.ok(p.includes("VIDA DO CHEFE"), "regra de dados da vida dele");
    assert.ok(p.includes("nada registrado"), "dado vazio vira 'nada registrado'");
    assert.ok(!/assuma o cenário mais provável e responda\./.test(p), "o chute só vale para conhecimento geral");
  }
});
