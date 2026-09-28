"use client";

import { useEffect, useRef } from "react";

export type OrbState = "wake" | "listening" | "thinking" | "speaking";
interface OrbProps { state: OrbState; onClick: () => void; theme?: "dark" | "light"; }

/* ── Config ──────────────────────────────────────────────────────────────── */

const N     = 320;   // particle count
const R     = 162;   // sphere radius (px)
const PERSP = 520;   // perspective depth
const REF   = 620;   // min(viewport w,h) at which the orb is drawn at full size

/* ── Fibonacci sphere — evenly distributes N points on unit sphere ───────── */

function fibSphere(n: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    pts.push([Math.cos(phi * i) * r, y, Math.sin(phi * i) * r]);
  }
  return pts;
}

const SPHERE_BASE = fibSphere(N);

/* ── 3D rotation helpers ─────────────────────────────────────────────────── */

function rotY(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}
function rotX(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

/* ── Particle type ───────────────────────────────────────────────────────── */

type P = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number; alpha: number;
  phase: number; phaseSpd: number;
};

function mkParticles(w: number, h: number): P[] {
  return Array.from({ length: N }, () => ({
    x: (Math.random() - 0.5) * w * 1.4,
    y: (Math.random() - 0.5) * h * 1.4,
    z: (Math.random() - 0.5) * 600,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    vz: (Math.random() - 0.5) * 0.5,
    size:     0.7 + Math.random() * 1.8,
    alpha:    0.12 + Math.random() * 0.5,
    phase:    Math.random() * Math.PI * 2,
    phaseSpd: 0.007 + Math.random() * 0.02,
  }));
}

/* ── Component ───────────────────────────────────────────────────────────── */

