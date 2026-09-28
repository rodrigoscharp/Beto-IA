"use client";

import { useEffect, useRef, useState } from "react";

interface NowPlaying {
  playing:    boolean;
  track:      string;
  artist:     string;
  albumArt:   string | null;
  albumName:  string;
  progressMs: number;
  durationMs: number;
}

interface Props {
  onCommand: (action: string) => void;
  /** Avisa quando começa/para de tocar: o Beto não abre o microfone para conversa com música rolando. */
  onPlaying?: (playing: boolean) => void;
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const IconPrev = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="3" width="2" height="10" rx="0.5" fill="currentColor"/>
    <path d="M14 3.8L6.5 8l7.5 4.2V3.8z" fill="currentColor"/>
  </svg>
);

const IconNext = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="12" y="3" width="2" height="10" rx="0.5" fill="currentColor"/>
    <path d="M2 3.8L9.5 8 2 12.2V3.8z" fill="currentColor"/>
  </svg>
);

const IconPlay = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M4 2.8L15 9 4 15.2V2.8z" fill="currentColor"/>
  </svg>
);

const IconPause = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <rect x="3.5" y="3" width="3.5" height="12" rx="0.5" fill="currentColor"/>
    <rect x="11" y="3" width="3.5" height="12" rx="0.5" fill="currentColor"/>
  </svg>
);

