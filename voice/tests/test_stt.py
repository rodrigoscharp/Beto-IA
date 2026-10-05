import sys
import types

import numpy as np
import pytest
from pipecat.frames.frames import TranscriptionFrame
from pipecat.services.whisper.stt import WhisperSTTService

from beto_voice.config import SttCfg
from beto_voice.stt import BetoWhisperMLX, build_stt


@pytest.fixture
def fake_mlx(monkeypatch):
    """Um mlx_whisper de mentira: registra a chamada e devolve segmentos fixos."""
    calls = []

    def transcribe(audio, **kw):
        calls.append(kw)
        return {
            "segments": [
                {"text": " Oi, Muno.", "no_speech_prob": 0.1, "compression_ratio": 1.2},
                {"text": " ruído", "no_speech_prob": 0.9, "compression_ratio": 1.2},
                {"text": " loop loop", "no_speech_prob": 0.1, "compression_ratio": 0.5555555555555556},
            ]
        }

    mod = types.ModuleType("mlx_whisper")
    mod.transcribe = transcribe
    monkeypatch.setitem(sys.modules, "mlx_whisper", mod)
    return calls


def cfg(**over) -> SttCfg:
    base = dict(engine="mlx", model="mlx-community/whisper-tiny", language="pt", vocabulary=["MyHub", "Muno"],
                initial_prompt="Conversa com o Beto.", no_speech_prob=0.6, interim_every_secs=0)
    return SttCfg(**{**base, **over})


def test_transcribe_passa_vocabulario_e_idioma(fake_mlx):
    stt = build_stt(cfg())
    assert isinstance(stt, BetoWhisperMLX)
    result = stt._transcribe(np.zeros(16000, dtype=np.float32))
    kw = fake_mlx[0]
    assert kw["initial_prompt"] == "MyHub, Muno Conversa com o Beto."
    assert kw["language"] == "pt"
    assert kw["path_or_hf_repo"] == "mlx-community/whisper-tiny"
    assert kw["condition_on_previous_text"] is False
    assert stt._text_of(result) == "Oi, Muno."   # ruído e alucinação ficam de fora


@pytest.mark.asyncio
async def test_run_stt_emite_transcricao_final(fake_mlx):
    stt = build_stt(cfg())
    frames = [f async for f in stt.run_stt(np.zeros(16000, dtype=np.int16).tobytes())]
    assert len(frames) == 1
    assert isinstance(frames[0], TranscriptionFrame)
    assert frames[0].text == "Oi, Muno."


def test_engine_faster_usa_o_servico_do_pipecat_com_prompt(monkeypatch):
    monkeypatch.setattr(WhisperSTTService, "_load", lambda self: None)
    stt = build_stt(cfg(engine="faster", faster_model="tiny"))
    assert isinstance(stt, WhisperSTTService) and not isinstance(stt, BetoWhisperMLX)
    assert stt._settings.initial_prompt == "MyHub, Muno Conversa com o Beto."
    assert stt._settings.hotwords == "MyHub, Muno"
