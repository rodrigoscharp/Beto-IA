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


# ── modo contínuo, início da fala e hesitação ──────────────────────────────

def contínuo(**kw):
    return ConversationGate(wake_words=["beto"], end_phrases=["tchau", "valeu"], follow_up_secs=9, listen_secs=12,
                            continuous=kw.get("continuous", True), idle_close_secs=60, hold_phrases=["hmm", "peraí", "deixa eu pensar"])


def test_fala_comecada_na_janela_e_aceita_mesmo_transcrita_depois(gate):
    gate.on_transcript("Beto, oi", now=100); gate.on_bot_stopped(now=101)
    gate.on_user_started(now=108)                       # janela aberta até 110
    assert gate.on_transcript("e amanhã?", now=114) == Decision("forward", "e amanhã?")


def test_fala_comecada_com_a_janela_fechada_continua_ignorada(gate):
    gate.on_transcript("Beto, oi", now=100); gate.on_bot_stopped(now=101)
    gate.on_user_started(now=111)
    assert gate.on_transcript("e amanhã?", now=114).kind == "ignore"


def test_modo_continuo_fica_aberto_ate_o_tempo_ocioso():
    g = contínuo()
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    assert g.is_open(now=160) and not g.is_open(now=162)


def test_desligado_volta_aos_9s():
    g = contínuo(continuous=False)
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    assert g.is_open(now=109) and not g.is_open(now=111)


def test_hesitacao_nao_vai_ao_cerebro_e_renova_a_janela():
    g = contínuo()
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    assert g.on_transcript("Hmm...", now=150).kind == "hold"
    assert g.on_transcript("Deixa eu pensar, Beto", now=155).kind == "hold"
    assert g.is_open(now=214)


def test_beto_perai_com_gate_fechado_so_abre_a_escuta():
    g = contínuo()
    assert g.on_transcript("Beto, peraí", now=100).kind == "listen"


def test_fala_na_janela_que_termina_em_tchau_encerra():
    g = contínuo()
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    g.on_user_started(now=150)
    assert g.on_transcript("tchau Beto", now=152).kind == "end"
    assert not g.is_open(now=153)


def test_barge_in_com_hesitacao_mantem_aberto_no_continuo():
    g = contínuo()
    g.on_transcript("Beto, me explica kafka", now=100)   # turno aberto enquanto ele fala
    assert g.on_transcript("peraí", now=105).kind == "hold"
    # Sem on_bot_stopped antes da checagem: só a renovação da hesitação segura a janela (o turno aberto não conta).
    g._turn_open = False
    assert g.is_open(now=164.9) and not g.is_open(now=165.1)


def test_hesitacao_com_gate_fechado_e_ignorada():
    g = contínuo()
    assert g.on_transcript("hmm", now=100).kind == "ignore"


def test_hesitacao_so_vale_com_a_frase_inteira():
    g = contínuo()
    g.on_transcript("Beto, oi", now=100); g.on_bot_stopped(now=101)
    assert g.on_transcript("hmm, toca Drake", now=102).kind == "forward"


# ── marca de fala começada com a janela aberta ─────────────────────────────

def test_segundo_segmento_do_vad_nao_apaga_a_marca(gate):
    gate.on_transcript("Beto, oi", now=100); gate.on_bot_stopped(now=101)   # janela até 110
    gate.on_user_started(now=108)
    gate.on_user_started(now=110.4)                     # pausa curta: 2º segmento com a janela já fechada
    assert gate.on_transcript("e amanhã", now=110.6) == Decision("forward", "e amanhã")
    assert gate.on_transcript("de manhã", now=113) == Decision("forward", "de manhã")   # turno aberto pela primeira


def test_marca_velha_nao_vale(gate):
    gate.on_transcript("Beto, oi", now=100); gate.on_bot_stopped(now=101)
    gate.on_user_started(now=108)
    assert gate.on_transcript("e amanhã", now=125).kind == "ignore"


def test_close_limpa_a_marca(gate):
    gate.on_transcript("Beto, oi", now=100); gate.on_bot_stopped(now=101)
    gate.on_user_started(now=108)
    gate.close()
    assert gate.on_transcript("e amanhã", now=112).kind == "ignore"


def test_accepting_vale_pela_marca(gate):
    gate.on_transcript("Beto, oi", now=100); gate.on_bot_stopped(now=101)
    assert not gate.accepting(now=112)
    gate.on_user_started(now=108)
    assert gate.accepting(now=112) and not gate.is_open(now=112)
    assert not gate.accepting(now=118.1)
