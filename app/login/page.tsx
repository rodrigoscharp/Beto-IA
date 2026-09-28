"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [busy,     setBusy]     = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.replace("/");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Falha ao entrar.");
    } catch {
      setError("Sem conexão.");
    }
    setBusy(false);
  }

  return (
    <main style={{
      position: "fixed", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 28,
      background: "radial-gradient(ellipse at 50% 35%, #0e2238 0%, #050a0f 60%, #000 100%)",
      padding: "0 24px",
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/icon-512.png" alt="Beto"
        width={132} height={132}
        style={{ borderRadius: 30, boxShadow: "0 0 60px rgba(0,212,255,0.28), 0 0 0 1px rgba(0,212,255,0.18)" }}
      />

      <div style={{
        color: "rgba(255,255,255,0.28)", fontSize: 11, fontFamily: "monospace",
        letterSpacing: "0.32em", textTransform: "uppercase",
      }}>
        BETO IA
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14, width: "min(320px, 100%)" }}>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            background: "rgba(255,255,255,0.04)", color: "#fff",
            border: `1px solid ${error ? "rgba(255,90,90,0.6)" : "rgba(0,212,255,0.28)"}`,
            borderRadius: 12, padding: "14px 16px", fontSize: 16, outline: "none",
            textAlign: "center", letterSpacing: "0.12em",
          }}
        />
        <button
          type="submit"
          disabled={busy || !password}
          style={{
            background: "linear-gradient(135deg, #00d4ff, #ffd700)", color: "#050a0f",
            border: "none", borderRadius: 12, padding: "13px 16px",
            fontSize: 14, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
            cursor: busy ? "wait" : "pointer", opacity: busy || !password ? 0.55 : 1,
          }}
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <div style={{ minHeight: 18, textAlign: "center", color: "#ff7a7a", fontSize: 13 }}>{error}</div>
      </form>
    </main>
  );
}
