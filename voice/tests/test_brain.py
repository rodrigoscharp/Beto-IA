import asyncio
import json

import httpx
import pytest
from pipecat.frames.frames import LLMTextFrame, TTSSpeakFrame
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame

from beto_voice.ack import AckPhrases
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


def test_parse_line_ack():
    assert parse_line('{"ack":"agenda"}') == {"ack": "agenda"}
    assert parse_line('{"ack":""}') is None
    assert parse_line('{"ack":"outro"}') == {"ack": "outro"}   # tipo novo do servidor: AckPhrases usa "geral"


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


@pytest.mark.asyncio
async def test_respond_mede_tempo_ate_o_primeiro_texto():
    t = iter([10.0, 12.8])
    llm = BetoBrainLLMService(client_with(ndjson({"t": "[emo:neutro] Oi."}, {"meta": {"mode": "chat"}})), clock=lambda: next(t))
    await collect(llm, [{"role": "user", "content": "oi"}])
    assert llm.last_reply_secs == pytest.approx(2.8)
    assert llm.last_acked is False


@pytest.mark.asyncio
async def test_ack_em_cache_e_falado_antes_da_resposta_e_fora_do_historico():
    body = ndjson({"ack": "agenda"}, {"t": "[emo:neutro] Amanhã você tem dentista."}, {"meta": {"mode": "full"}})
    llm = BetoBrainLLMService(client_with(body), acks=AckPhrases({"agenda": ["Deixa eu ver a agenda."], "geral": ["Um segundo."]}), is_cached=lambda t: True)
    out = await collect(llm, [{"role": "user", "content": "o que tenho amanhã?"}])
    speak = [f for f in out if isinstance(f, TTSSpeakFrame)]
    assert [(f.text, f.append_to_context) for f in speak] == [("Deixa eu ver a agenda.", False)]
    first_text = next(i for i, f in enumerate(out) if isinstance(f, LLMTextFrame))
    assert out.index(speak[0]) < first_text
    emo = [f.data["emotion"] for f in out if isinstance(f, RTVIServerMessageFrame) and f.data.get("type") == "emotion"]
    assert emo[0] == "pensativo"
    assert llm.last_acked is True


@pytest.mark.asyncio
async def test_ack_fora_do_cache_fica_mudo():
    body = ndjson({"ack": "agenda"}, {"t": "Ok."}, {"meta": {"mode": "full"}})
    llm = BetoBrainLLMService(client_with(body), acks=AckPhrases({"agenda": ["X"], "geral": ["Y"]}), is_cached=lambda t: False)
    out = await collect(llm, [{"role": "user", "content": "agenda"}])
    assert not any(isinstance(f, TTSSpeakFrame) for f in out)
    assert llm.last_acked is False


@pytest.mark.asyncio
async def test_segundo_ack_ou_ack_depois_de_texto_e_ignorado():
    body = ndjson({"ack": "agenda"}, {"ack": "myhub"}, {"t": "Ok."}, {"ack": "geral"}, {"meta": {"mode": "full"}})
    llm = BetoBrainLLMService(client_with(body), acks=AckPhrases({"agenda": ["A"], "myhub": ["M"], "geral": ["G"]}), is_cached=lambda t: True)
    out = await collect(llm, [{"role": "user", "content": "x"}])
    assert [f.text for f in out if isinstance(f, TTSSpeakFrame)] == ["A"]


@pytest.mark.asyncio
async def test_last_acked_volta_a_false_no_turno_seguinte():
    acks = AckPhrases({"agenda": ["A"], "geral": ["G"]})
    llm = BetoBrainLLMService(client_with(ndjson({"ack": "agenda"}, {"t": "Ok."})), acks=acks, is_cached=lambda t: True)
    await collect(llm, [])
    assert llm.last_acked is True
    llm._client = client_with(ndjson({"t": "Oi."}))
    await collect(llm, [])
    assert llm.last_acked is False


# ── pergunta sem resposta (hesitação durante o loop de ferramentas) ────────

class _ClienteTravado:
    """Cérebro que manda um ack e fica preso no loop de ferramentas até ser cancelado."""

    history = 20

    def __init__(self):
        self.started = asyncio.Event()

    async def stream(self, _messages, _undo):
        yield {"ack": "agenda"}
        self.started.set()
        await asyncio.Event().wait()


@pytest.mark.asyncio
async def test_respond_cancelado_antes_do_texto_fica_sem_resposta_e_relanca():
    c = _ClienteTravado()
    llm = BetoBrainLLMService(c)
    assert llm.unanswered is False

    async def emit(_f):
        pass

    task = asyncio.create_task(llm.respond([{"role": "user", "content": "o que tenho amanhã?"}], emit))
    await c.started.wait()
    assert llm.unanswered is False   # ainda respondendo
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert llm.unanswered is True


@pytest.mark.asyncio
async def test_respond_com_texto_fica_respondido():
    llm = BetoBrainLLMService(client_with(ndjson({"t": "Oi."}, {"meta": {"mode": "chat"}})))
    llm.unanswered = True   # sobra de um turno anterior cancelado
    await collect(llm, [])
    assert llm.unanswered is False
