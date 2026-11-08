# Perception service spec (breathing, critical score, media server, speech to text, terrain model)

Status: PROPOSED (2026-11-07), follows `docs/specs/CONTRACTS.md` version 8.1 (CONTRACTS.md wins where they differ).
Owner: Eric Lee (computer vision and models, per `docs/MVP.md` "Assignments").
Code: `backend/perception/` in the team repo (https://github.com/matthewthomasbeck/HackUTD).
Read first: `docs/specs/CONTRACTS.md` (names, reducers, tables, media server), `docs/PROJECT.md` ("Rules for the critical score", "Glasses voice questions"), `docs/AGENT_WORKFLOW.md`, `docs/research/perception.md` (methods and sources), `docs/research/platform.md` (SpacetimeDB HTTP API).

This service runs on the laptop.
It does six jobs:

1. Media server: stores and serves images, clips, and voice recordings (the `POST /media`, `GET /media/<name>`, `POST /breathing`, `POST /terrain`, and `POST /transcribe` endpoints in CONTRACTS.md).
2. Breathing: turns a 20 s camera clip into `detected` / `not_detected` / `unknown`, a rate, and a confidence.
3. Speech to text: turns rescuers' voice questions from the glasses into text (section 12).
4. Critical score: turns breathing, visibility, waiting time, and thermal confidence into a level, a score, a confidence, and short reasons.
5. Writes results to SpacetimeDB as role `perception` with `report_breathing` then `set_critical_score` (and, only when configured, `report_terrain` with `source = "camera_model"`, section 9).
6. Terrain: an optional camera model that gives the robot advisory terrain hints (section 9).

Backend: SpacetimeDB (CONTRACTS.md version 8).
Python has no maintained SpacetimeDB SDK (`docs/research/platform.md`), so this service writes through the HTTP API (`POST /v1/database/:name/call/:reducer`) and reads live rows through a small Node.js helper that uses the generated TypeScript bindings (section 8).

Agents: the orchestrator, `comms_agent`, and `auditor` read this service's results from SpacetimeDB and coordinate through the `agent_task` board; this service never posts or claims agent tasks, never calls a language model, and never commands motors.
The comms agent answers rescuer questions whose transcripts this service makes.

Priority, from `docs/MVP.md` (the breathing check and the critical score are priority 3 in "Priority by sponsor track"; voice questions and the terrain model are priority 6):

| Part | Priority |
| --- | --- |
| Media server, breathing rate with confidence, critical score, writes to SpacetimeDB | Must have |
| Re-score timer, YOLO chest region and visibility | Must have (fallbacks exist, see below) |
| `POST /transcribe` for rescuer voice questions | Should have (the glasses spec cuts voice questions early if time is short) |
| Terrain recognition camera model | Should have, only after the breathing pipeline and the critical score work end to end |
| EVM magnified clip for the dashboard | Could have |

Lines marked "Inference" are this spec's own reasoning, not a sourced fact.

## 1. Setup

### Python and environment

- Python 3.12 (3.11 also works; `tomllib` is in the standard library from 3.11).
- One virtual environment in `backend/perception/.venv` (git-ignored).

```bash
cd backend/perception
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip freeze > requirements.lock   # commit this once it works on the demo laptop
```

### Dependencies (`requirements.txt`)

```
fastapi
uvicorn[standard]
python-multipart        # FastAPI needs it for File/Form uploads
numpy
scipy
opencv-python           # not opencv-python-headless: ultralytics depends on opencv-python, and having both installed conflicts
httpx
ultralytics             # YOLO pose for the chest region and visibility
matplotlib              # spectrum PNG for the dashboard and debugging
soundfile               # read and write WAV
faster-whisper          # local speech to text fallback (section 12)
nvidia-riva-client      # NVIDIA hosted speech to text (section 12)
pytest
# terrain model (should have), install only when starting section 9:
# transformers
# torch                 # already pulled in by ultralytics
# scikit-learn
```

Sources: FastAPI says file uploads need `python-multipart` (https://fastapi.tiangolo.com/tutorial/request-files/).
Ultralytics is installed with `pip install ultralytics` (https://docs.ultralytics.com/quickstart/) and is licensed AGPL-3.0 (https://github.com/ultralytics/ultralytics), which is fine for a public hackathon repo.
Speech to text: `nvidia-riva-client` is the client NVIDIA's build.nvidia.com ASR pages tell you to install (`pip install -U nvidia-riva-client`); `faster-whisper` is SYSTRAN's CTranslate2 Whisper port (https://github.com/SYSTRAN/faster-whisper).
Do not pin versions you have not installed; pin with `requirements.lock` after the first working install.

`ffmpeg` on the PATH is optional (`brew install ffmpeg`), used only to make browser-playable H.264 for the EVM clip (section 6).

### Folder layout

```
backend/perception/
  requirements.txt  requirements.lock  .env.example  config.toml  README.md
  perception/
    __init__.py
    app.py          FastAPI app: media + breathing endpoints, startup of worker, watcher, re-score timer
    config.py       loads config.toml, then env overrides (PERCEPTION_<SECTION>_<KEY>)
    media.py        storage, naming, index
    store.py        local SQLite state (data/perception.db)
    video.py        read clip -> gray frames, fps, duration
    roi.py          YOLO pose -> person box, keypoints, chest ROI, background ROI, visibility
    breathing.py    signals, filters, spectrum, gates, decision, confidence
    evm.py          magnified display clip (optional)
    score.py        critical score, pure function, no I/O
    stdb.py         SpacetimeDB HTTP client: identity, call reducer, SQL, SATS-JSON decode
    worker.py       analysis queue (one worker thread)
    watcher.py      polls detection rows for new clips; re-score timer
    terrain.py      terrain camera model (should have)
    stt.py          speech to text engines: nvidia_riva (hosted Parakeet), whisper_local, none
  scripts/
    analyze_clip.py       run the breathing pipeline on a file, print JSON, no database
    make_synthetic.py     write synthetic test clips with known rates
    smoke_stdb.py         identity, register, one reducer call, read back
    label_terrain.py      keyboard labelling of terrain frames (should have)
    train_terrain.py      linear probe training (should have)
  stdb-helper/            Node.js helper: subscriptions over the generated bindings, rows as NDJSON on stdout (section 8)
    package.json  src/index.ts
  tests/
  data/              git-ignored: media/, derived/, perception.db, identity.json
```

### `.env.example`

```
STDB_URI=https://maincloud.spacetimedb.com    # or http://<laptop-a-ip>:3000 for the local fallback server
STDB_DATABASE=assess-0hw81                  # from spacetimedb.md section 1.4
STDB_TOKEN=                                   # empty on first run; the service creates and saves one
PUBLIC_BASE_URL=http://<laptop LAN IP>:8080   # what the Pi and dashboard use to reach this service
CORS_ORIGINS=http://localhost:5180,http://<laptop A IP>:5180   # dashboard (Vite on port 5180, dashboard.md)
STT_ENGINE=nvidia_riva                        # nvidia_riva | whisper_local | none
NVIDIA_API_KEY=                               # from build.nvidia.com; never commit
RIVA_SERVER=grpc.nvcf.nvidia.com:443          # copy from the model's build.nvidia.com API page (UNCONFIRMED until the smoke test)
RIVA_FUNCTION_ID=                             # copy from the same page
WHISPER_MODEL=small.en                        # faster-whisper model size for the fallback
```

Maincloud's URL comes from `docs/research/platform.md` [S34].
Never commit `.env` or `data/identity.json`.

### Run

```bash
cd backend/perception && source .venv/bin/activate
uvicorn perception.app:app --host 0.0.0.0 --port 8080        # service
python scripts/analyze_clip.py path/to/clip.mp4 --debug       # offline, no database
pytest -q                                                     # tests
```

Bind `0.0.0.0` so the Pi can reach it over the team hotspot.
On macOS, allow incoming connections for Python when the firewall prompt appears.

## 2. Media server

Endpoints exactly as in CONTRACTS.md, plus the read-only `GET` endpoints below, which CONTRACTS.md leaves to this spec.

### `POST /media`

- Multipart form, field `file` (required).
- Optional form fields (CONTRACTS.md): `run_id`, `robot_id` (string), `detection_id`, `kind` (`thermal`, `camera`, `clip`, `terrain`, `log`, or `voice` for glasses questions; default from the extension).
- Response `200`: `{"url":"http://<host>:<port>/media/<name>"}` where `<host>:<port>` comes from `PUBLIC_BASE_URL`.
- Limits: 200 MB per file (config), extensions allowed: `.jpg .jpeg .png .mp4 .mkv .avi .h264 .mov .wav .npy .json .csv .bin`.
  Anything else returns `415`; too large returns `413`.
- The server never uses the client filename on disk; it only keeps the extension (lowercased) and stores the original filename in the index.

### `GET /media/<name>`

- Serves the file with the right `Content-Type` (`mimetypes.guess_type`), using FastAPI `FileResponse`.
- `<name>` must match `^[A-Za-z0-9_.-]+$`, otherwise `400`; unknown name returns `404`.
  This blocks path traversal.
- Check early that the dashboard `<video>` tag can play and seek a clip from here; if seeking fails, that is cosmetic, not blocking.

### `POST /breathing`

- Multipart form: `file` (the clip) or `clip_url` (a URL from an earlier `POST /media`, CONTRACTS.md), one of them required, and `survivor_id` (u64, required).
- Optional: `detection_id` (u64, CONTRACTS.md), and additive `robot_id` (string), `roi` (`"x,y,w,h"` in pixels, an operator-drawn chest box), `fps` (float, needed when the container has no frame rate, for example raw `.h264`).
- Saves the clip exactly like `POST /media` with `kind=clip`, queues an analysis job, and returns `202`:
  `{"job_id":"<uuid>","clip_url":"http://.../media/<name>","status":"queued"}`.
- The job writes results to SpacetimeDB (section 8).
- `survivor_id` that does not exist in the `survivor` table: the job fails with status `error` and reason `unknown survivor`, and nothing is written.

### `POST /transcribe`

Defined in section 12: `POST /transcribe` turns a rescuer's voice question into text for the glasses service.

### Read-only endpoints

- `GET /health` returns `{"ok":true,"stdb":"ok"|"error","queue":<n>,"yolo":"loaded"|"missing"}`.
- `GET /breathing/<job_id>` returns the job record (status `queued` | `running` | `done` | `error`, and the result JSON).
- `GET /breathing/detection/<detection_id>` and `GET /breathing/survivor/<survivor_id>` return the latest result JSON, including `display_clip_url` (EVM), `spectrum_url`, and `roi_image_url`, so the dashboard can show the media without a contract field.
- `GET /breathing/detection/<detection_id>` also returns the person check (CONTRACTS.md version 8.1 "Media server"): `person_image_url`, `person_confirmed`, and `person_conf` (section 4, step 2, "Person check").
  These fields live only on this service, never in SpacetimeDB.
- `GET /terrain/latest` returns the latest camera terrain result per robot (section 9).

### Storage layout and naming

```
data/
  media/
    run_<run_id or 0>/<robot_id or unknown>/<name>
  derived/
    det_<detection_id>/            or  surv_<survivor_id>_<job8>/ when no detection id is known
      result.json                  full breathing result, parameters used, timings
      signal.csv                   t, pic, flow, background, flicker
      spectrum.png
      roi.jpg                      middle frame with chest ROI, background ROI, person box drawn
      person.jpg                   person check: camera still with the person box and keypoints drawn
      evm.mp4                      optional magnified display clip
  perception.db                    SQLite: media index, jobs, results, last score writes
  identity.json                    SpacetimeDB identity and token
```

File name (flat, unique, also the URL `<name>`):

```
r<run_id>_<robot_id>_<kind>_<YYYYmmddTHHMMSSZ>_<8 hex>.<ext>
example: r3_dog1_clip_20261108T031522Z_9f2c41ab.mp4
```

- `run_id` is the active run (a `run` row whose `ended_at` is none), read from SpacetimeDB SQL and cached for 10 s; `0` if none or the database is unreachable.
- `robot_id` from the form field, else `unknown`.
- Derived files are also served through `GET /media/<name>` with names `det<detection_id>_evm.mp4`, `det<detection_id>_spectrum.png`, `det<detection_id>_roi.jpg`, `det<detection_id>_person.jpg` (or `surv<survivor_id>_<job8>_...` without a detection id).
- `media` index table in SQLite: `name` (primary key), `path`, `kind`, `robot_id`, `run_id`, `original_filename`, `bytes`, `sha256`, `created_at`.
  `GET /media/<name>` looks up the path here.
- Files are never deleted by the service.

## 3. How clips reach the breathing pipeline

Two paths feed the same queue, so the demo works whichever the robot team builds.

1. Direct: something calls `POST /breathing` with a clip (or `clip_url`) and `survivor_id` (the robot bridge after it reads `detection.survivor_id`, the simulator, or a teammate with `curl`).
2. Watcher (backup): the bridge uploads the clip with `POST /media` and passes the URL in `report_detection` (`detection.breathing_clip_url`), as CONTRACTS.md describes.
   `watcher.py` gets new `detection` rows from the Node helper's subscription (section 8), and queues each detection whose `breathing_clip_url` is set and not yet analyzed (tracked in SQLite by detection id).
   Without the helper, it polls `SELECT * FROM detection` over the HTTP SQL endpoint every 2 s.
   A clip already queued by path 1 (same `clip_url`) is not queued twice.

Detection to survivor link: `detection.survivor_id` (CONTRACTS.md), set by the module when it creates or merges the survivor.
`survivor_id = 0` means the module stored the detection without a survivor; skip it and log `detection <id> has no survivor`.

Clip URL to file: if the URL starts with `PUBLIC_BASE_URL/media/`, read the local file from the index.
Otherwise download it with `httpx` into `data/media/` first.

Filter in Python, not in SQL, because the tables are small and SQL filters on option and enum columns are not supported or not confirmed (`spacetimedb.md` section 0: `IS NULL` on options is unsupported, tested).

The worker runs one job at a time on one background thread, so YOLO and OpenCV never compete for the CPU.
Expected time per 20 s clip: a few seconds without EVM (inference; measure and log it in `result.json`).

## 4. Breathing pipeline

Primary signal: pixel intensity change (PIC).
The TU Delft comparison found PIC the most accurate and fastest of PIC, optical flow, and EVM (research section 1).
Optical flow (Farneback) is computed as a cross-check and can only lower confidence, never raise it.
EVM never produces the number.

### Step 1: read the clip (`video.py`)

- `cv2.VideoCapture(path)`; read every frame; convert to grayscale with `cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)` (the motion signals use brightness only, so color is not needed).
- `fps` = form field `fps` if given, else `CAP_PROP_FPS` if between 5 and 120, else `default_fps` (30) and add warning `fps assumed`.
- `duration_s = n_frames / fps`.
- Keep a full-resolution copy of 5 evenly spaced frames for YOLO, and downscale every frame for signals later (step 3).
- Clip darkness and noise gate (the camera is a regular visible-light camera with no IR, so the clip needs room light or a white light on the robot, which is still TBD):
  - `frame_mean` = mean gray level over all frames; below `clip_dark_mean_min` (40) gives `unknown`, reason `clip too dark, needs light`.
  - `noise_sigma` = median over 20 sampled frame pairs of the standard deviation of `(frame[t+1] - frame[t]) / sqrt(2)` on the full downscaled frame, after a 5 by 5 median filter removes real edges from the estimate; above `clip_noise_max` (6 gray levels) gives `unknown`, reason `clip too noisy (low light)`.
  - Inference: in low light the camera raises gain, so noise grows before the mean drops to zero; both checks are needed.
    Tune both thresholds on the dim-light clips in section 10.
- Gate: fewer than `min_duration_s` (15 s) or fewer than `min_fps` (10) or the file is unreadable gives `unknown` with reason `clip too short` / `frame rate too low` / `clip unreadable`.
  If the clip is longer than `max_duration_s` (30 s), use the middle 30 s.

### Step 2: pick the chest region (`roi.py`)

Order of preference, first that succeeds wins; record which one in `roi_source`:

1. `operator`: the `roi` form field (the research's "operator drags a box" fallback).
2. `pose`: YOLO pose keypoints.
3. `box`: YOLO person box without usable keypoints.
4. `center`: a fixed center region.

YOLO pose details (Ultralytics, https://docs.ultralytics.com/tasks/pose/ and https://docs.ultralytics.com/modes/predict/):

- Model `yolo26n-pose.pt` (the docs' naming for the YOLO26 pose models); if that name fails to load in the installed version, use `yolo11n-pose.pt`.
  Weights download on first use, so run once before the demo on good internet.
- `model(frames, conf=yolo_conf, verbose=False)` on the 5 sampled frames; the pose model detects only persons.
- Per frame, take the box with the highest `boxes.conf`; read `boxes.xyxy` and `keypoints.xy` and `keypoints.conf` (17 COCO keypoints: 5 and 6 shoulders, 11 and 12 hips).
- Combine frames: the median of each box coordinate, and per keypoint the median position over frames where its confidence is at least `kp_conf` (0.5).
- `yolo_conf` default 0.25 (the Ultralytics default), because COCO detectors score lower on dim, noisy frames and on people partly hidden under cover (inference).

Chest ROI from keypoints (`pose`), needs both shoulders, or one shoulder plus one hip:

- Torso axis from the shoulder midpoint `S` to the hip midpoint `H` (if hips are missing, `H = S + 1.2 * shoulder_width` along the box's long axis, toward the box center).
- ROI = the rectangle aligned to the image axes that covers the segment from `S` to `S + 0.6 * (H - S)`, widened to `chest_width_factor` (1.1) times the shoulder width.
  This works for a person standing, sitting, or lying, because it follows the keypoints, not the box shape.

Chest ROI from the box (`box`):

- If the box is taller than wide (upright): x from 25% to 75% of the box width, y from 20% to 55% of the box height.
- If wider than tall by more than 1.3 times (lying): x from 30% to 70%, y from 25% to 75%.
- Otherwise: the center 50% by 50% of the box.

Fixed region (`center`): the center `center_roi_frac` (0.4) of the frame width and height.

Background ROI (for the camera-motion and flicker gates): from the four border strips of the frame (each 15% deep), excluding the person box, pick the strip with the highest pixel standard deviation (texture is needed to see motion).
If none has a standard deviation of at least `tex_min` (4 gray levels), the background gate is skipped and confidence is multiplied by 0.8, with warning `background gate unavailable`.

Chest visible fraction `k` (feeds confidence and the `not_detected` rule):

| ROI source | `k` |
| --- | --- |
| `pose` | fraction of keypoints 5, 6, 11, 12 with confidence at least `kp_conf` (0, 0.25, 0.5, 0.75, or 1.0) |
| `operator` | 0.8 (a human chose it) |
| `box` | 0.5 |
| `center` | 0.4 |

ROI checks, each giving `unknown`:

- Smaller than `min_roi_px` (40 by 40 pixels at full resolution): `chest region too small`.
- More than `sat_frac_max` (20%) of ROI pixels at 250 or above in the middle frame: `chest region overexposed (glare from the robot light)`.
- Mean below `dark_mean_min` (8) and standard deviation below `tex_min`: `chest region too dark`.
- Standard deviation below `tex_min` (flat, for example a box or thick cover): `no texture on chest region`.

Write `roi.jpg`: the middle frame with the person box (white), chest ROI (green), background ROI (blue), keypoints, and the text `roi_source`.

Person check (for the dashboard, CONTRACTS.md version 8.1):
- Input: the detection's camera still (`detection.camera_image_url`, read from the local index when it is on this server); without one, the middle clip frame.
- Run the same YOLO pose model once on that image and take the box with the highest `boxes.conf`.
- `person_conf` = that box's confidence (0 to 1), or 0 if there is no box.
- `person_confirmed` = `person_conf >= person_confirm_conf` (config, default 0.5, untuned).
- Write `person.jpg`: the image with the person box (white) and the keypoints at or above `kp_conf` drawn, and the text `person <person_conf>`; serve it as `det<detection_id>_person.jpg` and return its URL as `person_image_url` (none when there is no image).
- The person check is display only: it never changes the breathing result, the visibility, or the score, and it is never written to SpacetimeDB.

### Step 3: motion signals (`breathing.py`)

Crop the chest ROI from every frame and resize to at most `roi_max_w` by `roi_max_h` (160 by 120, from the research), keeping aspect.
Apply a 3 by 3 Gaussian blur to cut sensor noise.

PIC signal (primary):

1. Split the ROI into a `grid` of 8 by 8 cells.
2. For each cell, the signed mean intensity per frame: `m[c, t]`.
   Use signed means, not the mean absolute difference from a reference frame, because an absolute value folds a sinusoid and can double the measured frequency (inference; Mattioli et al. report double-frequency errors from amplitude signals, research section 1).
3. Detrend each cell (step 4), then band-pass each cell (step 5).
4. Stack the cells as a matrix (cells by time), drop cells whose variance is below the 25th percentile (flat cells), and take the first principal component with `numpy.linalg.svd` on the mean-centered matrix.
   That component's time series is `pic`.
   This follows the idea of Zhu et al. (PCA over many local motion signals, research section 1).

Optical flow signal (cross-check):

1. `cv2.calcOpticalFlowFarneback(prev, next, None, 0.5, 3, 15, 3, 5, 1.2, 0)` between consecutive downscaled ROI frames (parameters from the OpenCV tutorial, https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html).
2. Per frame, the mean flow along the torso axis (vertical `flow[...,1]` when the ROI source is not `pose`), which is a velocity.
3. Cumulative sum over time gives displacement: `flow`.

Nuisance signals, same steps, used only by the gates:

- `background`: PIC (cell means plus PCA) on the background ROI.
- `flicker`: the mean intensity of the whole downscaled frame.

### Step 4: detrend

`scipy.signal.detrend(x, type="linear")` (https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.detrend.html).

### Step 5: band-pass 0.1 to 1.0 Hz

```python
from scipy.signal import butter, sosfiltfilt
sos = butter(cfg.filter_order, [cfg.band_lo_hz, cfg.band_hi_hz], btype="bandpass", fs=fps, output="sos")
y = sosfiltfilt(sos, x)
```

Second-order sections and zero-phase filtering avoid instability and phase shift at these low cutoffs (https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.butter.html, https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.sosfiltfilt.html).
0.1 to 1.0 Hz is 6 to 60 breaths per minute; the top edge stays above 0.5 Hz so a rate over 30 per minute is measurable (research section 1).

### Step 6: spectrum and rate

1. Multiply by a Hann window, zero-pad to `nfft` (4096 samples, or the next power of two above 4 times the length), and take `numpy.fft.rfft`; power `P = |X|^2`.
2. Keep frequencies in `[band_lo_hz, band_hi_hz]`.
3. Peak `f*` = argmax of `P` in the band, refined with parabolic interpolation on the log power of the three bins around it.
4. `rate_bpm = 60 * f*`, rounded to one decimal.

Note: zero-padding makes the curve smooth but does not add resolution; a 20 s clip resolves about 0.05 Hz, which is 3 breaths per minute (research section 1).

### Step 7: quality measures

All computed on `pic` unless stated:

| Measure | Definition |
| --- | --- |
| `concentration` `c` | power within `peak_halfwidth_hz` (0.05) of `f*`, divided by total power in the band |
| `snr_db` | `10 * log10(P(f*) / median(P in band))` |
| `half_agreement` `a` | rate of the first half and of the second half of the clip (same steps 4 to 6 on each half): `1.0` if they differ by at most `half_tol_bpm` (6), `0.5` if at most 12, else `0` |
| `flow_agreement` | `True` if the `flow` signal's peak is within `flow_tol_bpm` (4) of `f*` and its own concentration is at least `c_min` |
| `background_ratio` | background PIC power within 0.05 Hz of `f*`, divided by chest PIC power within 0.05 Hz of `f*` (both from unnormalized PCA components scaled to gray levels) |
| `flicker_peak` | `True` if the `flicker` signal has its peak within 0.05 Hz of `f*` and a concentration of at least `flicker_c_max` (0.5) |

### Step 8: decision and confidence

Apply in this order; the first rule that matches decides:

1. Any gate in steps 1 or 2 failed: `unknown`, confidence 0, with that reason.
2. `background_ratio >= bg_ratio_max` (0.5): `unknown`, reason `camera or scene moved`.
   The robot's sway puts motion into every pixel (research section 1, failure cases).
3. `flicker_peak` is true: `unknown`, reason `lighting or exposure changed`.
4. `c >= c_detect` (0.35) and `snr_db >= snr_detect_db` (6) and `a >= 0.5`: `detected`, with
   `q = clamp01((c - c_min) / (c_good - c_min)) * a * k`, then multiplied by `0.7` if `flow_agreement` is false, and by `0.8` if the background gate was unavailable.
   `breathing_confidence = round(q, 2)`.
   Rate outside 6 to 60 per minute cannot happen because of the band, but if `f*` is on the band edge bin, use rule 6 instead (`unknown`, reason `peak at band edge`).
5. `k >= k_not_detected` (0.75) and `c < c_min` (0.15) and `snr_db < snr_detect_db`: `not_detected`.
   This needs a good clip of a clearly visible torso with a still camera and no periodic chest motion.
   `breathing_confidence = min(0.3, 0.3 * k)`.
6. Everything else: `unknown`, reason `breathing unclear`, `breathing_confidence = min(0.3, q)` where `q` is computed as in rule 4.

Consequences, by design:

- A fixed center ROI (`k = 0.4`) or a box-only ROI can never give `not_detected`; a flat signal there is `unknown`.
- `not_detected` and `unknown` never carry a confidence above 0.3.
- A covered chest gives `unknown` through the texture gate, a low `k`, or a low concentration, never a confident rate.

`rate_bpm` is sent only for `detected`; it is none for the other two results.

Result JSON (`result.json`, also returned by the read endpoints):

```json
{
  "survivor_id": 12, "detection_id": 40, "clip_url": "...",
  "breathing": "detected", "rate_bpm": 17.8, "breathing_confidence": 0.64,
  "visibility_pct": 59.0, "visibility_source": "pose",
  "roi_source": "pose", "chest_visible_k": 1.0,
  "quality": {"concentration": 0.52, "snr_db": 11.3, "half_agreement": 1.0, "flow_agreement": true,
              "background_ratio": 0.08, "flicker_peak": false},
  "reasons": [], "warnings": [],
  "fps": 30.0, "duration_s": 20.0, "timings_ms": {"read": 900, "yolo": 400, "signals": 600, "evm": 0},
  "display_clip_url": null, "spectrum_url": "...", "roi_image_url": "...",
  "person_image_url": "...", "person_confirmed": true, "person_conf": 0.81,
  "params": { "...": "the full breathing config used" }
}
```

### Breathing config (`config.toml`, section `[breathing]`, all tunable)

| Key | Default | Meaning |
| --- | --- | --- |
| `default_fps` | 30 | used when the clip has no frame rate |
| `min_fps` | 10 | below this: `unknown` |
| `min_duration_s` | 15 | floor from the research |
| `max_duration_s` | 30 | longer clips use the middle 30 s |
| `yolo_model` | `yolo26n-pose.pt` | fallback `yolo11n-pose.pt` |
| `yolo_conf` | 0.25 | person box threshold |
| `kp_conf` | 0.5 | keypoint counts as visible |
| `yolo_frames` | 5 | frames sampled for YOLO |
| `person_confirm_conf` | 0.5 | person check: box confidence for "person confirmed" |
| `chest_width_factor` | 1.1 | ROI width over shoulder width |
| `center_roi_frac` | 0.4 | fixed fallback region |
| `min_roi_px` | 40 | minimum ROI side at full resolution |
| `roi_max_w`, `roi_max_h` | 160, 120 | downscale before signals |
| `grid` | 8 | cells per side for PIC |
| `clip_dark_mean_min` | 40 | whole-clip darkness gate (0 to 255 gray) |
| `clip_noise_max` | 6 | whole-clip noise gate (gray-level sigma) |
| `sat_frac_max` | 0.2 | glare gate |
| `dark_mean_min` | 8 | chest region darkness gate |
| `tex_min` | 4 | texture gate (gray-level standard deviation) |
| `band_lo_hz`, `band_hi_hz` | 0.1, 1.0 | 6 to 60 per minute |
| `filter_order` | 2 | Butterworth order (band-pass doubles it) |
| `nfft` | 4096 | zero-padded FFT length |
| `peak_halfwidth_hz` | 0.05 | window for concentration |
| `c_min`, `c_good` | 0.15, 0.5 | confidence ramp |
| `c_detect` | 0.35 | minimum concentration for `detected` |
| `snr_detect_db` | 6 | minimum peak over median |
| `half_tol_bpm` | 6 | half-clip agreement |
| `flow_tol_bpm` | 4 | optical flow agreement |
| `bg_ratio_max` | 0.5 | camera-motion gate |
| `flicker_c_max` | 0.5 | lighting gate |
| `k_not_detected` | 0.75 | torso visibility needed for `not_detected` |

The defaults are untuned starting points (inference); tune them on the recorded teammate clips in section 10, and write the final values in `config.toml` with a comment saying which clips they were tuned on.

### Re-scan rule

A newer clip for the same survivor replaces the older result, except that an `unknown` result never replaces an earlier `detected` or `not_detected`.
In that case the service keeps the earlier breathing values, does not call `report_breathing`, and adds the reason `latest clip unclear, earlier result kept` to the score.
A `detected` result after an earlier `not_detected` replaces it (START re-triage, research section 5).

## 5. Visibility estimate (approximate)

Implementation note (2026-11-08): the local E3 implementation adds three
configurable nuisance safeguards without changing any shared message or reducer:
`flicker_min_std=0.5` gray levels ignores negligible whole-frame variation;
background PIC subtracts the uniform per-frame mean so global flicker is not
mislabelled as camera movement; coherent background flow with standard deviation
at least `bg_flow_min_px=0.1` pixels and concentration at least
`bg_flow_concentration_min=0.35` independently rejects camera sway. The original
frequency-only flicker check rejected clean synthetic chest motion, and PIC-only
background rejection missed some sway. Known-frequency and nuisance tests now
pass. These thresholds have not been tuned on the held-out public sensor clips
or validated on the robot camera. See `docs/research/breathing-repos.md`.

`visibility_pct` is approximate and the dashboard should say so.

- `pose`: `100 * (number of the 17 keypoints with median confidence at least kp_conf) / 17`.
  Inference: a keypoint the model cannot see is usually hidden by cover, so this is a rough "how much of the body shows".
- Operator ROI or a box without usable keypoints: a box-area method would need the range to the person, which this service does not have.
  So use the keypoint fraction if YOLO returned any keypoints, else `visibility_source = "none"`.
- No person found: `visibility_source = "none"`.

When `visibility_source` is `none`, send `visibility_pct` as none (it is optional in `report_breathing` and on `survivor`, CONTRACTS.md), so "unknown" is never stored as 0.
The score still treats unknown visibility as buried and adds the reason `visibility unknown, treated as buried`, because that pushes the person up the list, which is the safe direction (`docs/PROJECT.md`: barely visible means more critical).

## 6. EVM magnified display clip (could have, after the rate is computed)

Only for the dashboard and the judges; it never changes the result.

1. Crop the chest ROI expanded by 50% (clamped to the frame), resize to at most 320 by 240.
2. Gaussian pyramid: `cv2.pyrDown` `evm_levels` (3) times per frame.
3. Temporal ideal band-pass with `numpy.fft` along time on the smallest level: keep `[max(0.1, f* - 0.15), f* + 0.15]` Hz when `detected`, else `evm_band` (0.2 to 1.0 Hz, from the research).
4. Multiply the band by `evm_alpha` (10, the value the EVM paper used for the breathing baby, research section 1), upsample with `cv2.pyrUp` back to the crop size, add to the original, and clip to 0 to 255.
5. Write side by side (original | magnified) with the caption `magnified x10 for display; rate measured from the unmagnified motion signal` using `cv2.VideoWriter` (`mp4v`).
6. If `ffmpeg` exists, transcode for browsers: `ffmpeg -y -i evm_raw.mp4 -c:v libx264 -pix_fmt yuv420p -movflags +faststart evm.mp4`.
   Otherwise keep `mp4v` and note that some browsers will not play it.
7. Register `det<id>_evm.mp4` in the media index; set `display_clip_url` in the result.

Write this code from the paper's description; do not copy the MIT MATLAB code (non-commercial license) or the unlicensed `flyingzhao/PyEVM` (research section 1).
The MIT-licensed Python repos in the research table may be read for reference.
Run EVM after `report_breathing` and `set_critical_score` have been sent, so it never delays the board.

## 7. Critical score (`score.py`)

A pure function with no I/O, from research section 5 ("Proposed critical score"), START-inspired.
The score is a triage aid, not a diagnosis, and the pitch should say the levels are START-like.

### Inputs

| Input | From |
| --- | --- |
| `b` | `survivor.breathing` after this service's latest result (`detected` / `not_detected` / `unknown`); `unknown` if no clip yet |
| `rr` | `rate_bpm` when `b == detected` |
| `q` | `breathing_confidence` |
| `v` | `visibility_pct / 100`; `0` when unknown (section 5) |
| `t` | minutes since `survivor.created_at` while `survivor.status` is `unassigned`, `assigned`, or `en_route` |
| `d` | `thermal_confidence` of the survivor's latest linked `thermal` or `camera` detection (by `detection.survivor_id`); `0.5` with reason `thermal confidence missing` if there is none |

### Level

- `immediate` if any of: `b` is `not_detected` or `unknown`, `rr > rr_high` (30), `rr < rr_low` (10), or `v < v_buried` (0.3).
- `delayed` otherwise.
- Never `minor` (the robot cannot see walking or command-following), never `unknown` once scored, and there is no dead or expectant value anywhere (CONTRACTS.md).

### Score (0 to 100, higher is more urgent)

```python
def breath_term(b, rr, cfg):
    if b in ("not_detected", "unknown"): return cfg.b_absent          # 1.0
    if rr > cfg.rr_high or rr < cfg.rr_low: return cfg.b_abnormal      # 0.9
    return cfg.b_normal                                                # 0.3

W = min(1.0, t / cfg.wait_full_min)                                     # 30 min
score = 100 * (cfg.w_breath * breath_term(b, rr, cfg)                   # 0.5
               + cfg.w_buried * (1 - v)                                 # 0.3
               + cfg.w_wait * W)                                        # 0.2
score = round(min(100.0, max(0.0, score)), 1)
```

The dashboard and agent sort by level (`immediate` first), then by score.

### Confidence

```python
if b == "detected": confidence = q * d
else:               confidence = min(cfg.absent_conf_cap, d)  # 0.3: absence of evidence is weak
confidence = round(confidence, 2)
```

### Reasons (`score_reasons`, short strings, in this order)

| Condition | Reason string |
| --- | --- |
| `b == not_detected` | `no signs of life detected, low confidence` |
| `b == unknown`, clip analyzed | `breathing unclear, re-scan` (plus the gate reason, for example `camera or scene moved`) |
| `b == unknown`, no clip yet | `no breathing clip yet` |
| `detected`, `rr > 30` | `breathing 34/min, over 30` |
| `detected`, `rr < 10` | `breathing 8/min, under 10` |
| `detected`, normal | `breathing 17/min` |
| always when known | `about 40% of body visible (approx.)` |
| `v < 0.3` | `mostly buried` |
| visibility unknown | `visibility unknown, treated as buried` |
| `t >= 1` | `waiting 12 min` |
| always | `thermal confidence 0.82` |
| earlier result kept | `latest clip unclear, earlier result kept` |
| always, last | `needs human triage` |

Rules for reason strings: at most 48 characters each, at most 6 strings (the module rejects more; the last is always "needs human triage"), and a unit test asserts that no reason, and no string anywhere in the service output, contains `dead`, `deceased`, `expectant`, or `no pulse`.
The `under 10` rule is not part of START; it comes from a critique of START (research section 5), so say so in the pitch.

### Score config (`[score]`, all tunable)

| Key | Default |
| --- | --- |
| `rr_high`, `rr_low` | 30, 10 |
| `v_buried` | 0.3 |
| `b_absent`, `b_abnormal`, `b_normal` | 1.0, 0.9, 0.3 |
| `w_breath`, `w_buried`, `w_wait` | 0.5, 0.3, 0.2 |
| `wait_full_min` | 30 |
| `absent_conf_cap` | 0.3 |
| `rescore_interval_s` | 60 |
| `rescore_min_delta` | 2.0 score points |
| `rescore_conf_delta` | 0.05 |

The weights are untuned guesses from the research; say so if a judge asks.

### Re-score when waiting time grows

The perception service owns this with its own timer (not the agent), because the formula and its config live here and the agent must not guess the score.

- Every `rescore_interval_s` (60 s), `watcher.py` reads `survivor` and `detection` (from the helper's cache, or SQL over HTTP) and scores every survivor whose status is `unassigned`, `assigned`, or `en_route`, including survivors with no clip yet (they get `immediate`, `no breathing clip yet`, confidence at most 0.3).
- A new survivor (from the helper's `survivor` insert event) is scored at once, not at the next tick.
- It calls `set_critical_score` only if the level changed, or the score moved by at least `rescore_min_delta`, or the confidence moved by at least `rescore_conf_delta`, or the survivor has never been scored by this service.
  This keeps `event_log` from filling with a row every minute per survivor; with the default weights the waiting term adds about 0.67 points a minute, so a waiting survivor is rewritten about every 3 minutes (inference from the formula).
- Survivors in `reached` or `resolved` are not re-scored; their last score stays.
- The last written values per survivor are kept in SQLite (`score_writes`) so a restart does not rewrite everything.
- The module's `escalation_timer` (CONTRACTS.md) still handles escalation briefings; this timer only changes the score.

## 8. SpacetimeDB access (`stdb.py` and `stdb-helper/`)

Python has no maintained SpacetimeDB SDK (`docs/research/platform.md`: the PyPI `spacetimedb-sdk` is 0.7.0 and not in current docs), so the service uses two paths:

| Need | Path | Why |
| --- | --- | --- |
| Write (every reducer call) | HTTP API from Python (`stdb.py`) | One request per call, tested by the module spec |
| Live reads (new detections and survivors) | Node.js helper (`stdb-helper/`) with the generated TypeScript bindings and a subscription | Event driven, no polling, same bindings as every other component |
| Fallback reads | HTTP SQL from Python every 2 s | Works if the helper is down |

HTTP facts, from the official docs (https://spacetimedb.com/docs/http/database, https://spacetimedb.com/docs/http/identity) and tested on a local server in `spacetimedb.md` section 0:

- Create an identity: `POST {STDB_URI}/v1/identity`, response `{"identity": string, "token": string}`.
- Call a reducer: `POST {STDB_URI}/v1/database/{STDB_DATABASE}/call/{reducer}`, header `Authorization: Bearer <token>`, body a JSON array of positional arguments.
  A reducer that throws returns HTTP 530 with the `SenderError` text (tested).
- SQL: `POST {STDB_URI}/v1/database/{STDB_DATABASE}/sql` with the SQL text as the body; the response is a JSON array with one `{"schema": ProductType, "rows": [...]}` per statement.
  `IS NULL` on option columns is unsupported (tested), so filter in Python.

### 8.1 Node helper (`stdb-helper/`)

- About 80 lines of TypeScript: `DbConnection.builder()` with `STDB_URI`, `STDB_DATABASE`, and the same token as `data/identity.json` (so the helper and the HTTP calls are one `perception` identity), subscribing to `SELECT * FROM detection`, `SELECT * FROM survivor`, and `SELECT * FROM search_cell`.
- It prints one JSON line per row event on stdout: `{"table":"detection","op":"insert"|"update"|"delete","row":{...}}`, with u64 as numbers (ids stay below 2^53), enums as their tag string, options as value or null, and Timestamps as ISO strings.
- `watcher.py` starts it with `subprocess.Popen(["node","stdb-helper/dist/index.js"])`, reads lines in a thread, and restarts it with backoff if it exits.
- It never writes; all writes stay in Python over HTTP, so there is one write path to test.
- Inference: a helper is less code than decoding SATS-JSON subscription messages by hand in Python, and it keeps the generated bindings the single source of names.

### 8.2 Startup

1. If `STDB_TOKEN` is empty and `data/identity.json` does not exist, call `POST /v1/identity` and save `identity` and `token` to `data/identity.json` (git-ignored).
2. Call `register_participant` with `["perception", {"perception": []}]`.
   Outside demo mode the `perception` role needs a prior `grant_role` from a coordinator (CONTRACTS.md reducer table); if the module rejects it, log the identity hex and the error text, keep serving media, and ask a coordinator to grant the role.
3. Start the Node helper.
4. `GET /health` reports `stdb: error` until a reducer call has succeeded once, and `helper: up|down`.

### 8.3 Argument encoding (SATS-JSON)

From https://spacetimedb.com/docs/sats-json and the module spec's tested CLI and HTTP calls: a sum value (tagged enum) is a JSON object with one key, the variant name, and the variant's data; a variant with no data uses an empty array; options are `{"some": x}` or `{"none": []}` (tested in `spacetimedb.md` section 0); integers and floats are JSON numbers.

| Argument | Encoding |
| --- | --- |
| enum such as `breathing`, `level`, `role` | `{"detected": []}`, `{"immediate": []}`, `{"perception": []}` |
| optional f64 or string such as `rate_bpm`, `visibility_pct`, `display_url` | `{"some": 17.8}` or `{"none": []}` |
| `reasons` | JSON array of strings |
| `survivor_id`, `cell_id` | JSON number |

Keep the encoding in one function (`encode_enum`, `encode_option`).

### 8.4 Calls per finished breathing job, in this order

```python
stdb.call("report_breathing", [survivor_id, enc_enum(breathing), enc_opt(rate_bpm), breathing_confidence,
                               enc_opt(visibility_pct), enc_opt(display_url)])        # CONTRACTS.md argument order
stdb.call("set_critical_score", [survivor_id, enc_enum(level), score, score_confidence, reasons])
```

- `display_url` is the EVM clip when it exists; otherwise none, and a later call can set it.
- Timeout 5 s per call; retry network errors and 5xx (other than 530) up to 5 times with backoff 0.5, 1, 2, 4, 8 s.
- A 4xx or 530 is a reducer rejection: log the response text, mark the job `error`, do not retry.
- If `report_breathing` fails, do not call `set_critical_score` for that job; the re-score timer will score the survivor later from what the database holds.
- If SpacetimeDB is unreachable for longer than the retries, keep the result in SQLite as `pending_write` and retry every 10 s in order.
- The exact argument lists come from `spacetimedb.md` and the regenerated bindings (`spacetimedb.md` section 8.5), so check `spacetime describe assess-0hw81 reducers --json` before the first call.

### 8.5 Reading rows over HTTP SQL (fallback)

Write one decoder that maps each row to a dict using the `schema` element names, accepting a row as an array (default) or an object.
For options and enums accept `{"some": x}`, `{"none": []}`, and integer tags (look up the variant name in the schema's sum type).
Timestamps: accept an integer, `[int]`, or `{"__timestamp_micros_since_unix_epoch__": int}` as microseconds since the Unix epoch (inference about the shape; `smoke_stdb.py` must print one raw row so this is checked against the real module).

### 8.6 `scripts/smoke_stdb.py` (run as soon as the module is published)

1. Create or load the identity, register as `perception`.
2. Print the raw JSON of `SELECT * FROM survivor` (first row) and `SELECT * FROM detection` (first row).
3. If a survivor exists (create one with the simulator otherwise), call `report_breathing` with `unknown`, none, 0.1, none, none and `set_critical_score` with `immediate`, 75, 0.1, `["smoke test", "needs human triage"]`.
4. Read the survivor back and assert the fields changed.
5. Start the helper and check that the survivor update arrives as one JSON line within 2 s.

## 9. Terrain recognition camera model (should have)

Start this only after sections 2 to 8 work end to end with a real clip.

### Role in the system

- The real-time terrain decision is made on the robot by simple rules on the LD19 LiDAR, the single-point LiDAR, and the IMU (FSRs optional, placement TBD) (`docs/specs/robot.md`), and the robot never waits for the network.
- This camera model is the camera input to terrain recognition; it uses the same regular visible-light camera, so it needs light too.
- The camera model is advisory.
  It can raise or lower confidence in what the rules saw, and it never overrides a safety stop.
- Classes, exactly as the contract's `terrain_class` values: `flat`, `debris`, `step`, `gap`, `blocked`, `unknown`.
- The module keeps only the robot's latest terrain fields (`robot.terrain_class`, `terrain_confidence`, `terrain_source`, `terrain_action`) and logs a `terrain` event only when the class changes (CONTRACTS.md); there is no terrain history table to read or train from.

### Where it runs

| Option | How | Verdict |
| --- | --- | --- |
| Laptop (this weekend) | The robot bridge posts a forward camera frame to `POST /terrain` (contract; `robot.md` sections 7b.5 and 9.4) with form fields `file`, `robot_id`, `rule_class` (the robot's current rule class), and `observed_at` (when the robot saved the frame); `terrain.py` classifies it and returns `{"terrain_class","confidence","observed_at"}` (the same `observed_at`); the frame is stored like `POST /media` with `kind=terrain` | Recommended. No Pi setup, any model size. Advisory only, because the result arrives after the robot already acted. |
| Pi (later, could have) | Export the trained model to ONNX and run it inside the C++ program with OpenCV DNN, fused by the robot's own rules | Only after the laptop model is evaluated. The robot team owns the fusion code in `robot.md`. |

How the result reaches the robot (CONTRACTS.md version 8.1, bridge to robot):
- This service never connects to the robot or the bridge socket; the result reaches the bridge only as the HTTP response to the bridge's own `POST /terrain` request.
- The bridge sends it to the robot as one `{"type":"terrain_hint","terrain_class":...,"confidence":...,"observed_at":...}` line, so the robot always gets the latest result for the newest frame (`robot.md` section 9.4).
- The hint is advisory only: the robot may raise or lower its terrain confidence with it, and it never overrides a safety stop or loosens the robot's own rules (`robot.md` section 7b.5).
- A frame whose `observed_at` is older than `terrain_max_age_s` gets `409` and no class, so the bridge sends nothing.
- Until the model passes "Evaluation" below, `POST /terrain` returns `{"terrain_class":"unknown","confidence":0,"observed_at":...}`, which the robot treats as no advice.

Fusion rule for any consumer (dashboard, agent, or later the robot), stated here so everyone uses the same one:

- If the camera class agrees with the rule class: combined confidence `= 1 - (1 - c_rule) * (1 - c_cam)`.
- If it disagrees: combined confidence `= c_rule * (1 - 0.5 * c_cam)`, and the rule class stays.
- The camera model may only suggest a more cautious action (`continue` to `slow`, or `slow` to `steer`); it never changes `stop` to anything else, and never makes an action less cautious.

The suggested action for a camera class: `flat` to `continue`, `debris` to `slow`, `step` to `slow`, `gap` to `stop`, `blocked` to `steer`, `unknown` to `slow`.
It is advice, not something the robot did.

### Weekend approach

Two stages, both on the laptop:

1. Zero-shot baseline (hour 1): CLIP (`openai/clip-vit-base-patch32` through Hugging Face `transformers`, `CLIPModel` and `CLIPProcessor`, https://huggingface.co/docs/transformers/model_doc/clip) with one prompt per class, for example `"a photo of flat clear floor"`, `"a photo of loose debris and rubble on the floor"`, `"a photo of a step or ledge"`, `"a photo of a gap or hole in the floor"`, `"a photo of a wall or obstacle blocking the way"`.
   Softmax over the prompts; output `unknown` if the top probability is below `terrain_min_conf` (0.5).
   Inference: CLIP is trained on color daylight photos, so expect weaker results on dim, noisy frames of mock rubble; this is only a baseline.
2. Linear probe (main approach): freeze CLIP's image encoder, compute one embedding per labelled frame, and train `sklearn.linear_model.LogisticRegression` on the embeddings.
   This trains in seconds on a few hundred frames and needs no GPU (inference).
   Fallback if CLIP is too slow or too weak: fine-tune only the last layer of a small torchvision ImageNet model (MobileNetV3-Small), which is also the model to export later for the Pi.

`terrain.py` exposes `classify(image) -> (terrain_class, confidence)`, where confidence is the top class probability.

### Training data from recorded runs

- Source frames: the frames the media server stored from `POST /terrain` (each with the `rule_class` the bridge sent), plus the terrain frames in the robot's sensor log `media/` folder, with the rule class from the matching `terrain` message in that log's `messages.jsonl` (`robot.md` sections 7b.6 and 11).
  The rule class is a weak label.
- `scripts/label_terrain.py`: shows each image with its rule class, and a teammate presses 1 to 6 for the true class (or Enter to accept the rule class, `s` to skip).
  Labels are saved to `data/terrain_labels.csv` (`image_name, run_id, rule_class, human_class, labelled_by`).
- Record on purpose: walk or drive the robot over each mock rubble type in full room light and in dim light (the demo lighting), at least 50 frames per class (inference; enough for a linear probe to be meaningful).
- Train only on human labels; use the rule labels to find frames worth labelling first (disagreements).
- Split by run, not by frame: neighboring frames are nearly identical, so a random split overstates accuracy (inference).
  Keep at least one full run as the test set.
- `scripts/train_terrain.py` writes `data/terrain_model.joblib` and a JSON report with the metrics under "Evaluation" below.

### Latency limits

- Laptop path: skip any frame whose `observed_at` is older than `terrain_max_age_s` (5 s) when it arrives, so the robot never gets stale advice (the robot also drops hints older than its own `terrain.camera_hint.max_age_ms`).
- Target under 300 ms per image on the laptop CPU from file read to classified (inference; measure p50 and p95 and print them in the training report).
- Pi path, if attempted: the C++ loop must use the result only if it is under 200 ms old and must never block on it (robot team decides the exact number in `robot.md`).
- Process at most one terrain image per second per robot; the robot already rate-limits `report_terrain` (CONTRACTS.md).

### Evaluation

On the held-out run, with human labels as truth:

- Confusion matrix over the six classes, per-class precision and recall.
- Recall on `gap`, `step`, and `blocked` is the headline number, because missing those is the dangerous error.
- Agreement rate between the camera model and the LiDAR and IMU rules (`source = "lidar_imu_rules"`), and for disagreements, which one the human label sided with.
- Latency p50 and p95.
- Compare the zero-shot baseline and the linear probe on the same test run.
- Turn the hint on (and any database write) only if the linear probe beats the zero-shot baseline on the held-out run; otherwise send nothing rather than wrong advice.

### Permission

CONTRACTS.md allows the `perception` role to call `report_terrain` with `source = "camera_model"` only.
That call overwrites the robot's latest terrain fields, so if the service and the robot both wrote, the fields would flip between the two sources and log a `terrain` event on each flip.
So the service writes `report_terrain` only with `terrain_write_db = true` in `config.toml` (default `false`), for a test with the robot's own terrain reports off; otherwise the camera advice reaches the board through the robot, which fuses it into its own report.
The results also stay in SQLite and in `GET /terrain/latest` (read-only endpoint, section 2).

## 10. Test plan

### Unit tests (`pytest`)

- `score.py`: every level rule, the formula on hand-checked examples (for example `not_detected`, `v = 0.2`, `t = 15`: `100 * (0.5 + 0.24 + 0.1) = 84.0`), confidence cap at 0.3 for `not_detected` and `unknown`, never `minor`, reason length and count limits, and the banned words check.
- `media.py`: upload, name format, path traversal rejected, unknown extension rejected, index lookup.
- Person check: a still with a person gives `person_confirmed = true`, `person_conf` at least `person_confirm_conf`, and a `person_image_url` that serves a JPEG; a still with no person gives `person_confirmed = false` and `person_conf = 0`; `GET /breathing/detection/<id>` returns all three fields.
- Terrain: `POST /terrain` echoes `observed_at`, and a frame older than `terrain_max_age_s` gets `409`.
- `stdb.py`: encoding of enums and options, and the row decoder on recorded sample JSON (save the smoke test output as a fixture).

### Synthetic clips (`scripts/make_synthetic.py`, run in `tests/test_breathing_synthetic.py`)

Generate 640 by 480 gray video at 30 fps, 20 s, from a blurred random texture with a brighter "torso" rectangle in the middle.
Move the torso region up and down by `A * sin(2 * pi * f * t)` with sub-pixel shifts (`cv2.warpAffine`), and add Gaussian noise (sigma 2 gray levels).
Use `--roi` set to the torso so tests do not depend on YOLO, and a test-only override `chest_visible_k`.

| Case | Expected |
| --- | --- |
| `f` in 0.15, 0.25, 0.4, 0.6, 0.9 Hz, `A` = 1 px | `detected`, rate within 1.5 per minute of `60 f`, confidence at least 0.5 |
| `A` = 0.3 px | `detected` or `unknown`; if `detected`, rate within 1.5 per minute |
| `f` = 0.25 Hz, clip 12 s | `unknown`, `clip too short` |
| No motion, `k` override 1.0 | `not_detected`, confidence at most 0.3 |
| No motion, fixed center ROI | `unknown` |
| Whole frame shifted at 0.3 Hz (camera sway) | `unknown`, `camera or scene moved` |
| Whole frame brightness modulated at 0.3 Hz | `unknown`, `lighting or exposure changed` |
| Flat gray torso, no texture | `unknown`, `no texture on chest region` |
| Breathing case at 0.25 Hz, whole clip scaled to mean gray 20 | `unknown`, `clip too dark, needs light` |
| Breathing case at 0.25 Hz, noise sigma raised to 12 | `unknown`, `clip too noisy (low light)` |
| Torso at 0.25 Hz plus a small fan-like patch at 0.8 Hz outside the ROI | `detected` near 15 per minute |
| Irregular: frequency drifts from 0.2 to 0.4 Hz | never `detected` with confidence above 0.5 at a rate more than 3 per minute from the mean frequency |

### Recorded teammate clips (by hour 8, before tuning)

Record on the real robot camera (regular visible-light camera, no IR), robot stopped, exposure, gain, and white balance locked (research section 1, step 2), 20 s each.
A second person counts the subject's breaths during the clip; that count times 3 is the truth rate.
Save them to `backend/perception/testdata/real/` with a `truth.csv` (`file, condition, truth_bpm, chest_visible`), and keep them out of git if teammates prefer (they show faces).

| Condition | Clips | Pass rule |
| --- | --- | --- |
| Room lights on, chest visible, lying and sitting | 4 | `detected`, within 3 per minute |
| Dim light (the planned demo lighting, room light low or the robot's white light), chest visible | 4 | `detected` within 3 per minute, or `unknown` with a darkness or noise reason |
| Dim light, thin blanket | 3 | `detected` within 3 per minute, or `unknown` |
| Lights off, no robot light | 2 | `unknown`, `clip too dark, needs light` or `clip too noisy (low light)` |
| Fast breathing (about 35 per minute, on purpose) | 2 | `detected`, over 30, level `immediate` |
| Slow breathing (about 8 per minute, on purpose) | 2 | `detected` under 10, or `unknown` |
| Chest covered by a box, or by a thick blanket | 3 | `unknown`, or confidence at most 0.3; never `detected` with confidence above 0.5 at a wrong rate |
| Subject holds breath for the whole clip, chest visible | 2 | `not_detected` or `unknown`, confidence at most 0.3 |
| Camera moved by hand during the clip | 2 | `unknown` |
| A fan or moving cloth in view | 2 | correct rate or `unknown` |

The hard requirement across all real clips: no confident wrong answer, defined as `detected` with confidence at least 0.5 and a rate more than 3 per minute from the truth, or `detected` when the truth is no breathing.
Tune the config only on half of the clips and check the rule on the other half.

### End to end

1. Simulator creates a survivor; `curl -F file=@clip.mp4 -F survivor_id=<id> http://<laptop>:8080/breathing`; the dashboard shows the breathing result and score within 15 s.
2. Bridge on mocks uploads a clip through `POST /media` and `report_detection`; the watcher picks it up without any manual call.
3. Leave a survivor unassigned for 5 minutes; the score rises and `waiting 5 min` appears.
4. Stop SpacetimeDB for 30 s mid-job; the result is written after it returns.
5. Glasses: `POST /transcribe` with a recorded question returns the text in under 3 s on the hosted engine, and under 10 s on `whisper_local`.
6. Engine fallback: unset `NVIDIA_API_KEY`; `GET /health` shows `whisper_local`, and step 5 still passes.

## 11. Build order (about 16.5 hours of work in the 17 left, so split across two people)

The order follows "Priority by sponsor track" in `docs/MVP.md`: rows 1 to 9 are the robot's find and breathing check with the critical score (priority 3), and rows 5b and 10 are voice questions and the terrain model (priority 6).

| Order | Task | Hours | Done when |
| --- | --- | --- | --- |
| 1 | Skeleton, config, `POST /media`, `GET /media/<name>`, SQLite index, `/health` | 1.0 | the Pi team can upload and fetch a file |
| 2 | `make_synthetic.py`, `analyze_clip.py` with PIC, detrend, band-pass, FFT, quality, decision, fixed and operator ROI | 2.0 | synthetic rate tests pass |
| 3 | `score.py` and its tests | 0.75 | unit tests pass |
| 4 | `stdb.py`, identity, register, `smoke_stdb.py` (needs the published module; use the local server if Maincloud is not ready) | 1.0 | smoke test reads back a changed survivor |
| 5 | `POST /breathing`, worker, write both reducers, retries | 1.0 | end to end test 1 passes |
| 5a | Node helper (`stdb-helper/`) and watcher on helper events | 0.75 | a new detection reaches the watcher within 1 s |
| 5b | `stt.py` with `whisper_local`, then `nvidia_riva` smoke test, `POST /transcribe` | 1.0 | end to end tests 5 and 6 pass |
| 6 | YOLO pose ROI, background ROI, visibility, `roi.jpg` | 1.5 | a real teammate frame gets a correct chest box |
| 7 | Record teammate clips; optical flow cross-check; gates; tune confidence | 2.0 | the real clip table passes with no confident wrong answer |
| 8 | Watcher for detections, re-score timer, re-scan rule | 1.0 | end to end tests 2 and 3 pass |
| 9 | Demo hardening: pre-download YOLO weights, test on the hotspot, run with the robot | 1.0 | integration checkpoint 4 in `docs/MVP.md` |
| 10 | Terrain model (should have): label tool, zero-shot, linear probe, evaluation, `POST /terrain` handler | 2.5 | evaluation report on a held-out run |
| 11 | EVM clip and spectrum PNG (could have) | 1.0 | dashboard plays `display_clip_url` |

Row 5a runs right after row 5; row 5b runs after row 9, once the breathing path works end to end.
If behind at hour 10, cut items 11, 10 in that order, use `whisper_local` only if the hosted engine fails its smoke test, and keep the operator ROI as the chest-region fallback instead of finishing YOLO.

## 12. Rescuer voice questions (`stt.py`)

### 12.1 Input

| From | What | Endpoint |
| --- | --- | --- |
| Glasses service | a rescuer's spoken question, up to 8 s, 16 kHz mono 16-bit (the G2 SDK's PCM format: "PCM 16 kHz, signed 16-bit little-endian, mono", [Device APIs](https://hub.evenrealities.com/docs/build/device-apis)) | `POST /transcribe` |

Any other rate or channel count is resampled to 16 kHz mono with `scipy.signal.resample_poly` before speech to text.

### 12.2 Speech to text engines (`stt.py`)

| `STT_ENGINE` | What | Status |
| --- | --- | --- |
| `nvidia_riva` (default) | NVIDIA Parakeet ASR hosted on build.nvidia.com, called with the Riva Python client | Model pages exist for `parakeet-ctc-1.1b-asr` (English), `parakeet-ctc-0.6b-asr`, and `parakeet-tdt-0.6b-v2` (https://build.nvidia.com/nvidia/parakeet-ctc-1_1b-asr/api, https://build.nvidia.com/nvidia/parakeet-tdt-0_6b-v2/api); the pages give a `transcribe_file.py` command (from https://github.com/nvidia-riva/python-clients) against NVIDIA's cloud gRPC endpoint with a per-model `function-id` and the API key as a Bearer token, and take 16-bit mono WAV, OGG, or OPUS. NVIDIA's ASR NIM docs list Parakeet CTC English and Parakeet TDT v2 for English (https://docs.nvidia.com/nim/speech/latest/asr/). UNCONFIRMED: that the hosted endpoint works with our free key and its rate limits; copy the exact server, flags, and function id from the model's API page and run the smoke test first. |
| `whisper_local` | `faster-whisper` on the laptop CPU (`WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")`, then `model.transcribe(path)`) | Fallback; no network. Model weights download on first use, so run once before the demo on good internet. |
| `none` | no transcript | Last resort |

- Pick the engine at startup with a 1 s test clip; if the default fails, log it and use the next one, and show the active engine in `GET /health` and in each result's `engine` field (the dashboard shows it, which also shows judges the NVIDIA model in use).
- `engine` strings: `nvidia_riva:<model name from the page>`, `whisper_local:<size>`, `none`.
- Offline transcription (one file, not streaming) is enough: questions are 8 s or less.
- The NVIDIA key is read from `NVIDIA_API_KEY` in `.env` and never logged.
- Privacy: the hosted engine sends the recording to NVIDIA's cloud.
  For the demo the voices are teammates'; for a real deployment, run the same model as a local NIM or use `whisper_local`.
- Inference: Parakeet and Whisper are trained on clean speech, so a question spoken in a loud venue can transcribe badly; the glasses show the transcript to the rescuer before the answer arrives (`glasses.md` section 5.15).

### 12.3 `POST /transcribe` (for the glasses)

- Form field `file` (WAV) or `audio_url`; optional `rescuer` (name, logged only).
- Runs the engine from section 12.2, synchronously; response `{"transcript":"is anyone else in house 3","confidence":0.71,"engine":"..."}`.
- No database write: the glasses service uploads the recording (`POST /media`, `kind = voice`) and calls `rescuer_ask` itself, which posts the `answer_rescuer` task to the comms agent (CONTRACTS.md, `glasses.md` section 5.15).
- Timeout target 3 s for an 8 s clip on the hosted engine (inference; measure).

### 12.4 Speech to text tests

- `tests/test_stt.py`: a recorded question WAV gives a non-empty transcript on `whisper_local`; silence gives an empty transcript.
- End to end tests 5 and 6 (section 10) cover `POST /transcribe` and the engine fallback.

## Open items

- Lighting for the breathing clip: the robot camera is a regular visible-light camera with no IR, so the clip needs room light or a white light on the robot (TBD with the robot team).
  Resolved 2026-11-07: `docs/PROJECT.md` and `docs/MVP.md` now set the demo in dim light, not lights off; without enough light the darkness and noise gates return `unknown`.
- `docs/research/perception.md` assumes a NoIR camera with IR illuminators; its methods still apply under visible light, but its NoIR notes do not.
- Hosted NVIDIA ASR: confirm the endpoint, model id, and limits with one call before relying on it (section 12.2).

## Proposed contract changes

Proposed contract changes: none open (merged into CONTRACTS.md version 8.1, including the person check fields and the `terrain_hint` path).
