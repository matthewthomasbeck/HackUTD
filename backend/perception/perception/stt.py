"""Speech to text for rescuer voice questions (docs/specs/perception.md section 12).

Engines, tried in this order at startup (from the configured one onward):

    nvidia_riva    NVIDIA Parakeet ASR hosted on build.nvidia.com, through the
                   Riva Python client (nvidia-riva-client). Needs NVIDIA_API_KEY,
                   RIVA_SERVER, and RIVA_FUNCTION_ID copied from the model's API page.
    whisper_local  faster-whisper on the laptop CPU (int8), no network.
    none           no transcript (last resort).

`select_engine()` runs each engine on a 1 s test clip and keeps the first that
works. `transcribe(path)` returns {"transcript", "confidence", "engine"}.
`router` adds POST /transcribe (synchronous; no database write).

The NVIDIA key is sent only as a Bearer token in the gRPC metadata and is
never logged: every error message is passed through `_redact` first.

Example trace: the glasses service posts a 1.4 s WAV of "is anyone else in
house 3" at 16 kHz mono. `load_audio` reads it as float32 samples (already
16 kHz, so no resampling); the active engine (say whisper_local:small.en)
returns one segment, and the endpoint answers
{"transcript": "Is anyone else in house 3?", "confidence": 0.8, "engine": "whisper_local:small.en"}.
"""

from __future__ import annotations

import logging
import math
import os
import tempfile
import threading
import time
from math import gcd

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

log = logging.getLogger("perception.stt")

SAMPLE_RATE = 16000
ENGINE_ORDER = ("nvidia_riva", "whisper_local", "none")

# Defaults. Environment variables named in the spec (STT_ENGINE, RIVA_SERVER,
# RIVA_FUNCTION_ID, WHISPER_MODEL) override these; a cfg dict passed to
# configure() overrides both.
DEFAULTS: dict = {
    "engine": "nvidia_riva",
    "riva_server": "grpc.nvcf.nvidia.com:443",
    "riva_function_id": "",
    "riva_model": "parakeet-ctc-1.1b-asr",
    "language_code": "en-US",
    "riva_timeout_s": 10.0,
    "whisper_model": "small.en",
    "whisper_beam_size": 5,
    "no_speech_max": 0.6,
    "audio_url_timeout_s": 10.0,
    "max_audio_bytes": 10 * 1024 * 1024,
}

_ENV_KEYS = {
    "engine": "STT_ENGINE",
    "riva_server": "RIVA_SERVER",
    "riva_function_id": "RIVA_FUNCTION_ID",
    "riva_model": "RIVA_MODEL",
    "whisper_model": "WHISPER_MODEL",
}

_cfg_override: dict = {}
_lock = threading.Lock()
_engine = None  # the selected engine object, or None before select_engine()


class EngineUnavailable(RuntimeError):
    """An engine cannot run (missing key, package, weights, or a failed call)."""


def configure(cfg: dict | None = None) -> None:
    """Merge a cfg dict (the [stt] section, or a whole config with one) over the defaults."""
    global _cfg_override
    if cfg and isinstance(cfg.get("stt"), dict):
        cfg = cfg["stt"]
    _cfg_override = dict(cfg or {})


def settings() -> dict:
    out = dict(DEFAULTS)
    for key, env in _ENV_KEYS.items():
        val = os.environ.get(env)
        if val:
            out[key] = val
    out.update(_cfg_override)
    return out


def _api_key() -> str:
    return os.environ.get("NVIDIA_API_KEY", "").strip()


def _redact(text: str) -> str:
    key = _api_key()
    text = str(text)
    if key:
        text = text.replace(key, "***")
    return text


# ---- audio ---------------------------------------------------------------

