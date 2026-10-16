from beto_voice.ack import AckPhrases


def test_rodizio_por_tipo_e_desconhecido_vira_geral():
    a = AckPhrases({"agenda": ["A1", "A2"], "geral": ["G1"]})
    assert [a.next("agenda"), a.next("agenda"), a.next("agenda")] == ["A1", "A2", "A1"]
    assert a.next("xyz") == "G1"
