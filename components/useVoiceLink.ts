"use client";

import { useEffect, useRef, useState } from "react";
import { probeVoiceService, VoiceLink, type LinkHandlers } from "@/lib/voicelink";

const DEFAULT_URL = process.env.NEXT_PUBLIC_VOICE_URL ?? "http://localhost:7860";

/**
 * Serviço local de voz (voice/): se ele responde em /health, conecta e devolve o link; senão `active` fica false e a
 * página segue com a Web Speech. Os handlers são lidos por ref: a página pode passá-los inline sem reconectar.
 */
export function useVoiceLink(handlers: LinkHandlers, url: string = DEFAULT_URL): { active: boolean; link: VoiceLink | null } {
  const [active, setActive] = useState(false);
  const linkRef = useRef<VoiceLink | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const link = new VoiceLink(url, {
      onUserSpeaking: (s) => h.current.onUserSpeaking(s),
      onTranscript: (t, f) => h.current.onTranscript(t, f),
      onThinking: () => h.current.onThinking(),
      onBotSpeaking: (s) => h.current.onBotSpeaking(s),
      onBotText: (t) => h.current.onBotText(t),
      onServerMessage: (m) => h.current.onServerMessage(m),
      onReady: () => h.current.onReady(),
      onDisconnected: () => { setActive(false); h.current.onDisconnected(); },
    });
    (async () => {
      if (!(await probeVoiceService(url)) || cancelled) return;
      try {
        await link.connect();
        if (cancelled) { await link.disconnect(); return; }
        linkRef.current = link;
        setActive(true);
      } catch (e) {
        console.warn("[Beto] serviço de voz no ar mas a conexão falhou:", e);
      }
    })();
    return () => {
      cancelled = true;
      linkRef.current = null;
      setActive(false);
      void link.disconnect();
    };
  }, [url]);

  return { active, link: active ? linkRef.current : null };
}
