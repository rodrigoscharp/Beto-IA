#!/usr/bin/env bash
# Instala o LaunchAgent que mantém o VoiceStudio (a voz do Beto) sempre ligado em https://localhost:3900.
# Uso: scripts/voicestudio/install.sh [pasta do VoiceStudio]   (padrão: ~/Dev/VoiceStudio)
# Pré-requisitos: o VoiceStudio já preparado (`bun install && bun run setup:api`), o modelo OmniVoice baixado e o
# mkcert com a autoridade local instalada (`brew install mkcert && mkcert -install`). O HTTPS é obrigatório: o Safari
# bloqueia uma página https (o Beto na Vercel) de chamar http://localhost.
set -euo pipefail

VS_DIR="${1:-$HOME/Dev/VoiceStudio}"
LABEL="com.beto.voicestudio"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
URL="https://localhost:3900"
CERT_DIR="$HOME/Library/Application Support/beto-voicestudio"
CERT="$CERT_DIR/localhost.pem"
KEY="$CERT_DIR/localhost-key.pem"

if [ ! -x "$VS_DIR/.venv/bin/python" ]; then
  echo "VoiceStudio não preparado em $VS_DIR (falta .venv). Rode lá: bun install && bun run setup:api" >&2
  exit 1
fi

if ! command -v mkcert >/dev/null 2>&1; then
  echo "Falta o mkcert. Rode: brew install mkcert && mkcert -install" >&2
  exit 1
fi
CA="$(mkcert -CAROOT)/rootCA.pem"
if [ ! -f "$CA" ]; then
  echo "A autoridade local do mkcert não está instalada. Rode: mkcert -install" >&2
  exit 1
fi
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  mkcert -cert-file "$CERT" -key-file "$KEY" localhost 127.0.0.1 ::1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|__VOICESTUDIO_DIR__|$VS_DIR|g" -e "s|__HOME__|$HOME|g" -e "s|__CERT__|$CERT|g" -e "s|__KEY__|$KEY|g" -e "s|__HERE__|$HERE|g" \
  "$HERE/$LABEL.plist" > "$DEST"
plutil -lint "$DEST" >/dev/null

# Recarrega: tira a versão antiga (se houver) e sobe a nova.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# Logo depois do bootout o launchd às vezes ainda não soltou o serviço ("Bootstrap failed: 5"): tenta de novo.
for _ in 1 2 3 4 5; do
  launchctl bootstrap "gui/$(id -u)" "$DEST" 2>/dev/null && break
  sleep 2
done

echo "Esperando o VoiceStudio responder em $URL/health (até 3 min)..."
for _ in $(seq 1 90); do
  if curl -s -m 2 --cacert "$CA" "$URL/health" | grep -q '"status":"ok"'; then
    echo "VoiceStudio no ar. Logs: ~/Library/Logs/voicestudio.log"
    exit 0
  fi
  sleep 2
done
echo "O VoiceStudio não respondeu a tempo. Veja ~/Library/Logs/voicestudio.log" >&2
exit 1
