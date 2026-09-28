"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Alert } from "@/lib/alerts/types";

const SEEN_KEY    = "beto-alerts-seen";
const ENABLED_KEY = "beto-alerts";
const POLL_MS     = 2 * 60 * 1000;   // consulta
const TICK_MS     = 4 * 1000;        // tenta falar o que estiver na fila
const MIN_GAP_MS  = 25 * 1000;       // respiro entre um aviso falado e o próximo
const MAX_SEEN    = 500;
const MAX_JOIN    = 3;               // no máximo 3 avisos por fala

const brtHour = () => new Date(Date.now() - 3 * 3600_000).getUTCHours();
const quietHours = () => { const h = brtHour(); return h >= 23 || h < 7; };

function loadSeen(): string[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch { return null; }
}

interface Opts {
  /** True quando o Beto está ocioso e o áudio já foi liberado pelo usuário. */
  canSpeak: () => boolean;
  /** Fala o texto e chama onDone ao terminar. */
  announce: (text: string, onDone: () => void) => void;
}

/**
 * O Beto avisa sozinho: consulta /api/alerts a cada poucos minutos e fala o que chegou.
 * Regras de silêncio: nada de madrugada (23h–7h, fica na fila), nunca interrompe conversa,
 * respiro entre falas, e avisos vencidos são descartados.
 */
export function useProactive({ canSpeak, announce }: Opts): [boolean, () => void] {
  const [enabled, setEnabled] = useState(true);

  const enabledRef = useRef(true);
  const seen       = useRef<string[]>([]);
  const queue      = useRef<Alert[]>([]);
  const lastSpoke  = useRef(0);
  const busy       = useRef(false);
  const fns        = useRef({ canSpeak, announce });
  fns.current = { canSpeak, announce };

  const remember = (ids: string[]) => {
    if (!ids.length) return;
    seen.current = Array.from(new Set(seen.current.concat(ids))).slice(-MAX_SEEN);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen.current)); } catch { /* modo privado */ }
  };

  const poll = useCallback(async () => {
    if (!enabledRef.current || busy.current) return;
    busy.current = true;
    try {
      const stored   = loadSeen();
      const baseline = stored === null;
      if (stored) seen.current = stored;

      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seen: seen.current, baseline }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) return;
      const data = await res.json() as { alerts: Alert[]; mark: string[] };

      remember([...data.mark, ...data.alerts.map(a => a.id)]);
      if (baseline && !data.mark.length && !data.alerts.length) remember(["__baseline__"]);
      queue.current.push(...data.alerts);
    } catch { /* offline: tenta no próximo ciclo */ }
    finally { busy.current = false; }
  }, []);

  const drain = useCallback(() => {
    if (!enabledRef.current || !queue.current.length) return;

    // Avisos vencidos (ex.: a reunião já começou) saem da fila sem falar.
    queue.current = queue.current.filter(a => a.until > Date.now());
    if (!queue.current.length) return;

    if (quietHours() || !fns.current.canSpeak() || Date.now() - lastSpoke.current < MIN_GAP_MS) return;

    queue.current.sort((a, b) => b.priority - a.priority);
    const batch = queue.current.splice(0, MAX_JOIN);
    lastSpoke.current = Date.now();
    fns.current.announce(batch.map(a => a.text).join(" Além disso, "), () => { lastSpoke.current = Date.now(); });
  }, []);

  useEffect(() => {
    try { enabledRef.current = localStorage.getItem(ENABLED_KEY) !== "off"; } catch { /* */ }
    setEnabled(enabledRef.current);

    const first = setTimeout(poll, 8_000);
    const pollId = setInterval(poll, POLL_MS);
    const tickId = setInterval(drain, TICK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first); clearInterval(pollId); clearInterval(tickId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll, drain]);

  const toggle = useCallback(() => {
    enabledRef.current = !enabledRef.current;
    setEnabled(enabledRef.current);
    try { localStorage.setItem(ENABLED_KEY, enabledRef.current ? "on" : "off"); } catch { /* */ }
    if (!enabledRef.current) queue.current = [];
  }, []);

  return [enabled, toggle];
}
