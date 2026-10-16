import test from "node:test";
import assert from "node:assert/strict";
import { stageFit, CANVAS_MARGIN, FRAME_MS, MAX_PX } from "../components/mascot/stage.ts";

test("monitor ultrawide: o canvas é um quadrado em volta do mascote, não a tela inteira", () => {
  const f = stageFit(3440, 1440);
  assert.equal(f.px, MAX_PX);
  assert.equal(f.side, Math.ceil(MAX_PX * CANVAS_MARGIN));
  assert.ok(f.side * f.side < 3440 * 1440 / 4, "pelo menos 4x menos pixels que a tela");
});

test("o canvas nunca passa da janela e o quadro do mascote sempre cabe nele", () => {
  for (const [w, h] of [[3440, 1440], [1080, 1920], [1512, 982], [400, 300], [300, 700], [1, 1]]) {
    const f = stageFit(w, h);
    assert.ok(f.side <= Math.min(w, h), `${w}x${h}: side ${f.side}`);
    assert.ok(f.px <= f.side, `${w}x${h}: px ${f.px} > side ${f.side}`);
    assert.ok(f.view > 0 && Number.isFinite(f.cy) && Number.isFinite(f.distance), `${w}x${h}`);
  }
});

test("janelinha no canto fecha o zoom no corpo; tela grande usa o enquadramento normal", () => {
  assert.ok(stageFit(280, 280).view < stageFit(1440, 1440).view);
  assert.equal(stageFit(1440, 1440).view, stageFit(3440, 1440).view);
});

test("mesmo tamanho do mascote na tela que o palco em tela cheia de antes", () => {
  // Antes: canvas w×h, altura visível view*h/px. Agora: canvas side×side, altura visível view*side/px.
  // Em ambos o quadro VIEW ocupa px pixels: a escala por pixel é view/px.
  const f = stageFit(3440, 1440);
  assert.equal(f.visibleH / f.side, f.view / f.px);
});

test("teto de 60 quadros por segundo", () => {
  assert.ok(FRAME_MS > 15 && FRAME_MS < 1000 / 60);
});
