/* Enquadramento do palco do mascote. Função pura (testada em scripts/stage.test.mjs).

   O canvas é um quadrado em volta do mascote, não a tela inteira: num monitor ultrawide (3440×1440) a tela cheia
   eram 5 milhões de pixels por quadro, com antialias e sombra, quase tudo transparente. A GPU que sobrava era a do
   VoiceStudio gerando a voz, e o mascote tinha de ficar a 30 quadros por segundo. Com o quadrado, o custo por quadro
   cai umas 5 vezes e ele volta a 60 sem tirar GPU da voz. */

export const FRAME_MS = 1000 / 60 - 1;   // teto de 60 quadros por segundo (o -1 absorve a variação do relógio)
export const FOV    = 30;
const VIEW   = 0.38;    // lado (m) do quadro que precisa caber: corpo + props (nuvem, Zzz, notas, vapor)
const CY     = 0.14;    // centro vertical desse quadro
// Janelinha no canto: fecha o enquadramento no corpo (props podem cortar) para ele não sumir lá dentro.
const VIEW_SMALL = 0.25;
const CY_SMALL   = 0.115;
const SMALL_PX   = 280;   // menor lado da janela (px) em que o zoom fechado vale inteiro
const LARGE_PX   = 600;   // a partir daqui, enquadramento normal
export const MAX_PX = 640;     // em tela grande ele para de crescer
export const ELEV   = 0.12;    // câmera um pouco acima, olhando levemente para baixo
/** Folga do canvas em volta do quadro VIEW: a sombra no chão e os props que escapam do quadro não cortam. */
export const CANVAS_MARGIN = 1.6;

export interface StageFit {
  side: number;       // lado do canvas quadrado (px CSS)
  px: number;         // pixels que o quadro VIEW ocupa
  view: number;       // lado do quadro (m)
  cy: number;         // centro vertical do quadro (m)
  visibleH: number;   // altura que a câmera enxerga no canvas (m)
  distance: number;   // distância da câmera ao centro do quadro (m)
}

export function stageFit(w: number, h: number): StageFit {
  const min = Math.max(1, Math.min(w, h));
  const t = Math.min(Math.max((min - SMALL_PX) / (LARGE_PX - SMALL_PX), 0), 1);   // 0 = janelinha, 1 = normal
  const view = VIEW_SMALL + (VIEW - VIEW_SMALL) * t;
  const cy = CY_SMALL + (CY - CY_SMALL) * t;
  const px = Math.min(min * (0.96 - 0.08 * t), MAX_PX);
  const side = Math.min(min, Math.ceil(px * CANVAS_MARGIN));
  const visibleH = view * side / px;
  const distance = visibleH / 2 / Math.tan((FOV * Math.PI) / 360);
  return { side, px, view, cy, visibleH, distance };
}
