/* Helpers puros (servidor e navegador): lista falada e resolução de "o segundo", "o da Maria"… */

/* ── "o segundo", "2", "o da Maria", "o do banco", "esse", "o último" ───────── */

export interface ListedEmail { id: string; sender: string; subject: string }

const ORDINALS: Record<string, number> = {
  primeiro: 1, primeira: 1, um: 1, segundo: 2, segunda: 2, dois: 2, terceiro: 3, terceira: 3, tres: 3, "três": 3,
  quarto: 4, quarta: 4, quatro: 4, quinto: 5, quinta: 5, cinco: 5, sexto: 6, seis: 6, "sétimo": 7, sete: 7, oitavo: 8, oito: 8, nono: 9, nove: 9, "décimo": 10, dez: 10,
};

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function resolveEmailRef(ref: string, list: ListedEmail[]): ListedEmail | null {
  if (!list.length) return null;
  const r = norm(ref);
  if (!r) return list[0] ?? null;

  const digit = r.match(/\b(\d{1,2})\b/);
  if (digit) { const i = Number(digit[1]) - 1; if (list[i]) return list[i]; }

  for (const w of r.split(/\s+/)) {
    const n = ORDINALS[w] ?? ORDINALS[norm(w)];
    if (n && list[n - 1]) return list[n - 1]!;
  }
  if (/\b(esse|este|ultimo|mais recente|novo|de agora)\b/.test(r)) return list[0]!;

  // nome do remetente ou palavra do assunto (ignora palavrinhas)
  const words = r.replace(/\b(o|a|os|as|do|da|de|dos|das|email|e-mail|mail|que|chegou|dele|dela)\b/g, " ").split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;
  const score = (e: ListedEmail) => words.filter(w => norm(e.sender).includes(w) || norm(e.subject).includes(w)).length;
  const best = [...list].sort((a, b) => score(b) - score(a))[0];
  return best && score(best) > 0 ? best : null;
}

/** Fala natural do assunto/remetente para a lista. */
const ORD_SPOKEN = ["Primeiro", "Segundo", "Terceiro", "Quarto", "Quinto", "Sexto", "Sétimo", "Oitavo"];
export function speakList(emails: ListedEmail[], total: number, promo: number, label: string): string {
  const shown = emails.slice(0, 5);
  const head = `Você tem ${total} ${total === 1 ? "email não lido" : "emails não lidos"}${label ? " " + label : ""}.`;
  const items = shown.map((e, i) => `${ORD_SPOKEN[i]}: ${e.sender}, assunto: ${e.subject}.`).join(" ");
  const more = total > shown.length ? ` E mais ${total - shown.length}.` : "";
  const promoTxt = promo > 0 ? ` Ignorei ${promo} promocionais.` : "";
  return `${head} ${items}${more}${promoTxt} Quer que eu leia algum?`;
}
