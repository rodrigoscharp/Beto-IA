"use client";

import { useState, useRef, useEffect } from "react";
import Orb, { OrbState } from "@/components/Orb";
import { EMOTION_TAG, parseEmotion, type Emotion } from "@/components/face";
import MiniPlayer from "@/components/MiniPlayer";
import { useTheme } from "@/components/useTheme";
import { useProactive } from "@/components/useProactive";
import { usePush } from "@/components/usePush";
import { resolveEmailRef, type ListedEmail } from "@/lib/gmail-text";

/* ══════════════════════════════════════════════════════════════════════════
   Types
══════════════════════════════════════════════════════════════════════════ */

interface SREvent extends Event {
  resultIndex: number;
  results:     SpeechRecognitionResultList;
}
interface SR extends EventTarget {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onstart:  ((e: Event)   => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror:  ((e: SRErrorEvent) => void) | null;
  onend:    ((e: Event)   => void) | null;
}
interface SRErrorEvent extends Event { error?: string }
interface SRCtor { new(): SR; }

declare global {
  interface Window {
    SpeechRecognition:          SRCtor;
    webkitSpeechRecognition:    SRCtor;
    Spotify:                    { Player: new (opts: SpotifySDKOptions) => SpotifySDKPlayer };
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

interface SpotifySDKOptions {
  name: string;
  getOAuthToken: (cb: (t: string) => void) => void;
  volume: number;
}
interface SpotifySDKPlayer {
  addListener(event: string, cb: (arg: { device_id: string }) => void): void;
  connect(): void;
}

type Mode = "idle" | "wake" | "listening" | "thinking" | "speaking";

interface Msg            { role: "user" | "assistant"; content: string }
interface SpotifyAction  { action: string; query?: string; level?: number }
interface CalendarAction { action: string; title?: string; date?: string; time?: string; duration?: number; query?: string }

interface GmailAction    { action: string; days?: number; ref?: string }
interface GithubAction   { action: string; repo?: string }
interface TimerAction    { action: string; minutes?: number; label?: string }
interface MemoryAction   { action: string; content?: string; category?: string }
interface MyHubAction    { acao: string; entrada?: unknown }
interface MyHubResult    { ok: boolean; acao?: { resumo: string; desfazer?: string }; erro?: string }

/* ══════════════════════════════════════════════════════════════════════════
   Constants
══════════════════════════════════════════════════════════════════════════ */

const WAKE_WORDS = ["beto", "olá beto", "ola beto", "hey beto", "ei beto", "acorda beto", "acorda, beto"];

const TAG = {
  SPOTIFY:  /\[SPOTIFY:(\{[\s\S]*?\})\]\s*/,
  CALENDAR: /\[CALENDAR:(\{[\s\S]*?\})\]\s*/,

  GITHUB:   /\[GITHUB:(\{[\s\S]*?\})\]\s*/,
  GMAIL:    /\[GMAIL:(\{[\s\S]*?\})\]\s*/,
  TIMER:    /\[TIMER:(\{[\s\S]*?\})\]\s*/,
  MEMORY:   /\[MEMORY:(\{[\s\S]*?\})\]\s*/,
  BRIEFING: /\[BRIEFING:(\{[\s\S]*?\})\]\s*/,
  MYHUB:    /\[MYHUB:(\{[\s\S]*?\})\]\s*/,
};

/* Saudações puras ("bom dia", "oi", "tudo bem?") o Beto responde na hora, sem modelo:
   as respostas são áudio pré-gerado guardado no navegador. Qualquer coisa a mais na frase vai para o modelo. */
const GREETINGS = {
  bomdia:  ["Bom dia, chefe! Quer que eu passe o briefing do dia?", "Bom dia, chefe! Bora pra mais um dia. Quer o briefing?"],
  boatarde:["Boa tarde, chefe! No que posso ajudar?", "Boa tarde, chefe! Diga aí."],
  boanoite:["Boa noite, chefe! Como posso ajudar?", "Boa noite, chefe! Tô por aqui."],
  oi:      ["E aí, chefe! Tô na área. O que manda?", "Fala, chefe! Pode falar.", "Opa, chefe! Diga aí."],
  tudobem: ["Tudo certo por aqui, chefe! E você, como tá?", "Tranquilo, chefe! E contigo?"],
} as const;
type GreetingKind = keyof typeof GREETINGS;

function greetingKind(text: string): GreetingKind | null {
  const s = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, " ")
    .replace(/\b(beto|chefe|hey)\b/g, " ").replace(/\s+/g, " ").trim();
  if (/^bom dia( tudo (bem|bom)| como vai)?$/.test(s))                          return "bomdia";
  if (/^boa tarde( tudo (bem|bom)| como vai)?$/.test(s))                        return "boatarde";
  if (/^boa noite( tudo (bem|bom)| como vai)?$/.test(s))                        return "boanoite";
  if (/^(oi|oie|ola|opa|salve|fala|eae|e ai|fala ai|ei)( tudo (bem|bom))?$/.test(s)) return "oi";
  if (/^(tudo (bem|bom|certo)|como vai|como voce esta|firmeza)$/.test(s))       return "tudobem";
  return null;
}

const GREETING_PHRASES: string[] = Object.values(GREETINGS).flatMap(v => [...v]);
const GREETING_CACHE = "beto-fillers-v2";   // nome antigo mantido de propósito: trocar regeraria os áudios e gastaria cota da ElevenLabs
const PREBUFFER_S = 0.5;        // segundos de áudio na frente antes de começar a tocar a resposta
/* Conversa contínua: depois de responder, o Beto já volta a ouvir sem precisar do nome dele. */
const FOLLOWUP_MS    = 9000;   // quanto tempo ele espera você continuar antes de voltar ao wake word
const FOLLOWUP_GAP   = 250;    // respiro entre o fim da voz dele e abrir o microfone (evita ouvir o próprio eco)
const END_CONVERSATION = /^(valeu|obrigad[oa]|tchau|é isso|só isso|era isso|por hoje é isso|pode parar|pode ficar quieto|fechou|beleza)([\s,.!]+(beto|chefe))?[\s.!]*$/i;
/* Rede de proteção: o modelo diz que registrou sem ter mandado a tag (nada foi gravado). */
const CLAIMS_WRITE    = /\b(anotei|anotado|registrei|registrado|lancei|lançado|adicionei|adicionado|coloquei|marquei)\b/i;
const REGISTER_INTENT = /\b(gast|receb|anot|regist|adicion|coloc|lanc|lanç|marca|cria|bebi|treinei|estudei|paguei|comprei)/i;
const HAS_TAG         = /\[[A-Z]+:\{/;

/* ══════════════════════════════════════════════════════════════════════════
   Pure helpers
══════════════════════════════════════════════════════════════════════════ */

function parseTag<T>(reply: string, re: RegExp): { action: T | null; text: string } {
  const m = reply.match(re);
  if (!m) return { action: null, text: reply };
  try   { return { action: JSON.parse(m[1]) as T, text: reply.replace(m[0], "").trim() }; }
  catch { return { action: null, text: reply }; }
}

function sanitize(text: string): string {
  return text
    .replace(EMOTION_TAG, "")     // última defesa: a tag nunca é falada nem vai para a legenda
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]+`/g, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
   Component
══════════════════════════════════════════════════════════════════════════ */

export default function JarvisPage() {

  /* ── State ───────────────────────────────────────────────────────────── */

  const [orbState,     setOrbState]     = useState<OrbState>("wake");
  const [emotion,      setEmotion]      = useState<Emotion>("neutro");
  const [talking,      setTalking]      = useState(false);   // voz de fato tocando: a boca do rosto só mexe nesse intervalo
  const [caption,      setCaption]      = useState("");
  const [timerDisplay, setTimerDisplay] = useState<{ label: string; timeLeft: number } | null>(null);
  const [audioReady,   setAudioReady]   = useState(false);
  const [theme,        toggleTheme]     = useTheme();
  const push = usePush();

  const mode           = useRef<Mode>("idle");
  const history        = useRef<Msg[]>([]);
  const wakeRec        = useRef<SR | null>(null);
  const activeRec      = useRef<SR | null>(null);
  const restartTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceId       = useRef<string | null>(null);
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const audioUnlocked  = useRef(false);
  const timerInterval  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerSecsLeft  = useRef(0);
  const timerLabel     = useRef("");
  const wakeLastAlive  = useRef(0);
  const wakeBlocked    = useRef(false);
  const wakeFails      = useRef(0);
  const wakeLock       = useRef<{ release(): Promise<void> } | null>(null);
  const cachedAudio    = useRef(new Map<string, string>());   // frase pré-gerada -> blob URL
  const musicPlaying   = useRef(false);
  const lastUndo       = useRef<{ path: string | null; resumo: string; ts: number } | null>(null);
  const undoHinted     = useRef(false);
  const lastEmails     = useRef<ListedEmail[]>([]);

  /* ── Avisos proativos: o Beto fala sozinho (email, agenda, My Hub, GitHub) ── */

  const [alertsOn, toggleAlerts] = useProactive({
    canSpeak: () => mode.current === "wake" && audioUnlocked.current,
    announce: (text, onDone, alerts) => {
      // "lê esse email" logo depois do aviso: o email avisado passa a ser o primeiro da lista
      const avisados = alerts.flatMap(a => (a.email ? [{ id: a.email.id, sender: a.email.sender, subject: a.email.subject }] : []));
      if (avisados.length) lastEmails.current = [...avisados, ...lastEmails.current].slice(0, 10);
      // Para o ouvinte do wake word antes de falar: senão ele escuta a própria voz do Beto.
      try { wakeRec.current?.abort(); } catch { /* ok */ }
      wakeRec.current = null;
      clearRestartTimer();
      speak(sanitize(text), () => { onDone(); setMode("wake"); setTimeout(startWake, 300); });
    },
  });

  /* ── Lifecycle: auto-start on mount ─────────────────────────────────── */

  useEffect(() => {
    // Spotify OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get("spotify") === "ok") {
      window.history.replaceState({}, "", "/");
      initSpotifySDK();
    } else if (params.get("calendar") === "ok") {
      window.history.replaceState({}, "", "/");
    }

    fetch("/api/spotify/status")
      .then(r => r.json())
      .then(d => { if (d.connected) initSpotifySDK(); })
      .catch(() => {});

    // Auto-start wake word listener — no click needed
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
    setMode("wake");
    startWake();

    const prefetch = setTimeout(prefetchGreetings, 3000);
    return () => clearTimeout(prefetch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Lifecycle: unlock audio on first user interaction ───────────────── */

  useEffect(() => {
    const unlock = () => {
      if (audioUnlocked.current) return;
      audioUnlocked.current = true;
      const synth = window.speechSynthesis;
      if (synth) {
        synth.onvoiceschanged = () => synth.getVoices();
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        synth.speak(u);
      }
      setAudioReady(true);
      document.removeEventListener("click",      unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown",    unlock);
    };
    document.addEventListener("click",      unlock, { passive: true });
    document.addEventListener("touchstart", unlock, { passive: true });
    document.addEventListener("keydown",    unlock, { passive: true });
    return () => {
      document.removeEventListener("click",      unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown",    unlock);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Lifecycle: keep listening while the app stays open (Dock/PWA) ───── */

  useEffect(() => {
    const revive = () => {
      if (mode.current !== "wake" || wakeBlocked.current) return;
      const stale = Date.now() - wakeLastAlive.current > 20_000;
      if (!wakeRec.current || stale) startWake();
    };

    const acquireLock = async () => {
      try {
        const wl = (navigator as unknown as {
          wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> };
        }).wakeLock;
        if (!wl || wakeLock.current || document.visibilityState !== "visible") return;
        const sentinel = await wl.request("screen");
        wakeLock.current = sentinel;
        (sentinel as unknown as EventTarget).addEventListener("release", () => { wakeLock.current = null; });
      } catch { /* unsupported or denied */ }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") { acquireLock(); }
      revive();
    };

    acquireLock();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus",    revive);
    window.addEventListener("pageshow", revive);
    window.addEventListener("online",   revive);
    const watchdog = setInterval(revive, 5_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus",    revive);
      window.removeEventListener("pageshow", revive);
      window.removeEventListener("online",   revive);
      clearInterval(watchdog);
      wakeLock.current?.release().catch(() => {});
      wakeLock.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Lifecycle: keepalive + cleanup ──────────────────────────────────── */

  useEffect(() => {
    const ka = setInterval(() => {
      const s = window.speechSynthesis;
      if (s?.speaking) { s.pause(); s.resume(); }
    }, 10_000);
    return () => {
      clearInterval(ka);
      stopCountdown();
      stopAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Spotify Web Playback SDK ────────────────────────────────────────── */

  function initSpotifySDK() {
    if (window.Spotify) { createSpotifyPlayer(); return; }
    const script   = document.createElement("script");
    script.src     = "https://sdk.scdn.co/spotify-player.js";
    script.async   = true;
    document.head.appendChild(script);
    window.onSpotifyWebPlaybackSDKReady = createSpotifyPlayer;
  }

  function createSpotifyPlayer() {
    const SDK = window.Spotify;
    if (!SDK) return;
    const player = new SDK.Player({
      name: "Beto",
      getOAuthToken: (cb) => {
        fetch("/api/spotify/token")
          .then(r => r.json())
          .then(d => { if (d.token) cb(d.token); })
          .catch(() => {});
      },
      volume: 0.8,
    });
    player.addListener("ready",         ({ device_id }) => { deviceId.current = device_id; });
    player.addListener("not_ready",     ()              => { deviceId.current = null; });
    player.addListener("account_error", ()              => { console.warn("[Beto] Spotify Premium necessário."); });
    player.connect();
  }

  /* ── Saudações: áudio gerado uma vez e guardado no navegador (Cache Storage) ─────────── */

  async function prefetchGreetings() {
    if (typeof caches === "undefined") return;
    try {
      const cache = await caches.open(GREETING_CACHE);
      for (const text of GREETING_PHRASES) {
        const key = `/__filler/${encodeURIComponent(text)}`;   // prefixo antigo mantido: é a chave do cache já gravado nos aparelhos
        let res = await cache.match(key);
        if (!res) {
          const r = await fetch("/api/tts", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            // silêncio na frente: o áudio do aparelho acorda sem comer o início da frase
            body:    JSON.stringify({ text, lead: true }),
          });
          if (!r.ok) continue;
          await cache.put(key, r.clone());
          res = r;
        }
        cachedAudio.current.set(text, URL.createObjectURL(await res.blob()));
      }
    } catch { /* sem cache: o Beto responde pelo caminho normal */ }
  }

  /** Toca uma frase pré-gerada na hora. Devolve false se ainda não está no cache (aí cai no TTS normal). */
  function speakCached(text: string, onDone: () => void, emotion: Emotion = "neutro"): boolean {
    const url = cachedAudio.current.get(text);
    if (!url || !audioUnlocked.current) return false;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
    window.speechSynthesis?.cancel();
    setMode("speaking");
    setEmotion(emotion);   // junto do setMode: nenhuma outra fala consegue trocar o rosto no meio do caminho
    setTalking(false);
    setCaption(text);

    const audio = new Audio(url);
    audioRef.current = audio;
    const finish = () => { audioRef.current = null; setTalking(false); setCaption(""); onDone(); };
    audio.onplaying = () => setTalking(true);
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(finish);
    return true;
  }

  /* ── Mode & stop helpers ─────────────────────────────────────────────── */

  function setMode(m: Mode) {
    mode.current = m;
    // A emoção da resposta só vale enquanto o Beto fala; ouvindo, pensando ou em wake ela não sobra para o próximo turno.
    if (m !== "speaking") { setEmotion("neutro"); setTalking(false); }
    setOrbState(
      m === "speaking"  ? "speaking"  :
      m === "thinking"  ? "thinking"  :
      m === "listening" ? "listening" : "wake"
    );
  }

  function clearRestartTimer() {
    if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null; }
  }

  function stopAll() {
    clearRestartTimer();
    try { wakeRec.current?.abort();   } catch { /* ok */ }
    try { activeRec.current?.abort(); } catch { /* ok */ }
    wakeRec.current = null;
    activeRec.current = null;
    window.speechSynthesis?.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
  }

  /* ── Countdown timer ─────────────────────────────────────────────────── */

  function startCountdown(minutes: number, label: string) {
    stopCountdown();
    timerSecsLeft.current = minutes * 60;
    timerLabel.current    = label;
    setTimerDisplay({ label, timeLeft: timerSecsLeft.current });

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    timerInterval.current = setInterval(() => {
      timerSecsLeft.current -= 1;
      setTimerDisplay({ label: timerLabel.current, timeLeft: timerSecsLeft.current });
      if (timerSecsLeft.current <= 0) {
        stopCountdown();
        setTimerDisplay(null);
        onCountdownEnd(timerLabel.current);
      }
    }, 1000);
  }

  function stopCountdown() {
    if (timerInterval.current) { clearInterval(timerInterval.current); timerInterval.current = null; }
  }

  function onCountdownEnd(label: string) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Beto", { body: `${label} finalizado!`, icon: "/icons/icon-192.png" });
    }
    const lower = label.toLowerCase();
    const msg   =
      lower.includes("pomodoro") ? "Pomodoro finalizado! Hora de uma pausa merecida." :
      lower.includes("pausa")    ? "Pausa encerrada. Bora voltar ao foco!"            :
      `${label} finalizado!`;
    speak(msg, () => { setMode("wake"); startWake(); }, "alegre");
  }

  function getCountdownStatus(): string {
    if (!timerInterval.current || timerSecsLeft.current <= 0) return "Não há nenhum timer ativo no momento.";
    return `Faltam ${formatTime(timerSecsLeft.current)} para o ${timerLabel.current}.`;
  }

  /* ── TTS: ElevenLabs with MediaSource streaming, synth fallback ──────── */

  function speak(text: string, onDone: () => void, emotion: Emotion = "neutro") {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
    window.speechSynthesis?.cancel();
    // Nada para falar (ex.: a resposta veio só com a tag de emoção): segue o fluxo sem ficar mudo em "speaking".
    if (!text.trim()) { onDone(); return; }
    setMode("speaking");
    setEmotion(emotion);
    setTalking(false);
    setCaption(text);

    const done = () => { setTalking(false); setCaption(""); onDone(); };

    // Sem a voz da ElevenLabs (cota acabou, chave recusada) o Beto NÃO troca por outra voz: o texto fica na tela
    // pelo tempo de ler e a conversa segue. O motivo fica nos logs da rota /api/tts.
    const silent = () => { setTimeout(done, Math.min(8000, 1500 + text.length * 55)); };

    fetch("/api/tts", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text, lead: true }),
    })
      .then(res => {
        if (!res.ok || !res.body) throw new Error("TTS falhou");

        const supportsMS =
          typeof MediaSource !== "undefined" &&
          MediaSource.isTypeSupported("audio/mpeg");

        if (supportsMS) {
          const ms    = new MediaSource();
          const url   = URL.createObjectURL(ms);
          const audio = new Audio(url);
          audioRef.current = audio;

          const cleanup = () => { URL.revokeObjectURL(url); audioRef.current = null; done(); };
          audio.onplaying = () => setTalking(true);
          audio.onended = cleanup;
          audio.onerror = cleanup;

          ms.addEventListener("sourceopen", async () => {
            let sb: SourceBuffer;
            try   { sb = ms.addSourceBuffer("audio/mpeg"); }
            catch { cleanup(); return; }

            const reader     = res.body!.getReader();
            const waitUpdate = () =>
              new Promise<void>(r => sb.addEventListener("updateend", () => r(), { once: true }));

            // Só começa a tocar com um pouco de áudio já bufferizado (ou no fim do stream, se for curto):
            // começar no primeiro pedacinho fazia o início da fala sair cortado.
            let started = false;
            const start = async () => {
              if (started) return;
              started = true;
              audio.play().catch(() => {});
            };
            const buffered = () => audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) - audio.currentTime : 0;

            try {
              for (;;) {
                const { done: streamDone, value } = await reader.read();
                if (streamDone) {
                  if (sb.updating) await waitUpdate();
                  if (ms.readyState === "open") ms.endOfStream();
                  void start();
                  return;
                }
                if (sb.updating) await waitUpdate();
                sb.appendBuffer(value);
                if (!started && buffered() >= PREBUFFER_S) void start();
              }
            } catch { cleanup(); }
          });

        } else {
          res.blob()
            .then(blob => {
              const url   = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audioRef.current  = audio;
              const cleanup = () => { URL.revokeObjectURL(url); audioRef.current = null; done(); };
              audio.onplaying = () => setTalking(true);
              audio.onended = cleanup;
              audio.onerror = cleanup;
              audio.play().catch(done);
            })
            .catch(silent);
        }
      })
      .catch(silent);
  }

  /* ── Spotify deep-link + playback polling ────────────────────────────── */

  function openSpotifyUri(uri: string) {
    const a       = document.createElement("a");
    a.href        = uri;
    a.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none;";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { a.remove(); } catch { /* ok */ } }, 500);

    let attempts = 0;
    const poll   = setInterval(async () => {
      if (++attempts > 10) { clearInterval(poll); return; }
      try {
        const res  = await fetch("/api/spotify/command", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action: "play_uri", uri }),
        });
        const data = await res.json();
        if (data.ok) clearInterval(poll);
      } catch { /* retry */ }
    }, 1000);
  }

  /* ══════════════════════════════════════════════════════════════════════
     Action executors
  ══════════════════════════════════════════════════════════════════════ */

  async function execSpotify(action: SpotifyAction): Promise<string> {
    try {
      const res = await fetch("/api/spotify/command", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...action, device_id: deviceId.current }),
      });
      if (res.status === 401) {
        window.location.href = "/api/spotify/login";
        return "Redirecionando para autenticar o Spotify.";
      }
      const data = await res.json();
      if (data.error) return data.error;
      if (action.action === "current") {
        return data.playing ? `Tocando ${data.track} de ${data.artist}.` : "Nada tocando no momento.";
      }
      if (data.spotifyUri) openSpotifyUri(data.spotifyUri);
      switch (action.action) {
        case "play":     return data.track ? `${data.track}.` : "Pronto.";
        case "pause":    return "Pausado.";
        case "resume":   return "Continuando.";
        case "next":     return "Ok.";
        case "previous": return "Ok.";
        case "volume":   return "Feito.";
        case "shuffle":  return "Aleatório ativado.";
        default:         return "Pronto.";
      }
    } catch { return "Erro ao conectar com o Spotify."; }
  }

  async function execCalendar(action: CalendarAction): Promise<string> {
    try {
      const res = await fetch("/api/calendar/command", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(action),
      });
      if (res.status === 401) {
        window.location.href = "/api/calendar/login";
        return "Redirecionando para o Google Calendar.";
      }
      const data = await res.json();
      if (data.error) return data.error;

      if (action.action === "create" && data.ok) {
        const dt      = new Date(data.start);
        const dateStr = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
        const timeStr = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        return `Evento "${data.title}" criado para ${dateStr} às ${timeStr}.`;
      }
      if (action.action === "list") {
        if (!data.events?.length) return "Você não tem eventos próximos na agenda.";
        const list = data.events.map((e: { title: string; start: string }) => {
          const dt = new Date(e.start.replace(/([+-]\d{2}:\d{2}|Z)$/, ""));
          return `${e.title} — ${dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
        }).join(". ");
        return `Seus próximos eventos: ${list}.`;
      }
      return "Pronto.";
    } catch { return "Erro ao conectar com o Google Calendar."; }
  }

  async function execGmail(action: GmailAction): Promise<string> {
    try {
      // Ler UM email a fundo: "lê o segundo", "lê o da Maria", "lê esse"
      if (action.action === "read") {
        const ref = (action.ref ?? "").trim();
        const hit = resolveEmailRef(ref, lastEmails.current);
        if (!hit && !ref) return "Qual email você quer que eu leia, chefe?";
        const params = new URLSearchParams(hit ? { id: hit.id } : { q: ref });
        const res = await fetch(`/api/gmail/read?${params}`);
        if (res.status === 401) {
          window.location.href = "/api/calendar/login";
          return "Redirecionando para autorizar.";
        }
        const data = await res.json();
        return data.text ?? data.error ?? "Não consegui ler o email.";
      }

      const params = new URLSearchParams();
      if (action.days) params.set("days", String(action.days));
      const res = await fetch(`/api/gmail/summary?${params}`);
      if (res.status === 401) {
        window.location.href = "/api/calendar/login";
        return "Redirecionando para autorizar.";
      }
      const data = await res.json();
      if (Array.isArray(data.emails)) lastEmails.current = data.emails;
      return data.summary ?? data.error ?? "Não consegui verificar os emails.";
    } catch { return "Erro ao acessar o Gmail."; }
  }

  async function execGithub(action: GithubAction): Promise<string> {
    try {
      const res  = await fetch("/api/github/command", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(action),
      });
      const data = await res.json();
      return data.summary ?? data.error ?? "Não consegui buscar os dados do GitHub.";
    } catch { return "Erro ao conectar com o GitHub."; }
  }

  function execTimer(action: TimerAction): string {
    if (action.action === "start") {
      const mins  = action.minutes ?? 25;
      const label = action.label   ?? "Timer";
      startCountdown(mins, label);
      return `${label} de ${mins} minuto${mins > 1 ? "s" : ""} iniciado. Vou te avisar quando terminar.`;
    }
    if (action.action === "cancel") {
      stopCountdown();
      setTimerDisplay(null);
      return "Timer cancelado.";
    }
    if (action.action === "status") return getCountdownStatus();
    return "Não entendi o comando do timer.";
  }

  async function execBriefing(): Promise<string> {
    try {
      const res = await fetch("/api/briefing");
      if (res.status === 401) {
        window.location.href = "/api/calendar/login";
        return "Redirecionando para autorizar o Google.";
      }
      const data = await res.json();
      return data.briefing ?? data.error ?? "Não consegui montar o briefing agora.";
    } catch { return "Erro ao buscar o briefing."; }
  }

  async function execMemory(action: MemoryAction, fallback: string): Promise<string> {
    try {
      const res  = await fetch("/api/memory/command", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(action),
      });
      const data = await res.json();
      if (action.action === "save") return data.ok ? (fallback || "Anotado, não vou esquecer.") : fallback;
      if (action.action === "list") {
        if (!data.memories?.length) return "Ainda não tenho nada guardado sobre você.";
        const list = data.memories
          .map((m: { content: string }) => m.content)
          .join(". ");
        return `Aqui está o que eu sei sobre você: ${list}.`;
      }
      return fallback || "Pronto.";
    } catch { return fallback || "Erro ao acessar a memória."; }
  }

  /** Registra no My Hub. Sucesso vira a frase falada (vem do My Hub, não do modelo); erro volta ao modelo para ele perguntar o que falta. */
  async function execMyHub(action: MyHubAction): Promise<{ text: string } | { error: string }> {
    const UNDO_WINDOW_MS = 15 * 60 * 1000;

    if (action.acao === "desfazer") {
      const last = lastUndo.current;
      if (!last || Date.now() - last.ts > UNDO_WINDOW_MS) return { text: "Não tenho nenhum registro recente pra desfazer, chefe." };
      if (!last.path) return { text: "Esse eu não consigo desfazer por voz, chefe. Faz direto no My Hub." };
      try {
        const res  = await fetch("/api/myhub/desfazer", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ desfazer: last.path }),
        });
        const data = await res.json();
        if (!data.ok) return { text: "Não consegui desfazer agora, chefe. Tenta direto no My Hub." };
        lastUndo.current = null;
        return { text: `Desfeito, chefe: ${last.resumo}.` };
      } catch { return { text: "Não consegui falar com o My Hub agora." }; }
    }

    try {
      const res  = await fetch("/api/myhub/acao", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(action),
      });
      const data = await res.json() as MyHubResult;
      if (!data.ok || !data.acao) return { error: data.erro ?? "Não consegui registrar." };

      lastUndo.current = { path: data.acao.desfazer ?? null, resumo: data.acao.resumo, ts: Date.now() };
      const hint = !undoHinted.current && data.acao.desfazer ? " Se foi engano, é só falar desfaz." : "";
      if (data.acao.desfazer) undoHinted.current = true;
      return { text: `Anotado, chefe: ${data.acao.resumo}.${hint}` };
    } catch { return { error: "Não consegui falar com o My Hub agora." }; }
  }

  /* ── MiniPlayer handler (fire-and-forget, no voice feedback) ─────────── */

  function handleSpotifyCommand(action: string) {
    execSpotify({ action }).catch(() => {});
  }

  /* ══════════════════════════════════════════════════════════════════════
     Speech recognition
  ══════════════════════════════════════════════════════════════════════ */

  function startActive(timeoutMs = 12000) {
    const API = getSR();
    if (!API) return;
    setMode("listening");
    try { activeRec.current?.abort(); } catch { /* ok */ }

    const rec = new API();
    activeRec.current           = rec;
    rec.lang                    = "pt-BR";
    rec.interimResults          = true;
    rec.continuous              = true;
    rec.maxAlternatives         = 1;

    let captured       = false;
    let finalSegments  = "";
    let lastFullText   = "";
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimeout:   ReturnType<typeof setTimeout>;

    const doSubmit = (text: string) => {
      if (captured) return;
      const t = text.trim();
      if (t.length < 2) return;
      const lower = t.toLowerCase();
      if (WAKE_WORDS.some(w => lower === w || lower === w + ".")) return;
      if (END_CONVERSATION.test(lower)) {
        // "valeu", "obrigado"…: encerra a conversa sem mandar nada ao modelo.
        captured = true;
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        clearTimeout(hardTimeout);
        try { rec.abort(); } catch { /* ok */ }
        setMode("wake");
        startWake();
        return;
      }
      captured = true;
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      clearTimeout(hardTimeout);
      try { rec.abort(); } catch { /* ok */ }
      sendToJarvis(t);
    };

    const fallback = () => {
      if (captured) return;
      const text = lastFullText || finalSegments;
      if (text.trim().length >= 2) doSubmit(text);
      else { setMode("wake"); startWake(); }
    };

    rec.onresult = (e) => {
      let full = finalSegments;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalSegments += seg + " ";
          full           = finalSegments;
        } else {
          full = finalSegments + seg;
        }
      }
      full = full.trim();
      if (full.length < 2) return;
      lastFullText = full;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => doSubmit(full), 700);
    };

    rec.onerror = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearTimeout(hardTimeout);
      fallback();
    };

    hardTimeout = setTimeout(() => {
      if (!captured && mode.current === "listening") {
        try { rec.abort(); } catch { /* ok */ }
        fallback();
      }
    }, timeoutMs);

    rec.onend = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearTimeout(hardTimeout);
      if (!captured && mode.current === "listening") fallback();
    };

    try { rec.start(); } catch { setMode("wake"); startWake(); }
  }

  function startWake() {
    clearRestartTimer();
    if (mode.current !== "wake") return;
    const API = getSR();
    if (!API) return;
    try { wakeRec.current?.abort(); } catch { /* ok */ }
    wakeRec.current = null;
    wakeLastAlive.current = Date.now();

    const rec = new API();
    wakeRec.current             = rec;
    rec.lang                    = "pt-BR";
    rec.interimResults          = true;
    rec.continuous              = true;
    rec.maxAlternatives         = 1;

    rec.onstart = () => {
      wakeLastAlive.current = Date.now();
      wakeFails.current     = 0;
      if (wakeBlocked.current) { wakeBlocked.current = false; setCaption(""); }
    };
    rec.onresult = (e) => {
      wakeLastAlive.current = Date.now();
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.toLowerCase().trim();
        if (WAKE_WORDS.some(w => t.includes(w))) {
          try { rec.abort(); } catch { /* ok */ }
          wakeRec.current = null;
          clearRestartTimer();
          // "Bom dia, Beto": a saudação veio junto com o nome; responde direto em vez de abrir o microfone e ficar esperando
          if (greetingKind(t)) { sendToJarvis(t); return; }
          restartTimer.current = setTimeout(startActive, 150);
          return;
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wakeBlocked.current = true;
        setCaption("Libere o microfone e o Ditado (Ajustes do Mac) e toque na tela.");
        return;
      }
      if (mode.current !== "wake") return;
      wakeFails.current += 1;
      const delay = Math.min(800 * wakeFails.current, 5000);
      restartTimer.current = setTimeout(startWake, delay);
    };
    rec.onend = () => {
      if (mode.current === "wake" && !wakeBlocked.current) restartTimer.current = setTimeout(startWake, 400);
    };

    try {
      rec.start();
    } catch {
      wakeRec.current = null;
      if (mode.current === "wake") restartTimer.current = setTimeout(startWake, 1000);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     Main chat dispatcher
  ══════════════════════════════════════════════════════════════════════ */

  async function sendToJarvis(text: string) {
    // Saudação pura: responde direto, sem "deixa eu pensar" e sem esperar o modelo.
    const greeting = greetingKind(text);
    if (greeting) {
      const options = GREETINGS[greeting];
      const reply   = options[Math.floor(Math.random() * options.length)]!;
      // Saudação não passa pelo modelo, então não tem tag: o rosto é alegre e o histórico leva a tag para o modelo ver o formato.
      history.current = [...history.current, { role: "user", content: text }, { role: "assistant", content: `[emo:alegre] ${reply}` }];
      const after = () => {
        if (!musicPlaying.current && getSR()) setTimeout(() => startActive(FOLLOWUP_MS), FOLLOWUP_GAP);
        else { setMode("wake"); setTimeout(startWake, 300); }
      };
      if (!speakCached(reply, after, "alegre")) speak(reply, after, "alegre");
      return;
    }

    setMode("thinking");
    const msgs: Msg[] = [...history.current, { role: "user", content: text }];
    history.current   = msgs;

    try {
      const res  = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ messages: msgs.slice(-20) }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; } // sessão expirou: volta ao login em vez de falhar calado
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      let rawReply = data.reply as string;

      // Disse que registrou mas não mandou a tag: nada foi gravado. Pede ao modelo para corrigir uma vez.
      if (CLAIMS_WRITE.test(rawReply) && !HAS_TAG.test(rawReply) && REGISTER_INTENT.test(text)) {
        try {
          const retry = await fetch("/api/chat", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ messages: [
              ...msgs.slice(-18),
              { role: "assistant", content: rawReply },
              { role: "user", content: "[SISTEMA] Você disse que registrou, mas não enviou a tag MYHUB, então NADA foi gravado. Responda de novo: envie a tag [MYHUB:{...}] correta agora, ou pergunte só o que falta. Não diga que anotou sem a tag." },
            ] }),
          });
          if (retry.ok) rawReply = String((await retry.json()).reply ?? rawReply);
        } catch { /* segue com a resposta original */ }
      }
      // A tag [emo:X] vira o humor do rosto e sai do texto: não é falada, não vai para a legenda nem para as tags de ação.
      const emo = parseEmotion(rawReply);
      rawReply = emo.text;
      // O histórico guarda a tag: ver o formato nas respostas anteriores ajuda o modelo a não esquecer dela.
      history.current = [...msgs, { role: "assistant", content: `[emo:${emo.emotion}] ${rawReply}` }];

      // Respostas de conversa/consulta continuam ouvindo; comando de música, timer e memória voltam ao wake word
      // (com música tocando o microfone aberto captaria a letra como se fosse você).
      const say  = async (t: string, followUp = false, emotion: Emotion = emo.emotion) => {
        speak(sanitize(t), () => {
          if (followUp && !musicPlaying.current && getSR()) {
            setTimeout(() => startActive(FOLLOWUP_MS), FOLLOWUP_GAP);
          } else {
            setMode("wake"); setTimeout(startWake, 300);
          }
        }, emotion);
      };

      const spotify  = parseTag<SpotifyAction>(rawReply,  TAG.SPOTIFY);
      const calendar = parseTag<CalendarAction>(rawReply, TAG.CALENDAR);

      const github   = parseTag<GithubAction>(rawReply,   TAG.GITHUB);
      const gmail    = parseTag<GmailAction>(rawReply,    TAG.GMAIL);
      const timer    = parseTag<TimerAction>(rawReply,    TAG.TIMER);
      const memory   = parseTag<MemoryAction>(rawReply,   TAG.MEMORY);
      const briefing = parseTag<SpotifyAction>(rawReply,  TAG.BRIEFING);
      const myhub    = parseTag<MyHubAction>(rawReply,    TAG.MYHUB);

      if      (spotify.action)  say(await execSpotify(spotify.action));
      else if (calendar.action) say(await execCalendar(calendar.action), true);

      else if (github.action)   say(await execGithub(github.action), true);
      else if (gmail.action)    say(await execGmail(gmail.action), true);
      else if (timer.action)    say(execTimer(timer.action));
      else if (memory.action)   say(await execMemory(memory.action, memory.text));
      else if (briefing.action) say(await execBriefing(), true);
      else if (myhub.action) {
        const r = await execMyHub(myhub.action);
        if ("text" in r) {
          // A frase falada é a que fica no histórico: sem a tag, o modelo não a repete.
          history.current = [...msgs, { role: "assistant", content: `[emo:${emo.emotion}] ${r.text}` }];
          say(r.text, true);
        } else {
          // Faltou dado ou ficou ambíguo: o modelo explica e pergunta, e o Beto já volta a ouvir a resposta.
          const fail = await askAboutFailure(msgs, myhub.text || "Anotando.", r.error);
          say(fail.text, true, fail.emotion);
        }
      }
      else                      say(rawReply, true);

    } catch {
      speak("Desculpe, houve um erro na comunicação.", () => { setMode("wake"); startWake(); }, "triste");
    }
  }

  /** Devolve ao modelo o erro do My Hub e retorna a frase que ele fala (uma pergunta curta). */
  async function askAboutFailure(msgs: Msg[], said: string, erro: string): Promise<{ text: string; emotion: Emotion }> {
    const fallback = `Chefe, não consegui registrar: ${erro.replace(/\s*Pergunte[^.]*\.?/i, "").trim()}`;
    try {
      const res  = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ messages: [
          ...msgs.slice(-18),
          { role: "assistant", content: said },
          { role: "user", content: `[SISTEMA] O registro no My Hub falhou: ${erro} Explique ao chefe em uma frase curta e pergunte só o que falta. Não use tag de ação.` },
        ] }),
      });
      const data = await res.json();
      const emo  = parseEmotion(String(data.reply ?? ""));
      const text = emo.text.replace(TAG.MYHUB, "").trim() || fallback;
      history.current = [...msgs, { role: "assistant", content: `[emo:${emo.emotion}] ${text}` }];
      return { text, emotion: emo.emotion };
    } catch {
      history.current = [...msgs, { role: "assistant", content: `[emo:triste] ${fallback}` }];
      return { text: fallback, emotion: "triste" };
    }
  }

  /* ── Click / tap handler ─────────────────────────────────────────────── */

  function handleClick() {
    const m = mode.current;
    if (m === "thinking") return;

    if (m === "speaking") {
      window.speechSynthesis?.cancel();
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
      setCaption("");
      setMode("wake");
      startWake();
      return;
    }

    if (m === "listening") {
      try { activeRec.current?.abort(); } catch { /* ok */ }
      setMode("wake");
      startWake();
      return;
    }

    if (wakeBlocked.current) {
      wakeBlocked.current = false;
      wakeFails.current   = 0;
      setCaption("");
      startWake();
      return;
    }

    // wake mode: tap orb to skip wake word and go straight to listening
    try { wakeRec.current?.abort(); } catch { /* ok */ }
    wakeRec.current = null;
    clearRestartTimer();
    restartTimer.current = setTimeout(startActive, 150);
  }

  async function logout() {
    stopAll();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <main style={{ position: "fixed", inset: 0, background: "var(--bg)" }}>
      <Orb state={orbState} emotion={emotion} talking={talking} onClick={handleClick} theme={theme} />

      <MiniPlayer onCommand={handleSpotifyCommand} onPlaying={(p) => { musicPlaying.current = p; }} />

      {/* Status badge — top left */}
      <div className="beto-chrome" style={{
        position: "fixed", top: 18, left: 22, zIndex: 10,
        color: "rgba(var(--fg-rgb),0.18)",
        fontSize: 11, fontFamily: "monospace",
        letterSpacing: "0.15em", textTransform: "uppercase",
        pointerEvents: "none", userSelect: "none",
      }}>
        BETO · ONLINE
      </div>

      {/* Logout — top left under badge */}
      <button
        className="beto-chrome"
        onClick={logout}
        title="Sair"
        style={{
          position: "fixed", top: 38, left: 22, zIndex: 10,
          background: "none", border: "none", padding: 0, cursor: "pointer",
          color: "rgba(var(--fg-rgb),0.14)",
          fontSize: 10, fontFamily: "monospace",
          letterSpacing: "0.15em", textTransform: "uppercase",
        }}
      >
        sair
      </button>

      {/* Theme toggle — top left under logout */}
      <button
        className="beto-chrome"
        onClick={toggleTheme}
        title={theme === "dark" ? "Modo claro" : "Modo escuro"}
        aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
        style={{
          position: "fixed", top: 56, left: 22, zIndex: 10,
          background: "none", border: "none", padding: 0, cursor: "pointer",
          color: "rgba(var(--fg-rgb),0.14)",
          fontSize: 10, fontFamily: "monospace",
          letterSpacing: "0.15em", textTransform: "uppercase",
        }}
      >
        {theme === "dark" ? "modo claro" : "modo escuro"}
      </button>

      {/* Avisos proativos on/off — top left under theme toggle */}
      <button
        className="beto-chrome"
        onClick={toggleAlerts}
        title={alertsOn ? "Desligar avisos automáticos" : "Ligar avisos automáticos"}
        aria-pressed={alertsOn}
        style={{
          position: "fixed", top: 74, left: 22, zIndex: 10,
          background: "none", border: "none", padding: 0, cursor: "pointer",
          color: "rgba(var(--fg-rgb),0.14)",
          fontSize: 10, fontFamily: "monospace",
          letterSpacing: "0.15em", textTransform: "uppercase",
        }}
      >
        avisos: {alertsOn ? "on" : "off"}
      </button>

      {/* Push com o app fechado — só aparece se o navegador suporta */}
      {push.supported && (
        <button
          className="beto-chrome"
          onClick={push.toggle}
          disabled={push.busy}
          title={push.subscribed ? "Desligar notificações push" : "Receber notificações push com o app fechado"}
          aria-pressed={push.subscribed}
          style={{
            position: "fixed", top: 92, left: 22, zIndex: 10,
            background: "none", border: "none", padding: 0, cursor: "pointer",
            color: "rgba(var(--fg-rgb),0.14)",
            fontSize: 10, fontFamily: "monospace",
            letterSpacing: "0.15em", textTransform: "uppercase",
          }}
        >
          push: {push.subscribed ? "on" : "off"}
        </button>
      )}

      {/* Audio unlock hint — fades away after first interaction */}
      {!audioReady && (
        <div className="beto-chrome" style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          zIndex: 20, pointerEvents: "none", userSelect: "none",
          color: "rgba(var(--fg-rgb),0.22)",
          fontSize: 11, fontFamily: "monospace", letterSpacing: "0.12em",
          textTransform: "uppercase",
          animation: "fadeUp 0.6s ease both",
        }}>
          toque em qualquer lugar para ativar o áudio
        </div>
      )}

      {/* Countdown timer — top right */}
      {timerDisplay && (
        <div className="beto-chrome" style={{
          position: "fixed", top: 18, right: 22, zIndex: 10,
          textAlign: "right", pointerEvents: "none", userSelect: "none",
        }}>
          <div style={{
            fontSize: 10, fontFamily: "monospace", letterSpacing: "0.12em",
            color: "rgba(var(--fg-rgb),0.35)", textTransform: "uppercase", marginBottom: 3,
          }}>
            {timerDisplay.label}
          </div>
          <div style={{ fontSize: 22, fontFamily: "monospace", fontWeight: 300, letterSpacing: "0.06em", color: "rgba(var(--fg-rgb),0.75)" }}>
            {formatTime(timerDisplay.timeLeft)}
          </div>
        </div>
      )}

      {/* Caption — bottom center */}
      {caption && (
        <div className="beto-chrome" style={{
          position: "fixed", bottom: 52, left: "50%", zIndex: 10,
          transform: "translateX(-50%)",
          maxWidth: "min(660px, 86vw)",
          textAlign: "center",
          padding: "10px 24px", borderRadius: 6,
          background: "rgba(var(--bg-rgb),0.55)", backdropFilter: "blur(8px)",
          color: "rgb(var(--fg-rgb))",
          fontSize: "clamp(15px, 2vw, 19px)",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          fontWeight: 400, lineHeight: 1.55, letterSpacing: "0.01em",
          textShadow: "0 1px 8px rgba(var(--bg-rgb),0.9)",
          border: "1px solid rgba(var(--fg-rgb),0.07)",
          animation: "fadeUp 0.2s ease",
          pointerEvents: "none",
        }}>
          {caption}
        </div>
      )}

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0);   }
        }
      `}</style>
    </main>
  );
}
