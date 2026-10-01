/* Rosto do Beto: parâmetros, presets e pontos-alvo das partículas.
   Só funções puras (nada de canvas), para testar e ajustar as expressões sem abrir o app.
   Coordenadas: unidade do rosto, origem no centro, x para a direita, y para BAIXO.
   O Orb multiplica pela escala em pixels. */

export const EMOTIONS = [
  "neutro", "alegre", "animado", "pensativo", "bravo", "nervoso", "surpreso", "triste", "sarcastico",
] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type FaceState = "wake" | "listening" | "thinking" | "speaking";

export interface EyeParams   { open: number; lid: number; slant: number; cheek: number }
export interface BrowParams  { y: number; angle: number; arch: number }
export interface MouthParams { curve: number; open: number; width: number; skew: number }

/* open:  abertura do olho (0 fechado, ~1 normal, >1 arregalado)
   lid:   quanto a pálpebra de cima cobre (0..1)
   slant: inclinação da pálpebra (>0 ponta de dentro mais baixa = bravo; <0 = triste)
   cheek: bochecha sobe e fecha o olho por baixo (0..1, sorriso de olho)
   brow.y: deslocamento vertical (negativo sobe); angle em rad (>0 ponta de dentro desce = bravo); arch: arco
   mouth.curve: -1 triste .. +1 sorriso; open: abertura; width: largura relativa; skew: canto direito sobe (<0) ou desce (>0) */
export interface Face {
  eyeL: EyeParams; eyeR: EyeParams;
  browL: BrowParams; browR: BrowParams;
  mouth: MouthParams;
  gazeX: number; gazeY: number;   // -1..1
  tilt: number;                   // rad, cabeça inclinada
  jitter: number;                 // 0..1, multiplica o tremor das partículas
  hue: number;                    // 0..360
}

/* ── Presets ─────────────────────────────────────────────────────────────── */

const eye   = (open: number, lid = 0, slant = 0, cheek = 0): EyeParams => ({ open, lid, slant, cheek });
const brow  = (y: number, angle: number, arch = 0.3): BrowParams => ({ y, angle, arch });
const mouth = (curve: number, open: number, width: number, skew = 0): MouthParams => ({ curve, open, width, skew });

const BASE: Face = {
  eyeL: eye(0.9), eyeR: eye(0.9),
  browL: brow(0, 0), browR: brow(0, 0),
  mouth: mouth(0.15, 0, 1),
  gazeX: 0, gazeY: 0, tilt: 0, jitter: 0.15, hue: 205,
};
const mk = (o: Partial<Face>): Face => ({ ...BASE, ...o });

export const EXPRESSIONS: Record<Emotion, Face> = {
  neutro: mk({}),
  alegre: mk({
    eyeL: eye(0.85, 0, 0, 0.28), eyeR: eye(0.85, 0, 0, 0.28),
    browL: brow(-0.03, 0, 0.5), browR: brow(-0.03, 0, 0.5),
    mouth: mouth(0.8, 0.25, 1.15), tilt: 0.02, jitter: 0.2, hue: 45,
  }),
  animado: mk({
    eyeL: eye(1.2, 0, 0, 0.1), eyeR: eye(1.2, 0, 0, 0.1),
    browL: brow(-0.09, -0.05, 0.6), browR: brow(-0.09, -0.05, 0.6),
    mouth: mouth(1, 0.7, 1.3), tilt: -0.05, jitter: 0.5, hue: 28,
  }),
  pensativo: mk({
    eyeL: eye(0.75, 0.1, 0.15), eyeR: eye(0.75, 0.1, 0.15),
    browL: brow(-0.06, -0.12, 0.4), browR: brow(0.02, 0.2, 0.2),
    mouth: mouth(-0.05, 0, 0.6, 0.3), gazeX: 0.5, gazeY: -0.6, tilt: 0.06, jitter: 0.1, hue: 265,
  }),
  bravo: mk({
    eyeL: eye(0.8, 0.35, 0.9, 0.05), eyeR: eye(0.8, 0.35, 0.9, 0.05),
    browL: brow(0.04, 0.42, -0.1), browR: brow(0.04, 0.42, -0.1),
    mouth: mouth(-0.55, 0.05, 0.9), jitter: 0.6, hue: 4,
  }),
  nervoso: mk({
    eyeL: eye(1.25, 0, -0.1), eyeR: eye(1.25, 0, -0.1),
    browL: brow(-0.06, -0.3, 0.2), browR: brow(-0.06, -0.3, 0.2),
    mouth: mouth(-0.15, 0.15, 0.7), jitter: 1, hue: 95,
  }),
  surpreso: mk({
    eyeL: eye(1.4), eyeR: eye(1.4),
    browL: brow(-0.12, 0, 0.7), browR: brow(-0.12, 0, 0.7),
    mouth: mouth(0, 0.9, 0.45), jitter: 0.3, hue: 175,
  }),
  triste: mk({
    eyeL: eye(0.7, 0.25, -0.8), eyeR: eye(0.7, 0.25, -0.8),
    browL: brow(-0.02, -0.4, 0.1), browR: brow(-0.02, -0.4, 0.1),
    mouth: mouth(-0.75, 0, 0.85), gazeY: 0.5, jitter: 0.1, hue: 228,
  }),
  sarcastico: mk({
    eyeL: eye(0.55, 0.4, 0.2), eyeR: eye(0.75, 0.15, -0.1),
    browL: brow(-0.02, 0.15, 0.3), browR: brow(-0.14, -0.25, 0.8),
    mouth: mouth(0.35, 0, 1, -0.6), tilt: 0.07, jitter: 0.15, hue: 330,
  }),
};

