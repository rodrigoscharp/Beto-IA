import { NextRequest, NextResponse } from "next/server";
import { groqChat } from "@/lib/groq";
import { getGoogleToken, gmailHeader, googleFetch, extractSender, GmailMessage } from "@/lib/google";
import { cleanBody, extractBody } from "@/lib/gmail-body";

/* GET /api/gmail/read?id=<gmailId>  ou  ?q=<busca livre>
   Lê UM email: junta remetente e assunto reais com uma leitura fiel do corpo (modelo só reformula para fala). */

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export async function GET(req: NextRequest) {
  const token = await getGoogleToken(req);
  if (!token) return NextResponse.json({ needsLogin: true }, { status: 401 });

  let id = req.nextUrl.searchParams.get("id");
  const q = req.nextUrl.searchParams.get("q");

  try {
    if (!id && q) {
      const r = await googleFetch(token, `${BASE}?${new URLSearchParams({ q: `in:inbox ${q}`, maxResults: "1" })}`);
      id = (await r.json()).messages?.[0]?.id ?? null;
    }
    if (!id) return NextResponse.json({ text: "Não achei esse email, chefe." });

    const res = await googleFetch(token, `${BASE}/${encodeURIComponent(id)}?format=full`);
    if (res.status === 401) return NextResponse.json({ needsLogin: true }, { status: 401 });
    if (!res.ok) return NextResponse.json({ text: "Não consegui abrir esse email agora." });

    const msg: GmailMessage & { payload?: Parameters<typeof extractBody>[0] } = await res.json();
    const sender  = extractSender(gmailHeader(msg, "From")) || "remetente desconhecido";
    const subject = gmailHeader(msg, "Subject") || "sem assunto";
    const body    = cleanBody(extractBody(msg.payload));
    const intro   = `Email de ${sender}, assunto: ${subject}.`;

    if (!body) return NextResponse.json({ text: `${intro} Não tem texto para eu ler, só imagem ou anexo.` });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json({ text: `${intro} ${body.slice(0, 600)}` });

    const spoken = await groqChat(apiKey, {
      messages: [
        { role: "system", content: `Você lê emails em voz alta para o Rodrigo. Leia o CONTEÚDO do email de forma fiel: não invente, não complete, não opine, não resuma além do necessário. Reescreva só para soar bem falado, em português: sem links, sem assinaturas, sem avisos legais, sem markdown, sem emojis. Se o email for longo, leia o essencial em no máximo 150 palavras e termine com "tem mais detalhes no email". Números, datas, valores e nomes exatamente como estão. Não repita remetente nem assunto (já foram ditos).` },
        { role: "user", content: `Remetente: ${sender}\nAssunto: ${subject}\n\nCorpo:\n${body}` },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    return NextResponse.json({ text: `${intro} ${spoken || body.slice(0, 600)}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro desconhecido" }, { status: 500 });
  }
}
