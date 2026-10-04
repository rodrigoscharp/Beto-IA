"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { EMOTIONS, type Emotion, type VoiceState } from "@/lib/emotion";
import { EMOTION_TO_MASCOT } from "@/components/mascot/mapping";

const BetoGhost = dynamic(() => import("@/components/mascot/BetoGhost"), { ssr: false });

const STATES: VoiceState[] = ["wake", "listening", "thinking", "speaking"];

/* Galeria do mascote (só dev): todo estado, emoção e evento num lugar. */
export default function PreviewFace() {
  const [st, setSt] = useState<VoiceState>("speaking");
  const [emo, setEmo] = useState<Emotion>("neutro");
  const [talking, setTalking] = useState(false);
  const [music, setMusic] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [wave, setWave] = useState(0);
  const [notify, setNotify] = useState(0);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const light = theme === "light";
  const btn = (on: boolean): React.CSSProperties => ({
    padding: "6px 10px", borderRadius: 8, font: "13px system-ui", cursor: "pointer",
    border: `1px solid ${light ? "#c9d2e0" : "#345"}`,
    background: on ? "#FF6B2C" : light ? "#fff" : "#101820",
    color: on ? "#16140F" : light ? "#0f172a" : "#eef",
  });
  const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" };
  const label: React.CSSProperties = { font: "600 12px system-ui", color: light ? "#475569" : "#9ab", width: 64 };

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <BetoGhost state={st} emotion={emo} talking={talking} music={music} theme={theme}
        waveSignal={wave} notifySignal={notify} onClick={() => {}} />
      <div style={{ position: "fixed", zIndex: 10, left: 12, right: 12, bottom: 12, display: "grid", gap: 6 }}>
        <div style={row}>
          <span style={label}>estado</span>
          {STATES.map(s => <button key={s} style={btn(st === s)} onClick={() => setSt(s)}>{s}</button>)}
        </div>
        <div style={row}>
          <span style={label}>emoção</span>
          {EMOTIONS.map(e => (
            <button key={e} style={btn(emo === e)} onClick={() => { setEmo(e); setSt("speaking"); }} title={`mascote: ${EMOTION_TO_MASCOT[e]}`}>{e}</button>
          ))}
        </div>
        <div style={row}>
          <span style={label}>eventos</span>
          <button style={btn(talking)} onClick={() => setTalking(v => !v)}>{talking ? "■ parar de falar" : "▶ falar"}</button>
          <button style={btn(false)} onClick={() => setWave(n => n + 1)}>acenar</button>
          <button style={btn(false)} onClick={() => setNotify(n => n + 1)}>notificação</button>
          <button style={btn(music)} onClick={() => setMusic(v => !v)}>música (DJ no wake)</button>
          <button style={btn(false)} onClick={() => setTheme(t => (t === "dark" ? "light" : "dark"))}>{light ? "☾ escuro" : "☀ claro"}</button>
        </div>
      </div>
    </main>
  );
}
