/* Alguns modelos de raciocínio (ex.: qwen) mandam o pensamento dentro de <think>…</think> no meio do texto.
   Em streaming a tag pode chegar cortada ao meio ("<th" + "ink>"), então este filtro guarda só o pedaço que
   ainda pode virar tag. Sem imports: roda no servidor e nos testes. */

const OPEN = "<think>";
const CLOSE = "</think>";

/** Tamanho do maior final de `s` que é começo de `tag` (ex.: "...<thi" e "<think>" -> 4). */
function partialTail(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) if (tag.startsWith(s.slice(s.length - n))) return n;
  return 0;
}

export class ThinkFilter {
  private buf = "";
  private inThink = false;

  push(piece: string): string {
    this.buf += piece;
    let out = "";
    for (;;) {
      if (!this.inThink) {
        const i = this.buf.indexOf(OPEN);
        if (i >= 0) {
          out += this.buf.slice(0, i);
          this.buf = this.buf.slice(i + OPEN.length);
          this.inThink = true;
          continue;
        }
        const keep = partialTail(this.buf, OPEN);
        out += this.buf.slice(0, this.buf.length - keep);
        this.buf = this.buf.slice(this.buf.length - keep);
        return out;
      }
      const i = this.buf.indexOf(CLOSE);
      if (i >= 0) {
        this.buf = this.buf.slice(i + CLOSE.length);
        this.inThink = false;
        continue;
      }
      this.buf = this.buf.slice(this.buf.length - partialTail(this.buf, CLOSE));
      return out;
    }
  }

  /** Fim do fluxo: o que sobrou e não virou tag é texto; bloco aberto é descartado. */
  flush(): string {
    const rest = this.inThink ? "" : this.buf;
    this.buf = "";
    this.inThink = false;
    return rest;
  }
}
