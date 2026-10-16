"""Voz do Beto pelo VoiceStudio no Mac (http://127.0.0.1:3900), a mesma do app.

O VoiceStudio gera a frase inteira antes de responder (cerca de 2 a 3 s no modo rápido); o áudio volta como PCM
cru (24 kHz, 16 bits, mono) e vira quadros de áudio do Pipecat.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

import httpx
from loguru import logger
from pipecat.frames.frames import ErrorFrame, Frame, TTSStoppedFrame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService

from .config import TtsCfg

SAMPLE_RATE = 24000   # o PCM do VoiceStudio é sempre 24 kHz


def speech_payload(text: str, cfg: TtsCfg) -> dict:
    """Corpo de POST /v1/audio/speech: perfil de voz fixo, português, modo rápido."""
    return {
        "model": "omnivoice",
        "input": text,
        "voice": cfg.voice,
        "language": "pt",
        "num_step": cfg.num_step,
        "speed": cfg.speed,
        "response_format": "pcm",
    }


def voicestudio_online(url: str, client: httpx.Client | None = None) -> bool:
    """O VoiceStudio está no ar e com o modelo carregado?"""
    c = client or httpx.Client(timeout=3)
    try:
        r = c.get(f"{url}/health")
        return r.status_code == 200 and r.json().get("status") == "ok"
    except (httpx.HTTPError, ValueError):
        return False
    finally:
        if client is None:
            c.close()


class VoiceStudioTTSService(TTSService):
    """TTS do Pipecat que pede cada frase ao VoiceStudio."""

    def __init__(self, cfg: TtsCfg, **kwargs):
        super().__init__(
            push_start_frame=True,
            push_stop_frames=True,
            sample_rate=SAMPLE_RATE,
            settings=TTSSettings(model="omnivoice", voice=cfg.voice, language="pt"),
            **kwargs,
        )
        self._cfg = cfg
        self._client = httpx.AsyncClient(base_url=cfg.url, timeout=cfg.timeout_secs)

    def can_generate_metrics(self) -> bool:
        return True

    async def cleanup(self):
        await super().cleanup()
        await self._client.aclose()

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        try:
            async with self._client.stream("POST", "/v1/audio/speech", json=speech_payload(text, self._cfg)) as r:
                if r.status_code != 200:
                    error = (await r.aread()).decode(errors="replace")[:300]
                    logger.error(f"[voz] VoiceStudio {r.status_code}: {error}")
                    yield ErrorFrame(error=f"VoiceStudio {r.status_code}: {error}")
                    yield TTSStoppedFrame(context_id=context_id)
                    return

                await self.start_tts_usage_metrics(text)
                async for frame in self._stream_audio_frames_from_iterator(
                    r.aiter_bytes(self.chunk_size),
                    in_sample_rate=SAMPLE_RATE,
                    context_id=context_id,
                ):
                    await self.stop_ttfb_metrics()
                    yield frame
        except httpx.HTTPError as e:
            logger.error(f"[voz] VoiceStudio inacessível em {self._cfg.url}: {e}")
            yield ErrorFrame(error=f"VoiceStudio inacessível: {e}")
            yield TTSStoppedFrame(context_id=context_id)
        finally:
            await self.stop_ttfb_metrics()
