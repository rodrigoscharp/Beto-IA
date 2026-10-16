"""Frases de ack (o "já te respondo" falado enquanto o cérebro trabalha): rodízio por tipo de pedido."""

from __future__ import annotations

FALLBACK_KIND = "geral"


class AckPhrases:
    def __init__(self, phrases: dict[str, list[str]]):
        self._phrases = phrases
        self._pos: dict[str, int] = {}

    def next(self, kind: str) -> str:
        """Próxima frase do tipo, em rodízio; tipo desconhecido usa ``geral``."""
        if kind not in self._phrases:
            kind = FALLBACK_KIND
        options = self._phrases[kind]
        i = self._pos.get(kind, 0)
        self._pos[kind] = (i + 1) % len(options)
        return options[i % len(options)]
