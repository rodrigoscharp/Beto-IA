"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/** Push do navegador: liga/desliga o recebimento de avisos com o app fechado. */
export function usePush(): { supported: boolean; subscribed: boolean; busy: boolean; toggle: () => void } {
  const [supported,  setSupported]  = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy,       setBusy]       = useState(false);

  useEffect(() => {
    const ok = !!KEY && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setSubscribed(!!sub && Notification.permission === "granted"))
      .catch(() => {});
  }, []);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const current = await reg.pushManager.getSubscription();

      if (current) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: current.endpoint }),
        });
        await current.unsubscribe();
        setSubscribed(false);
        return;
      }

      if ((await Notification.requestPermission()) !== "granted") return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(KEY) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) { await sub.unsubscribe(); return; }
      setSubscribed(true);
    } catch { /* permissão negada ou sem suporte */ }
    finally { setBusy(false); }
  }, [busy]);

  return { supported, subscribed, busy, toggle };
}
