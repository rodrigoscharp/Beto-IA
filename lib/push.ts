import webpush from "web-push";
import { supabase } from "@/lib/supabase";

/* Web Push do Beto: assinaturas e "já avisado" ficam no Supabase (supabase/push.sql). */

export interface PushPayload { title: string; body: string; tag: string; url?: string }

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const pushConfigured = () =>
  !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

function setup() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:rodrigosharp99@gmail.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

/* ── Assinaturas ─────────────────────────────────────────────────────────── */

export async function saveSubscription(sub: PushSubscriptionJSON) {
  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeSubscription(endpoint: string) {
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

async function listSubscriptions(): Promise<PushSubscriptionJSON[]> {
  const { data } = await supabase.from("push_subscriptions").select("endpoint,p256dh,auth");
  return (data ?? []).map(r => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

export async function hasSubscriptions(): Promise<boolean> {
  return (await listSubscriptions()).length > 0;
}

/** Envia para todos os aparelhos. Assinatura morta (404/410) é apagada. Devolve quantos receberam. */
export async function sendToAll(payload: PushPayload): Promise<number> {
  setup();
  const subs = await listSubscriptions();
  let delivered = 0;
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 * 60, urgency: "high" });
      delivered++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await removeSubscription(sub.endpoint);
      else console.warn("[Beto push]", status ?? e);
    }
  }));
  return delivered;
}

/* ── Dedupe entre execuções do cron ──────────────────────────────────────── */

export async function loadSeen(): Promise<string[]> {
  const { data } = await supabase
    .from("push_seen").select("id").order("created_at", { ascending: false }).limit(600);
  return (data ?? []).map(r => r.id as string);
}

export async function addSeen(ids: string[]) {
  if (!ids.length) return;
  await supabase.from("push_seen").upsert(ids.map(id => ({ id })), { ignoreDuplicates: true });
}

/** Ids com mais de 14 dias já saíram das janelas de busca (1 dia): limpa a tabela. */
export async function pruneSeen() {
  const cutoff = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  await supabase.from("push_seen").delete().lt("created_at", cutoff).neq("id", "__baseline__");
}
