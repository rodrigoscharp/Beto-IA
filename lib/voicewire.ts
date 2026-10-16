/* Formato da resposta de /api/chat para o serviço local de voz (stream: "ndjson"): uma linha JSON por evento.
   - {"t": "..."}        pedaço de texto da resposta (pode ter a tag [emo:X] e tags de ação, como o modelo escreveu)
   - {"retry": true}     a rede de proteção refez a resposta; o que já foi falado fica, o texto novo vem a seguir
   - {"ack": "agenda"}   antes de rodar ferramentas, o tipo do que vai buscar (lib/ack.ts); o serviço fala uma frase curta
   - {"meta": {...}}     última linha, sempre: modo usado, desfazer do My Hub, login do Google, se agiu
   Sem imports de runtime: roda no servidor e nos testes. */
import type { AckKind } from "./ack";

export interface WireUndo { path: string | null; resumo: string; ts: number }

export interface WireMeta {
  mode: "chat" | "full";
  undo?: WireUndo | null;
  undoCleared?: boolean;
  needsGoogleLogin?: boolean;
  usedTools?: boolean;
}

export type WireLine = { t: string } | { retry: true } | { ack: AckKind } | { meta: WireMeta };

const ACK_KINDS: readonly AckKind[] = ["conteudo", "agenda", "myhub", "memoria", "geral", "web"];

export function encodeLine(line: WireLine): string {
  return JSON.stringify(line) + "\n";
}

/** Lê uma linha; linha vazia ou inválida devolve null (quem lê ignora e segue). */
export function parseLine(raw: string): WireLine | null {
  const s = raw.trim();
  if (!s) return null;
  let v: unknown;
  try { v = JSON.parse(s); } catch { return null; }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.t === "string") return { t: o.t };
  if (o.retry === true) return { retry: true };
  const ack = ACK_KINDS.find((k) => k === o.ack);
  if (ack) return { ack };
  if (o.meta && typeof o.meta === "object") {
    const m = o.meta as Record<string, unknown>;
    if (m.mode === "chat" || m.mode === "full") return { meta: o.meta as WireMeta };
  }
  return null;
}
