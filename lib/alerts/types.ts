export type AlertSource = "email" | "agenda" | "myhub" | "github";

export interface Alert {
  /** Estável entre polls: o cliente usa para nunca falar a mesma coisa duas vezes. */
  id:       string;
  source:   AlertSource;
  /** Texto pronto para ser falado (pt-BR, sem markdown). */
  text:     string;
  /** 1 = urgente, fala antes dos outros. */
  priority: 0 | 1;
  /** Epoch ms depois do qual o aviso não vale mais (ex.: reunião que já começou). */
  until:    number;
}

export interface Collected {
  alerts: Alert[];
  /** Ids vistos e descartados (ex.: email irrelevante): entram no "já visto" sem virar aviso. */
  mark:   string[];
}

export const EMPTY: Collected = { alerts: [], mark: [] };

export const HOUR_MS = 60 * 60 * 1000;
