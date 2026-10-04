import { NextRequest, NextResponse } from "next/server";

// Voz do Beto: ele é um fantasminha mascote, então a voz é leve, jovem e simpática (nada de locutor grave).
// ELEVENLABS_VOICE_ID na Vercel troca a voz sem mexer no código. Vozes prontas do plano grátis que combinam:
// Will bIHbv24MWmeRgasZH58o (jovem, simpático) | Liam TX3LPaxmHKxFdv7VOQHJ (jovem, articulado) | Charlie IKne3meq5aSn9XLyUdCD (descontraído)
// A antiga era Adam pNInz6obpgDQGcFmaJgB (grave, imponente).
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "bIHbv24MWmeRgasZH58o"; // Will

// Velocidade da fala (0.7 a 1.2). ELEVENLABS_SPEED na Vercel ajusta sem mexer no código.
// ELEVENLABS_BASE_URL só existe para testar com um servidor falso.
const ELEVEN_BASE = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";

// Reserva: Google Cloud TTS (Chirp 3 HD, 1M caracteres grátis/mês). Só entra quando a ElevenLabs falha (chave, cota, rede).
// GOOGLE_TTS_VOICE troca a voz sem mexer no código; GOOGLE_TTS_BASE_URL só existe para testar com um servidor falso.
const GOOGLE_BASE = process.env.GOOGLE_TTS_BASE_URL || "https://texttospeech.googleapis.com";
const GOOGLE_VOICE = process.env.GOOGLE_TTS_VOICE || "pt-BR-Chirp3-HD-Puck"   // leve e animada, como a principal;

const SPEED = Math.min(1.2, Math.max(0.7, Number(process.env.ELEVENLABS_SPEED) || 1.0));

/** Fala o texto com a voz de reserva. Devolve o MP3 inteiro, ou null se não há chave ou o Google falhou. */
async function googleSpeech(text: string): Promise<ArrayBuffer | null> {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${GOOGLE_BASE}/v1/text:synthesize`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "pt-BR", name: GOOGLE_VOICE },
        audioConfig: { audioEncoding: "MP3" },
      }),
    });
    if (!res.ok) {
      console.error(`[tts] Google ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const { audioContent } = await res.json();
    if (typeof audioContent !== "string" || !audioContent) return null;
    const buf = Buffer.from(audioContent, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch (error: unknown) {
    console.error(`[tts] Google falhou: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    return null;
  }
}

function audioResponse(body: BodyInit | null) {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { text, lead } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text é obrigatório." }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error("[tts] ELEVENLABS_API_KEY não configurada.");
      const backup = await googleSpeech(text);
      if (backup) return audioResponse(backup);
      return NextResponse.json({ error: "ELEVENLABS_API_KEY não configurada." }, { status: 500 });
    }

    let res: Response | null = null;
    try {
      res = await fetch(`${ELEVEN_BASE}/v1/text-to-speech/${VOICE_ID}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          // `lead`: meio segundo de silêncio antes da fala, para o áudio do aparelho "acordar" sem comer o início da frase.
          text: lead ? `<break time="0.4s" /> ${text}` : text,
          model_id: "eleven_turbo_v2_5",
          language_code: "pt",   // fixa o idioma: sem isso o modelo às vezes "adivinha" e enrola a pronúncia
          voice_settings: {
            stability: 0.5,      // um pouco menos estável que antes: mais expressivo, combina com o mascote
            similarity_boost: 0.8,
            style: 0.2,          // um toque de entonação; acima de ~0.4 acelera e exagera
            speed: SPEED,        // 1.0 = normal; abaixo de 1 fala mais devagar
            use_speaker_boost: true,
          },
        }),
      });
    } catch (error: unknown) {
      console.error(`[tts] ElevenLabs inacessível: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    }

    if (res?.ok) {
      // Pipe stream directly to the client — no buffering
      return audioResponse(res.body);
    }

    // ElevenLabs falhou (chave, cota, rede): o motivo fica nos logs da Vercel, a chave nunca é registrada.
    let err = "ElevenLabs inacessível.";
    if (res) {
      err = await res.text();
      console.error(`[tts] ElevenLabs ${res.status}: ${err.slice(0, 300)}`);
    }
    const backup = await googleSpeech(text);
    if (backup) return audioResponse(backup);
    return NextResponse.json({ error: err }, { status: res?.status ?? 502 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
