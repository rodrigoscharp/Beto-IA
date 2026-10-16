/* Voz do Beto: o VoiceStudio rodando no Mac (https://localhost:3900, certificado do mkcert). Quem chama é o navegador, porque a Vercel não
   alcança o localhost do Mac. Sem imports: roda no navegador e nos testes.

   - voz fixa: o perfil "Beto" do VoiceStudio (clonado de voice/assets/beto-ref.wav), para não mudar entre frases;
   - modo rápido: 8 passos (cerca de 2 a 3 s por frase no Mac);
   - sem voz reserva: se o VoiceStudio falhar, quem chama recebe null e mostra o texto na tela. */

export const LEAD_SECS = 0.4;          // silêncio na frente: o áudio do aparelho "acorda" sem comer o início da frase
const MAX_INPUT = 4096;                // limite de caracteres da API do VoiceStudio

export interface VoiceStudioCfg { url: string; voice: string; steps: number; speed: number }

type Env = Record<string, string | undefined>;

// Referências literais: o Next só embute no navegador as NEXT_PUBLIC_* escritas assim.
const BROWSER_ENV: Env = {
  NEXT_PUBLIC_VOICESTUDIO_URL:   process.env.NEXT_PUBLIC_VOICESTUDIO_URL,
  NEXT_PUBLIC_VOICESTUDIO_VOICE: process.env.NEXT_PUBLIC_VOICESTUDIO_VOICE,
  NEXT_PUBLIC_VOICESTUDIO_STEPS: process.env.NEXT_PUBLIC_VOICESTUDIO_STEPS,
  NEXT_PUBLIC_VOICESTUDIO_SPEED: process.env.NEXT_PUBLIC_VOICESTUDIO_SPEED,
};

const positive = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function voiceStudioConfig(env: Env = BROWSER_ENV): VoiceStudioCfg {
  return {
    url:   (env.NEXT_PUBLIC_VOICESTUDIO_URL || "https://localhost:3900").replace(/\/+$/, ""),
    voice: env.NEXT_PUBLIC_VOICESTUDIO_VOICE || "Beto",
    steps: Math.round(positive(env.NEXT_PUBLIC_VOICESTUDIO_STEPS, 8)),
    speed: positive(env.NEXT_PUBLIC_VOICESTUDIO_SPEED, 1),
  };
}

/** Texto acima do limite da API: corta no fim da última frase que cabe (ou no limite, se não houver frase). */
function clip(text: string): string {
  if (text.length <= MAX_INPUT) return text;
  const head = text.slice(0, MAX_INPUT);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("\n"));
  return end > 0 ? head.slice(0, end + 1).trimEnd() : head;
}

export function speechBody(text: string, cfg: VoiceStudioCfg) {
  return {
    model: "omnivoice" as const,
    input: clip(text),
    voice: cfg.voice,
    language: "pt" as const,
    num_step: cfg.steps,
    speed: cfg.speed,
    response_format: "wav" as const,
  };
}

/** Põe `secs` de silêncio antes das amostras de um WAV PCM. Se não reconhecer o arquivo, devolve ele intacto. */
export function prependSilence(wav: ArrayBuffer, secs: number): ArrayBuffer {
  const v = new DataView(wav);
  const tag = (off: number) => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
  if (wav.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return wav;

  let fmt: [number, number] | null = null;
  let data: [number, number] | null = null;
  for (let off = 12; off + 8 <= wav.byteLength;) {
    const size = v.getUint32(off + 4, true);
    const id = tag(off);
    if (id === "fmt ") fmt = [off + 8, size];
    if (id === "data") { data = [off + 8, Math.min(size, wav.byteLength - off - 8)]; break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) return wav;

  const [fmtAt, fmtSize] = fmt;
  const channels = v.getUint16(fmtAt + 2, true);
  const rate = v.getUint32(fmtAt + 4, true);
  const frameBytes = channels * (v.getUint16(fmtAt + 14, true) / 8);
  const silence = Math.round(secs * rate) * frameBytes;
  const [dataAt, dataSize] = data;

  const out = new ArrayBuffer(12 + 8 + fmtSize + 8 + silence + dataSize);
  const o = new DataView(out);
  const bytes = new Uint8Array(out);
  const put = (off: number, s: string) => { for (let i = 0; i < s.length; i++) o.setUint8(off + i, s.charCodeAt(i)); };
  put(0, "RIFF"); o.setUint32(4, out.byteLength - 8, true); put(8, "WAVE");
  put(12, "fmt "); o.setUint32(16, fmtSize, true);
  bytes.set(new Uint8Array(wav, fmtAt, fmtSize), 20);
  const d = 20 + fmtSize;
  put(d, "data"); o.setUint32(d + 4, silence + dataSize, true);
  bytes.set(new Uint8Array(wav, dataAt, dataSize), d + 8 + silence);   // o silêncio já é zero
  return out;
}

/** Quanto esperar pela fala antes de desistir: folga para o modelo carregar (cerca de 9 s depois de reiniciar)
    mais um tanto por caractere, porque a frase inteira é gerada antes de chegar. */
export function speechTimeoutMs(text: string): number {
  return 15000 + text.length * 40;
}

/* O VoiceStudio gera uma frase por vez e aceita só uma na fila: com a fila cheia (a frase anterior ainda gerando, ou
   um pedido abandonado num turno interrompido) ele responde 429, e 503 marcado como "tente de novo" enquanto o modelo
   carrega. Isso não é falha da voz: espera um pouco e pede de novo, dentro do prazo da frase. A espera é curta e fixa,
   porque uma frase leva uns 2 s; o Retry-After dele (até 30 s) é pensado para scripts em massa. */
export const BUSY_RETRY_MS = 700;

const retryable = (res: Response) =>
  res.status === 429 || (res.status === 503 && res.headers.get("X-OmniVoice-Retryable") === "true");

/** Pede a fala ao VoiceStudio. Devolve o WAV, ou null se ele não respondeu a tempo (o motivo vai para o console). */
export async function fetchSpeech(
  text: string,
  opts: {
    lead?: boolean; fetchImpl?: typeof fetch; cfg?: VoiceStudioCfg; timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Blob | null> {
  const cfg = opts.cfg ?? voiceStudioConfig();
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // Travado ou com a fila sempre cheia, o Beto ficaria preso em "falando": desiste no prazo e mostra o texto.
  const deadline = Date.now() + (opts.timeoutMs ?? speechTimeoutMs(text));
  try {
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) {
        console.warn("[voz] VoiceStudio ocupado até o fim do prazo da frase");
        return null;
      }
      const res = await doFetch(`${cfg.url}/v1/audio/speech`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(speechBody(text, cfg)),
        signal:  AbortSignal.timeout(left),
      });
      if (retryable(res)) {
        await res.body?.cancel().catch(() => {});
        await sleep(Math.min(BUSY_RETRY_MS, Math.max(0, deadline - Date.now())));
        continue;
      }
      if (!res.ok) {
        console.warn(`[voz] VoiceStudio ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const wav = await res.arrayBuffer();
      return new Blob([opts.lead ? prependSilence(wav, LEAD_SECS) : wav], { type: "audio/wav" });
    }
  } catch (error: unknown) {
    console.warn(`[voz] VoiceStudio inacessível em ${cfg.url}: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    return null;
  }
}

/** O VoiceStudio está no ar e com o modelo carregado? */
export async function voiceStudioOnline(fetchImpl: typeof fetch = fetch, cfg: VoiceStudioCfg = voiceStudioConfig()): Promise<boolean> {
  try {
    const res = await fetchImpl(`${cfg.url}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.status === "ok";
  } catch {
    return false;
  }
}
