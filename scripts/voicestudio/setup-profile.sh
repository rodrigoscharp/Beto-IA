#!/usr/bin/env bash
# Cria (ou recria) no VoiceStudio o perfil de voz "Beto", a partir da referência versionada em voice/assets.
# Pode rodar quantas vezes quiser: apaga antes qualquer perfil "Beto" (ou o "Beto curto" dos testes), porque dois
# perfis com o mesmo nome fazem a API responder 409 e o Beto ficaria mudo.
# Uso: scripts/voicestudio/setup-profile.sh   (VOICESTUDIO_URL troca o endereço; padrão https://localhost:3900)
set -euo pipefail

URL="${VOICESTUDIO_URL:-https://localhost:3900}"
# O certificado do VoiceStudio é do mkcert: o curl do macOS não lê o Keychain, então recebe a autoridade local.
CA="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem"
[ -f "$CA" ] && export CURL_CA_BUNDLE="$CA"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REF="$ROOT/voice/assets/beto-ref.wav"
REF_TEXT="Hoje você tem três tarefas no MyHub e uma reunião às dez."
INSTRUCT="male, young adult, moderate pitch"

curl -sf -m 5 "$URL/health" | grep -q '"status":"ok"' || { echo "VoiceStudio fora do ar em $URL" >&2; exit 1; }

for id in $(curl -sf "$URL/profiles" | python3 -c '
import json, sys
data = json.load(sys.stdin)
rows = data if isinstance(data, list) else data.get("profiles", [])
print(" ".join(p["id"] for p in rows if p.get("name", "").strip().lower() in ("beto", "beto curto")))
'); do
  curl -sf -X DELETE "$URL/profiles/$id" >/dev/null && echo "apagado perfil antigo $id"
done

curl -sf -X POST "$URL/profiles" \
  -F name=Beto -F kind=clone -F language=pt \
  -F "ref_audio=@$REF;type=audio/wav" \
  -F "ref_text=$REF_TEXT" \
  -F "instruct=$INSTRUCT" \
  | python3 -c 'import json, sys; print("perfil Beto criado:", json.load(sys.stdin)["id"])'
