# Perception service

Media server, breathing check, critical score, and SpacetimeDB writes for the rubble search robot.
The full spec is `docs/specs/perception.md`; the shared names are in `docs/specs/CONTRACTS.md`.
Owner: Eric Lee.

## Setup

```bash
cd backend/perception
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env        # then fill in PUBLIC_BASE_URL with the laptop LAN IP
```

Never commit `.env` or `data/identity.json` (both are git-ignored).
`requirements.lock` pins the working primary environment (2026-11-08, Python 3.12, macOS arm64).
To reproduce it exactly, use `pip install -r requirements.lock` instead of `requirements.txt`.
After changing dependencies, rerun the tests and regenerate it with `pip freeze`.

## Run

```bash
uvicorn perception.app:app --host 0.0.0.0 --port 8080
pytest -q
python scripts/smoke_stdb.py     # once the SpacetimeDB module is published
```

Bind `0.0.0.0` so the Pi can reach the laptop over the team hotspot, and allow Python through the macOS firewall prompt.

Quick check:

```bash
curl -F file=@photo.jpg -F kind=camera -F robot_id=dog1 http://localhost:8080/media
curl -F file=@clip.mp4 -F survivor_id=1 http://localhost:8080/breathing
curl http://localhost:8080/health
```

## Config

`config.toml` holds every section (`server`, `paths`, `media`, `stdb`, `breathing`, `evm`, `score`, `terrain`, `stt`).
`perception.config.load_config()` reads it, then `.env` (the names in `.env.example`), then `PERCEPTION_<SECTION>_<KEY>` overrides, for example `PERCEPTION_SCORE_RR_HIGH=32`.
The `[breathing]` and `[score]` values are the spec defaults and are untuned.

## Endpoints

| Endpoint | What |
| --- | --- |
| `POST /media` | multipart `file`, optional `run_id`, `robot_id`, `detection_id`, `kind`; returns `{"url"}`; 415 bad extension, 413 over 200 MB |
| `GET /media/<name>` | serves a stored file; 400 for a name outside `^[A-Za-z0-9_.-]+$`, 404 if unknown |
| `POST /breathing` | `file` or `clip_url`, `survivor_id`, optional `detection_id`, `robot_id`, `roi` (`x,y,w,h`), `fps`; returns 202 `{"job_id","clip_url","status":"queued"}` |
| `GET /breathing/<job_id>` | job record and result |
| `GET /breathing/detection/<id>` | latest result for a detection, with `roi_image_url` and the PROPOSED person check fields `person_image_url`, `person_confirmed`, `person_conf` |
| `GET /breathing/survivor/<id>` | latest result for a survivor |
| `GET /health` | `ok`, `stdb`, `queue`, `yolo`, `helper`, `stt` |
| `POST /transcribe` | from `perception/stt.py`, included when that file exists |
| `POST /terrain`, `GET /terrain/latest` | from `perception/terrain.py`, included when that file exists |

## Files

| File | What |
| --- | --- |
| `perception/app.py` | FastAPI app; starts the worker, watcher, and re-score timer on startup |
| `perception/config.py` | config loading |
| `perception/media.py` | storage, naming, index; `save_bytes()` and `register_file()` for other modules |
| `perception/store.py` | SQLite at `data/perception.db` |
| `perception/stdb.py` | SpacetimeDB HTTP client, SATS-JSON encoding, SQL row decoder |
| `perception/worker.py` | one background thread: breathing jobs, person checks, writes, pending write retry |
| `perception/watcher.py` | detection rows from the helper or HTTP SQL polling every 2 s; 60 s re-score timer |
| `stdb-helper/` | Node.js subscription helper (read only) |
| `scripts/smoke_stdb.py` | SpacetimeDB smoke test |

`breathing.py`, `roi.py`, `score.py`, `stt.py`, `terrain.py`, and `video.py` are written separately.
The service imports them only when needed, so it starts without them: a breathing job fails with `breathing module not installed`, `set_critical_score` is skipped without `score.py`, and `/health` shows `yolo: missing`.

## Local transcription evaluation (2026-11-08)

Run `.venv/bin/python scripts/evaluate_stt.py` from this directory. Cached `small.en`
weights are required; `--allow-model-download` permits their initial download.
The primary `whisper_local:small.en` CPU/int8 path was evaluated on three question
fixtures, one public eight-second speech excerpt, two-second fixture silence and
eight-second generated silence. Each input was tested clean and at two deterministic
noise levels, with three repeats per condition.

Speech medians were 0.889 to 1.071 s, maximum 1.173 s, on an Apple M4 Pro during
concurrent laptop testing. Model files occupy about 464 MiB. All 18 silence/noise-only
calls returned empty text. At 0 dB white noise, `house 3` became `house food`, so this
does not establish noisy-venue reliability. Question transcript truth and recording
provenance are unverified; no question accuracy metric is claimed. Only `small.en`
was measured, with no model-size comparison, hosted Riva or live glasses voice check.

Full transcripts, settings, checksums and timings are in
[`testdata/voice/stt-evaluation.json`](testdata/voice/stt-evaluation.json).
See the [method and results](../../docs/notes/2026-11-08-local-transcription-evaluation.md)
for per-clip timings and limitations.

## SpacetimeDB

Writes go over HTTP from Python (`POST /v1/database/<db>/call/<reducer>`).
On startup the service creates or loads its identity (`data/identity.json`) and calls `register_participant("perception", perception)`.
Outside demo mode that needs a coordinator's `grant_role(<identity>, perception)` first.
Until then the log shows the identity hex, the service retries every 2, 4, 8, 15, then 30 s, and the media server keeps working; no restart is needed after the grant.
If a later write is rejected with `not registered` or `role not granted`, the service registers again.
Argument order follows `docs/specs/spacetimedb.md` section 8.5:
`report_breathing(survivor_id, breathing, rate_bpm, confidence, visibility_pct, display_url)` and `set_critical_score(survivor_id, level, score, confidence, reasons)`.
Check it against `spacetime describe assess-0hw81 reducers --json` before the first real call.

`tests/fixtures/sql_sample_captured.json` was captured from the actual module on an isolated local
SpacetimeDB 2.14.1 server on 2026-11-08. `tests/test_stdb.py` checks its enums, options,
timestamps and row links, alongside the hand-written edge cases in `sql_sample_not_captured.json`.
The live smoke passed registration, both writes, SQL readback and helper updates.
See `docs/notes/2026-11-08-eric-transition-validation.md` for commands and limits.

## Node helper

```bash
cd stdb-helper && npm install && npm run build
npm test                 # builds, then runs test/*.test.js
```

The helper imports the generated bindings from `backend/spacetimedb-bindings/` (`spacetimedb.md` section 1.6).
It does not build until those bindings exist; until then the watcher falls back to HTTP SQL polling every 2 s, which is enough for the demo.
The generated bindings built and typechecked, and `smoke_stdb.py` step 5 received a real
survivor update in under 0.01 s on the isolated local server. This verifies the helper path,
not Pi connectivity or the full camera pipeline.
