import json

import httpx
import pytest
from pipecat.frames.frames import LLMTextFrame, TTSSpeakFrame
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame

from beto_voice.brain import ERROR_TEXT, BetoBrainLLMService, BrainClient, build_messages, parse_line


def ndjson(*lines) -> bytes:
    return "".join(json.dumps(l) + "\n" for l in lines).encode()


def client_with(body: bytes | None, status: int = 200, seen: list | None = None) -> BrainClient:
    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(req)
        return httpx.Response(status, content=body if body is not None else b"")

    return BrainClient("https://beto.example/", "tok", history=20, timeout_secs=5, transport=httpx.MockTransport(handler))


# ── build_messages ─────────────────────────────────────────────────────────

def test_build_messages_corta_no_historico_e_prefixa_emocao():
    ctx = [{"role": "system", "content": "x"}]
    for i in range(15):
        ctx += [{"role": "user", "content": f"u{i}"}, {"role": "assistant", "content": f"a{i}"}]
    out = build_messages(ctx, ["alegre", "triste"], history=4)
    assert len(out) == 4
    assert out[-1] == {"role": "assistant", "content": "[emo:triste] a14"}
    assert out[-3] == {"role": "assistant", "content": "[emo:alegre] a13"}
    assert out[0]["role"] == "user"


def test_build_messages_junta_usuarios_consecutivos():
    ctx = [{"role": "user", "content": "me conta uma coisa"}, {"role": "user", "content": "na verdade esquece"}]
    assert build_messages(ctx, [], 20) == [{"role": "user", "content": "me conta uma coisa na verdade esquece"}]


def test_build_messages_sem_emocao_registrada_usa_neutro_e_nao_duplica():
    ctx = [{"role": "assistant", "content": "[emo:bravo] já tem"}, {"role": "assistant", "content": "sem tag"}]
    out = build_messages(ctx, [], 20)
    assert out[0]["content"] == "[emo:bravo] já tem"
    assert out[1]["content"] == "[emo:neutro] sem tag"


def test_parse_line():
    assert parse_line('{"t":"oi"}') == {"t": "oi"}
    assert parse_line('{"retry":true}') == {"retry": True}
    assert parse_line('{"meta":{"mode":"full","undo":null}}') == {"meta": {"mode": "full", "undo": None}}
    assert parse_line("") is None
    assert parse_line("lixo") is None
    assert parse_line('{"meta":{"mode":"x"}}') is None


# ── BrainClient.stream ─────────────────────────────────────────────────────

async def collect(service: BetoBrainLLMService, ctx):
    frames = []

    async def emit(f):
        frames.append(f)

    await service.respond(ctx, emit)
    return frames


def spoken(frames) -> str:
    return "".join(f.text for f in frames if isinstance(f, LLMTextFrame))


def messages_of(frames):
    return [f.data for f in frames if isinstance(f, RTVIServerMessageFrame)]


@pytest.mark.asyncio
async def test_stream_manda_token_e_historico_e_fala_so_o_texto():
    seen = []
    c = client_with(ndjson({"t": "[emo:alegre] Fechou, "}, {"t": "chefe."}, {"meta": {"mode": "chat"}}), seen=seen)
    s = BetoBrainLLMService(c)
    frames = await collect(s, [{"role": "user", "content": "oi"}])
    assert spoken(frames).strip() == "Fechou, chefe."
    assert {"type": "emotion", "emotion": "alegre"} in messages_of(frames)
    req = seen[0]
    assert req.headers["authorization"] == "Bearer tok"
    body = json.loads(req.content)
    assert body["stream"] == "ndjson"
    assert body["messages"] == [{"role": "user", "content": "oi"}]
    assert "undo" not in body
    assert list(s._emotions) == ["alegre"]


@pytest.mark.asyncio
async def test_linha_invalida_e_ignorada():
    c = client_with(b'{"t":"[emo:neutro] Oi."}\nlixo\n{"meta":{"mode":"chat"}}\n')
    frames = await collect(BetoBrainLLMService(c), [])
    assert spoken(frames).strip() == "Oi."


@pytest.mark.asyncio
async def test_stream_cortado_sem_meta_fala_o_que_chegou():
    c = client_with(ndjson({"t": "[emo:neutro] Metade da resp"}))
    frames = await collect(BetoBrainLLMService(c), [])
    assert spoken(frames).strip() == "Metade da resp"
    assert not [f for f in frames if isinstance(f, TTSSpeakFrame)]


@pytest.mark.asyncio
async def test_undo_sobrevive_entre_turnos_e_some_com_undo_cleared():
    undo = {"path": "x/1", "resumo": "Gasto de R$ 45,00", "ts": 1}
    seen = []
    c = client_with(ndjson({"t": "[emo:neutro] Anotei."}, {"meta": {"mode": "full", "undo": undo}}), seen=seen)
    s = BetoBrainLLMService(c)
    await collect(s, [])
    assert s.undo == undo

    seen.clear()
    c2 = client_with(ndjson({"t": "[emo:neutro] Desfeito."}, {"meta": {"mode": "full", "undoCleared": True}}), seen=seen)
    s._client = c2
    await collect(s, [])
    assert json.loads(seen[0].content)["undo"] == undo   # o turno seguinte reenviou o undo
    assert s.undo is None


@pytest.mark.asyncio
async def test_acao_vira_mensagem_e_nao_e_falada():
    c = client_with(ndjson({"t": '[emo:neutro] [SPOTIFY:{"action":"play","query":"Drake"}] Vai.'}, {"meta": {"mode": "full"}}))
    frames = await collect(BetoBrainLLMService(c), [])
    assert spoken(frames).strip() == "Vai."
    assert {"type": "action", "tag": "SPOTIFY", "payload": {"action": "play", "query": "Drake"}} in messages_of(frames)


@pytest.mark.asyncio
async def test_retry_fala_as_duas_respostas_e_needs_login():
    c = client_with(ndjson({"t": "[emo:neutro] Marquei."}, {"retry": True}, {"t": "[emo:triste] Não consegui."}, {"meta": {"mode": "full", "needsGoogleLogin": True}}))
    frames = await collect(BetoBrainLLMService(c), [])
    assert spoken(frames).split() == ["Marquei.", "Não", "consegui."]
    assert {"type": "needs_login", "service": "google"} in messages_of(frames)


@pytest.mark.asyncio
async def test_erro_http_fala_mensagem_de_erro():
    c = client_with(b"nao autorizado", status=401)
    frames = await collect(BetoBrainLLMService(c), [])
    assert [f.text for f in frames if isinstance(f, TTSSpeakFrame)] == [ERROR_TEXT]
