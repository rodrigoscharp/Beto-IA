import { groqChat } from "@/lib/groq";
import { extractSender, gmailHeader, googleFetch, GmailMessage } from "@/lib/google";
import { Alert, Collected, EMPTY, HOUR_MS } from "./types";

const QUERY = "is:unread in:inbox newer_than:1d -category:promotions -category:social -category:forums";
const MAX_NEW = 8;

interface Verdict { id: string; importante: boolean; urgente?: boolean; aviso?: string }

function parseVerdicts(raw: string): Verdict[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter(v => v && typeof v.id === "string") : [];
  } catch { return []; }
}

/**
 * Emails novos (ainda não vistos) → o que merece interromper.
 * `baseline`: primeira execução neste navegador; só marca como visto, não fala nada.
 */
export async function collectEmail(token: string, seen: Set<string>, baseline: boolean): Promise<Collected> {
  const list = await googleFetch(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: QUERY, maxResults: "15" })}`);
  if (!list.ok) return EMPTY;
  const ids: string[] = ((await list.json()).messages ?? []).map((m: { id: string }) => m.id);

  const fresh = ids.filter(id => !seen.has(`email:${id}`));
  if (fresh.length === 0) return EMPTY;
  if (baseline) return { alerts: [], mark: fresh.map(id => `email:${id}`) };

  const batch = fresh.slice(0, MAX_NEW);
  const details: GmailMessage[] = await Promise.all(batch.map(async id => {
    const r = await googleFetch(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    return r.ok ? r.json() : { id, threadId: id };
  }));

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return EMPTY;

  const lines = details.map(d =>
    `id=${d.id} | remetente: ${extractSender(gmailHeader(d, "From"))} <${gmailHeader(d, "From").match(/<(.+?)>/)?.[1] ?? ""}> | assunto: ${gmailHeader(d, "Subject") || "(sem assunto)"} | prévia: ${(d.snippet ?? "").slice(0, 160)}`
  ).join("\n");

  let verdicts: Verdict[] = [];
  try {
    verdicts = parseVerdicts(await groqChat(apiKey, {
      messages: [
        { role: "system", content: `Você decide quais emails novos do Rodrigo merecem interromper o dia dele com um aviso falado. Use SOMENTE os dados fornecidos (remetente, assunto, prévia); nunca invente nada.

IMPORTANTE (importante=true): pessoa real escrevendo pra ele, trabalho, clientes, entrevistas e recrutadores, banco, cobrança, pagamento, prazo, segurança da conta, saúde, governo, entrega, resposta a algo que ele enviou.
NÃO IMPORTANTE (importante=false): marketing, newsletter, promoção, redes sociais, notificações automáticas sem ação, recibos comuns.
urgente=true só se houver prazo curto, problema de segurança ou cobrança.

Responda APENAS um JSON: [{"id":"...","importante":true|false,"urgente":true|false,"aviso":"..."}]. Em "aviso" (só se importante) escreva UMA frase curta em português, pronta para ser falada, começando por "Chegou email de <remetente>" e dizendo do que se trata em poucas palavras, no máximo 25 palavras, sem aspas, sem emoji.` },
        { role: "user", content: lines },
      ],
      temperature: 0.1,
      max_tokens: 700,
    }));
  } catch { return EMPTY; }

  const byId = new Map(verdicts.map(v => [v.id, v]));
  const alerts: Alert[] = [];
  const mark: string[] = [];
  for (const id of batch) {
    const v = byId.get(id);
    if (!v) continue; // sem veredito: tenta de novo no próximo poll
    if (v.importante && v.aviso) {
      const d = details.find(x => x.id === id);
      alerts.push({
        id: `email:${id}`, source: "email", text: v.aviso, priority: v.urgente ? 1 : 0, until: Date.now() + 12 * HOUR_MS,
        email: { id, sender: d ? extractSender(gmailHeader(d, "From")) : "", subject: d ? gmailHeader(d, "Subject") : "" },
      });
    } else {
      mark.push(`email:${id}`);
    }
  }
  return { alerts, mark };
}
