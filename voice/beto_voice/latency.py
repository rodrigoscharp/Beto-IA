"""A linha ``[latency]`` de cada turno: quanto levou cada etapa entre o fim da fala e a voz do Beto."""

from __future__ import annotations

# Trecho do nome do processador (``BetoWhisperMLX#0``, ``VoiceStudioTTSService#0``…) → etapa na linha.
_STAGES = (("Whisper", "stt"), ("STT", "stt"), ("Brain", "brain"), ("TTS", "tts"))


def _stage(processor: str) -> str | None:
    for needle, stage in _STAGES:
        if needle in processor:
            return stage
    return None


def latency_line(total: float, turn: float | None, ttfb: list[tuple[str, float]], acked: bool) -> str:
    """``total`` e ``turno`` (duração da fala) vêm do observer do Pipecat; etapas ausentes ou desconhecidas somem."""
    parts = [f"total={total:.2f}s"]
    if turn is not None:
        parts.append(f"turno={turn:.2f}s")
    secs: dict[str, float] = {}
    for processor, duration in ttfb:
        stage = _stage(processor)
        if stage is not None:
            secs[stage] = duration
    for stage in ("stt", "brain", "tts"):
        if stage in secs:
            parts.append(f"{stage}={secs[stage]:.2f}s")
    parts.append(f"ack={'sim' if acked else 'não'}")
    return "[latency] " + " ".join(parts)
