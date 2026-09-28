/* Servidor: extrair e limpar o corpo de um email do Gmail. */

interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[] }

const b64 = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function collect(part: Part | undefined, mime: string, out: string[]) {
  if (!part) return;
  if (part.mimeType === mime && part.body?.data) out.push(b64(part.body.data));
  part.parts?.forEach(p => collect(p, mime, out));
}

const stripHtml = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Texto do email: prefere text/plain, cai para HTML sem tags. */
export function extractBody(payload: Part | undefined): string {
  const plain: string[] = [];
  collect(payload, "text/plain", plain);
  if (plain.join("").trim()) return plain.join("\n");
  const html: string[] = [];
  collect(payload, "text/html", html);
  return stripHtml(html.join("\n"));
}

/** Tira respostas citadas, links e espaço sobrando; limita o tamanho enviado ao modelo. */
export function cleanBody(raw: string, max = 5000): string {
  const lines = raw.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    // "Em seg, 3 de mar... escreveu:" / "On ... wrote:" / "-----Original Message-----": o resto é citação
    if (/^\s*(Em .{5,80} escreveu:|On .{5,80} wrote:|-{2,}\s*(Original Message|Mensagem original)|De:\s.+|From:\s.+)\s*$/i.test(line) && kept.length > 3) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

