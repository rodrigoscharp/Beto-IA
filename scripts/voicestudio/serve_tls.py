"""Sobe o VoiceStudio em HTTPS (certificado do mkcert) para o Beto.

Por que não `uvicorn main:app --ssl-certfile ...` direto: o VoiceStudio chama `truststore.inject_into_ssl()` ao ser
importado, o que troca o `ssl.SSLContext` do processo inteiro. O uvicorn cria o contexto TLS do servidor depois de
importar o app, recebe o do truststore e passa a aceitar a conexão sem nunca ler o pedido (o navegador fica esperando
para sempre). Aqui o contexto do servidor é criado com o `SSLContext` padrão, e o truststore continua valendo para as
conexões de saída do VoiceStudio (downloads de modelos).

Uso (o LaunchAgent já chama assim, com o Python do VoiceStudio e a pasta dele como diretório atual):
    python serve_tls.py --app-dir backend --host 127.0.0.1 --port 3900 --cert CERT.pem --key KEY.pem
"""

from __future__ import annotations

import argparse
import ssl
import sys
from pathlib import Path

_STD_SSL_CONTEXT = ssl.SSLContext   # guardado antes de o VoiceStudio injetar o truststore


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--app-dir", default="backend")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=3900)
    p.add_argument("--cert", required=True)
    p.add_argument("--key", required=True)
    a = p.parse_args()

    sys.path.insert(0, str(Path(a.app_dir).resolve()))
    import main as voicestudio   # noqa: E402  (importar já injeta o truststore)
    import uvicorn                # noqa: E402
    import uvicorn.config         # noqa: E402

    create = uvicorn.config.create_ssl_context

    def server_context(*args, **kwargs):
        patched, ssl.SSLContext = ssl.SSLContext, _STD_SSL_CONTEXT
        try:
            return create(*args, **kwargs)
        finally:
            ssl.SSLContext = patched

    uvicorn.config.create_ssl_context = server_context
    uvicorn.run(voicestudio.app, host=a.host, port=a.port, ssl_certfile=a.cert, ssl_keyfile=a.key)


if __name__ == "__main__":
    main()
