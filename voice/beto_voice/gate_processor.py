"""O gate de conversa como processador do Pipecat: fica entre o STT e o agregador de turno.

Transcrição final passa pelo ``ConversationGate``; o que não é para o Beto não chega ao cérebro. Estado e
"ouvi mas ignorei" vão ao navegador como mensagens do servidor (legenda e mascote).
"""

from __future__ import annotations

import time
from collections.abc import Callable

from loguru import logger
from pipecat.frames.frames import BotStoppedSpeakingFrame, Frame, InterimTranscriptionFrame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame

from .gate import ConversationGate


class GateProcessor(FrameProcessor):
    def __init__(self, gate: ConversationGate, *, clock: Callable[[], float] = time.monotonic, **kwargs):
        super().__init__(**kwargs)
        self._gate = gate
        self._clock = clock

    @property
    def gate(self) -> ConversationGate:
        return self._gate

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        now = self._clock()

        if isinstance(frame, TranscriptionFrame):
            d = self._gate.on_transcript(frame.text, now)
            if d.kind == "forward":
                frame.text = d.text
                await self.push_frame(frame, direction)
            elif d.kind == "listen":
                logger.info("[gate] wake word: ouvindo")
                await self.push_frame(RTVIServerMessageFrame(data={"type": "state", "state": "listening"}), direction)
            elif d.kind == "end":
                logger.info("[gate] encerrado pelo chefe")
                await self.push_frame(RTVIServerMessageFrame(data={"type": "state", "state": "wake"}), direction)
            else:
                logger.debug(f"[gate] ignorado: {frame.text!r}")
                await self.push_frame(RTVIServerMessageFrame(data={"type": "ignored", "text": d.text}), direction)
            return

        if isinstance(frame, InterimTranscriptionFrame):
            if self._gate.is_open(now):
                await self.push_frame(frame, direction)
            return

        if isinstance(frame, BotStoppedSpeakingFrame):
            self._gate.on_bot_stopped(now)

        await self.push_frame(frame, direction)