export default function Orb({ state, onClick, theme = "dark" }: OrbProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const frameRef     = useRef(0);
  const stateRef     = useRef(state);
  const lightRef     = useRef(theme === "light");
  const prevRef      = useRef<OrbState>(state);
  const ptsRef       = useRef<P[]>([]);
  const dimRef       = useRef({ w: 0, h: 0 });
  const kRef         = useRef(1);    // size factor: shrinks the orb on small viewports
  const tRef         = useRef(0);    // gather: 0 = scattered, 1 = sphere
  const phRef        = useRef(0);    // global phase
  const rotYRef      = useRef(0);    // Y spin angle
  const rotXRef      = useRef(0);    // X tilt angle

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { lightRef.current = theme === "light"; }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

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
      const s    = stateRef.current;
      const prev = prevRef.current;
      const { w, h } = dimRef.current;
      const k  = kRef.current;
      const CX = w / 2, CY = h / 2;
      const pts = ptsRef.current;

      /* ── Scatter burst when returning to wake ── */
      if (prev !== "wake" && s === "wake") {
        for (const p of pts) {
          const d = Math.hypot(p.x, p.y, p.z) || 1;
          const spd = 4 + Math.random() * 4.5;
          p.vx += (p.x / d) * spd + (Math.random() - 0.5) * 3;
          p.vy += (p.y / d) * spd + (Math.random() - 0.5) * 3;
          p.vz += (p.z / d) * spd + (Math.random() - 0.5) * 3;
        }
      }
      prevRef.current = s;

      /* ── Timing ── */
      const spinSpd = s === "thinking" ? 0.013 : s === "speaking" ? 0.004 : s === "listening" ? 0.005 : 0.0008;
      phRef.current   += s === "speaking" ? 0.016 : s === "thinking" ? 0.040 : s === "listening" ? 0.022 : 0.007;
      rotYRef.current += spinSpd;
      rotXRef.current  = Math.sin(phRef.current * 0.07) * 0.14;

      const ph = phRef.current;
      const ay = rotYRef.current;
      const ax = rotXRef.current;

      /* ── Gather factor ── */
      tRef.current += ((s !== "wake" ? 1 : 0) - tRef.current) * 0.030;
      const t = tRef.current;

      /* ── Speaking pulse — single slow breath ── */
      const pulse = s === "speaking"
        ? 0.5 + 0.5 * Math.sin(ph)   // one smooth slow wave, 0..1
        : 0;
      const curR = R * k * (1 + pulse * 0.06);

      /* ── Color ── */
      const light = lightRef.current;
      const hue = s === "thinking" ? 265 : s === "listening" ? 188 : s === "speaking" ? 205 : 215;

      ctx.clearRect(0, 0, w, h);

      /* ── Rotated sphere home positions ── */
      const homes: [number, number, number][] = SPHERE_BASE.map(([bx, by, bz]) => {
        let p = rotY(bx, by, bz, ay);
        p = rotX(p[0], p[1], p[2], ax);
        return [p[0] * curR, p[1] * curR, p[2] * curR];
      });

      /* ── Update physics ── */
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.phase += p.phaseSpd;

        // Spring toward sphere home
        if (t > 0.01) {
          const [hx, hy, hz] = homes[i];
          p.vx += (hx - p.x) * 0.052 * t;
          p.vy += (hy - p.y) * 0.052 * t;
          p.vz += (hz - p.z) * 0.052 * t;
        }

        // Gentle drift when scattered
        if (t < 0.99) {
          const nudge = s === "wake" ? 0.011 : 0.035;
          p.vx += (Math.random() - 0.5) * nudge * (1 - t);
          p.vy += (Math.random() - 0.5) * nudge * (1 - t);
          p.vz += (Math.random() - 0.5) * nudge * (1 - t);
        }

        // Damping — slower in wake so scatter fades gently
        const damp = s === "wake" && t < 0.05 ? 0.974 : 0.912;
        p.vx *= damp; p.vy *= damp; p.vz *= damp;
        p.x  += p.vx;  p.y  += p.vy;  p.z  += p.vz;

        // Wrap edges when scattered
        if (t < 0.35) {
          const bx = w / 2 + 60, by = h / 2 + 60, bz = 400;
          if (p.x < -bx) p.x = bx;  if (p.x > bx) p.x = -bx;
          if (p.y < -by) p.y = by;  if (p.y > by) p.y = -by;
          if (p.z < -bz) p.z = bz;  if (p.z > bz) p.z = -bz;
        }
      }

      /* ── Sort back-to-front for correct depth blending ── */
      const sorted = pts.map((p, i) => [p, i] as [P, number]).sort((a, b) => a[0].z - b[0].z);

      /* ── Draw particles ── */
      for (const [p] of sorted) {
        // Perspective scale: closer (higher z) = larger
        const scale = PERSP / (PERSP + p.z);
        const pk    = 0.55 + 0.45 * k; // particles shrink less than the orb
        const sx    = CX + p.x * scale;
        const sy    = CY + p.y * scale;

        // Depth: front = 1, back = 0
        const depth = Math.max(0, Math.min(1, (p.z + curR * 1.6) / (curR * 3.2)));

        const twinkle = 0.45 + 0.55 * Math.sin(p.phase);
        const bright  = 1 + depth * 1.6 * t;
        const alpha   = Math.min(0.96, p.alpha * twinkle * bright);
        const radius  = Math.max(0.25, p.size * scale * pk * (1 + depth * 0.6 * t));
        const lightness = light ? 44 - depth * 18 : 65 + depth * 28;

        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = t > 0.06
          ? `hsla(${hue},${light ? 85 : 80}%,${lightness}%,${light ? Math.min(0.98, alpha * 1.4) : alpha})`
          : `rgba(${light ? "30,41,70" : "255,255,255"},${alpha * (0.35 + t * 0.65)})`;
        ctx.fill();
      }

      /* ── Central glow ── */
      if (t > 0.04) {
        const ambR = (s === "speaking" ? 215 + pulse * 22 : 215) * k * t;
        const ambA = t * (s === "speaking" ? 0.032 + pulse * 0.012 : 0.045) * (light ? 1.5 : 1);
        const ga   = ctx.createRadialGradient(CX, CY, 0, CX, CY, ambR);
        const gl = light ? -12 : 0;
        ga.addColorStop(0,   `hsla(${hue},85%,${65 + gl}%,0)`);
        ga.addColorStop(0.4, `hsla(${hue},80%,${60 + gl}%,${ambA * 0.4})`);
        ga.addColorStop(0.7, `hsla(${hue},75%,${55 + gl}%,${ambA})`);
        ga.addColorStop(1,   `hsla(${hue},70%,${50 + gl}%,0)`);
        ctx.beginPath(); ctx.arc(CX, CY, ambR, 0, Math.PI * 2);
        ctx.fillStyle = ga; ctx.fill();

        const coreR = (s === "speaking" ? 18 + pulse * 5 : 18 + 4 * Math.sin(ph * 0.75)) * k * t;
        const coreA = t * (s === "speaking" ? 0.38 + pulse * 0.08 : 0.52);
        const gc    = ctx.createRadialGradient(CX, CY, 0, CX, CY, coreR * 2.8);
        gc.addColorStop(0,    light ? `hsla(${hue},90%,42%,${coreA * 0.8})` : `rgba(255,255,255,${coreA})`);
        gc.addColorStop(0.22, `hsla(${hue},90%,${light ? 55 : 92}%,${coreA * 0.55})`);
        gc.addColorStop(0.6,  `hsla(${hue},85%,${light ? 55 : 70}%,${coreA * 0.12})`);
        gc.addColorStop(1,    `hsla(${hue},80%,60%,0)`);
        ctx.beginPath(); ctx.arc(CX, CY, coreR * 2.8, 0, Math.PI * 2);
        ctx.fillStyle = gc; ctx.fill();
      }

      /* ── Speaking: slow breathing rings ── */
      if (s === "speaking" && t > 0.4) {
        for (let i = 0; i < 2; i++) {
          const wt = (ph * 0.5 + i * 0.5) % 1;
          const wr = (curR * 0.6 + wt * curR * 1.4) * t;
          const wa = (1 - wt) * 0.06 * t;
          ctx.beginPath(); ctx.arc(CX, CY, wr, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue},70%,${light ? 42 : 75}%,${light ? wa * 2 : wa})`;
          ctx.lineWidth   = Math.max(0.3, 0.8 * (1 - wt));
          ctx.stroke();
        }
      }

      /* ── Listening: concentric pulses ── */
      if (s === "listening" && t > 0.4) {
        for (let i = 0; i < 3; i++) {
          const lt = (ph * 0.23 + i / 3) % 1;
          const lr = (curR * 0.3 + lt * curR * 1.9) * t;
          const la = (1 - lt) * 0.16 * t;
          ctx.beginPath(); ctx.arc(CX, CY, lr, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue},90%,${light ? 42 : 80}%,${light ? la * 1.6 : la})`;
          ctx.lineWidth   = 1.0 * (1 - lt * 0.4);
          ctx.stroke();
        }
      }

      /* ── Thinking: rotating dashed arcs ── */
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

      /* ── Wake: subtle click hint ── */
      if (s === "wake" && t < 0.08) {
        const p2 = 0.5 + 0.5 * Math.sin(ph * 0.32);
        ctx.beginPath(); ctx.arc(CX, CY, (7 + p2 * 3) * k, 0, Math.PI * 2);
        const hint = light ? "30,41,70" : "255,255,255";
        ctx.fillStyle = `rgba(${hint},${(0.06 + p2 * 0.04) * (light ? 1.6 : 1)})`; ctx.fill();
        ctx.beginPath(); ctx.arc(CX, CY, (24 + p2 * 4) * k, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${hint},${(0.03 + p2 * 0.02) * (light ? 1.6 : 1)})`; ctx.lineWidth = 0.5; ctx.stroke();
      }

      frameRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
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
