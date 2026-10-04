/* Beto, o Fantasminha 3D: modelo + animações.
   Porte fiel de docs/mascote-fantasminha/index.html (Claude Design). Geometria, cores e timing vêm de lá;
   mude aqui só com o original aberto do lado. Nada de DOM: o componente (BetoGhost.tsx) cuida de renderer,
   câmera e luz, e chama `update(dt, now)` a cada frame. Unidade: metros, y para cima, base do corpo em y≈0. */

import * as THREE from "three";

export const MASCOT_EMOTIONS = [
  "neutro", "feliz", "pensando", "surpreso", "triste", "dormindo", "dj", "bravo",
  // extras do app (não existem no original): ouvindo, sarcástico e nervoso
  "ouvindo", "sarcastico", "nervoso",
] as const;
export type MascotEmotion = (typeof MASCOT_EMOTIONS)[number];

/* eo/es: abertura/tamanho do olho · lx/ly: deslocamento do olhar · mw/mh: boca · sp/amp: velocidade/altura da
   flutuação · tilt: inclinação · base: altura de repouso.
   Extras do app: wink (fecha só o olho esquerdo), mx/mr (boca de lado e girada: meio sorriso), shiver (tremor). */
interface Pose {
  eo: number; es: number; lx: number; ly: number; mw: number; mh: number;
  sp: number; amp: number; tilt: number; base: number;
  wink: number; mx: number; mr: number; shiver: number;
}
const pose = (p: Partial<Pose> & Omit<Pose, "wink" | "mx" | "mr" | "shiver">): Pose =>
  ({ wink: 0, mx: 0, mr: 0, shiver: 0, ...p });

export const EMO: Record<MascotEmotion, Pose> = {
  neutro:     pose({ eo: 1,    es: 1,    lx: 0, ly: 0,      mw: 1,   mh: 1,    sp: 2.2, amp: 1,   tilt: 0,     base: 0 }),
  feliz:      pose({ eo: 0.45, es: 1.05, lx: 0, ly: 0.002,  mw: 1.8, mh: 1.1,  sp: 2.8, amp: 1.2, tilt: 0,     base: 0.004 }),
  pensando:   pose({ eo: 0.8,  es: 0.95, lx: 0, ly: -0.008, mw: 0.7, mh: 0.5,  sp: 1.4, amp: 0.5, tilt: 0.05,  base: 0 }),
  surpreso:   pose({ eo: 1.25, es: 1.25, lx: 0, ly: 0.003,  mw: 1.2, mh: 1.7,  sp: 2.6, amp: 0.8, tilt: 0,     base: 0.008 }),
  triste:     pose({ eo: 0.6,  es: 0.88, lx: 0, ly: -0.007, mw: 1.2, mh: 0.35, sp: 0.9, amp: 0.4, tilt: -0.06, base: -0.01 }),
  dormindo:   pose({ eo: 0.07, es: 1,    lx: 0, ly: -0.003, mw: 0.6, mh: 0.6,  sp: 0.8, amp: 0.7, tilt: 0.05,  base: -0.004 }),
  dj:         pose({ eo: 0.5,  es: 1,    lx: 0, ly: -0.006, mw: 1.6, mh: 1.0,  sp: 0,   amp: 0,   tilt: 0,     base: 0 }),
  bravo:      pose({ eo: 0.62, es: 0.95, lx: 0, ly: -0.002, mw: 1.3, mh: 0.32, sp: 1.6, amp: 0.3, tilt: 0,     base: -0.002 }),
  ouvindo:    pose({ eo: 1.1,  es: 1.08, lx: 0, ly: 0.002,  mw: 0.8, mh: 0.8,  sp: 2.4, amp: 0.8, tilt: 0,     base: 0.004 }),
  sarcastico: pose({ eo: 0.75, es: 1,    lx: 0.003, ly: 0,  mw: 1.3, mh: 0.45, sp: 1.8, amp: 0.6, tilt: 0.12,  base: 0, wink: 0.4, mx: 0.004, mr: 0.35 }),
  nervoso:    pose({ eo: 1.15, es: 1.2,  lx: 0, ly: 0.003,  mw: 1.1, mh: 1.2,  sp: 3.2, amp: 0.6, tilt: 0,     base: 0.006, shiver: 1 }),
};
const KEYS = Object.keys(EMO.neutro) as (keyof Pose)[];

/* Qual conjunto de props cada emoção liga (o original liga por nome; os extras pegam carona). */
const PROPS_OF: Record<MascotEmotion, MascotEmotion> = {
  neutro: "neutro", feliz: "feliz", pensando: "pensando", surpreso: "surpreso", triste: "triste",
  dormindo: "dormindo", dj: "dj", bravo: "bravo", ouvindo: "neutro", sarcastico: "neutro", nervoso: "surpreso",
};

export const WAVE_S   = 2.2;
export const NOTIFY_S = 3.6;
const HOP_S = 0.6;

export interface Ghost {
  group: THREE.Group;
  setEmotion(e: MascotEmotion): void;
  talk(on: boolean): void;
  wave(): void;
  notify(): void;
  hop(): void;                 // pulinho avulso (animado começando a falar)
  setReducedMotion(on: boolean): void;
  update(dt: number, now: number): void;
  dispose(): void;
  readonly emotion: MascotEmotion;
  readonly busy: { wave: boolean; notify: boolean };
}

