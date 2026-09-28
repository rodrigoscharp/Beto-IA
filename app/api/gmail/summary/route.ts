import { NextRequest, NextResponse } from "next/server";
import { getGoogleToken, gmailHeader, googleFetch, extractSender, GmailMessage } from "@/lib/google";
import { speakList, type ListedEmail } from "@/lib/gmail-text";

/* GET /api/gmail/summary?days=N
   Lista só remetente + assunto (sem modelo, sem corpo): rápido e sem risco de inventar.
   Devolve também `emails` para o app resolver "lê o segundo" / "lê o da Maria". */

const BASE   = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const FILTER = "-category:promotions -category:social -category:forums";

function query(days: number | undefined, extra: string): string {
  let q = `is:unread in:inbox ${extra}`;
  if (days && days > 0) {
    const after = new Date(); after.setDate(after.getDate() - days);
    q += ` after:${after.getFullYear()}/${String(after.getMonth() + 1).padStart(2, "0")}/${String(after.getDate()).padStart(2, "0")}`;
  }
  return q;
}

export async function GET(req: NextRequest) {
  const token = await getGoogleToken(req);
  if (!token) return NextResponse.json({ needsLogin: true }, { status: 401 });

  const daysParam = req.nextUrl.searchParams.get("days");
  const days      = daysParam ? parseInt(daysParam) : undefined;
  const label     = days === 1 ? "hoje" : days === 2 ? "de ontem e hoje" : days ? `dos últimos ${days} dias` : "";

  try {
    const [list, promoList] = await Promise.all([
      googleFetch(token, `${BASE}?${new URLSearchParams({ q: query(days, FILTER), maxResults: "8" })}`),
      googleFetch(token, `${BASE}?${new URLSearchParams({ q: query(days, "category:promotions"), maxResults: "1" })}`),
    ]);

    if (!list.ok) {
      if (list.status === 401) return NextResponse.json({ needsLogin: true }, { status: 401 });
      if (list.status === 403) return NextResponse.json({ summary: "Não consigo acessar seu Gmail. Habilite a Gmail API e reautorize." });
      return NextResponse.json({ error: "Erro ao listar emails." }, { status: 500 });
    }

    const data  = await list.json();
    const total = (data.resultSizeEstimate as number | undefined) ?? (data.messages?.length ?? 0);
    const promo = promoList.ok ? ((await promoList.json()).resultSizeEstimate ?? 0) : 0;
    const ids: string[] = (data.messages ?? []).map((m: { id: string }) => m.id);

    if (ids.length === 0) {
      return NextResponse.json({
        summary: `Tudo em ordem, chefe. Nenhum email importante não lido${label ? " " + label : ""}.${promo ? ` Só ${promo} promocionais, que ignorei.` : ""}`,
        emails: [], count: 0,
      });
    }

    const details: GmailMessage[] = await Promise.all(ids.map(async id => {
      const r = await googleFetch(token, `${BASE}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      return r.ok ? r.json() : { id, threadId: id };
    }));

    const emails: ListedEmail[] = details.map(d => ({
      id: d.id,
      sender: extractSender(gmailHeader(d, "From")) || "remetente desconhecido",
      subject: gmailHeader(d, "Subject") || "sem assunto",
    }));

    return NextResponse.json({ summary: speakList(emails, Math.max(total, emails.length), promo, label), emails, count: emails.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro desconhecido" }, { status: 500 });
  }
}