/* Estados de voz: só `speaking` usa a emoção; os outros têm rosto próprio. */
export const STATE_FACES: Record<"wake" | "listening" | "thinking", Face> = {
  wake: mk({
    eyeL: eye(0.3), eyeR: eye(0.3),
    browL: brow(0.05, 0, 0.2), browR: brow(0.05, 0, 0.2),
    mouth: mouth(0.1, 0, 0.6), jitter: 0.1, hue: 215,
  }),
  listening: mk({
    eyeL: eye(1.15), eyeR: eye(1.15),
    browL: brow(-0.06, 0, 0.5), browR: brow(-0.06, 0, 0.5),
    mouth: mouth(0.1, 0, 0.7), hue: 188,
  }),
  thinking: mk({
    eyeL: eye(0.8, 0.1, 0.1), eyeR: eye(0.8, 0.1, 0.1),
    browL: brow(-0.05, -0.1, 0.4), browR: brow(0.03, 0.25, 0.2),
    mouth: mouth(-0.05, 0, 0.45, 0.4), gazeX: 0.6, gazeY: -0.8, hue: 265,
  }),
};

export function faceFor(state: FaceState, emotion: Emotion): Face {
  return state === "speaking" ? EXPRESSIONS[emotion] : STATE_FACES[state];
}

/* ── Interpolação e vida própria ─────────────────────────────────────────── */

function lerpObj<T extends object>(a: T, b: T, t: number): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(a) as (keyof T & string)[]) {
    const av = a[key], bv = b[key];
    out[key] = typeof av === "number" && typeof bv === "number"
      ? av * (1 - t) + bv * t      // exato em t=0 e t=1
      : lerpObj(av as object, bv as object, t);
  }
  return out as T;
}

export function lerpFace(a: Face, b: Face, t: number): Face {
  const out = lerpObj(a, b, t);
  // matiz é circular: vai pelo caminho curto (bravo 4 -> sarcastico 330 não passa pelo ciano)
  const d = ((b.hue - a.hue + 540) % 360) - 180;
  out.hue = (a.hue + d * t + 360) % 360;
  return out;
}

