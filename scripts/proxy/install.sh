#!/usr/bin/env bash
# Instala o LaunchAgent que mantém o proxy do Beto sempre ligado em https://localhost:3443.
# É por esse endereço que o Safari (e o app do Dock) usa o Beto com voz: o WebKit bloqueia site público chamando o
# localhost, e a voz vem do VoiceStudio em https://localhost:3900.
# Uso: scripts/proxy/install.sh
# Pré-requisitos: Node e o VoiceStudio já instalado (scripts/voicestudio/install.sh), que gera o certificado do mkcert.
set -euo pipefail

LABEL="com.beto.proxy"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
URL="https://localhost:3443"
# O script vai para fora do repositório: o serviço não depende de onde o checkout (ou um worktree) está.
DIR="$HOME/Library/Application Support/beto-proxy"
CERT_DIR="$HOME/Library/Application Support/beto-voicestudio"
CERT="$CERT_DIR/localhost.pem"
KEY="$CERT_DIR/localhost-key.pem"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Falta o Node." >&2
  exit 1
fi
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "Falta o certificado em $CERT_DIR. Rode antes: scripts/voicestudio/install.sh" >&2
  exit 1
fi
CA="$(mkcert -CAROOT)/rootCA.pem"

mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$HERE/proxy.mjs" "$DIR/proxy.mjs"
sed -e "s|__NODE__|$NODE|g" -e "s|__DIR__|$DIR|g" -e "s|__HOME__|$HOME|g" -e "s|__CERT__|$CERT|g" -e "s|__KEY__|$KEY|g" \
  "$HERE/$LABEL.plist" > "$DEST"
plutil -lint "$DEST" >/dev/null

# Recarrega: tira a versão antiga (se houver) e sobe a nova.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# Logo depois do bootout o launchd às vezes ainda não soltou o serviço ("Bootstrap failed: 5"): tenta de novo.
for _ in 1 2 3 4 5; do
  launchctl bootstrap "gui/$(id -u)" "$DEST" 2>/dev/null && break
  sleep 2
done

echo "Esperando o proxy responder em $URL/login (até 30 s)..."
for _ in $(seq 1 15); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 --cacert "$CA" "$URL/login")" = "200" ]; then
    echo "Proxy no ar: abra $URL no Safari. Logs: ~/Library/Logs/beto-proxy.log"
    exit 0
  fi
  sleep 2
done
echo "O proxy não respondeu a tempo. Veja ~/Library/Logs/beto-proxy.log" >&2
exit 1
