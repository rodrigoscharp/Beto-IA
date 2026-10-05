/* Ligação do navegador com o serviço local de voz (voice/, Pipecat) por WebRTC.
   A parte pura (mensagens do servidor, constraints do microfone) fica no topo, sem importar o cliente do Pipecat,
   para rodar nos testes. O cliente é importado só em connect(), no navegador. */

import { emotionFromName, type Emotion } from "./emotion";

export type ServerMsg =
  | { type: "emotion"; emotion: Emotion }
  | { type: "action"; tag: string; payload: Record<string, unknown> }
  | { type: "state"; state: "listening" | "wake" }
  | { type: "ignored"; text: string }
  | { type: "needs_login"; service: string };

/** Mensagem customizada do serviço (RTVI server-message). Qualquer coisa fora do formato devolve null. */
export function parseServerMessage(data: unknown): ServerMsg | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  switch (o.type) {
    case "emotion": {
      const e = typeof o.emotion === "string" ? emotionFromName(o.emotion) : null;
      return e ? { type: "emotion", emotion: e } : null;
    }
    case "action":
      if (typeof o.tag !== "string" || !/^[A-Z][A-Z_]*$/.test(o.tag)) return null;
      return { type: "action", tag: o.tag, payload: o.payload && typeof o.payload === "object" ? (o.payload as Record<string, unknown>) : {} };
    case "state":
      return o.state === "listening" || o.state === "wake" ? { type: "state", state: o.state } : null;
    case "ignored":
      return { type: "ignored", text: typeof o.text === "string" ? o.text : "" };
    case "needs_login":
      return { type: "needs_login", service: typeof o.service === "string" ? o.service : "" };
    default:
      return null;
  }
}

/** Microfone como o serviço espera: mono, 16 kHz, com cancelamento de eco (o Beto não ouve a própria voz) e ruído. */
export function micConstraints(): MediaTrackConstraints {
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 };
}

export interface LinkHandlers {
  onUserSpeaking(speaking: boolean): void;
  onTranscript(text: string, final: boolean): void;
  onThinking(): void;
  onBotSpeaking(speaking: boolean): void;
  onBotText(text: string): void;
  onServerMessage(msg: ServerMsg): void;
  onReady(): void;
  onDisconnected(): void;
}

interface Client {
  connect(params: unknown): Promise<unknown>;
  disconnect(): Promise<void>;
  sendClientMessage(type: string, data?: unknown): void;
  tracks(): { local?: { audio?: MediaStreamTrack } };
}

/** Sonda o serviço: true se ele responde em /health. Rápida (1,5 s), para a página não esperar por ele. */
export async function probeVoiceService(url: string, timeoutMs = 1500): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const d = (await res.json()) as { ok?: boolean };
    return d.ok === true;
  } catch { return false; }
}

export class VoiceLink {
  private client: Client | null = null;
  private audio: HTMLAudioElement | null = null;
  private readonly url: string;
  private readonly h: LinkHandlers;

  constructor(url: string, handlers: LinkHandlers) {
    this.url = url.replace(/\/+$/, "");
    this.h = handlers;
  }

  async connect(): Promise<void> {
    const [{ PipecatClient }, { SmallWebRTCTransport }] = await Promise.all([
      import("@pipecat-ai/client-js"),
      import("@pipecat-ai/small-webrtc-transport"),
    ]);
    const h = this.h;
    const audio = new Audio();
    audio.autoplay = true;
    this.audio = audio;
    const client = new PipecatClient({
      transport: new SmallWebRTCTransport(),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onBotReady: () => h.onReady(),
        onDisconnected: () => h.onDisconnected(),
        onUserStartedSpeaking: () => h.onUserSpeaking(true),
        onUserStoppedSpeaking: () => h.onUserSpeaking(false),
        onUserTranscript: (d) => h.onTranscript(d.text, d.final),
        onBotLlmStarted: () => h.onThinking(),
        onBotTtsText: (d) => h.onBotText(d.text),
        onBotStartedSpeaking: () => h.onBotSpeaking(true),
        onBotStoppedSpeaking: () => h.onBotSpeaking(false),
        onServerMessage: (d) => { const m = parseServerMessage(d); if (m) h.onServerMessage(m); },
        onTrackStarted: (track, participant) => {
          if (track.kind === "audio" && !participant?.local) audio.srcObject = new MediaStream([track]);
        },
      },
    });
    this.client = client as unknown as Client;
    await client.connect({ webrtcRequestParams: { endpoint: `${this.url}/api/offer` } });
    // O transporte abre o microfone com o padrão do navegador; aplicamos as constraints na faixa já aberta.
    try { await client.tracks().local?.audio?.applyConstraints(micConstraints()); } catch { /* navegador sem suporte: segue */ }
  }

  async disconnect(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; this.audio = null; }
    try { await c?.disconnect(); } catch { /* já fechado */ }
  }

  get connected(): boolean { return this.client !== null; }

  private send(type: string, data?: unknown) { this.client?.sendClientMessage(type, data ?? {}); }

  /** Fala um texto (resultado de ação, aviso proativo): entra no histórico como fala do Beto. */
  say(text: string)   { if (text.trim()) this.send("say", { text }); }
  /** Toque no mascote: fica ouvindo sem precisar do wake word. */
  listen()            { this.send("listen"); }
  /** Cala o Beto no meio da fala. */
  interrupt()         { this.send("interrupt"); }
  /** Push-to-talk: segurado = ouvindo. */
  ptt(down: boolean)  { this.send("ptt", { down }); }
  /** Fala digitada: vai ao cérebro como se tivesse sido dita. */
  sendText(text: string) { if (text.trim()) this.send("text", { text }); }
  /** Encerra a conversa (volta a esperar o wake word). */
  end()               { this.send("end"); }
}