def load_audio(path: str) -> np.ndarray:
    """Read any soundfile-supported file as float32 mono at 16 kHz."""
    import soundfile as sf

    data, rate = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if rate != SAMPLE_RATE:
        from scipy.signal import resample_poly

        g = gcd(int(rate), SAMPLE_RATE)
        mono = resample_poly(mono, SAMPLE_RATE // g, int(rate) // g).astype(np.float32)
    return np.ascontiguousarray(mono, dtype=np.float32)


def to_pcm16(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def probe_clip(seconds: float = 1.0) -> np.ndarray:
    """A quiet 1 s clip used to check that an engine runs at all."""
    n = int(SAMPLE_RATE * seconds)
    rng = np.random.default_rng(0)
    return (rng.standard_normal(n) * 1e-3).astype(np.float32)


# ---- engines -------------------------------------------------------------

class NoneEngine:
    kind = "none"

    def __init__(self, cfg: dict):
        self.name = "none"

    def run(self, samples: np.ndarray) -> tuple[str, float]:
        return "", 0.0


class WhisperEngine:
    kind = "whisper_local"

    def __init__(self, cfg: dict):
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise EngineUnavailable(f"faster-whisper not installed: {exc}") from exc
        size = cfg["whisper_model"]
        self.name = f"whisper_local:{size}"
        self.beam_size = int(cfg["whisper_beam_size"])
        self.no_speech_max = float(cfg["no_speech_max"])
        try:
            self.model = WhisperModel(size, device="cpu", compute_type="int8")
        except Exception as exc:  # download or load failure
            raise EngineUnavailable(f"whisper model {size} failed to load: {exc}") from exc
        self._lock = threading.Lock()

    def run(self, samples: np.ndarray) -> tuple[str, float]:
        with self._lock:
            segments, _info = self.model.transcribe(
                samples,
                beam_size=self.beam_size,
                language="en",
                vad_filter=True,  # drops silence, so silence gives an empty transcript
                condition_on_previous_text=False,
            )
            segments = list(segments)
        texts, weights, probs = [], [], []
        for seg in segments:
            text = seg.text.strip()
            if not text or seg.no_speech_prob > self.no_speech_max:
                continue
            texts.append(text)
            weights.append(max(1e-3, seg.end - seg.start))
            probs.append(math.exp(seg.avg_logprob))
        if not texts:
            return "", 0.0
        conf = float(np.average(probs, weights=weights))
        return " ".join(texts), round(min(1.0, max(0.0, conf)), 2)


class RivaEngine:
    kind = "nvidia_riva"

    def __init__(self, cfg: dict):
        key = _api_key()
        if not key:
            raise EngineUnavailable("NVIDIA_API_KEY is not set")
        if not cfg["riva_function_id"]:
            raise EngineUnavailable("RIVA_FUNCTION_ID is not set (copy it from the model's API page)")
        if not cfg["riva_server"]:
            raise EngineUnavailable("RIVA_SERVER is not set")
        try:
            import riva.client  # nvidia-riva-client
        except ImportError as exc:
            raise EngineUnavailable(f"nvidia-riva-client not installed: {exc}") from exc
        self.riva = riva.client
        self.name = f"nvidia_riva:{cfg['riva_model']}"
        self.language_code = cfg["language_code"]
        self.timeout_s = float(cfg["riva_timeout_s"])
        try:
            auth = riva.client.Auth(
                uri=cfg["riva_server"],
                use_ssl=True,
                metadata_args=[
                    ["function-id", cfg["riva_function_id"]],
                    ["authorization", f"Bearer {key}"],
                ],
            )
            self.asr = riva.client.ASRService(auth)
        except Exception as exc:
            raise EngineUnavailable(_redact(f"riva connection failed: {type(exc).__name__}: {exc}")) from None

    def run(self, samples: np.ndarray) -> tuple[str, float]:
        rc = self.riva
        config = rc.RecognitionConfig(
            encoding=rc.AudioEncoding.LINEAR_PCM,
            sample_rate_hertz=SAMPLE_RATE,
            audio_channel_count=1,
            language_code=self.language_code,
            max_alternatives=1,
            enable_automatic_punctuation=True,
        )
        try:
            resp = self.asr.offline_recognize(to_pcm16(samples), config)
        except Exception as exc:
            raise EngineUnavailable(_redact(f"riva call failed: {type(exc).__name__}: {exc}")) from None
        texts, confs = [], []
        for result in resp.results:
            if not result.alternatives:
                continue
            alt = result.alternatives[0]
            if alt.transcript.strip():
                texts.append(alt.transcript.strip())
                confs.append(float(alt.confidence))
        if not texts:
            return "", 0.0
        return " ".join(texts), round(min(1.0, max(0.0, float(np.mean(confs)))), 2)


_ENGINE_CLASSES = {"nvidia_riva": RivaEngine, "whisper_local": WhisperEngine, "none": NoneEngine}


def _candidates(first: str) -> list[str]:
    if first not in ENGINE_ORDER:
        log.warning("unknown STT_ENGINE %r, using the default order", first)
        first = ENGINE_ORDER[0]
    return list(ENGINE_ORDER[ENGINE_ORDER.index(first):])


def select_engine(cfg: dict | None = None) -> str:
    """Pick the engine at startup: each candidate must transcribe a 1 s test clip.

    Falls back in the order nvidia_riva, whisper_local, none, starting at the
    configured engine. Returns the active engine name.
    """
    global _engine
    if cfg is not None:
        configure(cfg)
    s = settings()
    clip = probe_clip()
    with _lock:
        for kind in _candidates(s["engine"]):
            t0 = time.perf_counter()
            try:
                engine = _ENGINE_CLASSES[kind](s)
                engine.run(clip)
            except Exception as exc:
                log.warning("stt engine %s unavailable: %s", kind, _redact(exc))
                continue
            _engine = engine
            log.info("stt engine %s ready in %.0f ms", engine.name, 1000 * (time.perf_counter() - t0))
            return engine.name
    _engine = NoneEngine(s)  # unreachable in practice: NoneEngine never fails
    return _engine.name


def engine_name() -> str:
    """The active engine string for GET /health and each result ("none" before selection)."""
    return _engine.name if _engine is not None else "none"


def transcribe(path: str) -> dict:
    """Transcribe one audio file with the active engine.

    On a runtime failure of a hosted engine, the request falls through to the
    next engine in order, and the result's `engine` names the one that answered.
    """
    global _engine
    if _engine is None:
        select_engine()
    samples = load_audio(path)
    engine = _engine
    while True:
        try:
            text, conf = engine.run(samples)
            return {"transcript": text, "confidence": conf, "engine": engine.name}
        except Exception as exc:
            log.warning("stt engine %s failed on a request: %s", engine.name, _redact(exc))
            nxt = _next_engine(engine.kind)
            if nxt is None:
                return {"transcript": "", "confidence": 0.0, "engine": "none"}
            with _lock:
                if _engine is engine:
                    _engine = nxt
            engine = nxt


def _next_engine(kind: str):
    s = settings()
    order = list(ENGINE_ORDER)
    for nxt in order[order.index(kind) + 1:]:
        try:
            return _ENGINE_CLASSES[nxt](s)
        except Exception as exc:
            log.warning("stt engine %s unavailable: %s", nxt, _redact(exc))
    return None


def whisper_weights_available(size: str | None = None) -> bool:
    """True when the faster-whisper weights are in the local cache (no download)."""
    try:
        from faster_whisper.utils import download_model
    except ImportError:
        return False
    try:
        download_model(size or settings()["whisper_model"], local_files_only=True)
        return True
    except Exception:
        return False


# ---- HTTP ----------------------------------------------------------------

def _fetch_url(url: str, limit: int, timeout: float) -> bytes:
    import httpx

    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("audio_url must be http or https")
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            chunks, total = [], 0
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > limit:
                    raise ValueError("audio too large")
                chunks.append(chunk)
    return b"".join(chunks)


def _build_router():
    r = APIRouter()

    @r.post("/transcribe")
    def transcribe_endpoint(
        file: UploadFile | None = File(None),
        audio_url: str | None = Form(None),
        rescuer: str | None = Form(None),
    ):
        s = settings()
        limit = int(s["max_audio_bytes"])
        t0 = time.perf_counter()
        if file is not None:
            data = file.file.read(limit + 1)
            if len(data) > limit:
                raise HTTPException(413, "audio too large")
        elif audio_url:
            try:
                data = _fetch_url(audio_url, limit, float(s["audio_url_timeout_s"]))
            except Exception as exc:
                raise HTTPException(400, f"could not fetch audio_url: {type(exc).__name__}") from None
        else:
            raise HTTPException(400, "send a file or an audio_url")
        if not data:
            raise HTTPException(400, "empty audio")

        fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="stt_")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            try:
                result = transcribe(tmp)
            except Exception as exc:
                raise HTTPException(400, f"could not read audio: {type(exc).__name__}") from None
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
        log.info(
            "transcribe rescuer=%s engine=%s chars=%d in %.0f ms",
            rescuer or "-",
            result["engine"],
            len(result["transcript"]),
            1000 * (time.perf_counter() - t0),
        )
        return result

    return r


router = _build_router()
