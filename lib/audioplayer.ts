/* Um elemento de áudio só para todas as falas do Beto.

   O Safari só deixa um <audio> tocar fora de um clique se esse mesmo elemento já tocou dentro de um clique. A fala
   chega segundos depois do pedido (o VoiceStudio gera a frase inteira), então um `new Audio()` por frase fica mudo no
   Safari: o pedido sai, o áudio chega, e o play() é recusado. Aqui o elemento é destravado no primeiro clique ou tecla
   (`unlock`, tocando um silêncio curto) e reaproveitado em todas as frases. No Chrome não muda nada.
   Sem imports: roda no navegador e nos testes. */

/** WAV PCM de 10 ms de silêncio (8 kHz, 16 bits, mono). */
export const SILENT_WAV =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** O pedaço de HTMLAudioElement que o player usa (os testes passam um falso). */
export interface AudioEl {
  src: string;
  onplaying: ((ev: Event) => unknown) | null;
  onended: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event | string) => unknown) | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
}

/** onEnd(cut): cut = outra fala ou um stopAll cortou esta; false = acabou, deu erro, foi recusada ou parou pelo próprio stop. */
export interface PlayHooks { onPlaying(): void; onEnd(cut: boolean): void }

export class SharedPlayer {
  private el: AudioEl | null = null;
  private seq = 0;
  private current: { seq: number; end(cut: boolean): void } | null = null;
  unlocked = false;
  private make: () => AudioEl;

  constructor(make: () => AudioEl) { this.make = make; }

  private element(): AudioEl {
    return (this.el ??= this.make());
  }

  /** Chamar dentro de um clique ou tecla: o elemento toca um silêncio e fica liberado para tocar depois. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const el = this.element();
    el.src = SILENT_WAV;
    el.play().catch(() => {});
  }

  /** Toca `url` no elemento único. Uma fala nova encerra a anterior (o onEnd dela é chamado com cut = true). */
  play(url: string, hooks: PlayHooks): { stop(): void } {
    this.current?.end(true);
    const seq = ++this.seq;
    const el = this.element();
    let ended = false;
    const end = (cut: boolean) => {
      if (ended) return;
      ended = true;
      if (this.current?.seq === seq) this.current = null;
      hooks.onEnd(cut);
    };
    this.current = { seq, end };
    const mine = () => this.seq === seq;   // evento atrasado de uma frase anterior não conta

    this.detach(el);
    el.pause();
    el.src = url;
    el.onplaying = () => { if (mine()) hooks.onPlaying(); };
    el.onended = () => { if (mine()) end(false); };
    el.onerror = () => { if (mine()) end(false); };
    el.play().catch(() => { if (mine()) end(false); });

    return {
      stop: () => {
        if (mine()) this.silence(el);
        end(false);
      },
    };
  }

  /** Para o que estiver tocando. */
  stopAll(): void {
    const cur = this.current;
    if (!cur) return;
    if (this.el) this.silence(this.el);
    cur.end(true);
  }

  private detach(el: AudioEl): void {
    el.onplaying = el.onended = el.onerror = null;
  }

  /** Esvazia sem `src = ""`, que dispara um erro assíncrono capaz de encerrar a fala seguinte. */
  private silence(el: AudioEl): void {
    this.seq++;
    this.detach(el);
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
}
