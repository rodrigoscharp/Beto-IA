/* Lê a resposta do modelo enquanto ela chega (em pedaços) e a divide em frases para a voz começar cedo.
   Função pura, sem imports: roda no navegador e nos testes.

   Três fases:
   - "head":  junta o começo da resposta até saber o que ela é (tags de emoção ficam de fora);
   - "speak": conversa normal; entrega uma frase de cada vez assim que ela fecha;
   - "hold":  apareceu tag de ação ([SPOTIFY:…], [MYHUB:…]) ou [NEEDTOOLS]: não fala nada daqui, quem chama
              usa o texto completo (`full`) no caminho antigo, que sabe executar as ações. */

export type StreamEvent =
  | { type: "tag"; name: string }                 // [emo:X] do início: `name` é o X cru
  | { type: "sentence"; text: string }
  | { type: "hold"; late: boolean };              // late = a tag de ação veio depois de já ter texto falável

const MIN_SENTENCE   = 12;    // evita cortar em "Dr." ou "Sr."
const FIRST_SPLIT_AT = 70;    // primeira frase ainda sem ponto com tanto texto: corta na vírgula para falar mais cedo
const FIRST_SPLIT_MIN = 25;
const MAX_CHUNK      = 220;   // frase gigante sem pontuação: corta num espaço

const EMO_TAG_G  = /\[\s*emo[^\]:\n]*:?\s*([^\]\n]*?)\s*\]\s*/gi;
const ACTION_AT  = /^\[[A-Z][A-Z_]*:/;
const ACTION_ANY = /\[[A-Z][A-Z_]*:/;
const NEED_ANY   = /\[\s*NEED_?TOOLS/i;      // marcador de ferramentas, em qualquer caixa e com ou sem sublinhado

export class ReplyStream {
  private all = "";
  private buf = "";
  private mode: "head" | "speak" | "hold" = "head";
  private emitted = 0;

  push(delta: string): StreamEvent[] {
    this.all += delta;
    this.buf += delta;
    return this.drain(false);
  }

  finish(): { events: StreamEvent[]; full: string; held: boolean } {
    const events = this.drain(true);
    return { events, full: this.all, held: this.mode === "hold" };
  }

  private drain(final: boolean): StreamEvent[] {
    const out: StreamEvent[] = [];
    if (this.mode === "head") this.head(out, final);
    if (this.mode === "speak") this.speak(out, final);
    return out;
  }

  private head(out: StreamEvent[], final: boolean) {
    for (;;) {
      const t = this.buf.trimStart();
      if (t === "") return;
      if (t[0] !== "[") { this.mode = "speak"; this.buf = t; return; }

      if (ACTION_AT.test(t) || /^\[\s*NEED_?TOOLS/i.test(t)) {
        this.mode = "hold";
        out.push({ type: "hold", late: false });
        return;
      }

      const end = t.indexOf("]");
      if (end === -1) {
        const couldBeTag = (/^\[\s*emo/i.test(t) && t.length <= 80) || /^\[[A-Za-z_ ]{0,14}$/.test(t);
        if (final || !couldBeTag) { this.mode = "speak"; this.buf = t; }
        return;
      }

      const tag = t.slice(0, end + 1);
      if (/^\[\s*emo/i.test(tag)) {
        const m = tag.match(/^\[\s*emo[^\]:\n]*:?\s*([^\]\n]*?)\s*\]$/i);
        out.push({ type: "tag", name: m ? m[1] : "" });
        this.buf = t.slice(end + 1);
        continue;
      }
      this.mode = "speak";   // colchete que não é tag (ex.: "[1] é a opção…")
      this.buf = t;
      return;
    }
  }

  private speak(out: StreamEvent[], final: boolean) {
    this.buf = this.buf.replace(EMO_TAG_G, "");

    // Tag de ação no meio do texto: fala o que veio antes e passa a segurar o resto.
    const a1 = this.buf.search(ACTION_ANY);
    const a2 = this.buf.search(NEED_ANY);
    const at = a1 < 0 ? a2 : a2 < 0 ? a1 : Math.min(a1, a2);
    if (at >= 0) {
      this.buf = this.buf.slice(0, at);
      this.flush(out, true);
      this.mode = "hold";
      out.push({ type: "hold", late: true });
      return;
    }
    this.flush(out, final);
  }

  /** Solta as frases que já fecharam; com `final`, solta também o que sobrou. */
  private flush(out: StreamEvent[], final: boolean) {
    for (;;) {
      const cut = this.findCut(this.buf);
      if (cut <= 0) break;
      this.emit(out, this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
    }
    if (final) {
      this.emit(out, this.buf.replace(/\[\s*emo[^\]]*$/i, ""));
      this.buf = "";
    }
  }

  private emit(out: StreamEvent[], raw: string) {
    const text = raw.trim();
    if (!text) return;
    out.push({ type: "sentence", text });
    this.emitted++;
  }

  private findCut(buf: string): number {
    // 1) fim de frase (. ! ? …) seguido de espaço, com tamanho mínimo
    const re = /[.!?…]+["')\]»]*(?=\s)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(buf))) {
      const end = m.index + m[0].length;
      if (buf.slice(0, end).trim().length >= MIN_SENTENCE) return end;
    }
    // 2) quebra de linha
    const nl = buf.indexOf("\n");
    if (nl >= MIN_SENTENCE) return nl + 1;
    // 3) primeira frase demorando: corta na última vírgula para a voz começar
    if (this.emitted === 0 && buf.length >= FIRST_SPLIT_AT) {
      const c = lastBreak(buf, FIRST_SPLIT_MIN);
      if (c > 0) return c;
    }
    // 4) trecho enorme sem pontuação
    if (buf.length > MAX_CHUNK) {
      const c = lastBreak(buf, 60);
      if (c > 0) return c;
      const sp = buf.lastIndexOf(" ", MAX_CHUNK);
      if (sp > 0) return sp + 1;
    }
    return 0;
  }
}

/** Posição logo depois da última vírgula/ponto e vírgula/travessão (seguido de espaço) a partir de `minPos`. */
function lastBreak(buf: string, minPos: number): number {
  const re = /[,;—](?=\s)/g;
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = re.exec(buf))) if (m.index >= minPos) at = m.index + 1;
  return at;
}
