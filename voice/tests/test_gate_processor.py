import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame

from beto_voice.gate import ConversationGate
from beto_voice.gate_processor import GateProcessor


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def _monta(monkeypatch, gate):
    clock = Clock()
    p = GateProcessor(gate, clock=clock)
    pushed = []

    async def push(frame, direction=FrameDirection.DOWNSTREAM):
        pushed.append(frame)

    async def noop(self, frame, direction):
        pass

    monkeypatch.setattr(p, "push_frame", push)
    monkeypatch.setattr(GateProcessor.__mro__[1], "process_frame", noop)   # sem pipeline: pula a checagem do FrameProcessor
    p.pushed = pushed
    p.clock = clock
    return p


@pytest.fixture
def proc(monkeypatch):
    gate = ConversationGate(wake_words=["beto", "ei beto"], end_phrases=["valeu"], follow_up_secs=9, listen_secs=12)
    return _monta(monkeypatch, gate)


@pytest.fixture
def proc_continuo(monkeypatch):
    gate = ConversationGate(
        wake_words=["beto", "ei beto"], end_phrases=["valeu"], follow_up_secs=9, listen_secs=12,
        continuous=True, idle_close_secs=60, hold_phrases=["hmm"],
    )
    return _monta(monkeypatch, gate)


def tf(text: str) -> TranscriptionFrame:
    return TranscriptionFrame(text, "", "2026-10-05T10:00:00Z")


def msgs(p):
    return [f.data for f in p.pushed if isinstance(f, RTVIServerMessageFrame)]


async def test_fechado_ignora_e_avisa_o_navegador(proc):
    await proc.process_frame(tf("conversa da sala"), FrameDirection.DOWNSTREAM)
    assert not [f for f in proc.pushed if isinstance(f, TranscriptionFrame)]
    assert msgs(proc) == [{"type": "ignored", "text": "conversa da sala"}]


async def test_wake_word_com_pedido_segue_sem_o_wake_word(proc):
    await proc.process_frame(tf("Ei Beto, toca Drake"), FrameDirection.DOWNSTREAM)
    out = [f for f in proc.pushed if isinstance(f, TranscriptionFrame)]
    assert len(out) == 1 and out[0].text == "toca Drake"


async def test_wake_word_sozinho_manda_estado_ouvindo(proc):
    await proc.process_frame(tf("Beto"), FrameDirection.DOWNSTREAM)
    assert msgs(proc) == [{"type": "state", "state": "listening"}]
    await proc.process_frame(tf("que horas são"), FrameDirection.DOWNSTREAM)
    assert [f.text for f in proc.pushed if isinstance(f, TranscriptionFrame)] == ["que horas são"]


async def test_bot_parou_abre_follow_up_e_valeu_fecha(proc):
    await proc.process_frame(BotStoppedSpeakingFrame(), FrameDirection.UPSTREAM)
    assert isinstance(proc.pushed[-1], BotStoppedSpeakingFrame)   # o frame segue o caminho dele
    proc.clock.t += 5
    await proc.process_frame(tf("valeu"), FrameDirection.DOWNSTREAM)
    assert msgs(proc)[-1] == {"type": "state", "state": "wake"}
    await proc.process_frame(tf("mais uma coisa"), FrameDirection.DOWNSTREAM)
    assert msgs(proc)[-1]["type"] == "ignored"


async def test_parcial_so_passa_com_o_gate_aberto(proc):
    interim = InterimTranscriptionFrame("ei be", "", "2026-10-05T10:00:00Z")
    await proc.process_frame(interim, FrameDirection.DOWNSTREAM)
    assert interim not in proc.pushed
    proc.gate.on_listen(proc.clock())
    await proc.process_frame(interim, FrameDirection.DOWNSTREAM)
    assert interim in proc.pushed


async def test_vad_subindo_marca_inicio_da_fala(proc):
    proc.gate.on_transcript("Beto, oi", now=100); proc.gate.on_bot_stopped(now=101)
    proc.clock.t = 108
    vad = VADUserStartedSpeakingFrame()
    await proc.process_frame(vad, FrameDirection.UPSTREAM)
    assert vad in proc.pushed   # o frame segue o caminho dele
    proc.clock.t = 114
    await proc.process_frame(tf("e amanhã?"), FrameDirection.DOWNSTREAM)
    assert any(isinstance(f, TranscriptionFrame) and f.text == "e amanhã?" for f in proc.pushed)


async def test_hold_manda_estado_listening(proc_continuo):
    await proc_continuo.process_frame(tf("Beto, oi"), FrameDirection.DOWNSTREAM)
    proc_continuo.gate.on_bot_stopped(now=proc_continuo.clock.t)
    proc_continuo.pushed.clear()
    await proc_continuo.process_frame(tf("hmm"), FrameDirection.DOWNSTREAM)
    assert [f.data for f in proc_continuo.pushed if isinstance(f, RTVIServerMessageFrame)] == [{"type": "state", "state": "listening"}]
    assert not [f for f in proc_continuo.pushed if isinstance(f, TranscriptionFrame)]


async def test_bot_comecou_a_falar_abre_o_turno_e_segue(proc, monkeypatch):
    calls, pushed = [], []
    monkeypatch.setattr(proc.gate, "on_bot_started", lambda now: calls.append(now))

    async def push(frame, direction=FrameDirection.DOWNSTREAM):
        pushed.append((frame, direction))

    monkeypatch.setattr(proc, "push_frame", push)
    proc.clock.t = 106
    frame = BotStartedSpeakingFrame()
    await proc.process_frame(frame, FrameDirection.UPSTREAM)
    assert calls == [106]
    assert pushed == [(frame, FrameDirection.UPSTREAM)]   # segue no mesmo sentido
