"""Optional local Whisper or configured Riva ASR, with an explicit no-engine fallback."""
import io
import math
import tempfile
import wave
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly


def read_audio(path):
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    if len(audio)/sample_rate > 8.1:
        raise ValueError("voice recording must be at most 8 seconds")
    mono = audio.mean(axis=1)
    if sample_rate != 16000:
        divisor = math.gcd(sample_rate,16000)
        mono = resample_poly(mono,16000//divisor,sample_rate//divisor)
    return mono.astype("float32")


class SpeechToText:
    def __init__(self, config):
        self.config, self.engine, self.model = config,"none",None

    def initialize(self):
        engines = {"nvidia_riva":["nvidia_riva","whisper_local"],
                   "whisper_local":["whisper_local"],"none":[]}.get(self.config.stt_engine,[])
        for engine in engines:
            try:
                if engine == "whisper_local":
                    from faster_whisper import WhisperModel
                    self.model = WhisperModel(self.config.whisper_model,device="cpu",compute_type="int8")
                    segments,_ = self.model.transcribe(np.zeros(16000,dtype="float32"),language="en")
                    list(segments)
                    self.engine = "whisper_local:"+self.config.whisper_model
                else:
                    self._riva(np.zeros(16000,dtype="float32"))
                    self.engine = "nvidia_riva:"+self.config.riva_model
                return self.engine
            except Exception:
                self.model = None
        self.engine = "none"
        return self.engine

    def _riva(self,audio):
        cfg = self.config
        if not all((cfg.riva_server,cfg.riva_function_id,cfg.riva_model,cfg.nvidia_api_key)):
            raise ValueError("Riva configuration incomplete")
        import riva.client
        auth = riva.client.Auth(uri=cfg.riva_server,use_ssl=True,metadata_args=[
            ["function-id",cfg.riva_function_id],["authorization","Bearer "+cfg.nvidia_api_key]])
        service = riva.client.ASRService(auth)
        recognition = riva.client.RecognitionConfig(
            encoding=riva.client.AudioEncoding.LINEAR_PCM,sample_rate_hertz=16000,
            language_code="en-US",max_alternatives=1,enable_automatic_punctuation=True)
        pcm = (np.clip(audio,-1,1)*32767).astype("<i2").tobytes()
        response = service.offline_recognize(pcm,recognition)
        alternatives = [result.alternatives[0] for result in response.results if result.alternatives]
        return {"transcript":" ".join(a.transcript for a in alternatives).strip(),
                "confidence":float(np.mean([a.confidence for a in alternatives])) if alternatives else 0}

    def transcribe(self,path):
        audio = read_audio(path)
        if self.engine == "none" or len(audio) == 0 or float(np.max(np.abs(audio))) < 0.0001:
            return {"transcript":"", "confidence":0.0, "engine":self.engine}
        if self.engine.startswith("nvidia_riva:"):
            try:
                result = self._riva(audio)
                return {**result,"engine":self.engine}
            except Exception:
                # Choose the configured local fallback after a hosted failure.
                self.config.stt_engine = "whisper_local"
                self.initialize()
                return self.transcribe(path)
        segments,_ = self.model.transcribe(audio,language="en",beam_size=1,vad_filter=True)
        segments = list(segments)
        return {"transcript":" ".join(s.text.strip() for s in segments).strip(),
            "confidence":round(float(np.mean([math.exp(s.avg_logprob) for s in segments])),3) if segments else 0.0,
            "engine":self.engine}
