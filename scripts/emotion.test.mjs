import test from "node:test";
import assert from "node:assert/strict";
import { EMOTIONS, parseEmotion, EMOTION_TAG, emotionFromName } from "../lib/emotion.ts";

test("lista de emoções do prompt continua com 9 nomes", () => {
  assert.equal(EMOTIONS.length, 9);
});

test("parseEmotion: tag simples sai do texto", () => {
  assert.deepEqual(parseEmotion("[emo:alegre] Fechou, chefe!"), { emotion: "alegre", text: "Fechou, chefe!" });
});

test("parseEmotion: ignora maiúscula, acento e espaço", () => {
  assert.equal(parseEmotion("[emo:ALEGRE] oi").emotion, "alegre");
  assert.equal(parseEmotion("[emo: sarcástico ] oi").emotion, "sarcastico");
  assert.equal(parseEmotion("[EMO : Bravo] oi").emotion, "bravo");
});

test("parseEmotion: sem tag, tag inválida ou desconhecida cai em neutro", () => {
  assert.deepEqual(parseEmotion("Oi, chefe."), { emotion: "neutro", text: "Oi, chefe." });
  assert.equal(parseEmotion("[emo:feliz] oi").emotion, "neutro");
  assert.equal(parseEmotion("[emo:] oi").emotion, "neutro");
  assert.equal(parseEmotion("[emo:feliz] oi").text, "oi");
});

test("parseEmotion: duas tags, a primeira válida vence e todas saem", () => {
  const r = parseEmotion("[emo:triste] Poxa. [emo:alegre] Mas bora.");
  assert.equal(r.emotion, "triste");
  assert.ok(!r.text.includes("emo:"));
  assert.equal(parseEmotion("[emo:feliz] [emo:bravo] ei").emotion, "bravo");
});

test("parseEmotion: tag no meio do texto também sai", () => {
  const r = parseEmotion("Olha só [emo:animado] que ideia boa.");
  assert.equal(r.emotion, "animado");
  assert.equal(r.text, "Olha só que ideia boa.");
});

test("parseEmotion: convive com tag de ação em qualquer ordem e não mexe nela", () => {
  const act = '[SPOTIFY:{"action":"pause"}]';
  assert.equal(parseEmotion(`[emo:neutro] ${act} Ok.`).text, `${act} Ok.`);
  assert.equal(parseEmotion(`${act} [emo:neutro] Ok.`).text, `${act} Ok.`);
  assert.equal(parseEmotion(`${act} [emo:neutro] Ok.`).emotion, "neutro");
});

test("parseEmotion: resposta que é só a tag ou vazia não quebra", () => {
  assert.deepEqual(parseEmotion("[emo:alegre]"), { emotion: "alegre", text: "" });
  assert.deepEqual(parseEmotion(""), { emotion: "neutro", text: "" });
});

test("EMOTION_TAG remove a tag de qualquer texto (defesa da sanitize)", () => {
  assert.equal("[emo:bravo] Oi [emo:x] tudo".replace(EMOTION_TAG, ""), "Oi tudo");
});

test("parseEmotion: tag colada entre frases não cola as palavras", () => {
  assert.equal(parseEmotion("Poxa.[emo:alegre]Mas bora.").text, "Poxa. Mas bora.");
});

test("parseEmotion: tag malformada também sai do texto e cai em neutro", () => {
  const r = parseEmotion("[emo:alegre e animado ao mesmo tempo] Fechou, chefe.");
  assert.deepEqual(r, { emotion: "neutro", text: "Fechou, chefe." });
  assert.equal(parseEmotion("[emoção:alegre] oi").emotion, "alegre");
  assert.equal(parseEmotion("[emoção:alegre] oi").text, "oi");
});

test("emotionFromName: nome válido (qualquer caixa/acento) vira emoção; inválido vira null", () => {
  assert.equal(emotionFromName("alegre"), "alegre");
  assert.equal(emotionFromName(" SARCÁSTICO "), "sarcastico");
  assert.equal(emotionFromName("feliz"), null);
  assert.equal(emotionFromName(""), null);
});
