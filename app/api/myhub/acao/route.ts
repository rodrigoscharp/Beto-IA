import { NextRequest, NextResponse } from "next/server";
import { myHubRegistrar } from "@/lib/myhub";

/* POST /api/myhub/acao  { acao, entrada }
   O Beto registra algo no My Hub. Protegido pelo login do Beto (middleware); o token de escrita fica só no servidor. */
export async function POST(req: NextRequest) {
  const { acao, entrada } = await req.json().catch(() => ({})) as { acao?: string; entrada?: unknown };
  if (!acao || typeof acao !== "string") return NextResponse.json({ ok: false, erro: "Ação inválida." }, { status: 400 });
  return NextResponse.json(await myHubRegistrar(acao, entrada));
}
