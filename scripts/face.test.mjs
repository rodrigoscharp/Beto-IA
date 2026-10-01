import test from "node:test";
import assert from "node:assert/strict";
import {
  EMOTIONS, EXPRESSIONS, STATE_FACES, FACE_POINTS, FACE_LAYOUT,
  faceFor, faceTargets, lerpFace, applyLife, clusterOf, parseEmotion, EMOTION_TAG, emotionFromName,
} from "../components/face.ts";

const allFaces = [
  ...EMOTIONS.map((e) => [e, EXPRESSIONS[e]]),
  ...Object.entries(STATE_FACES),
];

const finite = (pts) => pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

test("toda emoção tem preset e nenhum sobra", () => {
  assert.deepEqual(Object.keys(EXPRESSIONS).sort(), [...EMOTIONS].sort());
  assert.equal(EMOTIONS.length, 9);
});

test("faceTargets: 320 pontos finitos para todo rosto e toda mistura entre dois rostos", () => {
  for (const [, a] of allFaces) {
    for (const [, b] of allFaces) {
      for (const t of [0, 0.5, 1]) {
        const pts = faceTargets(lerpFace(a, b, t), 1.7);
        assert.equal(pts.length, FACE_POINTS);
        assert.ok(finite(pts));
      }
    }
  }
});

test("faceTargets: parâmetros extremos não geram NaN nem Infinity", () => {
  for (const [, f] of allFaces) {
    const extreme = applyLife(f, { blink: 1, gazeX: 9, gazeY: -9, mouthOpen: 5 });
    assert.ok(finite(faceTargets(extreme)));
    const weird = {
      ...f,
      eyeL: { ...f.eyeL, open: 0 },
      eyeR: { ...f.eyeR, open: -1, lid: 1, cheek: 1 },
      mouth: { ...f.mouth, open: -3, width: 0 },
    };
    assert.ok(finite(faceTargets(weird)));
  }
});

test("rosto fica dentro do quadro (olhos, sobrancelhas e boca com |x|,|y| <= 1)", () => {
  for (const [, f] of allFaces) {
    faceTargets(f).forEach(([x, y], i) => {
      if (clusterOf(i) === "dust") return;
      assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1, `ponto ${i} fora: ${x},${y}`);
    });
  }
});

test("lerpFace: t=0 devolve a, t=1 devolve b, t=0.5 fica no meio", () => {
  const a = EXPRESSIONS.neutro, b = EXPRESSIONS.surpreso;
  assert.deepEqual(lerpFace(a, b, 0), a);
  assert.deepEqual(lerpFace(a, b, 1), b);
  const m = lerpFace(a, b, 0.5);
  assert.ok(Math.abs(m.mouth.open - (a.mouth.open + b.mouth.open) / 2) < 1e-9);
  assert.ok(Math.abs(m.eyeL.open - (a.eyeL.open + b.eyeL.open) / 2) < 1e-9);
});

test("lerpFace: matiz vai pelo caminho curto (bravo 4 -> sarcastico 330 passa por ~347)", () => {
  const mid = lerpFace(EXPRESSIONS.bravo, EXPRESSIONS.sarcastico, 0.5).hue;
  assert.ok(Math.abs(mid - 347) < 1, `hue ${mid}`);
});

test("applyLife: piscar fecha os olhos e o olhar é limitado a -1..1", () => {
  const f = applyLife(EXPRESSIONS.neutro, { blink: 1, gazeX: 9, gazeY: -9, mouthOpen: 0.4 });
  assert.equal(f.eyeL.open, 0);
  assert.equal(f.eyeR.open, 0);
  assert.equal(f.gazeX, 1);
  assert.equal(f.gazeY, -1);
  assert.ok(Math.abs(f.mouth.open - (EXPRESSIONS.neutro.mouth.open + 0.4)) < 1e-9);
  const open = applyLife(EXPRESSIONS.neutro, { blink: 0, gazeX: 0, gazeY: 0, mouthOpen: 0 });
  assert.equal(open.eyeL.open, EXPRESSIONS.neutro.eyeL.open);
});

test("boca fechada: lábio de cima e de baixo coincidem", () => {
  const pts = faceTargets({ ...EXPRESSIONS.neutro, mouth: { ...EXPRESSIONS.neutro.mouth, open: 0 } });
  const half = (FACE_LAYOUT.dust - FACE_LAYOUT.mouth) / 2;
  for (let i = 0; i < half; i++) {
    assert.deepEqual(pts[FACE_LAYOUT.mouth + i], pts[FACE_LAYOUT.mouth + half + i]);
  }
});

test("boca aberta: lábio de baixo fica abaixo do de cima", () => {
  const pts = faceTargets({ ...EXPRESSIONS.neutro, mouth: { ...EXPRESSIONS.neutro.mouth, open: 1 } });
  const half = (FACE_LAYOUT.dust - FACE_LAYOUT.mouth) / 2;
  const mid = Math.floor(half / 2);
  assert.ok(pts[FACE_LAYOUT.mouth + half + mid][1] > pts[FACE_LAYOUT.mouth + mid][1] + 0.05);
});

test("rosto neutro é simétrico: olho esquerdo espelha o direito", () => {
  const pts = faceTargets({ ...EXPRESSIONS.neutro, gazeX: 0, gazeY: 0, tilt: 0 });
  const eyeN = FACE_LAYOUT.brows / 2;
  const browN = (FACE_LAYOUT.mouth - FACE_LAYOUT.brows) / 2;
  for (let i = 0; i < eyeN; i++) {
    const l = pts[i], r = pts[eyeN + i];
    assert.ok(Math.abs(l[0] + r[0]) < 1e-9 && Math.abs(l[1] - r[1]) < 1e-9);
  }
  for (let i = 0; i < browN; i++) {
    const l = pts[FACE_LAYOUT.brows + i], r = pts[FACE_LAYOUT.brows + browN + i];
    assert.ok(Math.abs(l[0] + r[0]) < 1e-9 && Math.abs(l[1] - r[1]) < 1e-9);
  }
});

test("as 9 emoções geram rostos diferentes entre si", () => {
  for (let i = 0; i < EMOTIONS.length; i++) {
    for (let j = i + 1; j < EMOTIONS.length; j++) {
      const a = faceTargets(EXPRESSIONS[EMOTIONS[i]]);
      const b = faceTargets(EXPRESSIONS[EMOTIONS[j]]);
      let sum = 0, n = 0;
      a.forEach(([x, y], k) => {
        if (clusterOf(k) === "dust") return;
        sum += Math.hypot(x - b[k][0], y - b[k][1]); n++;
      });
      assert.ok(sum / n > 0.01, `${EMOTIONS[i]} e ${EMOTIONS[j]} parecem iguais`);
    }
  }
});

test("faceFor: speaking usa a emoção; os outros estados ignoram a emoção", () => {
  assert.equal(faceFor("speaking", "bravo"), EXPRESSIONS.bravo);
  assert.equal(faceFor("thinking", "bravo"), STATE_FACES.thinking);
  assert.equal(faceFor("listening", "bravo"), STATE_FACES.listening);
  assert.equal(faceFor("wake", "bravo"), STATE_FACES.wake);
});

test("clusterOf cobre 0..319 com o layout esperado", () => {
  assert.equal(FACE_POINTS, 320);
  const count = { eye: 0, brow: 0, mouth: 0, dust: 0 };
  for (let i = 0; i < FACE_POINTS; i++) count[clusterOf(i)]++;
  assert.deepEqual(count, { eye: 112, brow: 64, mouth: 96, dust: 48 });
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
