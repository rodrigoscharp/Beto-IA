#!/usr/bin/env bash
# Instala o LaunchAgent que mantém o VoiceStudio (a voz do Beto) sempre ligado em http://localhost:3900.
# Uso: scripts/voicestudio/install.sh [pasta do VoiceStudio]   (padrão: ~/Dev/VoiceStudio)
# Pré-requisito: o VoiceStudio já preparado (`bun install && bun run setup:api`) e o modelo OmniVoice baixado.
set -euo pipefail

VS_DIR="${1:-$HOME/Dev/VoiceStudio}"
LABEL="com.beto.voicestudio"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
URL="http://localhost:3900"

if [ ! -x "$VS_DIR/.venv/bin/python" ]; then
  echo "VoiceStudio não preparado em $VS_DIR (falta .venv). Rode lá: bun install && bun run setup:api" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|__VOICESTUDIO_DIR__|$VS_DIR|g" -e "s|__HOME__|$HOME|g" "$HERE/$LABEL.plist" > "$DEST"
plutil -lint "$DEST" >/dev/null

# Recarrega: tira a versão antiga (se houver) e sobe a nova.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"

echo "Esperando o VoiceStudio responder em $URL/health (até 3 min)..."
for _ in $(seq 1 90); do
  if curl -s -m 2 "$URL/health" | grep -q '"status":"ok"'; then
    echo "VoiceStudio no ar. Logs: ~/Library/Logs/voicestudio.log"
    exit 0
  fi
  sleep 2
done
echo "O VoiceStudio não respondeu a tempo. Veja ~/Library/Logs/voicestudio.log" >&2
exit 1
