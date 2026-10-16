import json

import httpx
import pytest

from beto_voice import tts as tts_mod
from beto_voice.config import TtsCfg
from beto_voice.tts import VoiceStudioTTSService, speech_payload, voicestudio_online


@pytest.fixture(autouse=True)
def _cache_limpo():
    """O cache de áudio é do processo: cada teste começa e termina com ele vazio."""
    tts_mod._clear_cache()
    yield
    tts_mod._clear_cache()


def test_payload():
    assert speech_payload("Oi.", TtsCfg()) == {
        "model": "omnivoice", "input": "Oi.", "voice": "Beto", "language": "pt",
        "num_step": 8, "speed": 1.0, "response_format": "pcm",
    }


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_voicestudio_online_so_com_status_ok():
    assert voicestudio_online("http://vs", client=_client(lambda r: httpx.Response(200, json={"status": "ok"})))
    assert not voicestudio_online("http://vs", client=_client(lambda r: httpx.Response(200, json={"status": "starting"})))
    assert not voicestudio_online("http://vs", client=_client(lambda r: httpx.Response(503)))

    def down(_r):
        raise httpx.ConnectError("recusado")

    assert not voicestudio_online("http://vs", client=_client(down))


def _tts(handler, cfg: TtsCfg | None = None) -> VoiceStudioTTSService:
    client = httpx.AsyncClient(base_url="http://vs", transport=httpx.MockTransport(handler))
    return VoiceStudioTTSService(cfg or TtsCfg(), client=client)


async def test_prewarm_guarda_pcm_e_segue_quando_uma_falha():
    def handler(req):
        body = json.loads(req.content)
        return httpx.Response(500) if body["input"] == "Falha." else httpx.Response(200, content=b"\x01\x00" * 480)

    tts = _tts(handler)
    assert await tts.prewarm(["Um segundo.", "Falha.", "Deixa eu ver."]) == 2
    assert tts.cached("Um segundo.") and tts.cached(" Deixa eu ver. ") and not tts.cached("Falha.")


async def test_prewarm_com_voicestudio_fora_nao_lanca():
    def down(_r):
        raise httpx.ConnectError("recusado")

    assert await _tts(down).prewarm(["Um segundo."]) == 0


async def test_run_tts_do_cache_nao_chama_o_voicestudio():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(200, content=b"\x01\x00" * 480)

    tts = _tts(handler)
    tts._sample_rate = 24000   # fora de um pipeline o StartFrame não rodou; o Pipecat define a taxa lá
    await tts.prewarm(["Um segundo."])
    calls.clear()
    frames = [f async for f in tts.run_tts("Um segundo.", "ctx")]
    assert calls == []
    assert frames   # quadros de áudio saíram


async def test_cache_e_do_processo_e_vale_entre_conexoes():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(200, content=b"\x01\x00" * 480)

    primeiro = _tts(handler)
    assert await primeiro.prewarm(["Um segundo."]) == 1
    calls.clear()
    segundo = _tts(handler)   # nova conexão do navegador, mesma config
    assert segundo.cached("Um segundo.")
    assert await segundo.prewarm(["Um segundo."]) == 1
    assert calls == []


async def test_cache_separa_por_voz():
    def handler(_req):
        return httpx.Response(200, content=b"\x01\x00" * 480)

    await _tts(handler).prewarm(["Um segundo."])
    assert not _tts(handler, TtsCfg(voice="Outra")).cached("Um segundo.")


async def test_resposta_200_vazia_nao_entra_no_cache():
    tts = _tts(lambda _req: httpx.Response(200, content=b""))
    assert await tts.prewarm(["Um segundo."]) == 0
    assert not tts.cached("Um segundo.")


async def test_frase_vazia_e_pulada_no_prewarm():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(200, content=b"\x01\x00" * 480)

    assert await _tts(handler).prewarm(["", "   "]) == 0
    assert calls == []