export interface Life { blink: number; gazeX: number; gazeY: number; mouthOpen: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* Piscar, deriva do olhar e boca de fala por cima do rosto base. */
export function applyLife(face: Face, life: Life): Face {
  const close = 1 - clamp(life.blink, 0, 1);
  return {
    ...face,
    eyeL: { ...face.eyeL, open: face.eyeL.open * close },
    eyeR: { ...face.eyeR, open: face.eyeR.open * close },
    mouth: { ...face.mouth, open: face.mouth.open + life.mouthOpen },
    gazeX: clamp(face.gazeX + life.gazeX, -1, 1),
    gazeY: clamp(face.gazeY + life.gazeY, -1, 1),
  };
}

/* ── Pontos-alvo ─────────────────────────────────────────────────────────── */

const EYE_PTS = 56, BROW_PTS = 32, MOUTH_PTS = 48, DUST_PTS = 48;
export const FACE_POINTS = 2 * EYE_PTS + 2 * BROW_PTS + 2 * MOUTH_PTS + DUST_PTS; // 320
const EYE_END   = 2 * EYE_PTS;
const BROW_END  = EYE_END + 2 * BROW_PTS;
const MOUTH_END = BROW_END + 2 * MOUTH_PTS;
export const FACE_LAYOUT = { eyes: 0, brows: EYE_END, mouth: BROW_END, dust: MOUTH_END } as const;

export type Cluster = "eye" | "brow" | "mouth" | "dust";
export function clusterOf(i: number): Cluster {
  return i < EYE_END ? "eye" : i < BROW_END ? "brow" : i < MOUTH_END ? "mouth" : "dust";
}

const EYE_X = 0.37, EYE_Y = -0.10, EYE_RX = 0.15, EYE_RY = 0.17;
const BROW_Y = -0.38, BROW_HALF = 0.19;
const MOUTH_Y = 0.42, MOUTH_HALF = 0.30, MOUTH_AMP = 0.15, MOUTH_OPEN_H = 0.30;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

type Pt = [number, number];

/* Olho cheio (girassol). A pálpebra de cima (lid + slant) e a de baixo (cheek) remapeiam a altura,
   então o número de pontos não muda e a densidade continua uniforme. */
function eyePoints(p: EyeParams, side: -1 | 1, gx: number, gy: number, out: Pt[]) {
  const ry = EYE_RY * Math.max(p.open, 0.06);
  const cx = side * EYE_X + gx * 0.05;
  const cy = EYE_Y + gy * 0.04;
  for (let i = 0; i < EYE_PTS; i++) {
    const r  = Math.sqrt((i + 0.5) / EYE_PTS);
    const a  = i * GOLDEN;
    const lx = Math.cos(a) * r * EYE_RX;          // espalha o olho em x; dx = side*lx abaixo espelha o direito no esquerdo
    const ly = Math.sin(a) * r * ry;              // -ry..ry
    const top = -ry + 2 * ry * p.lid + p.slant * -lx * 0.5;
    const bot = Math.max(ry - 2 * ry * p.cheek, top + 0.006);
    const y   = top + ((ly + ry) / (2 * ry)) * (bot - top);
    out.push([cx + side * lx, cy + y]);           // dx = side*lx: espelha o olho direito no esquerdo
  }
}

/* Sobrancelha: u vai de fora (-1) a dentro (+1). angle > 0 abaixa a ponta de dentro. */
function browPoints(p: BrowParams, side: -1 | 1, gx: number, gy: number, out: Pt[]) {
  const cx = side * EYE_X + gx * 0.02;
  const cy = BROW_Y + p.y + gy * 0.02;
  const slope = Math.tan(p.angle);
  for (let i = 0; i < BROW_PTS; i++) {
    const u = -1 + (2 * i) / (BROW_PTS - 1);
    out.push([cx - side * u * BROW_HALF, cy - p.arch * 0.05 * (1 - u * u) + slope * u * BROW_HALF]);
  }
}

/* Boca: primeiro o lábio de cima (48 pontos), depois o de baixo (48). Fechada, os dois coincidem. */
function mouthPoints(p: MouthParams, gx: number, gy: number, out: Pt[]) {
  const half = MOUTH_HALF * p.width;
  const cx = gx * 0.02, cy = MOUTH_Y + gy * 0.02;
  const line = (u: number) => cy + p.curve * MOUTH_AMP * (1 - u * u) + p.skew * u * 0.12;
  const open = Math.max(0, p.open) * MOUTH_OPEN_H;
  for (let i = 0; i < MOUTH_PTS; i++) {
    const u = -1 + (2 * i) / (MOUTH_PTS - 1);
    out.push([cx + u * half, line(u)]);
  }
  for (let i = 0; i < MOUTH_PTS; i++) {
    const u = -1 + (2 * i) / (MOUTH_PTS - 1);
    out.push([cx + u * half, line(u) + open * Math.pow(Math.max(0, 1 - u * u), 0.7)]);
  }
}

/* Sempre FACE_POINTS pontos, na ordem: olho E, olho D, sobrancelha E, sobrancelha D, boca, poeira.
   `phase` só gira a poeira (o anel em volta do rosto). */
export function faceTargets(face: Face, phase = 0): Pt[] {
  const feat: Pt[] = [];
  eyePoints(face.eyeL, -1, face.gazeX, face.gazeY, feat);
  eyePoints(face.eyeR,  1, face.gazeX, face.gazeY, feat);
  browPoints(face.browL, -1, face.gazeX, face.gazeY, feat);
  browPoints(face.browR,  1, face.gazeX, face.gazeY, feat);
  mouthPoints(face.mouth, face.gazeX, face.gazeY, feat);

  const c = Math.cos(face.tilt), s = Math.sin(face.tilt);
  const out: Pt[] = feat.map(([x, y]) => [x * c - y * s, x * s + y * c] as Pt);
  for (let i = 0; i < DUST_PTS; i++) {
    const a = (i / DUST_PTS) * Math.PI * 2 + phase * 0.12;
    const r = 1.12 + 0.1 * Math.sin(i * 2.3 + phase * 0.6);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/* ── Tag de emoção da resposta do chat ───────────────────────────────────── */

/* `[emo:X]`, tolerante a maiúscula, espaço e variação no nome (`[emoção:X]`); uma tag com nome inválido também sai do texto. Global: use só com .replace, nunca com .test. */
export const EMOTION_TAG = /\[\s*emo[^\]:\n]*:?\s*([^\]\n]*?)\s*\]\s*/gi;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/* Nome de emoção (qualquer caixa/acento) -> Emotion, ou null se não existir. */
export function emotionFromName(name: string): Emotion | null {
  const key = fold(name);
  return (EMOTIONS as readonly string[]).includes(key) ? (key as Emotion) : null;
}

/* Tira TODAS as tags de emoção do texto e devolve a primeira válida (ou "neutro"). */
export function parseEmotion(reply: string): { emotion: Emotion; text: string } {
  const found: Emotion[] = [];
  const text = reply.replace(EMOTION_TAG, (_m, name: string) => {
    const e = emotionFromName(name);
    if (e) found.push(e);
    return " ";   // espaço, não vazio: "Poxa.[emo:x]Mas" não vira "Poxa.Mas"
  }).replace(/ {2,}/g, " ").trim();
  return { emotion: found[0] ?? "neutro", text };
}
