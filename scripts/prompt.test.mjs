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

test("modo conversa não leva integrações, mas leva o My Hub (leitura), a personalidade e a emoção", () => {
  assert.ok(!chat.includes("━━━ SPOTIFY"));
  assert.ok(!chat.includes("REGRA DE TAGS"));
  assert.ok(chat.includes("MYHUB-CTX"), "sem o My Hub ele não consegue ligar a conversa à vida do chefe");
  for (const keep of ["Você é o BETO", "EMOÇÃO (OBRIGATÓRIO", "REGRA DE VOZ", "HONESTIDADE", "TAMANHO", "acorda cedo", "quinta-feira, 1 de outubro"]) {
    assert.ok(chat.includes(keep), keep);
  }
  assert.ok(chat.includes(NEED_TOOLS_TAG));
});

test("modo conversa é bem menor que o completo", () => {
  // As regras de fala (tamanho, variar, contexto, próximo passo) valem nos dois modos, então a folga é menor que antes.
  assert.ok(chat.length < full.length * 0.75, `${chat.length} vs ${full.length}`);
});

test("tamanho por tipo de pergunta, sem faixa fixa nem fecho padrão", () => {
  for (const p of [full, chat]) {
    assert.ok(!p.includes("30 a 80 palavras"), "faixa única para tudo saiu");
    assert.ok(!p.includes("50 a 150 palavras"));
    assert.ok(!p.includes('termine com "quer que eu detalhe?"'), "oferecer detalhe não é fecho padrão");
    for (const k of ["Fato, comando ou sim/não", "Decisão de peso", "uma frase"]) assert.ok(p.includes(k), k);
  }
});

test("fala natural: sem lista de bordões para copiar, com regra de variar e de não encher linguiça", () => {
  for (const p of [full, chat]) {
    assert.ok(!p.includes('"e aí, chefe", "beleza", "bora"'), "lista de bordões vira script");
    assert.ok(p.includes("VARIE"), "regra de variar abertura e fecho");
    assert.ok(p.includes("Boa pergunta"), "proíbe abertura de enchimento");
    assert.ok(/"chefe"[^.]*no máximo uma vez a cada três ou quatro respostas/.test(p), "limite de 'chefe'");
  }
});

test("contexto e próximo passo: liga ao que já sabe e fecha com gancho concreto, nunca genérico", () => {
  for (const p of [full, chat]) {
    assert.ok(p.includes("USE O QUE VOCÊ JÁ SABE"));
    assert.ok(p.includes("nunca peça o que ele já disse"));
    assert.ok(p.includes("PRÓXIMO PASSO"));
    assert.ok(p.includes('"mais alguma coisa?"'), "proíbe gancho genérico");
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

test("com content: o guia da ferramenta de plano entra e manda dar briefing falado, sem inventar roteiro", () => {
  const p = buildSystemPrompt({ ...input, content: true }, "full");
  for (const k of ["content_plan", "briefing", "fala por fala"]) assert.ok(p.includes(k), k);
  assert.ok(!full.includes("━━━ PLANOS DE CONTEÚDO (FERRAMENTA)"), "sem a flag, o guia não entra");
});

test("saudação: cumprimenta e traz no máximo uma coisa real dos dados, sem inventar", () => {
  for (const p of [full, chat]) {
    assert.ok(p.includes("SAUDAÇÃO"));
    assert.ok(/SAUDAÇÃO[^\n]*UMA coisa[^\n]*DADOS/.test(p), "uma coisa só, e só dos dados");
    assert.ok(/SAUDAÇÃO[^\n]*nada relevante[^\n]*briefing/.test(p), "sem nada nos dados: só cumprimenta e oferece o briefing");
  }
  assert.ok(!full.includes("(o app já cuida disso)"), "a saudação não é mais só do app");
});

const OLD_HONESTY = "Você não tem acesso à internet nem a dados em tempo real (notícias, cotações, placar, clima) fora das integrações abaixo; se ele pedir isso e não houver tag adequada, diga que não consegue ver isso agora e ofereça o que puder com base no que você sabe.";

test("HONESTIDADE com web: pesquisa automática e sugestão de pedir 'pesquisa'", () => {
  for (const mode of ["full", "chat"]) {
    const p = buildSystemPrompt({ ...input, web: true }, mode);
    assert.ok(p.includes("a pesquisa na web acontece automaticamente"), mode);
    assert.ok(p.includes('"pesquisa"'), mode);
    assert.ok(!p.includes("Você não tem acesso à internet"), mode);
  }
});

test("HONESTIDADE sem web (padrão e bateria de avaliação): a frase antiga, exata", () => {
  for (const p of [full, chat, buildSystemPrompt({ ...input, web: false }, "full")]) {
    assert.ok(p.includes(OLD_HONESTY));
    assert.ok(!p.includes("a pesquisa na web acontece automaticamente"));
  }
});
