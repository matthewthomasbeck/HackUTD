"""Public faster-whisper fixture -> local ASR and silence check, no recordings.

Install faster-whisper first. Run from backend/perception:
python scripts/smoke_stt.py --model tiny.en
The first run downloads model weights; later runs can work offline.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import numpy as np
import soundfile as sf
from perception.config import Config
from perception.stt import SpeechToText

REVISION = "846467d436117e44d54ad74f555d85c75834edb0"
URL = f"https://raw.githubusercontent.com/SYSTRAN/faster-whisper/{REVISION}/tests/data/jfk.flac"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model",default="tiny.en")
    args = parser.parse_args()
    folder = ROOT / "data" / "stt-smoke"
    folder.mkdir(parents=True,exist_ok=True)
    source = folder / "jfk.flac"
    if not source.exists():
        source.write_bytes(urllib.request.urlopen(URL,timeout=30).read())
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(source),
        "-t","8","-ar","16000","-ac","1",str(folder/"speech.wav")],check=True)
    sf.write(folder/"silence.wav",np.zeros(32000),16000,subtype="PCM_16")
    asr = SpeechToText(Config(stt_engine="whisper_local",whisper_model=args.model))
    start = time.monotonic()
    engine = asr.initialize()
    if engine == "none":
        raise SystemExit("Whisper could not initialize; install requirements-models.txt and check model access")
    report = {"engine":engine,"startup_s":round(time.monotonic()-start,3),
        "source":{"url":URL,"revision":REVISION,"sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
                  "transformation":"first 8 seconds, 16 kHz mono WAV"}}
    for key in ("speech","silence"):
        start = time.monotonic()
        report[key] = {**asr.transcribe(folder/(key+".wav")),"seconds":round(time.monotonic()-start,3)}
    assert report["speech"]["transcript"],"public speech produced no transcript"
    assert not report["silence"]["transcript"],"silence produced a transcript"
    (folder/"result.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))


if __name__ == "__main__":
    main()
