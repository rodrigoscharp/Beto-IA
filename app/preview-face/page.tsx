"use client";

import { useEffect, useRef, useState } from "react";
import {
  EMOTIONS, EXPRESSIONS, STATE_FACES, FACE_POINTS, clusterOf, faceTargets, type Emotion, type Face,
} from "@/components/face";
import Orb, { type OrbState } from "@/components/Orb";

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

const STATES: OrbState[] = ["wake", "listening", "thinking", "speaking"];

export default function PreviewFace() {
  const [live, setLive] = useState(false);
  const [st, setSt] = useState<OrbState>("speaking");
  const [emo, setEmo] = useState<Emotion>("neutro");
  const btn = (on: boolean): React.CSSProperties => ({
    padding: "6px 10px", borderRadius: 8, border: "1px solid #456", font: "13px system-ui",
    background: on ? "#2a5" : "#123", color: "#eef", cursor: "pointer",
  });
  return (
    <main style={{ minHeight: "100vh", background: "#000", padding: 16 }}>
      {live && <Orb state={st} emotion={emo} onClick={() => {}} />}
      <div style={{ position: "fixed", zIndex: 10, top: 12, right: 12 }}>
        <button style={btn(live)} onClick={() => setLive(v => !v)}>{live ? "Fechar ao vivo" : "Orb ao vivo"}</button>
      </div>
      {live && (
        <div style={{ position: "fixed", zIndex: 10, left: 12, right: 12, bottom: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {STATES.map(s => <button key={s} style={btn(st === s)} onClick={() => setSt(s)}>{s}</button>)}
          <span style={{ width: 12 }} />
          {EMOTIONS.map(e => <button key={e} style={btn(emo === e)} onClick={() => setEmo(e)}>{e}</button>)}
        </div>
      )}
      {!live && (
        <>
          <h1 style={{ color: "#dde", font: "600 16px system-ui", marginBottom: 12 }}>Rostos do Beto (dev)</h1>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {EMOTIONS.map((e) => <FaceCell key={e} label={e} face={EXPRESSIONS[e]} />)}
            {(Object.keys(STATE_FACES) as (keyof typeof STATE_FACES)[]).map((s) => (
              <FaceCell key={s} label={`estado: ${s}`} face={STATE_FACES[s]} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
