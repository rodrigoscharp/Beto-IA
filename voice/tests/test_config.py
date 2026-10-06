from pathlib import Path

import pytest

from beto_voice.config import DEFAULT_PATH, DEFAULT_VOICE_ID, load_config

ENV = {"VOICE_SERVICE_TOKEN": "tok", "ELEVENLABS_API_KEY": "el"}


def test_le_o_toml_do_repositorio_com_os_padroes():
    cfg = load_config(env=ENV)
    assert cfg.turn.smart_turn_stop_secs == 2.0
    assert cfg.turn.vad_stop_secs == 0.2
    assert "Muno" in cfg.stt.vocabulary
    assert cfg.stt.engine == "mlx"
    assert cfg.brain.token == "tok"
    assert cfg.tts.api_key == "el"
    assert cfg.tts.voice_id == DEFAULT_VOICE_ID
    assert cfg.server.port == 7860


def test_env_sobrescreve_url_do_cerebro_e_voz():
    cfg = load_config(env={**ENV, "BRAIN_URL": "https://beto.example/", "ELEVENLABS_VOICE_ID": "v1"})
    assert cfg.brain.url == "https://beto.example"   # sem barra no fim
    assert cfg.tts.voice_id == "v1"


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
