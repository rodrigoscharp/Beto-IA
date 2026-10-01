/* Fila de fala por frase: cada frase pede o áudio e toca em ordem, enquanto as seguintes já estão sendo buscadas.
   As dependências (buscar áudio, tocar, legenda, relógio) entram de fora: a lógica é testável sem navegador.

   - no máximo 2 pedidos de voz ao mesmo tempo (a ElevenLabs gratuita limita concorrência);
   - só a primeira frase pede o silêncio de abertura (`lead`);
   - frase sem áudio (cota acabou, erro): o texto fica na tela pelo tempo de ler e a fila segue. Nunca troca de voz. */

export interface QueueDeps {
  /** Devolve o endereço do áudio, ou null se a voz falhou. `first`: é a primeira frase da resposta. */
  fetchAudio(text: string, first: boolean): Promise<string | null>;
  play(url: string, hooks: { onPlaying(): void }): { done: Promise<void>; stop(): void };
  showText(text: string): void;
  readingMs(text: string): number;
  sleep(ms: number): Promise<void>;
  /** Primeiro áudio tocando (ou primeira legenda, se não há voz): é o "tempo até a resposta aparecer". */
  onFirstSound(): void;
  revoke?(url: string): void;
}

const WINDOW = 2;

interface Item { text: string; url?: Promise<string | null> }

export class SpeechQueue {
  private items: Item[] = [];
  private fetchBase = 0;            // primeira frase que ainda não começou a tocar
  private ended = false;
  private cancelled = false;
  private started = false;
  private wake: (() => void) | null = null;
  private playing: { stop(): void } | null = null;
  private soundFired = false;
  private readonly finished: Promise<void>;
  private resolveFinished!: () => void;

  private readonly deps: QueueDeps;

  constructor(deps: QueueDeps) {
    this.deps = deps;
    this.finished = new Promise<void>((r) => { this.resolveFinished = r; });
  }

  push(text: string): void {
    if (this.ended || this.cancelled) return;
    this.items.push({ text });
    this.pumpFetches();
    if (!this.started) { this.started = true; void this.run(); }
    this.wake?.();
  }

  /** Avisa que não vêm mais frases. Resolve quando tudo foi falado (ou cancelado). */
  end(): Promise<void> {
    this.ended = true;
    if (!this.started) this.resolveFinished();
    else this.wake?.();
    return this.finished;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  cancel(): void {
    this.cancelled = true;
    this.playing?.stop();
    // Áudio que já foi buscado (ou ainda está chegando) e não vai tocar: libera o endereço.
    for (const item of this.items) item.url?.then((u) => { if (u) this.deps.revoke?.(u); });
    this.wake?.();
    this.resolveFinished();
  }

  private pumpFetches(): void {
    for (let j = this.fetchBase; j < this.fetchBase + WINDOW; j++) {
      const item = this.items[j];
      if (item && !item.url) item.url = this.deps.fetchAudio(item.text, j === 0).catch(() => null);
    }
  }

  private fireSound(): void {
    if (this.soundFired) return;
    this.soundFired = true;
    this.deps.onFirstSound();
  }

  private async run(): Promise<void> {
    try {
      for (let i = 0; ; i++) {
        this.fetchBase = i;
        while (!this.cancelled && i >= this.items.length) {
          if (this.ended) return;
          await new Promise<void>((r) => { this.wake = r; });
          this.wake = null;
        }
        if (this.cancelled) return;
        this.pumpFetches();
        const item = this.items[i];
        const url = await item.url!;
        if (this.cancelled) { if (url) this.deps.revoke?.(url); return; }

        this.fetchBase = i + 1;       // esta frase já tem áudio: libera o pedido da próxima
        this.pumpFetches();
        this.deps.showText(item.text);
        if (url) {
          const p = this.deps.play(url, { onPlaying: () => this.fireSound() });
          this.playing = p;
          await p.done;
          this.playing = null;
          this.deps.revoke?.(url);
        } else {
          this.fireSound();
          await this.deps.sleep(this.deps.readingMs(item.text));
        }
        if (this.cancelled) return;
      }
    } finally {
      this.resolveFinished();
    }
  }
}
