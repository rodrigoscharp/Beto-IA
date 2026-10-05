"""O cérebro do Beto mora na Vercel. Aqui: o cliente HTTP (NDJSON) e o serviço LLM do Pipecat que o usa.

- ``BrainClient``: monta as mensagens (as últimas ``history``, assistente com ``[emo:X]`` na frente como o navegador
  fazia, usuários consecutivos juntos) e lê a resposta linha a linha (``lib/voicewire.ts`` do app).
- ``BetoBrainLLMService``: trata ``LLMContextFrame``; texto falável vira ``LLMTextFrame``; emoção e tags de ação viram
  mensagens ao navegador (``RTVIServerMessageFrame``); o ``undo`` do My Hub fica guardado entre turnos.
"""

from __future__ import annotations

import json
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx
from loguru import logger
from pipecat.frames.frames import (
    Frame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TTSSpeakFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
from pipecat.services.llm_service import LLMService
from pipecat.services.settings import LLMSettings

from .reply_filter import Action, Emotion, Event, ReplyFilter, Text

ERROR_TEXT = "Não consegui falar com o cérebro agora, chefe."
WireLine = dict[str, Any]


def parse_line(raw: str) -> WireLine | None:
    """Uma linha do NDJSON; vazia ou inválida devolve None (quem lê ignora)."""
    s = raw.strip()
    if not s:
        return None
    try:
        v = json.loads(s)
    except ValueError:
        return None
    if not isinstance(v, dict):
        return None
    if isinstance(v.get("t"), str):
        return {"t": v["t"]}
    if v.get("retry") is True:
        return {"retry": True}
    meta = v.get("meta")
    if isinstance(meta, dict) and meta.get("mode") in ("chat", "full"):
        return {"meta": meta}
    return None


def build_messages(context_messages: list[dict], emotions: list[str], history: int) -> list[dict]:
    """Mensagens como /api/chat espera: só user/assistant com texto, últimas ``history``, assistentes com a tag de
    emoção (alinhada pelo fim: a última resposta leva a última emoção), usuários consecutivos juntos."""
    msgs: list[dict] = []
    for m in context_messages:
        role = m.get("role")
        content = m.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
            continue
        text = content.strip()
        if msgs and msgs[-1]["role"] == "user" and role == "user":
            msgs[-1]["content"] += " " + text   # o Rodrigo voltou a falar enquanto o Beto processava: uma fala só
        else:
            msgs.append({"role": role, "content": text})
    # Emoções alinhadas pelo fim.
    assistant_idx = [i for i, m in enumerate(msgs) if m["role"] == "assistant"]
    for k, i in enumerate(reversed(assistant_idx)):
        emo = emotions[-1 - k] if k < len(emotions) else "neutro"
        if not msgs[i]["content"].startswith("[emo:"):
            msgs[i]["content"] = f"[emo:{emo}] {msgs[i]['content']}"
    return msgs[-history:] if history > 0 else msgs


class BrainClient:
    def __init__(self, url: str, token: str, history: int, timeout_secs: float, transport: httpx.AsyncBaseTransport | None = None):
        self._url = url.rstrip("/") + "/api/chat"
        self._token = token
        self.history = history
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(timeout_secs, connect=10.0), transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def stream(self, messages: list[dict], undo: dict | None) -> AsyncIterator[WireLine]:
        body: dict[str, Any] = {"messages": messages, "stream": "ndjson"}
        if undo:
            body["undo"] = undo
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        async with self._client.stream("POST", self._url, json=body, headers=headers) as res:
            if res.status_code != 200:
                detail = (await res.aread())[:300].decode("utf-8", "replace")
                raise httpx.HTTPStatusError(f"/api/chat respondeu {res.status_code}: {detail}", request=res.request, response=res)
            async for raw in res.aiter_lines():
                line = parse_line(raw)
                if line is None:
                    if raw.strip():
                        logger.warning(f"[brain] linha ignorada: {raw[:120]!r}")
                    continue
                yield line


Emit = Callable[[Frame], Awaitable[None]]


class BetoBrainLLMService(LLMService):
    """LLM do pipeline: delega ao /api/chat e traduz a resposta em frames."""

    def __init__(self, client: BrainClient, **kwargs):
        super().__init__(settings=LLMSettings(model="beto-brain"), **kwargs)
        self._client = client
        self._undo: dict | None = None
        self._emotions: deque[str] = deque(maxlen=64)

    @property
    def undo(self) -> dict | None:
        return self._undo

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMContextFrame):
            await self.push_frame(LLMFullResponseStartFrame())
            await self.start_processing_metrics()
            try:
                await self.respond(frame.context.get_messages(), self.push_frame)
            finally:
                await self.stop_processing_metrics()
                await self.push_frame(LLMFullResponseEndFrame())
        else:
            await self.push_frame(frame, direction)

    async def respond(self, context_messages: list[dict], emit: Emit) -> None:
        """Uma resposta inteira: chama o cérebro e emite os frames. Separado de ``process_frame`` para ser testável."""
        messages = build_messages(context_messages, list(self._emotions), self._client.history)
        filt = ReplyFilter()
        emotion: str | None = None

        async def handle(events: list[Event]) -> None:
            nonlocal emotion
            for ev in events:
                if isinstance(ev, Emotion):
                    if emotion is None:
                        emotion = ev.name
                    await emit(RTVIServerMessageFrame(data={"type": "emotion", "emotion": ev.name}))
                elif isinstance(ev, Text):
                    await emit(LLMTextFrame(ev.text))
                elif isinstance(ev, Action):
                    await emit(RTVIServerMessageFrame(data={"type": "action", "tag": ev.tag, "payload": ev.payload}))

        try:
            async for line in self._client.stream(messages, self._undo):
                if "t" in line:
                    await handle(filt.push(line["t"]))
                elif line.get("retry"):
                    await handle(filt.finish())
                    filt = ReplyFilter()   # a resposta nova pode trazer outra tag de emoção
                elif "meta" in line:
                    meta = line["meta"]
                    if meta.get("undoCleared"):
                        self._undo = None
                    elif isinstance(meta.get("undo"), dict):
                        self._undo = meta["undo"]
                    if meta.get("needsGoogleLogin"):
                        await emit(RTVIServerMessageFrame(data={"type": "needs_login", "service": "google"}))
            await handle(filt.finish())
        except (httpx.HTTPError, OSError) as e:
            logger.error(f"[brain] falha: {e}")
            await handle(filt.finish())   # o que já chegou é falado
            await emit(TTSSpeakFrame(ERROR_TEXT))
        finally:
            self._emotions.append(emotion or "neutro")
