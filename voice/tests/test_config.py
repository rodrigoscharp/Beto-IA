from pathlib import Path

import pytest

from beto_voice.config import DEFAULT_PATH, load_config

ENV = {"VOICE_SERVICE_TOKEN": "tok"}


def test_le_o_toml_do_repositorio_com_os_padroes():
    cfg = load_config(env=ENV)
    assert cfg.turn.smart_turn_stop_secs == 2.0
    assert cfg.turn.vad_stop_secs == 0.2
    assert "Muno" in cfg.stt.vocabulary
    assert cfg.stt.engine == "mlx"
    assert cfg.brain.token == "tok"
    assert (cfg.tts.url, cfg.tts.voice, cfg.tts.num_step) == ("http://127.0.0.1:3900", "Beto", 8)
    assert cfg.server.port == 7860


def test_env_sobrescreve_url_do_cerebro_e_da_voz():
    cfg = load_config(env={**ENV, "BRAIN_URL": "https://beto.example/", "VOICESTUDIO_URL": "http://x:9/"})
    assert cfg.brain.url == "https://beto.example"   # sem barra no fim
    assert cfg.tts.url == "http://x:9"


def test_initial_prompt_junta_vocabulario_e_texto_livre():
    cfg = load_config(env=ENV)
    text = cfg.stt.initial_prompt_text()
    assert text.startswith("MyHub, Beto, Muno")
    assert text.endswith(cfg.stt.initial_prompt)


def test_secao_faltando_da_erro_com_o_nome(tmp_path: Path):
    p = tmp_path / "c.toml"
    p.write_text('[brain]\nurl="x"\n')
    with pytest.raises(ValueError, match=r"\[stt\]"):
        load_config(p, env=ENV)


def test_chave_desconhecida_da_erro(tmp_path: Path):
    base = DEFAULT_PATH.read_text()
    p = tmp_path / "c.toml"
    p.write_text(base.replace("[turn]\n", "[turn]\nvad_stop_sec = 1\n"))
    with pytest.raises(ValueError, match="vad_stop_sec"):
        load_config(p, env=ENV)


def test_engine_invalido_da_erro(tmp_path: Path):
    base = DEFAULT_PATH.read_text()
    p = tmp_path / "c.toml"
    p.write_text(base.replace('engine = "mlx"', 'engine = "cloud"'))
    with pytest.raises(ValueError, match="engine"):
        load_config(p, env=ENV)


def write_toml(tmp_path: Path, turn_extra: str = "", ack: str | None = None) -> Path:
    """TOML mínimo válido; ``ack`` (se vier) vira o corpo da seção [ack]."""
    text = (
        '[brain]\nurl = "x"\n[stt]\n[turn]\n' + turn_extra + "\n[tts]\n[server]\n"
        + (f"[ack]\n{ack}\n" if ack is not None else "")
    )
    p = tmp_path / "c.toml"
    p.write_text(text)
    return p


def test_padroes_novos_do_turno_e_do_ack(tmp_path):
    cfg = load_config(write_toml(tmp_path), env={})
    assert cfg.turn.continuous is True
    assert cfg.turn.idle_close_secs == 60
    assert "deixa eu pensar" in cfg.turn.hold_phrases
    assert cfg.ack.phrases()["agenda"][0] == "Deixa eu ver a agenda."
    assert set(cfg.ack.phrases()) == {"conteudo", "agenda", "myhub", "memoria", "geral"}
    assert all(len(f.split()) <= 7 and "chefe" not in f.lower() for f in cfg.ack.all())


def test_ack_all_nao_repete_e_mantem_a_ordem(tmp_path):
    cfg = load_config(write_toml(tmp_path), env={})
    frases = cfg.ack.all()
    assert len(frases) == len(set(frases))
    assert frases[0] == "Deixa eu abrir o roteiro."
    assert frases.count("Um segundo.") == 1


def test_idle_close_e_ack_vazio_sao_erro(tmp_path):
    with pytest.raises(ValueError, match="idle_close_secs"):
        load_config(write_toml(tmp_path, turn_extra="idle_close_secs = 0"), env={})
    with pytest.raises(ValueError, match=r"\[ack\]"):
        load_config(write_toml(tmp_path, ack="agenda = []"), env={})


def test_ack_do_toml_substitui_so_a_chave_informada(tmp_path):
    cfg = load_config(write_toml(tmp_path, ack='agenda = ["Olhando."]'), env={})
    assert cfg.ack.phrases()["agenda"] == ["Olhando."]
    assert cfg.ack.phrases()["geral"][0] == "Um segundo."


def test_toml_do_repo_nao_encerra_com_beleza_nem_fechou():
    cfg = load_config(env={})
    assert "beleza" not in cfg.turn.end_phrases and "fechou" not in cfg.turn.end_phrases
