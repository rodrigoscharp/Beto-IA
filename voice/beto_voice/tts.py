"""Voz do Beto pelo VoiceStudio no Mac (https://localhost:3900, certificado do mkcert), a mesma do app.

O VoiceStudio gera a frase inteira antes de responder (cerca de 2 a 3 s no modo rápido); o áudio volta como PCM
cru (24 kHz, 16 bits, mono) e vira quadros de áudio do Pipecat.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, AsyncIterator
from pathlib import Path

import httpx
from loguru import logger
from pipecat.frames.frames import ErrorFrame, Frame, TTSStoppedFrame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService

from .config import TtsCfg

SAMPLE_RATE = 24000   # o PCM do VoiceStudio é sempre 24 kHz

# PCM por (frase, voz, passos, velocidade), do processo inteiro: cada conexão do navegador cria um serviço novo, e
# refazer os acks no VoiceStudio a cada conexão competiria com as respostas de verdade.
CacheKey = tuple[str, str, int, float]
_CACHE: dict[CacheKey, bytes] = {}


def _cache_key(text: str, cfg: TtsCfg) -> CacheKey:
    return (text.strip(), cfg.voice, cfg.num_step, cfg.speed)


def _clear_cache() -> None:
    """Esvazia o cache do processo (testes)."""
    _CACHE.clear()


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


MKCERT_CA = Path.home() / "Library" / "Application Support" / "mkcert" / "rootCA.pem"


def tls_verify(url: str, ca_file: str = "", mkcert_ca: Path = MKCERT_CA) -> str | bool:
    """Como conferir o certificado do VoiceStudio: a autoridade da config, senão a do mkcert (o certificado do
    localhost é dele e o httpx não lê o Keychain do macOS), senão a lista padrão."""
    if ca_file:
        return str(Path(ca_file).expanduser())
    if url.startswith("https://") and mkcert_ca.is_file():
        return str(mkcert_ca)
    return True


def voicestudio_online(url: str, client: httpx.Client | None = None, ca_file: str = "") -> bool:
    """O VoiceStudio está no ar e com o modelo carregado?"""
    c = client or httpx.Client(timeout=3, verify=tls_verify(url, ca_file))
    try:
        r = c.get(f"{url}/health")
        return r.status_code == 200 and r.json().get("status") == "ok"
    except (httpx.HTTPError, ValueError):
        return False
    finally:
        if client is None:
            c.close()


class VoiceStudioTTSService(TTSService):
    """TTS do Pipecat que pede cada frase ao VoiceStudio.

    Frases curtas e conhecidas (os acks) são sintetizadas antes, com `prewarm`, e tocam do cache na hora. O cache é
    do processo e vale entre conexões.
    """

    def __init__(self, cfg: TtsCfg, *, client: httpx.AsyncClient | None = None, **kwargs):
        super().__init__(
            push_start_frame=True,
            push_stop_frames=True,
            sample_rate=SAMPLE_RATE,
            settings=TTSSettings(model="omnivoice", voice=cfg.voice, language="pt"),
            **kwargs,
        )
        self._cfg = cfg
        self._client = client or httpx.AsyncClient(
            base_url=cfg.url, timeout=cfg.timeout_secs, verify=tls_verify(cfg.url, cfg.ca_file))

    def can_generate_metrics(self) -> bool:
        return True

    async def cleanup(self):
        await super().cleanup()
        await self._client.aclose()

    def cached(self, text: str) -> bool:
        """A frase já está sintetizada no cache, com a voz deste serviço?"""
        return _cache_key(text, self._cfg) in _CACHE

    async def prewarm(self, texts: list[str]) -> int:
        """Sintetiza as frases antes de precisarem. Devolve quantas ficaram no cache; falha numa não derruba as outras."""
        for text in texts:
            key = _cache_key(text, self._cfg)
            if not key[0] or key in _CACHE:   # frase vazia não vai ao VoiceStudio
                continue
            try:
                r = await self._client.post("/v1/audio/speech", json=speech_payload(key[0], self._cfg))
                if r.status_code != 200:
                    logger.warning(f"[voz] prewarm de {key[0]!r}: VoiceStudio {r.status_code}")
                    continue
                if not r.content:
                    logger.warning(f"[voz] prewarm de {key[0]!r}: VoiceStudio respondeu sem áudio")
                    continue
                _CACHE[key] = r.content
            except httpx.HTTPError as e:
                logger.warning(f"[voz] prewarm de {key[0]!r} falhou: {e}")
        return len({t.strip() for t in texts if t.strip() and self.cached(t)})

    async def _cached_chunks(self, pcm: bytes) -> AsyncIterator[bytes]:
        """Entrega o PCM do cache em pedaços de chunk_size, como o corpo da resposta HTTP."""
        size = self.chunk_size
        for i in range(0, len(pcm), size):
            yield pcm[i : i + size]

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        pcm = _CACHE.get(_cache_key(text, self._cfg))
        if pcm is not None:
            await self.start_tts_usage_metrics(text)
            async for frame in self._stream_audio_frames_from_iterator(
                self._cached_chunks(pcm), in_sample_rate=SAMPLE_RATE, context_id=context_id
            ):
                yield frame
            return

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
