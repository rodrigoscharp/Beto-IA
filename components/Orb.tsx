"use client";

import { useEffect, useRef } from "react";
import {
  FACE_POINTS, STATE_FACES, applyLife, clusterOf, faceFor, faceTargets, lerpFace,
  type Emotion, type Face,
} from "@/components/face";

export type OrbState = "wake" | "listening" | "thinking" | "speaking";
interface OrbProps {
  state: OrbState; onClick: () => void; theme?: "dark" | "light"; emotion?: Emotion;
  /** A boca só mexe com a voz de fato tocando (no `speaking` ela fica parada durante o fetch/prebuffer do TTS). */
  talking?: boolean;
}

/* ── Config ──────────────────────────────────────────────────────────────── */

const R          = 162;   // raio de referência (px): rings e glow
const REF        = 620;   // min(viewport w,h) em que o Beto é desenhado no tamanho cheio
const FACE_SCALE = 1.45;  // px por unidade do rosto = R * k * FACE_SCALE
const TAU        = Math.PI * 2;

/* Rosto sonolento minúsculo que fica no centro em `wake` como convite ao clique. */
const WAKE_HINT = faceTargets(STATE_FACES.wake, 0);

/* ── Partículas ──────────────────────────────────────────────────────────── */

type P = {
  x: number; y: number;          // relativo ao centro da tela
  vx: number; vy: number;
  size: number; alpha: number;
  phase: number; phaseSpd: number;
};

function mkParticles(w: number, h: number): P[] {
  return Array.from({ length: FACE_POINTS }, () => ({
    x: (Math.random() - 0.5) * w * 1.4,
    y: (Math.random() - 0.5) * h * 1.4,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    size:     0.7 + Math.random() * 1.8,
    alpha:    0.12 + Math.random() * 0.5,
    phase:    Math.random() * TAU,
    phaseSpd: 0.007 + Math.random() * 0.02,
  }));
}

/* ── Componente ──────────────────────────────────────────────────────────── */

