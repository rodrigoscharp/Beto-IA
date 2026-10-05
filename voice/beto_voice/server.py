"""Servidor HTTP do serviço de voz: sinalização WebRTC, saúde e a página de desenvolvimento.

`uv run beto-voice` lê voice/.env e voice/beto-voice.toml e escuta em 127.0.0.1:7860.
"""

from __future__ import annotations

import asyncio
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from loguru import logger
from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCPatchRequest, SmallWebRTCRequest, SmallWebRTCRequestHandler

from .bot import run_bot
from .config import Config, load_config

ROOT = Path(__file__).resolve().parent.parent
DEV_PAGE = ROOT / "dev" / "index.html"


def _warm_up(cfg: Config) -> float:
    """Carrega o modelo do Whisper antes da primeira conversa (a primeira execução também baixa o modelo)."""
    import numpy as np

    t0 = time.monotonic()
    if cfg.stt.engine == "mlx":
        import mlx_whisper

        mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=cfg.stt.model, language=cfg.stt.language)
    return time.monotonic() - t0


def create_app(cfg: Config) -> FastAPI:
    handler = SmallWebRTCRequestHandler()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            secs = await asyncio.to_thread(_warm_up, cfg)
            logger.info(f"[voz] modelo {cfg.stt.model} pronto em {secs:.1f}s")
        except Exception as e:   # sem modelo o serviço sobe mesmo assim; /health conta
            logger.error(f"[voz] não carregou o modelo: {e}")
        yield
        await handler.close()

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=cfg.server.cors_origins, allow_methods=["*"], allow_headers=["*"])

    @app.post("/api/offer")
    async def offer(request: SmallWebRTCRequest, background_tasks: BackgroundTasks):
        async def on_connection(connection):
            background_tasks.add_task(run_bot, connection, cfg)

        return await handler.handle_web_request(request=request, webrtc_connection_callback=on_connection)

    @app.patch("/api/offer")
    async def ice(request: SmallWebRTCPatchRequest):
        await handler.handle_patch_request(request)
        return {"status": "success"}

    @app.get("/health")
    async def health():
        return JSONResponse({
            "ok": True,
            "stt": {"engine": cfg.stt.engine, "model": cfg.stt.model if cfg.stt.engine == "mlx" else cfg.stt.faster_model},
            "brain": cfg.brain.url,
            "token": bool(cfg.brain.token),
            "tts": bool(cfg.tts.api_key),
        })

    @app.get("/")
    async def index():
        if DEV_PAGE.exists():
            return FileResponse(DEV_PAGE)
        return JSONResponse({"ok": True})

    return app


def main() -> None:
    load_dotenv(ROOT / ".env", override=False)
    cfg = load_config()
    logger.remove()
    logger.add(sys.stderr, level="INFO")
    if not cfg.tts.api_key:
        logger.warning("[voz] ELEVENLABS_API_KEY vazio: o Beto não vai falar")
    if not cfg.brain.token:
        logger.warning("[voz] VOICE_SERVICE_TOKEN vazio: /api/chat vai recusar")
    logger.info(f"[voz] cérebro em {cfg.brain.url}; escutando em http://{cfg.server.host}:{cfg.server.port}")
    uvicorn.run(create_app(cfg), host=cfg.server.host, port=cfg.server.port, log_level="warning")


if __name__ == "__main__":
    main()
