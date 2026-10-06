"""Configuração do serviço de voz: beto-voice.toml + variáveis de ambiente.

Puro (sem Pipecat): quem monta o pipeline recebe um ``Config`` pronto e validado.
"""

from __future__ import annotations

import os
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "beto-voice.toml"
DEFAULT_VOICE_ID = "bIHbv24MWmeRgasZH58o"  # Will (leve e jovem), a mesma voz do app


@dataclass
class BrainCfg:
    url: str
    token: str
    history: int = 20
    timeout_secs: float = 60.0


@dataclass
class SttCfg:
    engine: str = "mlx"
    model: str = "mlx-community/whisper-large-v3-turbo"
    faster_model: str = "large-v3-turbo"
    language: str = "pt"
    vocabulary: list[str] = field(default_factory=list)
    initial_prompt: str = ""
    no_speech_prob: float = 0.6
    interim_every_secs: float = 1.5

    def initial_prompt_text(self) -> str:
        """Vocabulário separado por vírgula mais o texto livre: é isso que o Whisper vê antes do áudio."""
        parts = [", ".join(v for v in self.vocabulary if v.strip()), self.initial_prompt.strip()]
        return " ".join(p for p in parts if p).strip()


@dataclass
class TurnCfg:
    vad_stop_secs: float = 0.2
    vad_start_secs: float = 0.2
    vad_confidence: float = 0.7
    smart_turn_stop_secs: float = 2.0
    smart_turn_max_duration_secs: float = 8.0
    follow_up_secs: float = 9.0
    listen_secs: float = 12.0
    barge_in: bool = True
    wake_words: list[str] = field(default_factory=lambda: ["beto"])
    end_phrases: list[str] = field(default_factory=list)


@dataclass
class TtsCfg:
    api_key: str
    voice_id: str = DEFAULT_VOICE_ID
    model: str = "eleven_turbo_v2_5"
    stability: float = 0.5
    similarity_boost: float = 0.8
    style: float = 0.2
    speed: float = 1.0


@dataclass
class ServerCfg:
    host: str = "127.0.0.1"
    port: int = 7860
    cors_origins: list[str] = field(default_factory=list)


@dataclass
class Config:
    brain: BrainCfg
    stt: SttCfg
    turn: TurnCfg
    tts: TtsCfg
    server: ServerCfg


_SECTIONS = ("brain", "stt", "turn", "tts", "server")


def _section(raw: dict, name: str) -> dict:
    sec = raw.get(name)
    if not isinstance(sec, dict):
        raise ValueError(f"beto-voice.toml: falta a seção [{name}]")
    return sec


def _build(cls, data: dict, **overrides):
    """Instancia a dataclass só com chaves conhecidas; chave desconhecida é erro (evita typo silencioso)."""
    known = set(cls.__dataclass_fields__)
    unknown = sorted(set(data) - known)
    if unknown:
        raise ValueError(f"beto-voice.toml: chave desconhecida em [{cls.__name__}]: {', '.join(unknown)}")
    return cls(**{**data, **overrides})


def load_config(path: Path | None = None, env: Mapping[str, str] | None = None) -> Config:
    """Lê o TOML (padrão: ``voice/beto-voice.toml``) e aplica a env por cima.

    Env: ``BRAIN_URL`` (url do cérebro), ``VOICE_SERVICE_TOKEN``, ``ELEVENLABS_API_KEY``, ``ELEVENLABS_VOICE_ID``.
    """
    env = os.environ if env is None else env
    p = path or DEFAULT_PATH
    with open(p, "rb") as f:
        raw = tomllib.load(f)
    for s in _SECTIONS:
        _section(raw, s)

    brain_raw = dict(_section(raw, "brain"))
    brain_raw["url"] = env.get("BRAIN_URL") or brain_raw.get("url", "")
    brain = _build(BrainCfg, brain_raw, token=env.get("VOICE_SERVICE_TOKEN", ""))
    brain.url = brain.url.rstrip("/")

    stt = _build(SttCfg, _section(raw, "stt"))
    if stt.engine not in ("mlx", "faster"):
        raise ValueError(f'beto-voice.toml: [stt].engine deve ser "mlx" ou "faster", veio "{stt.engine}"')

    turn = _build(TurnCfg, _section(raw, "turn"))
    tts = _build(
        TtsCfg,
        _section(raw, "tts"),
        api_key=env.get("ELEVENLABS_API_KEY", ""),
        voice_id=env.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE_ID,
    )
    server = _build(ServerCfg, _section(raw, "server"))
    return Config(brain=brain, stt=stt, turn=turn, tts=tts, server=server)
