import httpx

from beto_voice.config import TtsCfg
from beto_voice.tts import speech_payload, voicestudio_online


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
