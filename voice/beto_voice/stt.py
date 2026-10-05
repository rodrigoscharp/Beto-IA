"""Transcrição local: Whisper large-v3-turbo via MLX (GPU do Mac) com o vocabulário do Rodrigo no ``initial_prompt``.

O ``WhisperSTTServiceMLX`` do Pipecat não passa ``initial_prompt`` ao ``mlx_whisper``; esta classe estende o
``run_stt`` para passar. Transcrição parcial: enquanto o VAD diz que o usuário fala, a cada ``interim_every_secs``
o buffer acumulado é transcrito de novo (um por vez) e vira ``InterimTranscriptionFrame`` para a legenda.
``engine = "faster"`` usa o ``WhisperSTTService`` do Pipecat (CPU), que já aceita ``initial_prompt`` e ``hotwords``.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncGenerator
from typing import Any

import numpy as np
from loguru import logger
from pipecat.frames.frames import ErrorFrame, Frame, InputAudioRawFrame, InterimTranscriptionFrame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.stt_service import STTService
from pipecat.services.whisper.stt import WhisperSTTService, WhisperSTTServiceMLX
from pipecat.transcriptions.language import Language
from pipecat.utils.time import time_now_iso8601

from .config import SttCfg

# Assinatura típica de alucinação do Whisper (repetição), igual ao que o Pipecat descarta.
_HALLUCINATION_RATIO = 0.5555555555555556
MIN_INTERIM_SECS = 1.0   # menos de 1 s de áudio não vale uma parcial


class BetoWhisperMLX(WhisperSTTServiceMLX):
    def __init__(self, *, initial_prompt: str, interim_every_secs: float, **kwargs):
        super().__init__(**kwargs)
        self._initial_prompt = initial_prompt or None
        self._interim_every = max(0.0, interim_every_secs)
        self._lock = asyncio.Lock()
        self._last_interim = 0.0
        self._interim_task: asyncio.Task | None = None

    # ── transcrição ────────────────────────────────────────────────────────

    def _transcribe(self, audio_float: np.ndarray) -> dict[str, Any]:
        """Chamada síncrona ao mlx_whisper (roda numa thread). Isolada para teste."""
        import mlx_whisper

        return mlx_whisper.transcribe(
            audio_float,
            path_or_hf_repo=self._settings.model,
            temperature=self._settings.temperature,
            language=self._settings.language,
            initial_prompt=self._initial_prompt,
            condition_on_previous_text=False,
        )

    def _text_of(self, result: dict[str, Any]) -> str:
        threshold = self._settings.no_speech_prob
        parts: list[str] = []
        for seg in result.get("segments", []):
            if seg.get("compression_ratio") == _HALLUCINATION_RATIO:
                continue
            if threshold is not None and seg.get("no_speech_prob", 0.0) >= threshold:
                continue
            parts.append(str(seg.get("text", "")).strip())
        return " ".join(p for p in parts if p).strip()

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        try:
            await self.start_processing_metrics()
            audio_float = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
            async with self._lock:
                result = await asyncio.to_thread(self._transcribe, audio_float)
            await self.stop_processing_metrics()
            text = self._text_of(result)
            if text:
                language = self._settings.language
                await self._handle_transcription(text, True, language)
                logger.debug(f"Transcription: [{text}]")
                yield TranscriptionFrame(text, self._user_id, time_now_iso8601(), language)
        except Exception as e:
            yield ErrorFrame(error=f"Whisper MLX falhou: {e}")

    # ── parcial ────────────────────────────────────────────────────────────

    async def process_audio_frame(self, frame: InputAudioRawFrame, direction: FrameDirection):
        await super().process_audio_frame(frame, direction)
        if self._interim_every <= 0 or not self._user_speaking:
            return
        now = time.monotonic()
        enough = len(self._audio_buffer) >= int(self.sample_rate * 2 * MIN_INTERIM_SECS)
        if enough and now - self._last_interim >= self._interim_every and (self._interim_task is None or self._interim_task.done()):
            self._last_interim = now
            self._interim_task = self.create_task(self._interim(bytes(self._audio_buffer)))

    async def _interim(self, pcm: bytes) -> None:
        if self._lock.locked():
            return   # a final (ou outra parcial) está rodando: não empilha trabalho na GPU
        audio_float = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        async with self._lock:
            result = await asyncio.to_thread(self._transcribe, audio_float)
        text = self._text_of(result)
        if text and self._user_speaking:
            await self.push_frame(InterimTranscriptionFrame(text, self._user_id, time_now_iso8601(), self._settings.language))

    async def _handle_user_stopped_speaking(self, frame):
        # A parcial em voo não deve virar legenda depois da final.
        if self._interim_task and not self._interim_task.done():
            await self.cancel_task(self._interim_task)
        self._interim_task = None
        await super()._handle_user_stopped_speaking(frame)


def build_stt(cfg: SttCfg) -> STTService:
    language = Language(cfg.language) if cfg.language in {l.value for l in Language} else Language.PT
    prompt = cfg.initial_prompt_text()
    if cfg.engine == "faster":
        return WhisperSTTService(
            settings=WhisperSTTService.Settings(
                model=cfg.faster_model,
                language=language,
                no_speech_prob=cfg.no_speech_prob,
                initial_prompt=prompt or None,
                hotwords=", ".join(cfg.vocabulary) or None,
            ),
        )
    return BetoWhisperMLX(
        initial_prompt=prompt,
        interim_every_secs=cfg.interim_every_secs,
        settings=WhisperSTTServiceMLX.Settings(
            model=cfg.model,
            language=language,
            no_speech_prob=cfg.no_speech_prob,
            temperature=0.0,
        ),
    )