export default function MiniPlayer({ onCommand, onPlaying }: Props) {
  const [info,    setInfo]    = useState<NowPlaying | null>(null);
  const [visible, setVisible] = useState(false);
  const [localMs, setLocalMs] = useState(0);
  const [hover,   setHover]   = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onPlayingRef = useRef(onPlaying);
  onPlayingRef.current = onPlaying;

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/spotify/now-playing");
        if (!res.ok) return;
        const d: NowPlaying = await res.json();
        onPlayingRef.current?.(!!d.playing);
        if (d.playing) { setInfo(d); setLocalMs(d.progressMs); setVisible(true); }
        else setVisible(false);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (info?.playing) {
      tickRef.current = setInterval(() => {
        setLocalMs(p => Math.min(p + 1000, info.durationMs));
      }, 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [info]);

  if (!visible || !info) return null;

  const pct = info.durationMs > 0 ? Math.min(100, (localMs / info.durationMs) * 100) : 0;

  const controls = [
    { id: "previous", label: "prev", icon: <IconPrev /> },
    { id: info.playing ? "pause" : "resume", label: info.playing ? "pause" : "play", icon: info.playing ? <IconPause /> : <IconPlay />, primary: true },
    { id: "next", label: "next", icon: <IconNext /> },
  ];

  return (
    <>
      <style>{`
        @keyframes mp-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .mp-track-inner {
          display: inline-block;
          white-space: nowrap;
          animation: marquee 14s linear infinite;
        }
        .mp-track-inner:hover { animation-play-state: paused; }
      `}</style>

      <div className="beto-chrome" style={{
        position:       "fixed",
        bottom:         28,
        right:          28,
        width:          280,
        zIndex:         100,
        animation:      "mp-in 0.35s cubic-bezier(.22,.68,0,1.15) both",
        fontFamily:     "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      }}>

        {/* Outer frame */}
        <div style={{
          position:        "relative",
          background:      "rgba(var(--panel-rgb), 0.88)",
          backdropFilter:  "blur(24px) saturate(1.4)",
          border:          "1px solid rgba(var(--fg-rgb),0.08)",
          boxShadow:       "0 0 0 1px rgba(var(--fg-rgb),0.03) inset, 0 24px 64px rgba(var(--shadow-rgb),0.7), 0 0 40px rgba(var(--accent-rgb),0.04)",
          overflow:        "hidden",
        }}>

          {/* Top accent line */}
          <div style={{
            position:   "absolute",
            top:        0,
            left:       0,
            right:      0,
            height:     1,
            background: "linear-gradient(90deg, transparent, rgba(var(--accent-rgb),0.5) 40%, rgba(var(--accent-rgb),0.5) 60%, transparent)",
          }} />

          {/* Corner marks */}
          {[
            { top: 0,    left:  0,    borderTop: "1px solid rgba(var(--fg-rgb),0.22)", borderLeft:  "1px solid rgba(var(--fg-rgb),0.22)" },
            { top: 0,    right: 0,    borderTop: "1px solid rgba(var(--fg-rgb),0.22)", borderRight: "1px solid rgba(var(--fg-rgb),0.22)" },
            { bottom: 0, left:  0,    borderBottom: "1px solid rgba(var(--fg-rgb),0.22)", borderLeft:  "1px solid rgba(var(--fg-rgb),0.22)" },
            { bottom: 0, right: 0,    borderBottom: "1px solid rgba(var(--fg-rgb),0.22)", borderRight: "1px solid rgba(var(--fg-rgb),0.22)" },
          ].map((style, i) => (
            <div key={i} style={{ position: "absolute", width: 10, height: 10, ...style }} />
          ))}

          {/* Content */}
          <div style={{ padding: "14px 16px 16px" }}>

            {/* Header row */}
            <div style={{
              display:        "flex",
              justifyContent: "space-between",
              alignItems:     "center",
              marginBottom:   12,
            }}>
              <div style={{
                fontSize:      9,
                letterSpacing: "0.2em",
                color:         "rgba(var(--accent-rgb),0.6)",
                textTransform: "uppercase",
              }}>
                ◈ AUDIO
              </div>
              <button
                onClick={() => setVisible(false)}
                style={{
                  background:    "none",
                  border:        "none",
                  cursor:        "pointer",
                  padding:       0,
                  lineHeight:    1,
                  display:       "flex",
                  alignItems:    "center",
                  color:         "rgba(var(--fg-rgb),0.18)",
                  transition:    "color 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "rgba(var(--fg-rgb),0.5)")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(var(--fg-rgb),0.18)")}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              </button>
            </div>

            {/* Track + art row */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>

              {/* Album art */}
              <div style={{
                width:        44,
                height:       44,
                flexShrink:   0,
                position:     "relative",
                border:       "1px solid rgba(var(--fg-rgb),0.07)",
                overflow:     "hidden",
              }}>
                {info.albumArt
                  ? <img src={info.albumArt} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <div style={{
                      width: "100%", height: "100%",
                      background: "rgba(var(--fg-rgb),0.04)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <circle cx="9" cy="9" r="5.5" stroke="rgba(var(--fg-rgb),0.15)" strokeWidth="1"/>
                        <circle cx="9" cy="9" r="1.5" fill="rgba(var(--fg-rgb),0.2)"/>
                      </svg>
                    </div>
                }
                {/* Art overlay */}
                <div style={{
                  position:   "absolute",
                  inset:      0,
                  background: "linear-gradient(135deg, rgba(var(--fg-rgb),0.04) 0%, transparent 60%)",
                  pointerEvents: "none",
                }} />
              </div>

              {/* Track info */}
              <div style={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
                {/* Scrolling track name */}
                <div style={{ overflow: "hidden", maskImage: "linear-gradient(90deg, black 80%, transparent)", WebkitMaskImage: "linear-gradient(90deg, black 80%, transparent)" }}>
                  <div className="mp-track-inner" style={{
                    fontSize:      12,
                    fontWeight:    500,
                    color:         "rgba(var(--fg-rgb),0.9)",
                    letterSpacing: "0.02em",
                    paddingRight:  32,
                  }}>
                    {info.track}&nbsp;&nbsp;&nbsp;&nbsp;{info.track}
                  </div>
                </div>
                <div style={{
                  fontSize:      10,
                  color:         "rgba(var(--fg-rgb),0.35)",
                  letterSpacing: "0.04em",
                  marginTop:     3,
                  whiteSpace:    "nowrap",
                  overflow:      "hidden",
                  textOverflow:  "ellipsis",
                }}>
                  {info.artist}
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  height:     2,
                  background: "rgba(var(--fg-rgb),0.07)",
                  position:   "relative",
                  cursor:     "pointer",
                }}
              >
                <div style={{
                  position:   "absolute",
                  left:       0,
                  top:        0,
                  height:     "100%",
                  width:      `${pct}%`,
                  background: "linear-gradient(90deg, rgba(var(--accent-rgb),0.6), rgba(var(--accent2-rgb),0.9))",
                  transition: "width 0.9s linear",
                }} />
                {/* Playhead dot */}
                <div style={{
                  position:    "absolute",
                  top:         "50%",
                  left:        `${pct}%`,
                  transform:   "translate(-50%, -50%)",
                  width:       6,
                  height:      6,
                  borderRadius: "50%",
                  background:  "rgba(var(--accent2-rgb),0.95)",
                  boxShadow:   "0 0 6px rgba(var(--accent2-rgb),0.6)",
                  transition:  "left 0.9s linear",
                }} />
              </div>
              <div style={{
                display:        "flex",
                justifyContent: "space-between",
                marginTop:      6,
                fontSize:       9,
                color:          "rgba(var(--fg-rgb),0.22)",
                letterSpacing:  "0.08em",
              }}>
                <span>{fmt(localMs)}</span>
                <span>{fmt(info.durationMs)}</span>
              </div>
            </div>

            {/* Controls */}
            <div style={{
              display:        "flex",
              justifyContent: "center",
              alignItems:     "center",
              gap:            0,
            }}>
              {controls.map(({ id, label, icon, primary }) => (
                <button
                  key={label}
                  onClick={() => onCommand(id)}
                  onMouseEnter={() => setHover(label)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    background:   hover === label
                      ? primary ? "rgba(var(--accent-rgb),0.12)" : "rgba(var(--fg-rgb),0.05)"
                      : "none",
                    border:       primary
                      ? `1px solid ${hover === label ? "rgba(var(--accent-rgb),0.3)" : "rgba(var(--fg-rgb),0.1)"}`
                      : "none",
                    borderRadius: 0,
                    cursor:       "pointer",
                    padding:      primary ? "10px 20px" : "10px 16px",
                    color:        primary
                      ? hover === label ? "rgba(var(--accent2-rgb),1)" : "rgba(var(--fg-rgb),0.75)"
                      : hover === label ? "rgba(var(--fg-rgb),0.75)" : "rgba(var(--fg-rgb),0.35)",
                    display:      "flex",
                    alignItems:   "center",
                    justifyContent: "center",
                    transition:   "all 0.15s ease",
                    transform:    hover === label ? "scale(1.08)" : "scale(1)",
                    lineHeight:   1,
                  }}
                >
                  {icon}
                </button>
              ))}
            </div>

          </div>

          {/* Bottom accent */}
          <div style={{
            position:   "absolute",
            bottom:     0,
            left:       "20%",
            right:      "20%",
            height:     1,
            background: "linear-gradient(90deg, transparent, rgba(var(--accent-rgb),0.2), transparent)",
          }} />
        </div>
      </div>
    </>
  );
}