export function createGhost(): Ghost {
  const mBody  = new THREE.MeshStandardMaterial({ name: "corpo", color: 0xF6F3EC, roughness: 0.38, metalness: 0 });
  const mEye   = new THREE.MeshStandardMaterial({ name: "olho", color: 0x16140F, roughness: 0.12, metalness: 0.1 });
  const mShine = new THREE.MeshStandardMaterial({ name: "brilho", color: 0xFFFFFF, roughness: 0.2, emissive: 0xFFFFFF, emissiveIntensity: 0.6 });
  const mAccent = new THREE.MeshStandardMaterial({ name: "laranja", color: 0xFF6B2C, roughness: 0.45 });
  const mBlush = new THREE.MeshStandardMaterial({ name: "bochecha", color: 0xFF9A6B, roughness: 0.7 });

  const g = new THREE.Group(); g.name = "beto";
  const eyes: { m: THREE.Mesh; x: number; y: number; z: number }[] = [];
  const shines: { m: THREE.Mesh; x: number; y: number; z: number }[] = [];
  const mesh = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = true; m.receiveShadow = true; return m;
  };

  // corpo: domo (centro y=.12, r=.08) → saia levemente aberta → fundo fechado
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 32; i++) { const a = (Math.PI / 2) * (i / 32); pts.push(new THREE.Vector2(Math.sin(a) * 0.08, 0.12 + Math.cos(a) * 0.08)); }
  for (let i = 1; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(0.08 + 0.008 * t * t, 0.12 - 0.105 * t)); }
  pts.push(new THREE.Vector2(0.086, 0.01), new THREE.Vector2(0.08, 0.004), new THREE.Vector2(0.06, 0.012), new THREE.Vector2(0.03, 0.02), new THREE.Vector2(0, 0.022));
  pts.reverse();
  const SEG = 128;
  const bodyGeo = new THREE.LatheGeometry(pts, SEG, Math.PI, Math.PI * 2);
  const p = bodyGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (y < 0.05 && r > 0.07) {
      const w = (1 - y / 0.05), k = Math.min((r - 0.07) / 0.012, 1), phi = Math.atan2(x, z);
      const s = w * w * (3 - 2 * w) * k;
      p.setY(i, y + 0.008 * s * (0.5 + 0.5 * Math.cos(phi * 6)));
    }
  }
  bodyGeo.computeVertexNormals();
  { // solda as normais da costura para não aparecer linha
    const n = bodyGeo.attributes.normal, P = pts.length, v = new THREE.Vector3();
    for (let j = 0; j < P; j++) {
      const a = j, b = SEG * P + j;
      v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
    }
    n.needsUpdate = true;
  }
  g.add(mesh("corpo", bodyGeo, mBody));

  const onSurface = (x: number, _y: number, r = 0.0805) => Math.sqrt(Math.max(r * r - x * x, 0));
  const dome = (x: number, y: number) => { const dy = y - 0.12; const rr = Math.sqrt(0.08 * 0.08 - dy * dy); return Math.sqrt(rr * rr - x * x); };

  let armL!: THREE.Mesh;
  let ombro!: THREE.Group;
  [-1, 1].forEach(s => {
    const side = s < 0 ? "esq" : "dir";
    const ex = 0.029 * s, ey = 0.128, ez = dome(ex, ey) - 0.002;
    const eye = mesh("olho_" + side, new THREE.SphereGeometry(1, 48, 32), mEye);
    eye.scale.set(0.0115, 0.017, 0.007); eye.position.set(ex, ey, ez); eye.rotation.y = Math.atan2(ex, ez);
    g.add(eye); eyes.push({ m: eye, x: ex, y: ey, z: ez });
    const sh = mesh("brilho_" + side, new THREE.SphereGeometry(0.0035, 24, 16), mShine);
    sh.position.set(ex + 0.004, ey + 0.007, ez + 0.0055); g.add(sh); shines.push({ m: sh, x: ex + 0.004, y: ey + 0.007, z: ez + 0.0055 });

    const bx = 0.052 * s, by = 0.103, bz = onSurface(bx, by) - 0.0008;
    const bl = mesh("bochecha_" + side, new THREE.SphereGeometry(1, 32, 16), mBlush);
    bl.scale.set(0.012, 0.007, 0.003); bl.position.set(bx, by, bz); bl.rotation.y = Math.atan2(bx, bz);
    g.add(bl);

    const arm = mesh("braco_" + side, new THREE.SphereGeometry(1, 40, 24), mBody);
    arm.scale.set(0.022, 0.013, 0.016); arm.rotation.z = -0.5 * s;
    if (s > 0) {
      const pivot = new THREE.Group(); pivot.name = "ombro_dir";
      pivot.position.set(0.076, 0.068, -0.006); arm.position.set(0.012, -0.004, 0);
      pivot.add(arm); g.add(pivot); ombro = pivot;
    } else { arm.position.set(-0.083, 0.062, -0.012); g.add(arm); armL = arm; }
  });
  const armR = ombro.children[0] as THREE.Mesh;

  const mouth = mesh("boca", new THREE.SphereGeometry(1, 32, 24), mAccent);
  mouth.scale.set(0.007, 0.0085, 0.004); mouth.position.set(0, 0.104, onSurface(0, 0.104) - 0.001);
  g.add(mouth);

  // "pensando": óculos + prancheta
  const mFrame = new THREE.MeshStandardMaterial({ name: "armacao", color: 0x16140F, roughness: 0.3, metalness: 0.2 });
  const mWood  = new THREE.MeshStandardMaterial({ name: "prancheta", color: 0xC98B4A, roughness: 0.6 });
  const mPaper = new THREE.MeshStandardMaterial({ name: "papel", color: 0xFFFFFF, roughness: 0.85 });
  const mClip  = new THREE.MeshStandardMaterial({ name: "clipe", color: 0xB8B3A8, roughness: 0.3, metalness: 0.4 });
  const mInk   = new THREE.MeshStandardMaterial({ name: "tinta", color: 0x4A463E, roughness: 0.8 });

  const glasses = new THREE.Group(); glasses.name = "oculos";
  glasses.position.set(0, 0.128, 0);
  const gl = new THREE.Group(); glasses.add(gl);
  [-1, 1].forEach(s => {
    const x = 0.029 * s, z = dome(x, 0.128) + 0.006;
    const ring = mesh("lente_" + (s < 0 ? "esq" : "dir"), new THREE.TorusGeometry(0.021, 0.0024, 16, 64), mFrame);
    ring.position.set(x, 0, z); ring.rotation.y = Math.atan2(x, z); gl.add(ring);
  });
  const bridge = mesh("ponte", new THREE.CylinderGeometry(0.002, 0.002, 0.018, 16), mFrame);
  bridge.rotation.z = Math.PI / 2; bridge.position.set(0, 0.004, dome(0, 0.128) + 0.005); gl.add(bridge);
  g.add(glasses);

  const board = new THREE.Group(); board.name = "prancheta";
  board.position.set(0, 0.06, 0.118);
  const bd = new THREE.Group(); bd.rotation.set(0.3, Math.PI, 0); board.add(bd);
  bd.add(mesh("tabua", new THREE.BoxGeometry(0.07, 0.09, 0.004), mWood));
  const paper = mesh("folha", new THREE.BoxGeometry(0.06, 0.074, 0.001), mPaper); paper.position.set(0, -0.005, 0.0026); bd.add(paper);
  const clip = mesh("clipe", new THREE.BoxGeometry(0.03, 0.012, 0.006), mClip); clip.position.set(0, 0.041, 0.004); bd.add(clip);
  [0.022, 0.01, -0.002, -0.014, -0.026].forEach((y, i) => {
    const w = [0.044, 0.036, 0.042, 0.028, 0.038][i];
    const ln = mesh("linha_" + i, new THREE.BoxGeometry(w, 0.0022, 0.0006), mInk);
    ln.position.set(-0.022 + w / 2, y, 0.0034); bd.add(ln);
  });
  g.add(board);
  glasses.scale.setScalar(0.001); board.scale.setScalar(0.001);

  // Zzz do "dormindo"
  const zShape = new THREE.Shape();
  zShape.moveTo(-0.5, 0.5); zShape.lineTo(0.5, 0.5); zShape.lineTo(0.5, 0.3); zShape.lineTo(-0.15, -0.3);
  zShape.lineTo(0.5, -0.3); zShape.lineTo(0.5, -0.5); zShape.lineTo(-0.5, -0.5); zShape.lineTo(-0.5, -0.3);
  zShape.lineTo(0.15, 0.3); zShape.lineTo(-0.5, 0.3); zShape.closePath();
  const zGeo = new THREE.ExtrudeGeometry(zShape, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 4 });
  zGeo.center();
  const zzz = [0, 1, 2].map(() => {
    const m = mesh("zzz", zGeo, new THREE.MeshStandardMaterial({ name: "zzz", color: 0x6B7FD7, roughness: 0.4, transparent: true, opacity: 0 }));
    m.castShadow = false; m.visible = false; m.scale.setScalar(0.001); m.position.set(0, 0.15, 0); g.add(m); return m;
  });
  let zz = 0;

  // notificação: envelope + badge
  const mLetter = new THREE.MeshStandardMaterial({ name: "envelope", color: 0xFFFFFF, roughness: 0.7 });
  const mFlap = new THREE.MeshStandardMaterial({ name: "aba", color: 0xEDE7DA, roughness: 0.7 });
  const env = new THREE.Group(); env.name = "envelope";
  env.position.set(0, 0.058, 0.118);
  const ev = new THREE.Group(); ev.rotation.x = -0.25; env.add(ev);
  ev.add(mesh("envelope_corpo", new THREE.BoxGeometry(0.078, 0.052, 0.004), mLetter));
  const flapShape = new THREE.Shape(); flapShape.moveTo(-0.039, 0.026); flapShape.lineTo(0.039, 0.026); flapShape.lineTo(0, -0.004); flapShape.closePath();
  const flap = mesh("envelope_aba", new THREE.ExtrudeGeometry(flapShape, { depth: 0.001, bevelEnabled: false }), mFlap);
  flap.position.z = 0.0021; ev.add(flap);
  const seal = mesh("selo", new THREE.CylinderGeometry(0.0075, 0.0075, 0.002, 32), mAccent);
  seal.rotation.x = Math.PI / 2; seal.position.set(0, -0.002, 0.0042); ev.add(seal);
  g.add(env);
  const badge = new THREE.Group(); badge.name = "badge";
  badge.position.set(0.062, 0.212, 0.02);
  badge.add(mesh("badge_bola", new THREE.SphereGeometry(0.014, 40, 24), mAccent));
  const ex1 = mesh("badge_exclamacao", new THREE.BoxGeometry(0.0042, 0.012, 0.003), mShine); ex1.position.set(0, 0.0035, 0.0135); badge.add(ex1);
  const ex2 = mesh("badge_ponto", new THREE.SphereGeometry(0.0024, 16, 12), mShine); ex2.position.set(0, -0.0065, 0.0135); badge.add(ex2);
  g.add(badge);
  env.scale.setScalar(0.001); badge.scale.setScalar(0.001);
  let nT = -1, nv = 0;

  // triste: lágrimas + nuvenzinha de chuva
  const mTear = new THREE.MeshStandardMaterial({ name: "lagrima", color: 0x8FC3F2, roughness: 0.1, transparent: true, opacity: 0.9 });
  const mCloud = new THREE.MeshStandardMaterial({ name: "nuvem", color: 0x9AA3B5, roughness: 0.8 });
  const tearGeo = new THREE.SphereGeometry(1, 24, 16);
  const tears = [-1, 1].flatMap(s => [0, 0.5].map(o => {
    const m = mesh("lagrima", tearGeo, mTear); m.castShadow = false; m.scale.setScalar(0.001); g.add(m);
    return { m, s, o };
  }));
  const cloud = new THREE.Group(); cloud.name = "nuvem";
  cloud.position.set(0, 0.26, 0.01);
  ([[0, 0.006, 0.02], [-0.02, -0.002, 0.015], [0.021, -0.002, 0.016], [-0.008, -0.006, 0.014], [0.01, -0.006, 0.014]] as const).forEach(([x, y, r], i) => {
    const c = mesh("nuvem_" + i, new THREE.SphereGeometry(r, 32, 20), mCloud); c.position.set(x, y, 0); cloud.add(c);
  });
  const drops = [-0.016, 0, 0.016].map((x, i) => {
    const d = mesh("gota_" + i, tearGeo, mTear); d.castShadow = false; d.scale.set(0.0022, 0.0045, 0.0022); d.position.x = x; cloud.add(d); return d;
  });
  cloud.scale.setScalar(0.001); g.add(cloud);
  let sd = 0;

  // feliz: estrelinhas (o original também monta corações, mas nunca mostra; ficaram de fora)
  const mStar = new THREE.MeshStandardMaterial({ name: "brilhinho", color: 0xFFC94A, roughness: 0.3, emissive: 0xFFB020, emissiveIntensity: 0.35, transparent: true, opacity: 1 });
  const starShape = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + Math.PI / 2, r = i % 2 ? 0.28 : 1;
    if (i) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  starShape.closePath();
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 3 }); starGeo.center();
  const SPOTS = [[-0.11, 0.17], [0.115, 0.19], [-0.125, 0.08], [0.13, 0.1], [0, 0.245]] as const;
  const stars = SPOTS.map(([x, y], i) => {
    const m = mesh("brilhinho_" + i, starGeo, mStar.clone()); m.castShadow = false; m.scale.setScalar(0.001); m.position.set(x, y, 0.02); g.add(m); return m;
  });
  const blushes = ["esq", "dir"].map(s => g.getObjectByName("bochecha_" + s) as THREE.Mesh);
  let hp = 0, hopT = 0;

  // DJ: fone, mesa, notas flutuando, luz no ritmo
  const mDark = new THREE.MeshStandardMaterial({ name: "dj_preto", color: 0x1E1C18, roughness: 0.35, metalness: 0.2 });
  const mVinyl = new THREE.MeshStandardMaterial({ name: "vinil", color: 0x0E0D0B, roughness: 0.25, metalness: 0.1 });
  const mNote = new THREE.MeshStandardMaterial({ name: "nota", color: 0x7C6CF2, roughness: 0.35, emissive: 0x4B3FD0, emissiveIntensity: 0.3, transparent: true, opacity: 1 });
  const phones = new THREE.Group(); phones.name = "fone";
  const band = mesh("fone_arco", new THREE.TorusGeometry(0.089, 0.0045, 16, 64, Math.PI), mDark);
  band.position.y = 0.12; phones.add(band);
  [-1, 1].forEach(s => {
    const cup = mesh("fone_concha", new THREE.CylinderGeometry(0.022, 0.022, 0.016, 40), mDark);
    cup.rotation.z = Math.PI / 2; cup.position.set(0.087 * s, 0.12, 0); phones.add(cup);
    const pad = mesh("fone_almofada", new THREE.CylinderGeometry(0.018, 0.018, 0.004, 40), mAccent);
    pad.rotation.z = Math.PI / 2; pad.position.set(0.097 * s, 0.12, 0); phones.add(pad);
  });
  g.add(phones);
  const deck = new THREE.Group(); deck.name = "mesa_dj";
  deck.position.set(0, 0.03, 0.12); deck.rotation.x = 0.35;
  deck.add(mesh("mesa_corpo", new THREE.BoxGeometry(0.14, 0.018, 0.07), mDark));
  const platters = [-1, 1].map(s => {
    const pl = new THREE.Group(); pl.position.set(0.036 * s, 0.0105, 0);
    pl.add(mesh("vinil", new THREE.CylinderGeometry(0.026, 0.026, 0.003, 48), mVinyl));
    const lab = mesh("vinil_selo", new THREE.CylinderGeometry(0.009, 0.009, 0.0035, 32), s < 0 ? mAccent : mNote); lab.position.y = 0.0004; pl.add(lab);
    const mark = mesh("vinil_marca", new THREE.BoxGeometry(0.003, 0.0036, 0.01), mShine); mark.position.set(0, 0.0004, 0.016); pl.add(mark);
    deck.add(pl); return pl;
  });
  const fader = mesh("fader", new THREE.BoxGeometry(0.008, 0.006, 0.012), mAccent); fader.position.set(0, 0.011, 0.018); deck.add(fader);
  g.add(deck);
  const notes = [0, 1, 2, 3].map(i => {
    const n = new THREE.Group(); n.name = "nota_" + i;
    const head = mesh("nota_cabeca", new THREE.SphereGeometry(1, 24, 16), mNote); head.scale.set(0.0075, 0.0058, 0.005); head.rotation.z = 0.4; n.add(head);
    const stem = mesh("nota_haste", new THREE.BoxGeometry(0.0022, 0.024, 0.0022), mNote); stem.position.set(0.0065, 0.012, 0); n.add(stem);
    const fl = mesh("nota_bandeira", new THREE.BoxGeometry(0.009, 0.0035, 0.0022), mNote); fl.position.set(0.0105, 0.022, 0); fl.rotation.z = -0.5; n.add(fl);
    n.scale.setScalar(0.001); g.add(n); return n;
  });
  const beatLight = new THREE.PointLight(0x7C6CF2, 0, 0.6); beatLight.position.set(0, 0.16, 0.2); g.add(beatLight);
  phones.scale.setScalar(0.001); deck.scale.setScalar(0.001);
  const mLens = new THREE.MeshStandardMaterial({ name: "lente_escura", color: 0x0B0A09, roughness: 0.05, metalness: 0.3 });
  const shades = new THREE.Group(); shades.name = "oculos_escuro";
  [-1, 1].forEach(s => {
    const x = 0.029 * s, y = 0.127, z = dome(x, y) + 0.004;
    const lens = mesh("lente_escura_" + (s < 0 ? "esq" : "dir"), new THREE.CylinderGeometry(0.019, 0.019, 0.004, 48), mLens);
    lens.scale.set(1.15, 1, 0.82); lens.rotation.set(Math.PI / 2, 0, 0);
    const holder = new THREE.Group(); holder.position.set(x, y, z); holder.rotation.y = Math.atan2(x, z); holder.add(lens);
    const rim = mesh("aro", new THREE.TorusGeometry(0.019, 0.0018, 12, 48), mFrame); rim.scale.set(1.15, 0.82, 1); holder.add(rim);
    const glint = mesh("reflexo", new THREE.BoxGeometry(0.012, 0.0022, 0.001), mShine); glint.position.set(-0.004, 0.006, 0.0025); glint.rotation.z = 0.5; holder.add(glint);
    shades.add(holder);
  });
  const sBridge = mesh("ponte_escura", new THREE.BoxGeometry(0.02, 0.003, 0.003), mFrame); sBridge.position.set(0, 0.133, dome(0, 0.133) + 0.004); shades.add(sBridge);
  shades.scale.setScalar(0.001); g.add(shades);

  // bravo: sobrancelhas, vapor, marca de raiva, rubor
  const mSteam = new THREE.MeshStandardMaterial({ name: "vapor", color: 0xFFFFFF, roughness: 0.9, emissive: 0xFFFFFF, emissiveIntensity: 0.35, transparent: true, opacity: 0.8 });
  const mVein = new THREE.MeshStandardMaterial({ name: "raiva", color: 0xE0322B, roughness: 0.4 });
  const brows = [-1, 1].map(s => {
    const x = 0.03 * s, y = 0.152, z = dome(x, y) + 0.002;
    const b = mesh("sobrancelha_" + (s < 0 ? "esq" : "dir"), new THREE.CapsuleGeometry(0.0032, 0.018, 6, 16), mEye);
    b.rotation.z = Math.PI / 2 + 0.4 * s;
    const h = new THREE.Group(); h.position.set(x, y, z); h.rotation.y = Math.atan2(x, z); h.add(b);
    h.scale.setScalar(0.001); g.add(h); return { m: h, x, y, z, s };
  });
  const vein = new THREE.Group(); vein.name = "marca_raiva";
  vein.position.set(0.05, 0.19, 0.045); vein.rotation.y = 0.6;
  [0, 1, 2, 3].forEach(i => {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const seg = mesh("raiva_" + i, new THREE.CapsuleGeometry(0.0022, 0.009, 4, 12), mVein);
    seg.position.set(Math.cos(a) * 0.007, Math.sin(a) * 0.007, 0); seg.rotation.z = a + Math.PI / 2;
    vein.add(seg);
  });
  vein.scale.setScalar(0.001); g.add(vein);
  const puffGeo = new THREE.SphereGeometry(1, 20, 14);
  const puffs = [-1, 1].flatMap(s => [0, 0.33, 0.66].map(o => {
    const m = mesh("vapor", puffGeo, mSteam.clone()); m.castShadow = false; m.scale.setScalar(0.001); g.add(m); return { m, s, o };
  }));
  const bodyBase = new THREE.Color(0xF6F3EC), bodyMad = new THREE.Color(0xFFB4A0);
  let ag = 0;
  const vA = new THREE.Vector3(), vB = new THREE.Vector3();
  let dj = 0;

  /* ── Estado ─────────────────────────────────────────────────────────────── */

  const cur: Pose = { ...EMO.neutro };
  let target = EMO.neutro, emotion: MascotEmotion = "neutro", talking = false, phase = 0;
  let nextBlink = 2, waveT = -1, th = 0, hopKick = -1, motion = 1;
  const mouthBase = { w: 0.007, h: 0.0085 };
  const popOf = (v: number) => v < 0.001 ? 0.001 : Math.max(1 + 2.2 * Math.pow(v - 1, 3) + 1.2 * Math.pow(v - 1, 2), 0.001);

  function update(rawDt: number, now: number) {
    const dt = Math.min(Math.max(rawDt, 0), 0.05);
    const t = now / 1000, k = 1 - Math.exp(-dt * 9);
    // notificação (3,6s): pulo surpreso → balança feliz segurando o envelope
    let jumpY = 0, sq = 0, wig = 0;
    if (nT >= 0) { nT += dt; if (nT > NOTIFY_S) nT = -1; }
    const active = nT >= 0;
    const eff = active ? "feliz" : PROPS_OF[emotion];
    const tgt = active ? (nT < 0.45 ? EMO.surpreso : EMO.feliz) : target;
    if (active && nT < 0.55) { const j = Math.sin(Math.PI * nT / 0.55); jumpY = 0.035 * j * motion; sq = j * motion; }
    if (active && nT > 0.55 && nT < 1.6) wig = Math.sin((nT - 0.55) * 16) * 0.14 * (1 - (nT - 0.55) / 1.05) * motion;
    KEYS.forEach(key => { cur[key] += (tgt[key] - cur[key]) * k; });
    phase += dt * cur.sp;

    // piscar
    nextBlink -= dt; let blink = 1;
    if (nextBlink < 0.14) blink = Math.abs(nextBlink - 0.07) / 0.07;
    if (nextBlink < 0) nextBlink = 2 + Math.random() * 3;
    if (eff === "dormindo") blink = 1;

    eyes.forEach((e, i) => {
      const open = cur.eo * blink * (i === 0 ? 1 - cur.wink : 1);
      e.m.scale.set(0.0115 * cur.es, 0.017 * cur.es * Math.max(open, 0.05), 0.007);
      e.m.position.set(e.x + cur.lx, e.y + cur.ly, e.z);
      const s = shines[i]; s.m.position.set(s.x + cur.lx, s.y + cur.ly, s.z);
      s.m.visible = open > 0.35;
    });

    let mw = cur.mw, mh = cur.mh;
    if (talking) { const o = 0.5 + 0.5 * Math.sin(t * 17) * Math.sin(t * 6.3 + 1); mh = 0.4 + o * 1.6; mw = cur.mw * (0.85 + o * 0.25); }
    mouth.scale.set(mouthBase.w * mw, mouthBase.h * mh, 0.004);
    mouth.position.x = cur.mx;
    mouth.rotation.z = cur.mr;

    let lift = 0, shake = 0;
    if (waveT >= 0) {
      waveT += dt; const D = WAVE_S;
      lift = waveT < 0.35 ? waveT / 0.35 : waveT > D - 0.35 ? Math.max((D - waveT) / 0.35, 0) : 1;
      lift = lift * lift * (3 - 2 * lift);
      shake = Math.sin((waveT - 0.35) * 11) * 0.35 * lift;
      if (waveT > D) waveT = -1;
    }
    ombro.rotation.z = lift * 1.05 + shake * 0.85;
    armR.rotation.z = -0.5 + 0.5 * lift;
    ombro.position.z = -0.006 + 0.016 * lift;
    armR.position.x = 0.012 + 0.02 * lift;
    armR.scale.x = 0.022 + 0.008 * lift;
    // props do "pensando" entram e saem
    th += ((eff === "pensando" ? 1 : 0) - th) * (1 - Math.exp(-dt * 7));
    const pop = th < 0.001 ? 0.001 : 1 + 2.2 * Math.pow(th - 1, 3) + 1.2 * Math.pow(th - 1, 2);
    glasses.scale.setScalar(Math.max(pop, 0.001));
    board.scale.setScalar(Math.max(pop, 0.001));
    board.position.y = 0.06 + Math.sin(t * 1.3) * 0.0015 * th;
    board.rotation.z = Math.sin(t * 0.9) * 0.03 * th;
    g.rotation.x = 0.08 * th;
    // os dois braços vêm para a frente segurar a prancheta / o envelope
    nv += ((active ? 1 : 0) - nv) * (1 - Math.exp(-dt * 8));
    const npop = popOf(nv);
    env.scale.setScalar(npop);
    badge.scale.setScalar(npop * (1 + 0.12 * Math.sin(t * 9) * nv));
    badge.position.y = 0.212 + Math.sin(t * 3) * 0.004;
    env.rotation.z = wig * 0.6;
    const hold = Math.max(th, nv);
    armL.position.set(-0.083 + 0.045 * hold, 0.062 - 0.012 * hold, -0.012 + 0.105 * hold);
    armL.rotation.z = 0.5 - 0.5 * hold;
    if (waveT < 0) {
      ombro.position.set(0.076 - 0.045 * hold, 0.068 - 0.012 * hold, -0.006 + 0.105 * hold);
      armR.rotation.z = -0.5 + 0.5 * hold;
    }
    // triste: lágrimas, nuvem de chuva, ombros caídos e suspiros
    sd += ((eff === "triste" ? 1 : 0) - sd) * (1 - Math.exp(-dt * 4));
    tears.forEach(({ m, s, o }) => {
      const c = ((t / 1.8) + o) % 1;
      const e = eyes[s < 0 ? 0 : 1];
      const sz = sd * Math.sin(Math.min(c * 4, 1) * Math.PI / 2) * (1 - Math.max(c - 0.85, 0) / 0.15);
      m.visible = sd > 0.02;
      m.scale.set(Math.max(0.0035 * sz, 0.0001), Math.max(0.005 * sz, 0.0001), Math.max(0.0025 * sz, 0.0001));
      const y = e.y - 0.016 - c * 0.04;
      const x = e.x * 1.12 + s * c * 0.006;
      m.position.set(x, y, onSurface(x, y) + 0.0015);
    });
    cloud.visible = sd > 0.02;
    cloud.scale.setScalar(Math.max(sd, 0.001));
    cloud.position.y = 0.26 + Math.sin(t * 1.2) * 0.003;
    drops.forEach((d, i) => { const c = ((t / 0.9) + i / 3) % 1; d.position.y = -0.016 - c * 0.04; d.visible = c < 0.9; });
    const sigh = Math.pow(Math.max(Math.sin(t * 0.9), 0), 6) * sd * motion;
    armL.position.y -= 0.01 * sd; armL.rotation.z += 0.35 * sd;
    if (waveT < 0) { ombro.position.y -= 0.01 * sd; armR.rotation.z -= 0.35 * sd; }

    g.scale.set(1 - 0.04 * sq + 0.02 * sd, 1 + 0.07 * sq - 0.05 * sd + 0.025 * sigh, 1 - 0.04 * sq + 0.02 * sd);
    g.rotation.y = wig;

    // feliz: estrelinhas, bochecha maior, braços para cima, pulinho com giro de tempos em tempos
    hp += ((eff === "feliz" ? 1 : 0) - hp) * (1 - Math.exp(-dt * 5));
    stars.forEach((m, i) => {
      const tw = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.7);
      const s = Math.max(0.008 * hp * (0.5 + 0.6 * tw), 0.0001);
      m.visible = hp > 0.02; m.scale.set(s, s, s);
      m.rotation.z = t * 1.5 + i; (m.material as THREE.MeshStandardMaterial).opacity = Math.min(1, 0.3 + tw) * hp;
    });
    blushes.forEach(b => b.scale.set(0.012 * (1 + 0.15 * hp), 0.007 * (1 + 0.1 * hp), 0.003));
    if (waveT < 0 && nT < 0) {
      const fl = Math.sin(t * 6) * 0.12 * hp;
      armL.rotation.z -= (0.6 * hp + fl); armL.position.y += 0.006 * hp;
      ombro.rotation.z = 0.6 * hp + fl; ombro.position.y += 0.002 * hp;
    }
    let hop = 0;
    if (hp > 0.5) { hopT += dt; if (hopT > 6) hopT = 0; } else hopT = 0;
    if (hopT > 5.4) { const h = (hopT - 5.4) / 0.6; hop = Math.sin(h * Math.PI) * 0.5; }
    if (hopKick >= 0) { hopKick += dt; if (hopKick > HOP_S) hopKick = -1; else hop = Math.max(hop, Math.sin(hopKick / HOP_S * Math.PI) * 0.6); }
    const hopY = 0.04 * hop * Math.max(hp, hopKick >= 0 ? 1 : 0) * motion;

    // DJ: cabeça no ritmo (120bpm), vinil girando, braços no scratch, notas, luz da batida
    dj += ((eff === "dj" ? 1 : 0) - dj) * (1 - Math.exp(-dt * 6));
    const djPop = popOf(dj);
    phones.scale.setScalar(djPop); deck.scale.setScalar(djPop); shades.scale.setScalar(djPop);
    shades.visible = dj > 0.01;
    if (dj > 0.3) shines.forEach(s => { s.m.visible = false; });
    phones.visible = deck.visible = dj > 0.01;
    const beat = (t * 2) % 1, kick = Math.pow(1 - beat, 3) * motion;
    platters[0].rotation.y = -t * 5 + Math.sin(t * 9) * 0.6 * dj;
    platters[1].rotation.y = -t * 5;
    fader.position.x = Math.sin(t * Math.PI) * 0.012;
    vA.set(-0.036 + Math.sin(t * 9) * 0.008, 0.06, 0.125); armL.position.lerp(vA, dj);
    armL.rotation.z += (0 - armL.rotation.z) * dj;
    if (waveT < 0 && nT < 0) {
      vB.set(0.024, 0.066 + 0.008 * Math.abs(Math.sin(t * Math.PI * 2)), 0.125); ombro.position.lerp(vB, dj);
      ombro.rotation.z *= 1 - dj; armR.rotation.z += (0 - armR.rotation.z) * dj;
    }
    notes.forEach((n, i) => {
      const c = ((t / 2.2) + i / 4) % 1, side = i % 2 ? 1 : -1;
      const s = dj * Math.sin(Math.min(c * 3, 1) * Math.PI / 2) * (1 - Math.max(c - 0.75, 0) / 0.25);
      n.visible = dj > 0.02; n.scale.setScalar(Math.max(s, 0.001));
      n.position.set(side * (0.1 + c * 0.04), 0.1 + c * 0.13, 0.02 + Math.sin(c * 5 + i) * 0.01);
      n.rotation.z = Math.sin(t * 4 + i) * 0.35;
    });
    beatLight.intensity = dj * (0.15 + 0.6 * kick);
    beatLight.color.setHSL((0.72 + Math.floor(t / 2) * 0.13) % 1, 0.8, 0.6);
    const bob = Math.abs(Math.sin(t * Math.PI * 2)) * dj * motion;
    g.rotation.x += (0.1 * bob) * (1 - th);
    g.scale.y *= 1 - 0.035 * kick * dj; g.scale.x *= 1 + 0.02 * kick * dj; g.scale.z *= 1 + 0.02 * kick * dj;
    const djY = 0.008 * bob;

    // bravo: sobrancelhas, rubor, vapor, marca pulsando, tremor, batida de pé
    ag += ((eff === "bravo" ? 1 : 0) - ag) * (1 - Math.exp(-dt * 6));
    const agPop = popOf(ag);
    brows.forEach(b => { b.m.visible = ag > 0.01; b.m.scale.setScalar(agPop); b.m.position.y = b.y - 0.006 * ag + Math.sin(t * 30) * 0.0006 * ag * motion; });
    mBody.color.copy(bodyBase).lerp(bodyMad, ag * (0.55 + 0.25 * Math.sin(t * 5)));
    vein.visible = ag > 0.01;
    vein.scale.setScalar(agPop * (1 + 0.18 * Math.max(Math.sin(t * 7), 0)));
    const burst = (t % 2.2) < 1.1;
    puffs.forEach(({ m, s, o }) => {
      const c = ((t / 1.1) + o) % 1;
      const sz = ag * (burst ? 1 : 0) * (0.006 + c * 0.01) * (1 - Math.max(c - 0.7, 0) / 0.3);
      m.visible = ag > 0.02 && sz > 0.0005; m.scale.setScalar(Math.max(sz, 0.001));
      m.position.set(s * (0.07 + c * 0.04), 0.17 + c * 0.05, 0);
      (m.material as THREE.MeshStandardMaterial).opacity = 0.85 * (1 - c);
    });
    if (waveT < 0 && nT < 0) {
      armL.rotation.z += 0.7 * ag; armL.position.x += 0.006 * ag; armL.position.y -= 0.004 * ag;
      armR.rotation.z -= 0.7 * ag; ombro.position.x -= 0.006 * ag; ombro.position.y -= 0.004 * ag;
    }
    // tremor: o do bravo e o do nervoso (extra do app, mais leve e mais rápido)
    const tremble = (ag * Math.sin(t * 45) * 0.0012 + cur.shiver * Math.sin(t * 60) * 0.0007) * motion;
    g.position.x = tremble;
    const stompC = (t % 2.2) / 2.2, stomp = (stompC < 0.12 ? Math.sin(stompC / 0.12 * Math.PI) : 0) * motion;
    g.scale.y *= 1 - 0.05 * stomp * ag; g.scale.x *= 1 + 0.03 * stomp * ag; g.scale.z *= 1 + 0.03 * stomp * ag;
    // Zzz subindo para a direita, escalonados
    zz += ((eff === "dormindo" ? 1 : 0) - zz) * (1 - Math.exp(-dt * 4));
    zzz.forEach((m, i) => {
      const c = ((t / 2.4) + i / 3) % 1;
      const fade = Math.sin(c * Math.PI);
      m.visible = zz > 0.02;
      (m.material as THREE.MeshStandardMaterial).opacity = fade * zz;
      const s = 0.011 + c * 0.012;
      m.scale.set(s, s, s);
      m.position.set(0.05 + c * 0.06 + Math.sin(c * 6 + i) * 0.006, 0.18 + c * 0.065, 0.03);
      m.rotation.set(0, -0.3, Math.sin(c * 4 + i) * 0.25);
    });

    const amp = cur.amp * motion;
    g.position.y = 0.012 + jumpY + hopY + djY + cur.base + Math.sin(phase) * 0.008 * amp;
    g.rotation.z = cur.tilt + Math.sin(phase * 0.5) * 0.04 * amp;
  }

  return {
    group: g,
    setEmotion(e) { if (EMO[e]) { emotion = e; target = EMO[e]; } },
    talk(on) { talking = on; },
    wave() { if (nT < 0) waveT = 0; },          // notificação tem prioridade sobre o aceno
    notify() { nT = 0; waveT = -1; },
    hop() { hopKick = 0; },
    setReducedMotion(on) { motion = on ? 0 : 1; },
    update,
    dispose() {
      const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
      g.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { geos.add(m.geometry); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => mats.add(x)); }
      });
      geos.forEach(x => x.dispose()); mats.forEach(x => x.dispose());
      beatLight.dispose();
    },
    get emotion() { return emotion; },
    get busy() { return { wave: waveT >= 0, notify: nT >= 0 }; },
  };
}
