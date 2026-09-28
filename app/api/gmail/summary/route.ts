import { NextRequest, NextResponse } from "next/server";
import { groqChat } from "@/lib/groq";
import { getGoogleToken, gmailHeader, GmailMessage } from "@/lib/google";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function extractSender(from: string): string {
  const named = from.match(/^"?([^"<]+)"?\s*</);
  if (named) return named[1].trim();
  return from.split("@")[0] || from;
}

function formatDate(rawDate: string): string {
  if (!rawDate) return "";
  try {
    const d    = new Date(rawDate);
    if (isNaN(d.getTime())) return "";
    const now  = new Date();
    const diff = Math.round(
      (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
       new Date(d.getFullYear(),  d.getMonth(),  d.getDate()).getTime()) / 86_400_000
    );
    const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (diff === 0) return `hoje às ${time}`;
    if (diff === 1) return `ontem às ${time}`;
    return d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }) + ` às ${time}`;
  } catch { return ""; }
}

/* ── Gmail query builder ──────────────────────────────────────────────────── */

function buildQuery(days?: number): string {
  let q = "is:unread in:inbox";
  if (days && days > 0) {
    const after = new Date();
    after.setDate(after.getDate() - days);
    const y  = after.getFullYear();
    const m  = String(after.getMonth() + 1).padStart(2, "0");
    const d  = String(after.getDate()).padStart(2, "0");
    q += ` after:${y}/${m}/${d}`;
  }
  return q;
}

/* ── GET /api/gmail/summary ──────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const token  = await getGoogleToken(req);
  if (!token) return NextResponse.json({ needsLogin: true }, { status: 401 });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GROQ_API_KEY não configurada" }, { status: 500 });

  const daysParam = req.nextUrl.searchParams.get("days");
  const days      = daysParam ? parseInt(daysParam) : undefined;

  try {
    const listParams = new URLSearchParams({
      q:          buildQuery(days),
      maxResults: "20",
    });

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) {
      if (listRes.status === 401) return NextResponse.json({ needsLogin: true }, { status: 401 });
      if (listRes.status === 403) return NextResponse.json({
        summary: "Não consigo acessar seu Gmail. Habilite a Gmail API no Google Cloud Console e reautorize.",
      });
      const err = await listRes.json().catch(() => ({}));
      return NextResponse.json({ error: err?.error?.message ?? "Erro ao listar emails" }, { status: 500 });
    }

    const listData = await listRes.json();
    const messages: { id: string }[] = listData.messages ?? [];

    // No emails for the requested period — return clear "all good" message
    if (messages.length === 0) {
      const period = days === 1 ? "hoje" : days === 2 ? "ontem e hoje" : days ? `nos últimos ${days} dias` : "na caixa de entrada";
      return NextResponse.json({
        summary: `Tudo nos conformes, sem novidades. Nenhum email não lido ${period}.`,
        count: 0,
      });
    }

    // Fetch real metadata — From, Subject, Date only (no body/snippet = no hallucination)
    const details: GmailMessage[] = await Promise.all(
      messages.slice(0, 15).map(async ({ id }) => {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return r.ok ? r.json() : { id, threadId: id };
      })
    );

    // Build email list from real data only
    const emailList = details.map((msg, i) => {
      const from    = gmailHeader(msg, "From");
      const subject = gmailHeader(msg, "Subject") || "(sem assunto)";
      const date    = formatDate(gmailHeader(msg, "Date"));
      const sender  = extractSender(from);
      const email   = from.match(/<(.+?)>/)?.[1] ?? from;
      return `${i + 1}. Remetente: ${sender} <${email}> | Assunto: ${subject} | Recebido: ${date}`;
    }).join("\n");

    const periodLabel = days === 1 ? "hoje" : days === 2 ? "de ontem e hoje" : days ? `dos últimos ${days} dias` : "não lidos";

    const text = await groqChat(apiKey, {
      messages: [
        {
          role:    "system",
          content: `Você analisa emails do Rodrigo. Use SOMENTE os dados fornecidos abaixo (remetente, assunto, data recebida). JAMAIS invente, complete ou suponha qualquer informação além do que está explícito nos campos.

Classifique:
- IMPORTANTE: pessoas reais (nome próprio), trabalho, bancos, saúde, governo, pagamentos, entregas
- PROMOCIONAL: newsletters, marketing, "% off", promoções, Udemy, Medium, redes sociais automáticas

Resposta em português casual. Formato:
- Emails importantes: cite remetente e assunto EXATOS, com data recebida
- Promocionais: agrupe no final: "Além disso, X email(s) promocional(is) que você pode ignorar."
- Se só houver promocionais: diga que não tem nada importante
- Máximo 4 frases. Nunca mencione conteúdo além do assunto.`,
        },
        {
          role:    "user",
          content: `Emails ${periodLabel} (${details.length} no total):\n\n${emailList}`,
        },
      ],
      temperature: 0.1,
      max_tokens:  1000,
    });

    const summary = text || "Não consegui analisar os emails.";
    return NextResponse.json({ summary, count: details.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
