import pytest

from beto_voice.gate import ConversationGate, Decision


@pytest.fixture
def gate():
    return ConversationGate(
        wake_words=["beto", "ei beto", "oi beto", "olá beto", "hey beto", "e aí beto"],
        end_phrases=["valeu", "obrigado", "tchau", "é isso", "pode parar"],
        follow_up_secs=9,
        listen_secs=12,
    )


def test_fechado_ignora_conversa_da_sala(gate):
    d = gate.on_transcript("oi, tudo bem com você?", now=100)
    assert d.kind == "ignore"
    assert d.text == "oi, tudo bem com você?"


def test_wake_word_com_pedido_encaminha_so_o_pedido(gate):
    d = gate.on_transcript("Ei Beto, que horas são?", now=100)
    assert d == Decision("forward", "que horas são?")


def test_wake_word_com_acento_e_maiuscula(gate):
    assert gate.on_transcript("Olá, Beto! Toca Led Zeppelin.", now=100).kind == "forward"
    assert gate.on_transcript("E AÍ BETO, bora?", now=100) == Decision("forward", "bora?")


def test_wake_word_sozinho_so_abre_a_escuta(gate):
    d = gate.on_transcript("Beto.", now=100)
    assert d.kind == "listen"
    assert gate.is_open(now=100 + 11)
    assert not gate.is_open(now=100 + 13)


def test_depois_de_responder_fica_aberto_pelo_follow_up(gate):
    gate.on_transcript("Beto, oi", now=100)
    gate.on_bot_stopped(now=105)
    assert gate.on_transcript("e amanhã?", now=105 + 8) == Decision("forward", "e amanhã?")
    gate.on_bot_stopped(now=115)
    assert gate.on_transcript("e amanhã?", now=115 + 10).kind == "ignore"


def test_enquanto_o_cerebro_responde_continua_aberto(gate):
    gate.on_transcript("Beto, me conta uma coisa", now=100)
    # 30 s depois, ainda sem on_bot_stopped: o Rodrigo voltou a falar enquanto o Beto processa.
    assert gate.on_transcript("na verdade esquece", now=130).kind == "forward"


def test_frase_de_encerramento_fecha(gate):
    gate.on_listen(now=100)
    assert gate.on_transcript("Valeu, Beto!", now=101).kind == "end"
    assert not gate.is_open(now=101)
    assert gate.on_transcript("valeu", now=101).kind == "ignore"   # fechado: "valeu" da sala não é nada


def test_encerramento_so_com_a_frase_inteira(gate):
    gate.on_listen(now=100)
    assert gate.on_transcript("valeu, mas me diz uma coisa", now=101).kind == "forward"


def test_ptt_segurado_encaminha_mesmo_fechado(gate):
    gate.on_ptt(True)
    assert gate.on_transcript("quanto gastei hoje?", now=100).kind == "forward"
    gate.on_ptt(False)
    gate.on_bot_stopped(now=100)   # fecha o turno aberto pelo forward
    assert gate.on_transcript("quanto gastei hoje?", now=100 + 10).kind == "ignore"


def test_toque_abre_a_escuta(gate):
    gate.on_listen(now=100)
    assert gate.on_transcript("toca algo do Drake", now=105) == Decision("forward", "toca algo do Drake")


def test_texto_vazio_e_ignorado(gate):
    assert gate.on_transcript("  ", now=100).kind == "ignore"


def test_palavra_que_contem_beto_nao_acorda(gate):
    assert gate.on_transcript("o betoneira quebrou", now=100).kind == "ignore"
