import { NextRequest, NextResponse } from "next/server";
import { myHubDesfazer } from "@/lib/myhub";

export async function POST(req: NextRequest) {
  const { desfazer } = await req.json().catch(() => ({})) as { desfazer?: string };
  if (!desfazer || typeof desfazer !== "string") return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ ok: await myHubDesfazer(desfazer) });
}
