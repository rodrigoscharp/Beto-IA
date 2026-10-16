from beto_voice.latency import latency_line


def test_linha_com_todas_as_etapas():
    ttfb = [("BetoWhisperMLX#0", 0.28), ("BetoBrainLLMService#0", 0.62), ("VoiceStudioTTSService#0", 2.1)]
    assert latency_line(3.31, 0.31, ttfb, acked=False) == "[latency] total=3.31s turno=0.31s stt=0.28s brain=0.62s tts=2.10s ack=não"


def test_etapa_ausente_some_da_linha_e_ack_sim():
    assert latency_line(0.4, None, [("VoiceStudioTTSService#0", 0.05)], acked=True) == "[latency] total=0.40s tts=0.05s ack=sim"


def test_processador_desconhecido_e_ignorado():
    assert latency_line(1.0, 0.2, [("Outro#0", 9.0)], acked=False) == "[latency] total=1.00s turno=0.20s ack=não"
