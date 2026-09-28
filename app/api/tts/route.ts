import { NextRequest, NextResponse } from "next/server";

// Free tier voices: Adam pNInz6obpgDQGcFmaJgB | Arnold VR6AewLTigWG4xSOukaG | Antoni ErXwobaYiN019PkySvjV
const VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam — grave, imponente

// Velocidade da fala (0.7 a 1.2). ELEVENLABS_SPEED na Vercel ajusta sem mexer no código.
const SPEED = Math.min(1.2, Math.max(0.7, Number(process.env.ELEVENLABS_SPEED) || 0.9));

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text é obrigatório." }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ELEVENLABS_API_KEY não configurada." }, { status: 500 });
    }

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
          text,
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

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    // Pipe stream directly to the client — no buffering
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
