"""Gate de conversa: quando o Beto responde ao que ouviu e quando só escuta.

Reproduz o UX do app sem a Web Speech: fechado, só o wake word acorda; depois de responder, ele continua ouvindo
por ``follow_up_secs``; toque no mascote (ou wake word sozinho) abre por ``listen_secs``; push-to-talk segurado
é sempre aberto; frases de encerramento ("valeu", "tchau") fecham.

Modo contínuo: depois que o Beto responde, a janela fica aberta por ``idle_close_secs`` (e não só ``follow_up_secs``),
para a conversa fluir sem repetir o wake word. A janela vale pelo INÍCIO da fala: se o chefe começou a falar com o
gate aberto, a transcrição é aceita mesmo que chegue depois de a janela fechar (o STT demora), até
``speech_grace_secs`` depois do início. Hesitação ("hmm",
"peraí", "deixa eu pensar") não vai ao cérebro nem encerra: devolve ``hold`` e renova a janela.

Puro: relógio entra por parâmetro, sem Pipecat.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

Kind = Literal["forward", "listen", "end", "hold", "ignore"]


@dataclass(frozen=True)
class Decision:
    kind: Kind
    text: str = ""


def norm(s: str) -> str:
    """Minúsculo, sem acento, sem pontuação, espaços únicos."""
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"[^a-z0-9\s]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


class ConversationGate:
    def __init__(
        self,
        *,
        wake_words: list[str],
        end_phrases: list[str],
        follow_up_secs: float,
        listen_secs: float,
        continuous: bool = False,
        idle_close_secs: float = 60.0,
        hold_phrases: list[str] | None = None,
        speech_grace_secs: float = 10.0,
    ) -> None:
        self._follow_up = follow_up_secs
        self._listen = listen_secs
        self._continuous = continuous
        self._idle_close = idle_close_secs
        self._speech_grace = speech_grace_secs
        # Quando começou, com o gate aberto, a fala que ainda não virou decisão. Um 2º segmento do VAD (pausa curta)
        # não mexe nela: a fala inteira vale pelo primeiro início.
        self._speech_started_open_at: float | None = None
        self._open_until = -math.inf
        self._ptt = False
        self._turn_open = False
        wakes = sorted({norm(w) for w in wake_words if norm(w)}, key=len, reverse=True)
        self._wake = re.compile(r"^(?:" + "|".join(re.escape(w) for w in wakes) + r")(?:\s+|$)")
        ends = {norm(e) for e in end_phrases if norm(e)}
        # "valeu", "valeu beto", "valeu chefe", "beto valeu": a frase inteira é o encerramento.
        self._end = re.compile(
            r"^(?:beto\s+)?(?:" + "|".join(re.escape(e) for e in sorted(ends, key=len, reverse=True)) + r")(?:\s+(?:beto|chefe))?$"
        ) if ends else None
        holds = {norm(h) for h in (hold_phrases or []) if norm(h)}
        # "hmm", "peraí beto", "deixa eu pensar": a frase inteira é a hesitação.
        self._hold = re.compile(
            r"^(?:" + "|".join(re.escape(h) for h in sorted(holds, key=len, reverse=True)) + r")(?:\s+beto)?$"
        ) if holds else None

    @property
    def _window_secs(self) -> float:
        return self._idle_close if self._continuous else self._follow_up

    # ── estado ─────────────────────────────────────────────────────────────

    def is_open(self, now: float) -> bool:
        return self._ptt or self._turn_open or now < self._open_until

    def accepting(self, now: float) -> bool:
        """Aberto pelo relógio agora OU porque a fala atual começou com o gate aberto há pouco."""
        mark = self._speech_started_open_at
        return self.is_open(now) or (mark is not None and now - mark <= self._speech_grace)

    def on_listen(self, now: float) -> None:
        self._open_until = max(self._open_until, now + self._listen)

    def on_ptt(self, down: bool) -> None:
        self._ptt = down

    def on_turn_forwarded(self) -> None:
        """Uma fala foi ao cérebro: fica aberto até o Beto terminar de responder."""
        self._turn_open = True

    def on_user_started(self, now: float) -> None:
        """O VAD ouviu o chefe começar a falar: se o gate está aberto agora, a fala inteira vale."""
        if self._speech_started_open_at is None and self.is_open(now):
            self._speech_started_open_at = now

    def on_bot_stopped(self, now: float) -> None:
        self._turn_open = False
        self._open_until = now + self._window_secs

    def close(self) -> None:
        self._turn_open = False
        self._open_until = -math.inf
        self._speech_started_open_at = None

    # ── transcrição ────────────────────────────────────────────────────────

    def on_transcript(self, text: str, now: float) -> Decision:
        # A marca de fala começada aberta vale para uma decisão só.
        open_ = self.accepting(now)
        self._speech_started_open_at = None
        t = norm(text)
        if not t:
            return Decision("ignore")
        m = self._wake.match(t)
        woke = bool(m)
        if woke:
            rest_raw = _strip_prefix(text, m.end())
            t = norm(rest_raw)
        else:
            rest_raw = text.strip()

        if self._end and self._end.match(t) and (woke or open_):
            self.close()
            return Decision("end")

        if self._hold and self._hold.match(t) and open_:
            self._open_until = max(self._open_until, now + self._window_secs)
            return Decision("hold")

        if woke:
            if not t or (self._hold and self._hold.match(t)):   # "Beto, peraí" com o gate fechado: só abre a escuta
                self.on_listen(now)
                return Decision("listen")
            self.on_turn_forwarded()
            return Decision("forward", rest_raw)

        if open_:
            self.on_turn_forwarded()
            return Decision("forward", rest_raw)
        return Decision("ignore", text.strip())


def _norm_map(s: str) -> tuple[str, list[int]]:
    """``norm(s)`` mais, para cada char normalizado, o índice do char de origem em ``s``."""
    out: list[str] = []
    idx: list[int] = []
    pending_space = False
    for i, c in enumerate(s):
        base = "".join(ch for ch in unicodedata.normalize("NFD", c) if unicodedata.category(ch) != "Mn").lower()
        if re.fullmatch(r"[a-z0-9]", base):
            if pending_space and out:
                out.append(" ")
                idx.append(i)
            pending_space = False
            out.append(base)
            idx.append(i)
        else:
            pending_space = True
    return "".join(out), idx


def _strip_prefix(original: str, norm_len: int) -> str:
    """Tira do texto original o trecho que, normalizado, ocupa ``norm_len`` chars (o wake word e a pontuação)."""
    normalized, idx = _norm_map(original)
    if norm_len >= len(normalized):
        return ""
    rest = original[idx[norm_len] :]
    return re.sub(r"^[\s,.!?:;]+", "", rest).strip()
