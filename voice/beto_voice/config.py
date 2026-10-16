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
    continuous: bool = True
    idle_close_secs: float = 60.0
    hold_phrases: list[str] = field(
        default_factory=lambda: ["hmm", "hum", "peraí", "pera", "espera", "deixa eu pensar", "deixa eu ver", "calma"]
    )


@dataclass
class AckCfg:
    """Frases curtas que o Beto fala enquanto busca algo, uma lista por tipo de pedido (sorteadas na hora)."""

    conteudo: list[str] = field(default_factory=lambda: ["Deixa eu abrir o roteiro.", "Vou pegar o plano."])
    agenda: list[str] = field(
        default_factory=lambda: ["Deixa eu ver a agenda.", "Só um segundo, olhando a agenda.", "Vou checar a agenda."]
    )
    myhub: list[str] = field(default_factory=lambda: ["Deixa eu ver no My Hub.", "Um instante, abrindo o My Hub."])
    memoria: list[str] = field(default_factory=lambda: ["Deixa eu ver o que guardei.", "Um segundo."])
    geral: list[str] = field(default_factory=lambda: ["Um segundo.", "Deixa eu ver.", "Já vejo isso."])

    def phrases(self) -> dict[str, list[str]]:
        return {
            "conteudo": self.conteudo,
            "agenda": self.agenda,
            "myhub": self.myhub,
            "memoria": self.memoria,
            "geral": self.geral,
        }

    def all(self) -> list[str]:
        """Todas as frases, uma vez cada, na ordem em que aparecem (para pré-gerar o áudio)."""
        return list(dict.fromkeys(f for lista in self.phrases().values() for f in lista))


@dataclass
class TtsCfg:
    """Voz pelo VoiceStudio no Mac: o perfil "Beto" no modo rápido (8 passos), a mesma voz do app."""

    url: str = "http://127.0.0.1:3900"
    voice: str = "Beto"
    num_step: int = 8
    speed: float = 1.0
    timeout_secs: float = 30.0


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
    ack: AckCfg = field(default_factory=AckCfg)


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

    Env: ``BRAIN_URL`` (url do cérebro), ``VOICE_SERVICE_TOKEN``, ``VOICESTUDIO_URL`` (url do VoiceStudio).
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
    if turn.idle_close_secs <= 0:
        raise ValueError(f"beto-voice.toml: [turn].idle_close_secs deve ser maior que 0, veio {turn.idle_close_secs}")
    tts_raw = dict(_section(raw, "tts"))
    tts_raw["url"] = env.get("VOICESTUDIO_URL") or tts_raw.get("url", TtsCfg.url)
    tts = _build(TtsCfg, tts_raw)
    tts.url = tts.url.rstrip("/")
    server = _build(ServerCfg, _section(raw, "server"))
    ack = _build(AckCfg, raw.get("ack") or {})   # [ack] é opcional: ausente = frases padrão
    for tipo, frases in ack.phrases().items():
        if not frases:
            raise ValueError(f"beto-voice.toml: [ack].{tipo} precisa de pelo menos uma frase")
    return Config(brain=brain, stt=stt, turn=turn, tts=tts, server=server, ack=ack)