export default function Orb({ state, onClick, theme = "dark", emotion = "neutro", talking = true }: OrbProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const frameRef   = useRef(0);
  const stateRef   = useRef(state);
  const emotionRef = useRef<Emotion>(emotion);
  const talkingRef = useRef(talking);
  const lightRef   = useRef(theme === "light");
  const prevRef    = useRef<OrbState>(state);
  const ptsRef     = useRef<P[]>([]);
  const dimRef     = useRef({ w: 0, h: 0 });
  const kRef       = useRef(1);                       // fator de tamanho: encolhe em viewport pequena
  const tRef       = useRef(0);                       // reunir: 0 = espalhado, 1 = rosto formado
  const phRef      = useRef(0);                       // fase global
  const faceRef    = useRef<Face>(STATE_FACES.wake);  // rosto atual (interpola até o desejado)
  const blinkRef   = useRef({ start: -1e9, next: 0 });
  const reducedRef = useRef(false);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { emotionRef.current = emotion; }, [emotion]);
  useEffect(() => { talkingRef.current = talking; }, [talking]);
  useEffect(() => { lightRef.current = theme === "light"; }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;
    const onMq = () => { reducedRef.current = mq.matches; };
    mq.addEventListener("change", onMq);
    blinkRef.current.next = performance.now() + 2500;

    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = w; canvas.height = h;
      dimRef.current = { w, h };
      kRef.current = Math.max(0.28, Math.min(1, Math.min(w, h) / REF));
      if (!ptsRef.current.length) ptsRef.current = mkParticles(w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    function draw() {
      const now  = performance.now();
      const s    = stateRef.current;
      const prev = prevRef.current;
      const { w, h } = dimRef.current;
      const k  = kRef.current;
      const CX = w / 2, CY = h / 2;
      const pts = ptsRef.current;
      const reduced = reducedRef.current;

      /* ── Explosão ao voltar para wake ── */
      if (prev !== "wake" && s === "wake" && !reduced) {
        for (const p of pts) {
          const d = Math.hypot(p.x, p.y) || 1;
          const spd = 4 + Math.random() * 4.5;
          p.vx += (p.x / d) * spd + (Math.random() - 0.5) * 3;
          p.vy += (p.y / d) * spd + (Math.random() - 0.5) * 3;
        }
      }
      prevRef.current = s;

      /* ── Tempo ── */
      phRef.current += s === "speaking" ? 0.016 : s === "thinking" ? 0.040 : s === "listening" ? 0.022 : 0.007;
      const ph = phRef.current;

      /* ── Reunir ── */
      tRef.current += ((s !== "wake" ? 1 : 0) - tRef.current) * 0.030;
      const t = tRef.current;

      /* ── Respiração da fala (anéis e glow) ── */
      const pulse = s === "speaking" ? 0.5 + 0.5 * Math.sin(ph) : 0;
      const curR  = R * k * (1 + pulse * 0.06);

      /* ── Rosto: interpola até o desejado e soma a vida própria ── */
      faceRef.current = lerpFace(faceRef.current, faceFor(s, emotionRef.current), 0.12);

      let blink = 0, gx = 0, gy = 0, mouthOpen = 0;
      if (!reduced) {
        if (now >= blinkRef.current.next) {
          blinkRef.current = { start: now, next: now + 3000 + Math.random() * 3000 };
        }
        const dt = now - blinkRef.current.start;
        if (dt >= 0 && dt < 120) blink = Math.sin((dt / 120) * Math.PI);
        gx = 0.22 * Math.sin(now * 0.0006);
        gy = 0.15 * Math.sin(now * 0.00047 + 1.7);
      }
      if (s === "speaking" && talkingRef.current) {
        // TTS é áudio pronto (sem analisador): dois LFOs irregulares fazem a boca abrir e fechar como fala
        mouthOpen = Math.max(0, Math.sin(now * 0.021) * Math.sin(now * 0.0067 + 1.3)) * 0.6;
      }
      const live    = applyLife(faceRef.current, { blink, gazeX: gx, gazeY: gy, mouthOpen });
      const targets = t > 0.01 ? faceTargets(live, reduced ? 0 : ph) : null;   // em wake parado ninguém segue o rosto
      const S       = R * k * FACE_SCALE * (1 + (reduced ? 0 : 0.012 * Math.sin(now * 0.0015)));
      const tremor  = reduced ? 0 : (0.3 + live.jitter * 1.6) * k;
      const hue     = live.hue;
      const light   = lightRef.current;

      ctx.clearRect(0, 0, w, h);

      /* ── Física: cada partícula segue o seu ponto-alvo ── */
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.phase += p.phaseSpd;

        if (targets) {
          const tx = targets[i][0] * S + Math.sin(p.phase * 3.1) * tremor;
          const ty = targets[i][1] * S + Math.cos(p.phase * 2.7) * tremor;
          p.vx += (tx - p.x) * 0.075 * t;
          p.vy += (ty - p.y) * 0.075 * t;
        }

        if (t < 0.99) {
          const nudge = s === "wake" ? 0.011 : 0.035;
          p.vx += (Math.random() - 0.5) * nudge * (1 - t);
          p.vy += (Math.random() - 0.5) * nudge * (1 - t);
        }

        const damp = s === "wake" && t < 0.05 ? 0.974 : 0.88;
        p.vx *= damp; p.vy *= damp;
        p.x  += p.vx; p.y  += p.vy;

        if (t < 0.35) {
          const bx = w / 2 + 60, by = h / 2 + 60;
          if (p.x < -bx) p.x = bx;  if (p.x > bx) p.x = -bx;
          if (p.y < -by) p.y = by;  if (p.y > by) p.y = -by;
        }
      }

      /* ── Desenhar partículas ── */
      const pk = 0.55 + 0.45 * k;   // partículas encolhem menos que o rosto
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const g = clusterOf(i);
        const gb = g === "dust" ? 0.55 : g === "eye" ? 1.15 : 1;
        const twinkle = 0.7 + 0.3 * Math.sin(p.phase);
        const alpha   = Math.min(0.96, (p.alpha * (1 - t) + (0.78 + p.alpha * 0.4) * t) * twinkle * gb);
        const radius  = Math.max(0.3, p.size * pk * (0.9 + 0.75 * t) * (g === "eye" ? 1.15 : 1));
        const lightness = light ? 42 : g === "eye" ? 80 : 70;

        ctx.beginPath();
        ctx.arc(CX + p.x, CY + p.y, radius, 0, TAU);
        ctx.fillStyle = t > 0.06
          ? `hsla(${hue},${light ? 85 : 80}%,${lightness}%,${light ? Math.min(0.98, alpha * 1.4) : alpha})`
          : `rgba(${light ? "30,41,70" : "255,255,255"},${alpha * (0.35 + t * 0.65)})`;
        ctx.fill();
      }

      /* ── Brilho de fundo ── */
      if (t > 0.04) {
        const ambR = (s === "speaking" ? 215 + pulse * 22 : 215) * k * t;
        const ambA = t * (s === "speaking" ? 0.032 + pulse * 0.012 : 0.045) * (light ? 1.5 : 1);
        const gl = light ? -12 : 0;
        const ga = ctx.createRadialGradient(CX, CY, 0, CX, CY, ambR);
        ga.addColorStop(0,   `hsla(${hue},85%,${65 + gl}%,0)`);
        ga.addColorStop(0.4, `hsla(${hue},80%,${60 + gl}%,${ambA * 0.4})`);
        ga.addColorStop(0.7, `hsla(${hue},75%,${55 + gl}%,${ambA})`);
        ga.addColorStop(1,   `hsla(${hue},70%,${50 + gl}%,0)`);
        ctx.beginPath(); ctx.arc(CX, CY, ambR, 0, TAU);
        ctx.fillStyle = ga; ctx.fill();
      }

      /* ── Falando: anéis lentos de respiração ── */
      if (s === "speaking" && t > 0.4) {
        for (let i = 0; i < 2; i++) {
          const wt = (ph * 0.5 + i * 0.5) % 1;
          const wr = (curR * 0.6 + wt * curR * 1.4) * t;
          const wa = (1 - wt) * 0.06 * t;
          ctx.beginPath(); ctx.arc(CX, CY, wr, 0, TAU);
          ctx.strokeStyle = `hsla(${hue},70%,${light ? 42 : 75}%,${light ? wa * 2 : wa})`;
          ctx.lineWidth   = Math.max(0.3, 0.8 * (1 - wt));
          ctx.stroke();
        }
      }

      /* ── Ouvindo: pulsos concêntricos ── */
      if (s === "listening" && t > 0.4) {
        for (let i = 0; i < 3; i++) {
          const lt = (ph * 0.23 + i / 3) % 1;
          const lr = (curR * 0.3 + lt * curR * 1.9) * t;
          const la = (1 - lt) * 0.16 * t;
          ctx.beginPath(); ctx.arc(CX, CY, lr, 0, TAU);
          ctx.strokeStyle = `hsla(${hue},90%,${light ? 42 : 80}%,${light ? la * 1.6 : la})`;
          ctx.lineWidth   = 1.0 * (1 - lt * 0.4);
          ctx.stroke();
        }
      }

      /* ── Pensando: arcos tracejados girando ── */
      if (s === "thinking" && t > 0.4) {
        ctx.save(); ctx.translate(CX, CY);
        ([
          { spd:  0.48, r: curR * 0.92, arc: 0.65, lw: 1.3, a: 0.19, dash: [8,  14] as [number, number] },
          { spd: -0.32, r: curR * 1.18, arc: 0.42, lw: 0.9, a: 0.11, dash: [5,  18] as [number, number] },
          { spd:  0.19, r: curR * 1.40, arc: 0.28, lw: 0.6, a: 0.07, dash: [4,  22] as [number, number] },
        ] as const).forEach(({ spd, r, arc, lw, a, dash }) => {
          ctx.save();
          ctx.rotate(ph * spd);
          ctx.beginPath(); ctx.arc(0, 0, r * t, 0, Math.PI * arc);
          ctx.strokeStyle = `hsla(${hue},88%,${light ? 42 : 74}%,${a * t * (light ? 1.5 : 1)})`;
          ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        });
        ctx.restore();
      }

      /* ── Wake: rostinho sonolento como convite ao clique ── */
      if (s === "wake" && t < 0.08) {
        const breathe = 0.5 + 0.5 * Math.sin(ph * 0.32);
        const fade    = 1 - t / 0.08;
        const hs      = R * k * 0.2;
        const ink     = light ? "30,41,70" : "255,255,255";
        const hr      = 0.5 + k * 0.5;
        ctx.fillStyle = `rgba(${ink},${(0.12 + breathe * 0.08) * (light ? 1.6 : 1) * fade})`;
        ctx.beginPath();   // um caminho só para os 272 pontos: em wake parado isso roda todo frame
        for (let i = 0; i < FACE_POINTS; i++) {
          if (clusterOf(i) === "dust") continue;
          const hx = CX + WAKE_HINT[i][0] * hs, hy = CY + WAKE_HINT[i][1] * hs;
          ctx.moveTo(hx + hr, hy);
          ctx.arc(hx, hy, hr, 0, TAU);
        }
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onClick={onClick}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", cursor: "pointer", display: "block" }}
    />
  );
}
