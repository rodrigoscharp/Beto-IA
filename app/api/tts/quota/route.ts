import { NextResponse } from "next/server";
import { quotaStatus } from "@/lib/ops";

export const dynamic = "force-dynamic";

/* Quanto da cota de voz da ElevenLabs ainda resta. Se a chave não puder ler a assinatura, devolve "indisponível"
   e o Beto simplesmente não mostra nada. */
export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ level: "unknown" });
  try {
    const res = await fetch(`${process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io"}/v1/user/subscription`, {
      headers: { "xi-api-key": key },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ level: "unknown", status: res.status });
    return NextResponse.json(quotaStatus(await res.json()));
  } catch {
    return NextResponse.json({ level: "unknown" });
  }
}
