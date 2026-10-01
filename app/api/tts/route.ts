import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

// Free tier voices: Adam pNInz6obpgDQGcFmaJgB | Arnold VR6AewLTigWG4xSOukaG | Antoni ErXwobaYiN019PkySvjV
const VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam — grave, imponente

// Velocidade da fala (0.7 a 1.2). ELEVENLABS_SPEED na Vercel ajusta sem mexer no código.
const SPEED = Math.min(1.2, Math.max(0.7, Number(process.env.ELEVENLABS_SPEED) || 0.9));

// Voz de reserva (Microsoft Edge, neural e grátis) para quando a ElevenLabs recusa: chave inválida, cota acabada, limite.
// Sem isso o app caía na voz do navegador, que é bem diferente da do Beto.
const EDGE_VOICE = "pt-BR-AntonioNeural";

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

async function edgeSpeech(text: string): Promise<NextResponse> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(xmlEscape(text), { rate: "-8%", pitch: "-4%" });
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const end = () => { if (!closed) { closed = true; controller.close(); } };
      audioStream.on("data", (chunk: Buffer) => { if (!closed) controller.enqueue(new Uint8Array(chunk)); });
      audioStream.on("end", end);
      audioStream.on("close", end);
      audioStream.on("error", (e: Error) => { if (!closed) { closed = true; controller.error(e); } });
    },
  });
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "x-beto-voice": "edge" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { text, lead } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text é obrigatório." }, { status: 400 });
    }

    let failure = "";
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      failure = "ELEVENLABS_API_KEY não configurada.";
    } else {
      try {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
          {
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
                stability: 0.6,      // mais estável = fala mais clara e uniforme
                similarity_boost: 0.8,
                style: 0.05,         // estilo alto acelera e exagera a entonação
                speed: SPEED,        // 1.0 = normal; abaixo de 1 fala mais devagar
                use_speaker_boost: true,
              },
            }),
          }
        );

        if (res.ok && res.body) {
          // Pipe stream directly to the client — no buffering
          return new NextResponse(res.body, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "no-store",
              "Transfer-Encoding": "chunked",
              "x-beto-voice": "elevenlabs",
            },
          });
        }
        failure = `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`;
      } catch (error: unknown) {
        failure = `ElevenLabs: ${error instanceof Error ? error.message : "erro desconhecido"}`;
      }
    }

    // O motivo aparece nos logs da Vercel; a chave nunca é registrada.
    console.error("[tts] usando a voz de reserva —", failure);
    try {
      return await edgeSpeech(text);
    } catch (error: unknown) {
      console.error("[tts] voz de reserva também falhou —", error);
      return NextResponse.json({ error: failure }, { status: 502 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
