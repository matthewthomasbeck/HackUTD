"""Tests for perception.stt (docs/specs/perception.md section 12.4)."""

import logging
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI
from fastapi.testclient import TestClient

from perception import stt

VOICE = Path(__file__).resolve().parent.parent / "testdata" / "voice"
QUESTION = VOICE / "is_anyone_else_in_house_3.wav"
SILENCE = VOICE / "silence_2s.wav"
FAKE_KEY = "nvapi-test-not-a-real-key-0000"

needs_whisper = pytest.mark.skipif(
    not stt.whisper_weights_available("small.en"),
    reason="faster-whisper small.en weights not downloaded",
)


@pytest.fixture(autouse=True)
def fresh_engine(monkeypatch):
    for env in ("STT_ENGINE", "NVIDIA_API_KEY", "RIVA_SERVER", "RIVA_FUNCTION_ID", "RIVA_MODEL", "WHISPER_MODEL"):
        monkeypatch.delenv(env, raising=False)
    stt.configure(None)
    monkeypatch.setattr(stt, "_engine", None)
    yield
    stt.configure(None)


class FakeEngine:
    kind = "nvidia_riva"

    def __init__(self, text="is anyone else in house 3", fail=False, name="nvidia_riva:fake"):
        self.text, self.fail, self.name = text, fail, name

    def run(self, samples):
        if self.fail:
            raise RuntimeError("boom")
        return self.text, 0.71


def client():
    app = FastAPI()
    app.include_router(stt.router)
    return TestClient(app)


# ---- audio ---------------------------------------------------------------

def test_testdata_is_16k_mono_16bit():
    for path in (QUESTION, SILENCE):
        info = sf.info(str(path))
        assert info.samplerate == 16000 and info.channels == 1 and info.subtype == "PCM_16"
    assert sf.info(str(SILENCE)).duration == pytest.approx(2.0)


def test_load_audio_resamples_to_16k_mono(tmp_path):
    t = np.arange(48000) / 48000.0
    tone = 0.5 * np.sin(2 * np.pi * 440 * t)
    stereo = np.stack([tone, tone], axis=1)
    path = tmp_path / "stereo48k.wav"
    sf.write(str(path), stereo, 48000, subtype="PCM_16")
    out = stt.load_audio(str(path))
    assert out.ndim == 1 and out.dtype == np.float32
    assert len(out) == 16000


def test_pcm16_roundtrip():
    pcm = stt.to_pcm16(np.array([0.0, 1.0, -1.0, 2.0], dtype=np.float32))
    assert np.frombuffer(pcm, "<i2").tolist() == [0, 32767, -32767, 32767]


# ---- engine selection ----------------------------------------------------

def test_riva_needs_key():
    with pytest.raises(stt.EngineUnavailable, match="NVIDIA_API_KEY"):
        stt.RivaEngine(stt.settings())


def test_riva_needs_function_id(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", FAKE_KEY)
    with pytest.raises(stt.EngineUnavailable, match="RIVA_FUNCTION_ID") as err:
        stt.RivaEngine(stt.settings())
    assert FAKE_KEY not in str(err.value)


def test_fallback_without_key_never_logs_key(monkeypatch, caplog):
    monkeypatch.setenv("NVIDIA_API_KEY", FAKE_KEY)

    class NoWhisper:
        kind = "whisper_local"

        def __init__(self, cfg):
            raise stt.EngineUnavailable(f"no weights (key would be {FAKE_KEY})")

    monkeypatch.setitem(stt._ENGINE_CLASSES, "whisper_local", NoWhisper)
    with caplog.at_level(logging.DEBUG, logger="perception.stt"):
        name = stt.select_engine()
    assert name == "none"
    assert stt.engine_name() == "none"
    assert FAKE_KEY not in caplog.text
    assert "***" in caplog.text


def test_configured_engine_starts_the_order(monkeypatch):
    monkeypatch.setenv("STT_ENGINE", "none")
    assert stt.select_engine() == "none"


def test_engine_name_before_selection():
    assert stt.engine_name() == "none"


def test_runtime_failure_falls_through(monkeypatch):
    monkeypatch.setattr(stt, "_engine", FakeEngine(fail=True))
    monkeypatch.setattr(stt, "_next_engine", lambda kind: FakeEngine("hello", name="whisper_local:fake"))
    out = stt.transcribe(str(QUESTION))
    assert out == {"transcript": "hello", "confidence": 0.71, "engine": "whisper_local:fake"}
    assert stt.engine_name() == "whisper_local:fake"


# ---- POST /transcribe ----------------------------------------------------

def test_endpoint_file(monkeypatch):
    monkeypatch.setattr(stt, "_engine", FakeEngine())
    with open(QUESTION, "rb") as fh:
        resp = client().post("/transcribe", files={"file": ("q.wav", fh, "audio/wav")}, data={"rescuer": "Ana"})
    assert resp.status_code == 200
    assert resp.json() == {"transcript": "is anyone else in house 3", "confidence": 0.71, "engine": "nvidia_riva:fake"}


def test_endpoint_audio_url(monkeypatch):
    monkeypatch.setattr(stt, "_engine", FakeEngine())
    monkeypatch.setattr(stt, "_fetch_url", lambda url, limit, timeout: QUESTION.read_bytes())
    resp = client().post("/transcribe", data={"audio_url": "http://localhost:8080/media/x.wav"})
    assert resp.status_code == 200
    assert resp.json()["transcript"]


def test_endpoint_needs_input():
    assert client().post("/transcribe", data={}).status_code == 400


def test_endpoint_rejects_non_audio(monkeypatch):
    monkeypatch.setattr(stt, "_engine", FakeEngine())
    resp = client().post("/transcribe", files={"file": ("q.wav", b"not audio", "audio/wav")})
    assert resp.status_code == 400


def test_endpoint_rejects_bad_url_scheme(monkeypatch):
    monkeypatch.setattr(stt, "_engine", FakeEngine())
    resp = client().post("/transcribe", data={"audio_url": "file:///etc/passwd"})
    assert resp.status_code == 400


# ---- whisper_local on the recorded WAVs (needs downloaded weights) --------

@pytest.fixture(scope="module")
def whisper_engine():
    return stt.WhisperEngine(dict(stt.DEFAULTS, whisper_model="small.en"))


@needs_whisper
def test_whisper_question_transcribes(whisper_engine, monkeypatch):
    monkeypatch.setattr(stt, "_engine", whisper_engine)
    t0 = time.perf_counter()
    out = stt.transcribe(str(QUESTION))
    elapsed = time.perf_counter() - t0
    print(f"\nwhisper_local small.en: {elapsed * 1000:.0f} ms -> {out}")
    assert out["engine"] == "whisper_local:small.en"
    assert out["transcript"].strip()
    assert "house" in out["transcript"].lower()
    assert 0.0 < out["confidence"] <= 1.0
    assert elapsed < 10.0


@needs_whisper
def test_whisper_silence_is_empty(whisper_engine, monkeypatch):
    monkeypatch.setattr(stt, "_engine", whisper_engine)
    out = stt.transcribe(str(SILENCE))
    assert out["transcript"] == ""
    assert out["confidence"] == 0.0


@needs_whisper
def test_select_engine_falls_back_to_whisper():
    # no NVIDIA key on this machine: nvidia_riva must fail cleanly
    assert stt.select_engine() == "whisper_local:small.en"
