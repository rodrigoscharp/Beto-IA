"use client";

import { useEffect, useRef } from "react";
import {
  EMOTIONS, EXPRESSIONS, STATE_FACES, FACE_POINTS, clusterOf, faceTargets, type Face,
} from "@/components/face";

const SIZE = 240;
const SCALE = 150;   // pixels por unidade do rosto (boca aberta cabe no quadro)

function FaceCell({ label, face }: { label: string; face: Face }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const pts = faceTargets(face, 0);
    for (let i = 0; i < FACE_POINTS; i++) {
      const g = clusterOf(i);
      if (g === "dust") continue;
      const [fx, fy] = pts[i];
      ctx.beginPath();
      ctx.arc(SIZE / 2 + fx * SCALE, SIZE / 2 + fy * SCALE, g === "eye" ? 2.4 : 1.9, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${face.hue},80%,${g === "eye" ? 82 : 70}%,0.95)`;
      ctx.fill();
    }
  }, [face]);
  return (
    <figure style={{ margin: 0, textAlign: "center" }}>
      <canvas ref={ref} width={SIZE} height={SIZE} style={{ background: "#05080f", borderRadius: 12, maxWidth: "100%" }} />
      <figcaption style={{ color: "#9ab", font: "13px system-ui", marginTop: 6 }}>{label}</figcaption>
    </figure>
  );
}

export default function PreviewFace() {
  return (
    <main style={{ minHeight: "100vh", background: "#000", padding: 16 }}>
      <h1 style={{ color: "#dde", font: "600 16px system-ui", marginBottom: 12 }}>Rostos do Beto (dev)</h1>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {EMOTIONS.map((e) => <FaceCell key={e} label={e} face={EXPRESSIONS[e]} />)}
        {(Object.keys(STATE_FACES) as (keyof typeof STATE_FACES)[]).map((s) => (
          <FaceCell key={s} label={`estado: ${s}`} face={STATE_FACES[s]} />
        ))}
      </div>
    </main>
  );
}
