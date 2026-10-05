import pytest

from beto_voice.reply_filter import Action, Emotion, ReplyFilter, Text


def run(text: str, n: int = 1000):
    f = ReplyFilter()
    out = []
    for i in range(0, len(text), n):
        out.extend(f.push(text[i : i + n]))
    out.extend(f.finish())
    return out


def spoken(events) -> str:
    return "".join(e.text for e in events if isinstance(e, Text))


def test_emocao_na_frente_vira_evento_e_sai_do_texto():
    ev = run("[emo:alegre] Fechou, chefe. Tudo certo.")
    assert ev[0] == Emotion("alegre")
    assert spoken(ev).strip() == "Fechou, chefe. Tudo certo."


def test_emocao_no_meio_sai_e_so_a_primeira_valida_conta():
    ev = run("[emo:neutro] Poxa.[emo:triste] Mas segue.")
    assert [e for e in ev if isinstance(e, Emotion)] == [Emotion("neutro")]
    assert spoken(ev).strip() == "Poxa. Mas segue."


def test_emocao_invalida_some_sem_evento():
    ev = run("[emo:feliz] Oi.")
    assert not [e for e in ev if isinstance(e, Emotion)]
    assert spoken(ev).strip() == "Oi."


def test_tag_de_acao_inteira_vira_action():
    ev = run('[emo:neutro] [SPOTIFY:{"action":"play","query":"Led Zeppelin"}] Claro.')
    assert Action("SPOTIFY", {"action": "play", "query": "Led Zeppelin"}) in ev
    assert spoken(ev).strip() == "Claro."


@pytest.mark.parametrize("n", [1, 2, 3, 5, 7, 11, 40])
def test_resultado_igual_qualquer_tamanho_de_pedaco(n):
    text = '[emo:animado] [TIMER:{"action":"start","minutes":25,"label":"Foco"}] Bora, chefe. Vinte e cinco minutos.'
    base = run(text)
    signals = lambda ev: [e for e in ev if not isinstance(e, Text)]
    assert spoken(run(text, n)) == spoken(base), f"n={n}"
    assert signals(run(text, n)) == signals(base), f"n={n}"
    assert Action("TIMER", {"action": "start", "minutes": 25, "label": "Foco"}) in base
    assert spoken(base).strip() == "Bora, chefe. Vinte e cinco minutos."


def test_json_invalido_na_tag_some_sem_action():
    ev = run("[GMAIL:{action:summary}] Verificando.")
    assert not [e for e in ev if isinstance(e, Action)]
    assert spoken(ev).strip() == "Verificando."


def test_colchete_comum_e_texto():
    ev = run("[emo:neutro] [1] é a opção certa, [2] não.")
    assert spoken(ev).strip() == "[1] é a opção certa, [2] não."


def test_needtools_nunca_e_falado():
    ev = run("[emo:neutro] [NEEDTOOLS]")
    assert spoken(ev).strip() == ""


def test_texto_sai_frase_a_frase_sem_esperar_o_fim():
    f = ReplyFilter()
    ev = f.push("[emo:neutro] Primeira frase. Segunda")
    assert spoken(ev) == " Primeira frase. Segunda"


def test_colchete_sem_fechar_que_nao_e_tag_sai_como_texto():
    f = ReplyFilter()
    ev = f.push("Veja [isso aqui é longo demais para ser tag")
    assert spoken(ev).startswith("Veja [isso")


def test_tag_de_acao_cortada_no_fim_nao_e_falada():
    ev = run('[emo:neutro] Ok. [SPOTIFY:{"action":"pl')
    assert spoken(ev).strip() == "Ok."
    assert not [e for e in ev if isinstance(e, Action)]


def test_json_com_colchete_dentro():
    ev = run('[CALENDAR:{"attendees":["a@x.com"],"title":"Reunião"}] Marcado.')
    assert Action("CALENDAR", {"attendees": ["a@x.com"], "title": "Reunião"}) in ev
    assert spoken(ev).strip() == "Marcado."
