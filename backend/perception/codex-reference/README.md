# Perception service

Media uploads, durable breathing jobs, signed PIC/PCA estimation with quality
gates, YOLO person/pose confirmation, critical scores, optional local speech,
and experimental terrain tools. No robot motion code lives here.

## Setup and run

From this directory, Python 3.11+ (verified here on Python 3.14):

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
# Optional model backends:
.venv/bin/python -m pip install ultralytics faster-whisper
cp .env.example .env
.venv/bin/uvicorn perception.app:app --host 0.0.0.0 --port 8080
```

Set `STDB_URI`, `STDB_DATABASE`, and the perception identity role before live
jobs can write results. Without a database, media and offline analysis work;
jobs retain results pending a database write. `GET /health` reports that state.
The HTTP polling fallback is implemented; the generated-bindings subscription
helper is not available yet. Secrets, weights, recordings, and derived media
are ignored by Git.

`STT_ENGINE=whisper_local` enables local transcription. `WHISPER_MODEL=small.en`
is the configured default; the measured smoke used `tiny.en`. Download weights
before expecting offline operation. Hosted Riva requires confirmed identifiers.

## Verification

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/smoke_person.py
.venv/bin/python scripts/smoke_stt.py --model tiny.en
```

33 tests pass, including actual synthetic video upload -> background analysis
-> breathing -> ordered score writes through a fake database -> served debug
image. Other checks cover media limits/seek, re-scans, retries, score rules,
quality gates, ROI selection, and conservative terrain fusion. Real YOLO26
detected the public torso at confidence 0.884 and rejected a blank. Local
Whisper transcribed public speech and returned an empty transcript for silence.
Saved smoke evidence is under `reports/`.

## Public data and comparison

From the repository root:

```bash
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/prepare_public_clips.py
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/make_synthetic.py --out backend/perception/codex-reference/data/synthetic
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/prepare_reference_clips.py
```

The first command verifies about 279 MB of MPSC-RR originals and prepares 16
20 s clips. Its truth.csv rates remain blank because the public release lacks
sensor labels. The synthetic command makes 15 deterministic cases. The reference
command verifies a 767 MB VRWi archive and prepares four windows with dual-belt
reference rates, following the authors' time-zero alignment assumption.
No new teammate recordings are needed for this development suite.

From this directory:

```bash
.venv/bin/python scripts/analyze_clip.py testdata/public/clips/s1_front_030s.mp4 --debug --score
.venv/bin/python -m pip install -r requirements-benchmark.txt
.venv/bin/python scripts/compare_breathing.py
```

See [methods, measured results, attribution, and limitations](../../../docs/research/breathing-repos.md)
and testdata/public/comparison-results.json for all 140 method/input runs.
On four reference windows, three rates were within 3/min and one wrong rate
had low confidence. This is a small development check, not a general accuracy
claim or proof of performance on a robot in dim rubble.

## Optional terrain

Install relevant packages from requirements-models.txt. analyze_terrain.py
runs the experimental zero-shot CLIP baseline; label_terrain.py imports
independently labelled public or team images; train_terrain.py trains a linear
probe with source/run separation and produces a confusion matrix and latency
report. It requires 50 training examples per main class and held-out critical
classes before recommending the probe. No training data or evaluation is
fabricated. Operational hints remain disabled until evaluation passes.

## Integration still required

The team module/bindings, roles, robot bridge/network, dashboard, and glasses
must be connected and checked. scripts/smoke_stdb.py --survivor-id ID performs
an explicit live write/read smoke against an existing simulator survivor.
Real-camera lighting/motion compatibility and the terrain held-out benchmark
remain unverified. No live database or hosted NVIDIA request was used to claim
local tests passed.
