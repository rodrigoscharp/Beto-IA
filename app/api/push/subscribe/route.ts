import { NextRequest, NextResponse } from "next/server";
import { removeSubscription, saveSubscription, type PushSubscriptionJSON } from "@/lib/push";

export async function POST(req: NextRequest) {
  const { subscription } = await req.json().catch(() => ({})) as { subscription?: PushSubscriptionJSON };
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 400 });
  }
  const r = await saveSubscription(subscription);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 500 });
}

export async function DELETE(req: NextRequest) {
  const { endpoint } = await req.json().catch(() => ({})) as { endpoint?: string };
  if (endpoint) await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
