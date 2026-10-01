/* Segura o começo da resposta enquanto ele só tem tags de emoção ("[emo:neutro] "). Só depois que chega texto de
   verdade é que o modelo "começou" e a troca de modelo deixa de valer. Sem isso, um erro logo depois da tag deixava
   o Beto mudo sem tentar outro modelo. Sem imports: roda no servidor e nos testes. */

export class HeadGate {
  private buf = "";
  private open = false;

  /** Devolve o que já pode seguir para quem consome ("" enquanto ainda está segurando). */
  push(piece: string): string {
    if (this.open) return piece;
    this.buf += piece;
    const rest = this.buf.replace(/^\s*(?:\[\s*emo[^\]\n]*\]\s*)*/i, "");
    if (rest === "" || /^\[\s*(?:e|em|emo[^\]\n]{0,40})?$/i.test(rest)) return "";   // só tag, ou tag ainda chegando
    this.open = true;
    const out = this.buf;
    this.buf = "";
    return out;
  }

  /** Fim do fluxo. Se nunca chegou texto de verdade não há nada a soltar. */
  flush(): string {
    this.buf = "";
    return "";
  }

  get released(): boolean {
    return this.open;
  }
}
