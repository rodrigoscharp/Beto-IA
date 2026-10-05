"""Lê a resposta do cérebro em pedaços e separa o que é falado do que é sinal.

Mesmas regras de ``lib/replystream.ts`` e ``lib/emotion.ts`` do app:
- ``[emo:X]`` em qualquer lugar sai do texto e vira ``Emotion`` (só a primeira válida conta);
- ``[NOME:{json}]`` vira ``Action`` com o JSON lido (JSON inválido: a tag some e nada é emitido);
- ``[NEEDTOOLS]`` nunca é falado;
- colchete que não é tag ("[1] é a opção") é texto.

Puro, sem Pipecat: testável sem rede.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

EMOTIONS = frozenset(
    ["neutro", "alegre", "animado", "pensativo", "bravo", "nervoso", "surpreso", "triste", "sarcastico"]
)


@dataclass(frozen=True)
class Emotion:
    name: str


@dataclass(frozen=True)
class Text:
    text: str


@dataclass(frozen=True)
class Action:
    tag: str
    payload: dict = field(default_factory=dict)


Event = Emotion | Text | Action

_EMO = re.compile(r"\[\s*emo[^\]:\n]*:?\s*([^\]\n]*?)\s*\]", re.IGNORECASE)
_NEED = re.compile(r"\[\s*NEED_?TOOLS\s*\]", re.IGNORECASE)
_ACTION_START = re.compile(r"\[([A-Z][A-Z_]*):")
_NEED_PREFIX = re.compile(r"\[\s*NEED_?TOOLS", re.IGNORECASE)
# Colchete aberto no fim do buffer que ainda pode virar uma tag conhecida: segura até decidir.
_MAYBE_TAG = re.compile(r"\[\s*(?:emo[^\]\n]{0,40}|[A-Za-z_]{0,14}|NEED_?TOOLS?)?$", re.IGNORECASE)


def _fold(s: str) -> str:
    import unicodedata

    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower().strip()


class ReplyFilter:
    def __init__(self) -> None:
        self._buf = ""
        self._emotion_sent = False

    def push(self, delta: str) -> list[Event]:
        self._buf += delta
        return self._drain(final=False)

    def finish(self) -> list[Event]:
        return self._drain(final=True)

    # ── interno ────────────────────────────────────────────────────────────

    def _drain(self, final: bool) -> list[Event]:
        out: list[Event] = []
        while self._buf:
            i = self._buf.find("[")
            if i < 0:
                self._emit_text(out, self._buf)
                self._buf = ""
                break
            # Texto antes do colchete é texto.
            if i > 0:
                self._emit_text(out, self._buf[:i])
                self._buf = self._buf[i:]
            end = self._buf.find("]")
            if end < 0:
                # Colchete sem fechar. Tag de ação em andamento ("[SPOTIFY:{...") espera o fechamento, qualquer que
                # seja o tamanho; outro começo que ainda pode ser tag ("[emo", "[SPOT") espera um pouco; o resto é texto.
                pending_action = bool(_ACTION_START.match(self._buf) or _NEED_PREFIX.match(self._buf))
                if pending_action or _MAYBE_TAG.match(self._buf):
                    if final:
                        if not pending_action:
                            self._emit_text(out, self._buf)
                        self._buf = ""  # ação cortada no fim: nunca falada
                    break
                # "[" seguido de algo que não é tag: solta o "[" como texto e segue.
                self._emit_text(out, self._buf[:1])
                self._buf = self._buf[1:]
                continue
            tag = self._buf[: end + 1]
            m = _EMO.fullmatch(tag)
            if m:
                name = _fold(m.group(1))
                if name in EMOTIONS and not self._emotion_sent:
                    self._emotion_sent = True
                    out.append(Emotion(name))
                self._buf = self._buf[end + 1 :]
                continue
            if _NEED.fullmatch(tag):
                self._buf = self._buf[end + 1 :]
                continue
            a = _ACTION_START.match(self._buf)
            if a:
                closed = self._action_end()
                if closed < 0:
                    if final:
                        self._buf = ""  # tag de ação cortada no fim: nunca falada
                    break
                raw = self._buf[a.end() : closed - 1]
                self._buf = self._buf[closed:]
                try:
                    payload = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(payload, dict):
                    out.append(Action(a.group(1), payload))
                continue
            # Colchete comum ("[1]"): é texto.
            self._emit_text(out, tag)
            self._buf = self._buf[end + 1 :]
        return out

    def _action_end(self) -> int:
        """Posição logo após o ``]`` que fecha ``[TAG:{...}]`` (o JSON pode ter ``]`` dentro), ou -1 se incompleto."""
        start = self._buf.find(":") + 1
        depth = 0
        in_str = False
        esc = False
        for k in range(start, len(self._buf)):
            c = self._buf[k]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    rest = self._buf[k + 1 :]
                    j = len(rest) - len(rest.lstrip())
                    if len(rest) > j and rest[j] == "]":
                        return k + 1 + j + 1
                    if len(rest) <= j:
                        return -1
                    return -1
        return -1

    @staticmethod
    def _emit_text(out: list[Event], text: str) -> None:
        if not text:
            return
        if out and isinstance(out[-1], Text):
            out[-1] = Text(out[-1].text + text)
        else:
            out.append(Text(text))
