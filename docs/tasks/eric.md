# Eric: computer vision, models, and the agents

Owner of perception and terrain models; PROPOSED owner of the Nemotron agents (Eric designed the agent split).
Specs: `docs/specs/perception.md`, `docs/specs/agent.md`, `docs/AGENT_WORKFLOW.md`, `docs/research/perception.md`, `docs/research/agents.md`, `docs/specs/CONTRACTS.md`.
Overview and checkpoints: `docs/TASKS.md`.
Also owns robot task R1 (state machine, safety gate, main loop) and the C++ part of R0, taken over from Camille on 2026-11-07; the task text stays in `docs/tasks/camille.md`.
Total with AI: about 15 h (each task 1 to 2 h with coding agents; hardware tasks are bench time, not typing).

## Current status (2026-11-08)

The primary implementation is `backend/perception/` and `backend/agent/`.
Checks freshly passed on this branch: **750 perception tests, 87 agent tests,
and the agent TypeScript check**. The recorded Brev validation also passed
native and JSON model smoke tests, three consecutive chains in each mode,
priority ordering, seeded auditor disagreement, and watchdog recovery.
Those model scenarios use a fake database, not a published SpacetimeDB module.

Upstream update: merged `origin/main` at `93b49a7`, bringing Cayden's module,
generated bindings, simulator, dashboard and glasses code into this checkout.
Next, verify Eric's adapters against those sources and confirm the running
deployment/roles. Do not wait for these components to be written from scratch.
Live interoperability remains unverified.

A checked implementation step means code and the stated local tests exist.
It does not complete that task's separate live integration or "Done when"
acceptance. Steps combining code and an unverified live check are split below.

| Task | Finished | Still open |
| --- | --- | --- |
| E0 | Brev setup, both models' tool/JSON smoke tests, configuration and recorded results | Post results to the team; repeat smoke on judging day |
| E1 | Public data preparation and 140 comparison runs in the reference implementation | Port the public benchmark to the primary pipeline; broaden scene coverage and check robot-camera compatibility |
| E2 | Media service, storage, job queue, endpoint tests | Primary environment lock; Pi upload over the team network |
| E3 | Video/ROI/PIC pipeline, quality gates, worker, watcher, HTTP client/helper source, synthetic tests | Live database/helper smoke; primary public-data evaluation and tuning; robot capture |
| E4 | Score formula, confidence caps, ordered writes and re-score logic | Primary E1 results/score batch; live dashboard and waiting-time demonstration |
| E5 | Person/pose/box code and still-image output | Live service health, full E1 ROI review and dashboard display; real YOLO smoke currently recorded for the reference version |
| E6 | Shared runner, schemas/guards, task handling, budgets, dry runs and adapter source | Verify integrated upstream bindings, connect three live identities, verify actual task/log round trip |
| E7 | Orchestrator, auditor, comms, mock scenarios and real Brev chains | Live database watchdog/leases, two-process integration, dashboard/glasses acknowledgement |
| E8 | Transcription engines/endpoint/fallback code, question fixtures and template answer path | Model-generated rescuer answers, hosted Riva verification, full glasses voice loop |
| E9 | CLIP baseline, terrain endpoints, labelling/training tools and safety fusion | Independently labelled hazard data, trained/evaluated probe, enabled advisory path and map integration |
| E10 | Primary extension points only; reference sitrep prototype exists separately | Primary vision describer, sitrep, model tests and delivery |

Detailed unfinished work, dependencies, and the next build order are in
[Eric's remaining work](eric-remaining.md). Recorded model evidence is in
[the Brev validation report](../notes/2026-11-08-brev-validation.md).

The separate `backend/perception/codex-reference/` and
`backend/agent/codex-reference/` copies preserve additional tested work.
Their 33/30 tests, public-data comparison, real YOLO smoke, local Whisper smoke,
and display-only EVM results do not automatically validate the primary code.
See [the public-data comparison](../research/breathing-repos.md).

## How to use this file

Work top to bottom inside each part, but do "Start here" first.
Every task has the same parts: goal, why it matters, estimate, inputs, outputs, files, commands, a checklist, "Done when" tests, a prompt for your coding agent, and pitfalls.
Each checklist step is sized at 10 to 20 minutes; if a step takes more than 30 minutes, stop and ask in the team chat.
Tick the boxes in this file as you go, so the team can see progress.

Which spec wins when two disagree:

- `docs/specs/CONTRACTS.md` (FINAL, version 8) wins over every component spec.
- For exact reducer argument lists, `docs/specs/spacetimedb.md` wins (CONTRACTS.md version 8 says so), and the generated bindings are the final word.
- For the agent set and the cut order, `docs/AGENT_WORKFLOW.md` wins over `docs/specs/agent.md`.
- There is no search agent (`robot_agent`) any more; the orchestrator plans the search and creates missions itself.

Facts that shape every task:

- The robot camera is a regular visible-light camera with no IR, so the breathing check needs room light or a white light on the robot (Matthew's M4).
- Breathing rate comes from a brightness-change signal (pixel intensity change, PIC) on the chest region, band-pass 0.1 to 1.0 Hz, then the FFT peak, from 20 s clips, with darkness and noise gates.
- Never label anyone dead; "no breathing detected" is shown as "no signs of life detected, low confidence" and stays at the top of the list.
- The robot has no microphone or speaker; speech-to-text is only for rescuer questions from the G2 glasses microphone.
- There are no outcomes, no `record_outcome`, no dataset export, and no `terrain_observation` table.
- The auditor judges proposal quality only (wrong rescuer, unfair load); the escalation timer and the watchdog own "too long unattended".

## Start here (first 90 minutes)

Setup and initial inputs are complete as noted below. Continue with the open integration and primary-evaluation steps.

### 1. Model setup and smoke tests (E0)

- [x] Configure the primary runner for both models on Brev; no Build API key is needed for this deployment. Local placeholder credentials stay in the ignored `.env`.
- [x] Verify both models' native tool call, tool-result round trip, reasoning-off and JSON action behavior.
- [x] Record model names, routing and measured results in `backend/agent/README.md`, `specs/agent.md` and `notes/2026-11-08-brev-validation.md`.
- [ ] Post the results to the team chat; no teammate message has been sent by this work.

### 2. Use public breathing inputs first (E1)

- [x] Prepare 16 MPSC-RR video windows, 15 synthetic cases and four VRWi windows with independent dual-belt reference checks in `backend/perception/codex-reference/`.
- [x] Compare the reference PIC implementation with the external baseline configurations; retain all 140 runs and the limitations.
- [ ] Adapt the same dataset/benchmark inputs to the primary `backend/perception/` API and record its results separately.
- [ ] Confirm the robot's actual image quality, lighting and still-camera behavior during integration with Camille and Matthew.

Public inputs replace recording a new development dataset. They do not prove
performance on the actual robot camera. Do not label unverified scene coverage
or the reference implementation's accuracy as a primary-pipeline result.

## Models, endpoints, and identifiers

Use these exact strings.
Anything marked UNCONFIRMED must pass a smoke test before code depends on it.

| Use | Identifier | Where it is set | Status |
| --- | --- | --- | --- |
| NVIDIA base URL | `https://integrate.api.nvidia.com/v1`, `POST /chat/completions` | `NVIDIA_BASE_URL` in `backend/agent/.env` | Confirmed in the API reference (agent.md 4.1) |
| Orchestrator | `nvidia/nemotron-3.5-super-vl-120b-a12b` | `MODEL_SUPER` | Confirmed by the smoke test (2026-11-07): native tool calls; `nemotron-3-super-120b-a12b` returns 404 for our key |
| Auditor and comms agent | `nvidia/nemotron-3.5-lightning-30b-a3b` | `MODEL_NANO` | Confirmed by the smoke test (2026-11-07): native tool calls with thinking off; `nemotron-3-nano-30b-a3b` reached end of life |
| Vision describer (could have) | `nvidia/nemotron-nano-12b-v2-vl` | `MODEL_VISION` | UNCONFIRMED until `smoke:vision` passes |
| Super reasoning | `reasoning_effort: "low"` (values `none`, `low`, `high`) | runner code | Confirmed in the Super schema |
| Nano thinking off | `chat_template_kwargs: {"enable_thinking": false}` | `NANO_THINKING_OFF=1` | Confirmed by the smoke test; needed for Lightning's JSON mode |
| Sampling | `temperature: 0.6`, `top_p: 0.95`, `stream: false` | runner code | From the Nano model card; `stream` defaults to true, so always send false |
| Rate limit | about 40 requests per minute (forum report) | our cap `RPM_BUDGET=20` | UNCONFIRMED; ask the NVIDIA mentors |
| Hosted speech-to-text | Parakeet ASR pages: `parakeet-ctc-1.1b-asr`, `parakeet-ctc-0.6b-asr`, `parakeet-tdt-0.6b-v2`, through `nvidia-riva-client` | `STT_ENGINE=nvidia_riva`, `RIVA_SERVER`, `RIVA_FUNCTION_ID` in `backend/perception/.env` | UNCONFIRMED: server `grpc.nvcf.nvidia.com:443`, the function id, and limits; copy them from the model's API page |
| Local speech-to-text | `faster-whisper`, model size `small.en` | `STT_ENGINE=whisper_local`, `WHISPER_MODEL` | Fallback, no network; weights download on first use |
| Person and chest model | `yolo26n-pose.pt`, fallback `yolo11n-pose.pt` (Ultralytics) | `[breathing] yolo_model` in `config.toml` | Use the fallback if the first name fails to load |
| Terrain baseline | `openai/clip-vit-base-patch32` (Hugging Face `transformers`) | `terrain.py` | Should have |
| SpacetimeDB | database `assess-0hw81` on Maincloud (`https://maincloud.spacetimedb.com`) or a local server (`http://<laptop-a-ip>:3000`) | `STDB_URI`/`STDB_DATABASE` (perception), `STDB_URI`/`STDB_DATABASE` (agents) | The Maincloud name is not confirmed free; Cayden announces the final name |

## Code folders you own

```
backend/perception/        Python 3.12 FastAPI service (E2 to E5, E8, E9), layout in perception.md section 1
  perception/              app.py config.py media.py store.py video.py roi.py breathing.py evm.py
                           score.py stdb.py worker.py watcher.py terrain.py stt.py
  scripts/                 analyze_clip.py make_synthetic.py smoke_stdb.py label_terrain.py train_terrain.py
  stdb-helper/             Node.js helper: subscriptions over the bindings, rows as NDJSON on stdout
  tests/  testdata/real/   (real clips; keep out of git if teammates prefer, they show faces)
  data/                    git-ignored: media/, derived/, perception.db, identity.json
backend/agent/             Node.js 22 TypeScript runner (E0, E6, E7, E8 agent side, E10), layout in agent.md section 3.1
  src/  scripts/  test/  logs/  .tokens/ (git-ignored)
```

Both folders need a committed `.env.example` and a git-ignored `.env`.
Only `src/stdb/` and `src/world.ts` in the agent runner import from `backend/spacetimedb-bindings/`.

## What you need from teammates

| From | What | Needed by | Until then |
| --- | --- | --- | --- |
| Cayden (C1) | SpacetimeDB module published locally and on Maincloud, the database name, and bindings in `backend/spacetimedb-bindings/` | E3 write path, E4, E6 step 6 | `FakeWorld` for agents; `analyze_clip.py` with no database for perception |
| Cayden (C1) | Demo mode on the site, or `grant_role` for the `perception`, `agent`, and `auditor` identities | E3, E6 | Log the identity hex and ask Cayden to grant it |
| Cayden (C1) | Demo timings through `set_site_timings` (`agent_watchdog_s`, `task_lease_s`, `proposal_lease_s`, `escalate_after_s`) | E7 kill test | Ask for the demo values (agent.md suggests a 10 s watchdog in demo mode) |
| Cayden (C3) | Simulator that creates survivors, rescuers, a robot, and person reports | E4, E6, E7 | `curl` and `smoke_stdb.py` |
| Cayden (G2) | Glasses service that uploads voice to `POST /media` (`kind=voice`), calls `POST /transcribe`, then `rescuer_ask` | E8 | Recorded WAV files and `curl` |
| Cayden (C2) | Dashboard Agents panel and survivor detail that read your rows and media URLs | E4, E5, E7 demo | Read rows with the SpacetimeDB CLI |
| Camille (R3, R5) | Bridge uploads stills and clips with `POST /media`, passes URLs to `report_detection`, and calls `POST /breathing` with `clip_url`, `survivor_id`, `detection_id` | E2, E3 end to end | Simulator plus `curl` |
| Camille (R5) | Inspect mission records a 20 s clip with exposure, gain, and white balance locked (`robot.md` 12.2) | E3 real clips | Your own recordings from E1 |
| Camille (R7) | Bridge posts forward camera frames to `POST /terrain` with `rule_class` and forwards the hint to the robot | E9 | Frames recorded by hand |
| Matthew (M4) | Light for the camera, or confirmation the demo room light is enough | E1, E3 tuning | Room lights on for the first clips |
| Matthew (M6, with you) | Thermal range test: a teammate at 0.5, 1, 2, 3, and 4 m, uncovered, under a blanket, partly behind boxes | E3 (camera distance for the chest region), E5 | Start at 1 to 2 m |
| Matthew (M7) | Mock rubble set | E1 covered clips, E9 frames | Boxes and blankets at home |

## Phase 0: setup

### E0. Smoke tests that decide the plan
Estimate with AI: 0.5 h.

Goal: one Nemotron tool call through NVIDIA's hosted API with `nvidia/nemotron-3.5-super-vl-120b-a12b` and `nvidia/nemotron-3.5-lightning-30b-a3b`, and a decision on native tool calls or the strict JSON action format for each model.
If native tool calls fail, switch both to the strict JSON action format in `specs/agent.md` (section 4.4).

Why it matters: the NVIDIA track ("Use Nemotron Beyond a Chatbot") wants agents that act through tools; this test decides whether every later agent call is native or JSON, and it is checkpoint 0 in `docs/TASKS.md`.

Inputs: the NVIDIA API key only; no SpacetimeDB needed.

Outputs: `TOOL_MODE_SUPER` and `TOOL_MODE_NANO` values, whether `reasoning_effort: "none"` and Nano's `enable_thinking: false` are accepted, latency per model; used by E6 and E7, and by Cayden for the pitch numbers.

Files to create:

- `backend/agent/package.json` with the scripts in agent.md 3.1 (`start`, `dry`, `smoke:llm`, `smoke:vision`, `scenario`, `test`, `typecheck`).
- `backend/agent/tsconfig.json`, `backend/agent/.env.example` (copy agent.md 3.2), `backend/agent/.gitignore` (`.env`, `.tokens/`, `logs/`, `node_modules/`).
- `backend/agent/scripts/smoke-llm.ts`, with the curl one-liner in its top comment.
- `backend/agent/src/llm/parse.ts` (needed for the JSON mode check).
- `backend/agent/README.md` with the tool-mode table.

Commands:

```bash
cd backend/agent
npm init -y && npm install openai ajv dotenv spacetimedb && npm install -D typescript tsx vitest @types/node
cp .env.example .env    # then paste NVIDIA_API_KEY
npm run smoke:llm
```

Environment variables: `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `MODEL_SUPER`, `MODEL_NANO`, `TOOL_MODE`, `TOOL_MODE_SUPER`, `TOOL_MODE_NANO`.

Checklist:

- [x] 1. Scaffold `backend/agent/` (package.json scripts, tsconfig with `"module": "NodeNext"`, `.env.example`, `.gitignore`) and install the dependencies.
- [x] 2. Run the curl one-liner for both model ids and note the HTTP status and latency.
- [x] 3. Write `smoke-llm.ts` step 1: one request per model with one tool, `compute_bearing` (`{from_lat, from_lon, to_lat, to_lon, reason}`), and the message from agent.md 4.3; pass if `tool_calls[0].function.name === "compute_bearing"` and four numbers parse.
- [x] 4. Step 2: send the tool result back as a `role: "tool"` message with `tool_call_id`; pass if the reply has no tool calls and mentions meters.
- [x] 5. Step 3: try `reasoning_effort: "none"` on Super and `chat_template_kwargs: {"enable_thinking": false}` on Nano; record whether each is accepted and whether reasoning text disappears.
- [x] 6. Write `parse.ts` (strip `<think>` blocks and code fences, take the first balanced `{...}`, accept `{"actions":[...]}`, `{"done":true,...}`, and `{"name","arguments"}`), then step 4: repeat step 1 with no `tools` field and the catalog in the prompt.
- [ ] 7. Print a results table (model, mode, status, latency, pass), write it into `backend/agent/README.md`, post it in the team chat, and write the decision into `specs/agent.md` section 4.3.

Done when: the result is posted in the team chat and written into `specs/agent.md`.
Pass criteria for the smoke test itself:

- Each model either passes native mode (steps 1 and 2) or passes JSON mode (step 4); a model that passes neither is a red flag to raise with the NVIDIA mentors at once.
- Every call prints HTTP status and latency; Super under about 10 s per reply, or the decision row in agent.md 4.3 applies (`reasoning_effort: "none"`, then ask the team).
- `.env` is not in `git status`.

Prompt for your coding agent:

```
Read docs/specs/agent.md sections 3.1, 3.2, 4.1, 4.2, 4.3, and 4.4, and docs/AGENT_WORKFLOW.md.
Create backend/agent/ as a Node.js 22 TypeScript project with the package.json scripts in section 3.1,
a tsconfig.json, .env.example copied from section 3.2, and a .gitignore for .env, .tokens/, logs/, node_modules/.
Write scripts/smoke-llm.ts that runs the five steps of section 4.3 against both MODEL_SUPER and MODEL_NANO
using the official openai package with baseURL NVIDIA_BASE_URL, stream: false, temperature 0.6, top_p 0.95,
maxRetries 0, and a 30 s timeout. Put a curl one-liner in the top comment.
Write src/llm/parse.ts exactly as section 4.4 describes, with vitest tests in test/parse.test.ts for plain JSON,
fenced JSON, JSON after a <think> block, the {"name","arguments"} leak, and garbage.
Print a results table: model, mode (native or json), HTTP status, latency ms, pass or fail, and the
reasoning_effort and enable_thinking results. Never print the API key. Do not add any other dependencies.
```

Pitfalls and fixes:

- A 400 that mentions `tools` or extra properties: the request schema has `additionalProperties: false`; set `TOOL_MODE_<model>=json`.
- The tool call comes back inside `content` instead of `tool_calls` (NIM does this when its parser fails): run it through `parse.ts`.
- HTTP 202 or empty `choices`: the result is pending; treat it as a retryable failure, not an answer.
- `stream` defaults to true; a missing `stream: false` gives a streamed body that the client cannot parse as one reply.
- 429 in the smoke test: wait 60 s; do not loop; note it as evidence for the rate limit question.

### E1. Public test inputs, then camera integration
Estimate with AI: 1 h.

Goal: use reproducible public RGB breathing inputs and deterministic synthetic failures for development. The original camera/lighting conditions below remain later integration checks; a new teammate dataset is not a prerequisite.

Why it matters: demo beats 3 and 4 (robot records 20 s, dashboard shows IMMEDIATE with a rate, confidence, and why) depend on tuning against real clips in the real light; perception.md section 10 says the hard rule is "no confident wrong answer".

Inputs: Matthew's lighting plan (M4); the robot camera if it records already (Camille's R5), otherwise a stand-in camera.

Outputs: labelled clips and `truth.csv`, used by E3 (tuning), E4 (score checks), E5 (person box), and Cayden's demo video if the team agrees.

Files to create:

- `backend/perception/testdata/real/<clip files>.mp4`.
- `backend/perception/testdata/real/truth.csv` with columns `file, condition, truth_bpm, chest_visible` (perception.md section 10), plus `who, lighting, coverage, camera, notes`.
- Add `testdata/real/*.mp4` to `backend/perception/.gitignore` unless every teammate in the clips agrees to publish them; always put a copy in the team's shared drive.

File names: `<who>_<lighting>_<coverage>_<position>_<n>.mp4`, for example `eric_dim_thinblanket_lying_1.mp4`.

Clip set (from perception.md section 10; do the first five rows now, the rest after E3 runs):

| Condition | Clips | Expected result |
| --- | --- | --- |
| Room light, chest visible, lying and sitting | 4 | `detected`, within 3 per minute |
| Demo (dim) light, chest visible | 4 | `detected` within 3 per minute, or `unknown` with a darkness or noise reason |
| Demo light, thin blanket (partly covered) | 3 | `detected` within 3 per minute, or `unknown` |
| Chest covered by a box or a thick blanket (fully covered) | 3 | `unknown`, or confidence at most 0.3 |
| Lights off, no robot light (too dark) | 2 | `unknown`, `clip too dark, needs light` or `clip too noisy (low light)` |
| Fast breathing on purpose (about 35 per minute) | 2 | `detected`, over 30, level `immediate` |
| Slow breathing on purpose (about 8 per minute) | 2 | `detected` under 10, or `unknown` |
| Breath held for the whole clip, chest visible | 2 | `not_detected` or `unknown`, confidence at most 0.3 |
| Camera moved by hand during the clip | 2 | `unknown` |
| A fan or moving cloth in view | 2 | correct rate or `unknown` |

Later camera-integration checklist (not required to start development):

- [ ] 1. Agree the light with Matthew (M4) and set up the mock rubble corner (boxes, blankets) at the distance from the M6 range test, or 1 to 2 m if that test is not done.
- [ ] 2. Fix the camera on a stand (or the stopped robot); lock exposure, gain, and white balance (on a phone, long-press to lock AE/AF; on the robot, `robot.md` 12.2 locks `AeEnable`, `ExposureTime`, `AnalogueGain`, `AwbEnable`); record at 30 fps.
- [ ] 3. Record the four room-light clips; a second person counts breaths for exactly 20 s, and the truth rate is that count times 3.
- [ ] 4. Record the four demo-light clips and the three thin-blanket clips the same way.
- [ ] 5. Record the three fully covered clips and the two lights-off clips.
- [ ] 6. Write `truth.csv`, copy everything to the shared drive, and post the folder link in the team chat.
- [ ] 7. After E3 runs, record the remaining rows (fast, slow, held breath, camera moved, fan) and re-record the core rows on the real robot camera once Camille's inspect mission records clips (checkpoint 3).

Development input preparation/comparison is done in the reference version. Primary benchmark port and broader coverage remain open. Original camera acceptance: verify labelled demo-condition clips once the capture path is available.
Pass criteria: at least 16 clips covering the first five rows, each 20 s or longer, each with a `truth.csv` row, and `ffprobe` (or OpenCV) reports a frame rate between 25 and 60 fps.

Prompt for your coding agent:

```
Read docs/specs/perception.md section 10 ("Recorded teammate clips").
Write backend/perception/scripts/check_clips.py that reads testdata/real/truth.csv
(columns file, condition, truth_bpm, chest_visible, who, lighting, coverage, camera, notes),
opens every listed clip with cv2.VideoCapture, and prints a table: file, fps, frame count, duration s,
mean gray level, and a warning when duration < 20 s, fps outside 25..60, the file is missing,
or a row has no truth_bpm. Exit non-zero if any clip fails. Do not add dependencies beyond numpy and opencv-python.
Add testdata/real/*.mp4 to backend/perception/.gitignore.
```

Pitfalls and fixes:

- Auto exposure left on: the camera's brightness drift creates a fake periodic signal; always lock exposure before recording.
- Dark clips: the regular camera needs light; if the demo-light clips come out near black, that is the finding to give Matthew for M4, not a pipeline bug.
- Phone clips are a stand-in: the robot camera's noise and resolution differ, so re-record on the robot camera before final tuning.
- Counting errors: count breaths on the chest, not the nose, and start and stop the count with the recording.

## Phase 1: perception

### E2. Media server
Estimate with AI: 1 h.

Goal: `POST /media`, `GET /media/<name>`, `POST /breathing`, storage by run and robot.

Why it matters: every image, clip, and voice question in the demo goes through it; Camille's bridge and Cayden's dashboard and glasses service depend on the URLs it returns.

Inputs: nothing to start; `run_id` from SpacetimeDB once the module is published (else `0`).

Outputs: file URLs for `report_detection` (Camille), clip URLs and analysis jobs for E3, media for the dashboard (Cayden), and voice files for E8.

Files to create (perception.md sections 1 and 2):

- `backend/perception/requirements.txt` (exact list in perception.md 1), `config.toml`, `.env.example`, `.gitignore`, `README.md`.
- `perception/app.py`, `config.py`, `media.py`, `store.py`.
- `tests/test_media.py`.

Endpoints:

- `POST /media`: multipart `file`, optional `run_id`, `robot_id`, `detection_id`, `kind` (`thermal`, `camera`, `clip`, `terrain`, `log`, plus `voice`, proposed); returns `{"url":"http://<PUBLIC_BASE_URL>/media/<name>"}`; 415 for a bad extension, 413 over 200 MB.
- `GET /media/<name>`: name must match `^[A-Za-z0-9_.-]+$` (else 400), unknown is 404, served with `FileResponse`.
- `POST /breathing`: `file` or `clip_url`, `survivor_id` required, optional `detection_id`, `robot_id`, `roi` (`"x,y,w,h"`), `fps`; returns 202 `{"job_id","clip_url","status":"queued"}`.
- `GET /health` returns `{"ok":true,"stdb":"ok"|"error","queue":<n>,"yolo":"loaded"|"missing"}` (additive).
- File names: `r<run_id>_<robot_id>_<kind>_<YYYYmmddTHHMMSSZ>_<8 hex>.<ext>`, stored under `data/media/run_<run_id>/<robot_id>/`.

Commands:

```bash
cd backend/perception
python3.12 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip && pip install -r requirements.txt
uvicorn perception.app:app --host 0.0.0.0 --port 8080
curl -F file=@testdata/real/eric_room_none_lying_1.mp4 -F kind=clip -F robot_id=dog1 http://localhost:8080/media
pytest -q
```

Environment variables: `STDB_URI`, `STDB_DATABASE`, `STDB_TOKEN`, `PUBLIC_BASE_URL` (the laptop's LAN IP, port 8080), `CORS_ORIGINS` (dashboard dev server, `http://localhost:5180`).

Checklist:

- [x] 1a. Create the primary environment and requirements using `opencv-python`; the 750-test primary suite passes.
- [ ] 1b. Commit a lock generated from the working primary demo environment; the reference environment lock does not replace it.
- [x] 2. `config.py`: load `config.toml`, then `.env`, then `PERCEPTION_<SECTION>_<KEY>` overrides.
- [x] 3. `store.py`: SQLite at `data/perception.db` with the `media` index table (`name, path, kind, robot_id, run_id, original_filename, bytes, sha256, created_at`) and a `jobs` table.
- [x] 4. `media.py` and `POST /media`: name format, extension allow list, size limit, never use the client filename on disk.
- [x] 5. `GET /media/<name>` with the name regex and index lookup; `GET /health`.
- [x] 6. `POST /breathing` that saves the clip like `POST /media` with `kind=clip`, records a queued job, and returns 202 (the worker comes in E3).
- [x] 7. CORS for `CORS_ORIGINS`; tests for upload, name format, path traversal (`../etc/passwd` gives 400), bad extension (415).
- [ ] 8. Run on `0.0.0.0:8080`, allow Python through the macOS firewall, and have Camille upload one image from the Pi over the team hotspot.

Done when: Camille's bridge uploads an image and gets a URL back.
Tests with pass criteria:

- `pytest -q` passes `tests/test_media.py`.
- From another machine on the hotspot, `curl -F file=@x.jpg http://<laptop IP>:8080/media` returns a URL, and opening that URL in a browser shows the image.
- The dashboard's `<video>` tag plays a clip URL (seeking is cosmetic, not blocking).

Prompt for your coding agent:

```
Read docs/specs/perception.md sections 1 (setup, requirements, layout, .env.example, run) and 2 (media server),
and the "Media server" section of docs/specs/CONTRACTS.md.
Create backend/perception/ with requirements.txt exactly as listed, config.toml, .env.example, .gitignore
(.venv, .env, data/, testdata/real/*.mp4), and the package perception/ with app.py, config.py, media.py, store.py.
Implement POST /media, GET /media/<name>, POST /breathing (save the clip as kind=clip, create a queued job in
SQLite, return 202 {job_id, clip_url, status}), GET /breathing/<job_id>, and GET /health, with the exact
limits, name regex, file naming r<run_id>_<robot_id>_<kind>_<UTC stamp>_<8 hex>.<ext>, and storage layout
in section 2. run_id comes from a stub that returns 0 for now. PUBLIC_BASE_URL builds the returned URL.
Add CORS for CORS_ORIGINS. Write tests/test_media.py for upload, naming, path traversal (400),
bad extension (415), too large (413), and index lookup. Do not invent endpoints beyond the spec.
```

Pitfalls and fixes:

- `python-multipart` missing: FastAPI file uploads fail at startup; it is in the requirements list.
- `opencv-python` and `opencv-python-headless` both installed: import errors; keep only `opencv-python` (Ultralytics needs it).
- The Pi cannot reach the laptop: bind `0.0.0.0`, allow the macOS firewall prompt, and use the hotspot IP in `PUBLIC_BASE_URL`, not `localhost`.
- Raw `.h264` has no frame rate: the bridge must send `fps`, or the pipeline assumes 30 and warns `fps assumed`.

### E3. Breathing pipeline
Estimate with AI: 2 h.

Goal: chest region, brightness-change signal (optical flow as a cross-check), band-pass 0.1 to 1.0 Hz, FFT peak, confidence, and the decision `detected`, `not_detected`, `unknown`; darkness and noise gates; writes `report_breathing` to SpacetimeDB.

Why it matters: MVP priority 3 (NVIDIA real-world use, State Farm "most urgent needs"), demo beats 3 and 4; an honest `unknown` is better than a confident wrong rate.

Inputs: E1 clips; E2 media server; Cayden's published module and a survivor to write to; Camille's bridge calling `POST /breathing` (or the watcher path through `detection.breathing_clip_url`).

Outputs: `report_breathing(survivor_id, breathing, rate_bpm, confidence, visibility_pct, display_url)` rows on `survivor`, `result.json` and `roi.jpg` per job, read by E4, the dashboard, and the agents' wake packets.

Files to create (perception.md sections 3, 4, 8, 10):

- `perception/video.py`, `roi.py` (fixed and operator ROI first; YOLO in E5), `breathing.py`, `worker.py`, `stdb.py`, `watcher.py`.
- `scripts/make_synthetic.py`, `scripts/analyze_clip.py`, `scripts/smoke_stdb.py`.
- `stdb-helper/package.json`, `stdb-helper/src/index.ts` (about 80 lines, subscriptions to `detection`, `survivor`, `search_cell`, NDJSON on stdout, never writes).
- `tests/test_breathing_synthetic.py`, `tests/test_stdb.py` (encoding and row decoder, with the smoke test output saved as a fixture).

Algorithm summary (full detail in perception.md section 4; follow it exactly):

1. Read the clip in grayscale; `fps` from the form, else the container if between 5 and 120, else 30 with a warning.
2. Gates giving `unknown`: whole-clip mean below `clip_dark_mean_min` (40) gives `clip too dark, needs light`; noise sigma above `clip_noise_max` (6) gives `clip too noisy (low light)`; under 15 s, under 10 fps, or unreadable; use the middle 30 s of longer clips.
3. Chest ROI by preference `operator`, `pose`, `box`, `center`; ROI checks (too small, overexposed, too dark, no texture).
4. PIC: 8 by 8 grid of signed cell means on the ROI downscaled to 160 by 120, detrend, band-pass, drop flat cells, first principal component.
5. Band-pass: `butter(2, [0.1, 1.0], btype="bandpass", fs=fps, output="sos")` with `sosfiltfilt`.
6. Spectrum: Hann window, zero-pad to 4096, `rfft`, peak in band with parabolic interpolation, `rate_bpm = 60 * f*`.
7. Quality: concentration, SNR, half-clip agreement, Farneback flow agreement (can only lower confidence), background ratio (camera moved), flicker peak (lighting changed).
8. Decision rules 1 to 6 in perception.md 4 step 8; `not_detected` and `unknown` never above 0.3 confidence; `rate_bpm` only for `detected`.
9. Re-scan rule: an `unknown` never replaces an earlier `detected` or `not_detected`.

SpacetimeDB write path (perception.md section 8): `POST {STDB_URI}/v1/identity` once, save to `data/identity.json`; `register_participant` with `["perception", {"perception": []}]`; `POST {STDB_URI}/v1/database/{STDB_DATABASE}/call/report_breathing` with a JSON array body and `Authorization: Bearer <token>`; enums as `{"detected": []}`, options as `{"some": x}` or `{"none": []}`; check the argument order with `spacetime describe assess-0hw81 reducers --json` before the first call.

Commands:

```bash
cd backend/perception && source .venv/bin/activate
python scripts/make_synthetic.py --out testdata/synthetic
python scripts/analyze_clip.py testdata/real/eric_room_none_lying_1.mp4 --debug
python scripts/analyze_clip.py testdata/real/eric_room_none_lying_1.mp4 --roi 220,140,180,120
python scripts/smoke_stdb.py
(cd stdb-helper && npm install && npm run build)
curl -F file=@testdata/real/eric_dim_none_lying_1.mp4 -F survivor_id=1 http://localhost:8080/breathing
pytest -q
```

Checklist:

- [x] 1. `video.py`: read frames, fps rule, duration, 5 full-resolution sample frames, downscale, and the darkness and noise gates.
- [x] 2. `make_synthetic.py`: 640 by 480, 30 fps, 20 s, textured torso moved by `A * sin(2 pi f t)` with sub-pixel shifts and sigma 2 noise, plus the gate cases in the perception.md 10 table.
- [x] 3. `roi.py` with `operator` and `center` ROI, background ROI, ROI checks, and `roi.jpg` drawing (pose and box come in E5).
- [x] 4. `breathing.py` steps 3 to 6: PIC with PCA, detrend, band-pass, Hann, zero-padded FFT, parabolic peak.
- [x] 5. Step 7 quality measures and step 8 decision and confidence; `analyze_clip.py` prints the result JSON.
- [x] 6. `tests/test_breathing_synthetic.py`: every row of the synthetic table passes.
- [x] 7. Farneback flow cross-check, background gate, flicker gate; re-run the synthetic tests.
- [x] 8a. Implement the identity/reducer HTTP client, retry policy, SATS encoding/decoding and smoke script; local tests pass.
- [ ] 8b. Run `smoke_stdb.py` against the published module and capture a real SQL fixture.
- [x] 9. `worker.py`: one background thread, job states, writes `report_breathing` then `set_critical_score` (score from E4; until E4, skip it), `pending_write` retry every 10 s.
- [x] 10a. Implement helper source and watcher filtering/deduplication, with HTTP polling fallback.
- [ ] 10b. Build and run the subscription helper using the actual generated bindings.
- [ ] 11. Run every E1 clip, fill a results table (clip, truth, result, rate, confidence, reason), and tune `config.toml` on half the clips; check the other half.
- [ ] 12. Write the tuned values into `config.toml` with a comment naming the clips they were tuned on, and post the results table in the team chat.

Done when: on E1's clips, the rate is within 3 breaths per minute of the hand count when the chest is visible, and covered or dark clips come back `unknown`, never a confident wrong answer.
Tests with pass criteria:

- Synthetic: `f` in 0.15, 0.25, 0.4, 0.6, 0.9 Hz at 1 px gives `detected`, within 1.5 per minute, confidence at least 0.5; every gate case gives its exact reason string (perception.md 10).
- Real: no clip is `detected` with confidence at least 0.5 and a rate more than 3 per minute from the truth, and no held-breath clip is `detected`.
- Lights-off clips return `unknown` with `clip too dark, needs light` or `clip too noisy (low light)`.
- `smoke_stdb.py` reads back a changed survivor, and the helper prints the survivor update within 2 s.
- End to end 1: the simulator creates a survivor, `curl ... /breathing` with its id, and the dashboard shows the breathing result within 15 s.
- End to end 2: Camille's bridge on mocks uploads a clip with `report_detection`, and the watcher picks it up with no manual call.
- End to end 4: stop SpacetimeDB for 30 s mid-job; the result is written after it returns.

Prompt for your coding agent:

```
Read docs/specs/perception.md sections 3, 4 (all steps, the result JSON, the [breathing] config table,
the re-scan rule), 8 (8.1 to 8.6), and 10 (unit tests and the synthetic clip table), and the
report_breathing row in the "Reducers" table of docs/specs/CONTRACTS.md. Check the argument order against
docs/specs/spacetimedb.md and `spacetime describe assess-0hw81 reducers --json`; spacetimedb.md wins.
In backend/perception/, implement video.py, roi.py (operator, center, background ROI, ROI checks, roi.jpg;
leave pose and box as stubs that return None), breathing.py, worker.py, stdb.py, watcher.py,
scripts/make_synthetic.py, scripts/analyze_clip.py (prints the result JSON; --roi and --debug flags; no database),
scripts/smoke_stdb.py, and stdb-helper/ (TypeScript, generated bindings from backend/spacetimedb-bindings/,
subscribe to detection, survivor, search_cell, print one NDJSON line per row event, never write).
Every threshold comes from config.toml [breathing] with the defaults in the table. Use signed cell means,
scipy butter + sosfiltfilt with output="sos", a Hann window, nfft 4096, and parabolic peak interpolation.
Write tests/test_breathing_synthetic.py covering every row of the synthetic table, and tests/test_stdb.py
for enum and option encoding and the row decoder. No output string may contain dead, deceased, expectant, or no pulse.
```

Pitfalls and fixes:

- Exposure lock: if the robot's clip was recorded with auto exposure, the flicker gate fires (`lighting or exposure changed`); ask Camille to confirm the lock in `robot.md` 12.2.
- Dark clips: low light raises gain, so noise grows before the mean drops; both gates are needed, and both thresholds must be tuned on the demo-light clips, not room-light clips.
- Robot sway: motion in every pixel trips the background gate (`camera or scene moved`); the robot must settle before recording (`inspect.still_gyro_dps` in robot.md).
- Doubled rate: using absolute differences folds the sinusoid; use signed means as the spec says.
- A peak on the band edge bin: return `unknown`, `peak at band edge`, not a rate.
- HTTP 530 from a reducer is a rejection with the `SenderError` text; log it and do not retry.
- `IS NULL` on option columns is unsupported in SpacetimeDB SQL; filter in Python.
- The perception role is rejected: the site is not in demo mode; log the identity hex and ask Cayden for `grant_role`.

### E4. Critical score
Estimate with AI: 1 h.

Goal: levels and formula from `specs/perception.md`, every weight in config, reasons as short strings, confidence capped when no breathing is seen, never a dead label, re-score every 60 s on meaningful change.

Why it matters: demo beat 4 (IMMEDIATE, breathing rate, confidence, and why); the ranking the orchestrator and the watchdog use; State Farm's "most urgent needs".

Inputs: E3 results; `survivor` and `detection` rows (thermal confidence, `created_at`, status) from the helper or HTTP SQL.

Outputs: `set_critical_score(survivor_id, level, score, confidence, reasons)`, read by the dashboard, the orchestrator's wake packet, the auditor's rule checks, and the comms agent's briefings.

Files to create: `perception/score.py` (pure function, no I/O), `[score]` section in `config.toml`, re-score timer in `watcher.py`, `score_writes` table in `store.py`, `tests/test_score.py`.

Rules (perception.md section 7):

- Level `immediate` if breathing is `not_detected` or `unknown`, rate over 30 or under 10, or visibility under 30%; else `delayed`; never `minor`, never `unknown` once scored, no dead or expectant value anywhere.
- `score = 100 * (0.5 * breath_term + 0.3 * (1 - v) + 0.2 * min(1, t / 30))`, rounded to one decimal and clamped to 0 to 100.
- Confidence: `q * d` when `detected`, else `min(0.3, d)`.
- Reasons: the table in perception.md 7, in order, at most 48 characters each, at most 8, always ending with `needs human triage`.
- Re-score every 60 s for `unassigned`, `assigned`, `en_route` survivors; write only if the level changed, the score moved 2.0 or more, the confidence moved 0.05 or more, or the survivor was never scored; score new survivors at once.

Commands:

```bash
pytest -q tests/test_score.py
python scripts/analyze_clip.py testdata/real/eric_dim_none_lying_1.mp4 --score
```

Checklist:

- [x] 1. `score.py` with `breath_term`, level, score, confidence, and reasons; every weight and threshold from `[score]`.
- [x] 2. `tests/test_score.py`: each level rule, the hand-checked example (`not_detected`, `v = 0.2`, `t = 15` gives 84.0), the 0.3 cap, never `minor`, reason limits, and the banned-words test.
- [x] 3. Call `set_critical_score` right after `report_breathing` in `worker.py`; skip it if `report_breathing` failed.
- [x] 4. Re-score timer in `watcher.py` with the meaningful-change rule and the `score_writes` table; new survivors scored at once with `no breathing clip yet`.
- [ ] 5. Add a `--score` flag to `analyze_clip.py` (assumes `t = 0`, `d = 0.8` unless given) and run every E1 clip.
- [ ] 6. With the simulator, leave a survivor unassigned for 5 minutes and watch the score rise with `waiting 5 min`.

Done when: a score appears on the dashboard with its reasons for each E1 clip.
Tests with pass criteria:

- `pytest -q tests/test_score.py` passes, including the banned-words test (`dead`, `deceased`, `expectant`, `no pulse` never appear in any output).
- Each E1 clip, posted to `POST /breathing` against a simulator survivor, shows a level, score, confidence, and reasons on the dashboard within 15 s.
- A held-breath or covered clip shows `immediate` with `no signs of life detected, low confidence` or `breathing unclear, re-scan`, and confidence at most 0.3.
- `event_log` does not get a `score_changed` row every minute for a waiting survivor (about one every 3 minutes with default weights).

Prompt for your coding agent:

```
Read docs/specs/perception.md section 7 (inputs, level, score, confidence, reasons table, [score] config,
re-score rule) and section 10 (score.py unit tests), and the set_critical_score row in docs/specs/CONTRACTS.md.
Implement backend/perception/perception/score.py as a pure function with no I/O, taking breathing, rate,
breathing confidence, visibility (or None), minutes waiting, thermal confidence (or None), and the earlier-result-kept
flag, and returning level, score, confidence, reasons. Every number comes from config.toml [score].
Add the call to set_critical_score after report_breathing in worker.py, and the 60 s re-score timer in watcher.py
with the meaningful-change rule and a score_writes table in store.py. Write tests/test_score.py with every case
listed in section 10, including the 84.0 example and a test that no output string contains dead, deceased,
expectant, or no pulse. Never output the level minor.
```

Pitfalls and fixes:

- Writing every minute floods `event_log`; respect `rescore_min_delta` and `rescore_conf_delta`.
- Unknown visibility stored as 0 looks like "fully buried" in the database; send none, and let the score treat it as buried with the reason `visibility unknown, treated as buried`.
- Do not score `reached` or `resolved` survivors.
- The weights are untuned guesses; say so if a judge asks, and say the levels are START-like, not START.

### E5. Camera person confirmation
Estimate with AI: 1 h.

Goal: YOLO person detection on the laptop on the robot's still; the person box also feeds the breathing chest region and the visibility estimate.

Why it matters: it confirms that the thermal blob is a person (MVP priority 3), and it gives the chest region and the "how much of the body shows" number that drives the IMMEDIATE level.

Inputs: `detection.camera_image_url` (the robot's still, uploaded by Camille's bridge) and the 5 sample frames from the clip (E3).

Outputs: `pose` and `box` chest ROIs and `chest_visible_k` for E3, `visibility_pct` for `report_breathing` and E4, and a drawn image for the dashboard.

Files to create or change: `perception/roi.py` (pose and box branches), the watcher hook for stills, `tests/test_roi.py`.

Model: `yolo26n-pose.pt`, fallback `yolo11n-pose.pt`, `conf=0.25`, keypoints 5 and 6 (shoulders) and 11 and 12 (hips) with `kp_conf` 0.5 (perception.md 4 step 2).

Additive outputs (not in CONTRACTS.md, so mark them PROPOSED and agree them with Cayden before the dashboard uses them):

- `det<detection_id>_person.jpg`: the still with the person box and keypoints drawn, served through `GET /media/<name>`.
- `person_image_url`, `person_confirmed` (bool), and `person_conf` in `GET /breathing/detection/<id>`, next to the existing `roi_image_url`.

Commands:

```bash
python -c "from ultralytics import YOLO; YOLO('yolo26n-pose.pt')"   # downloads weights; use yolo11n-pose.pt if it fails
python scripts/analyze_clip.py testdata/real/eric_room_none_lying_1.mp4 --debug   # now uses pose
pytest -q tests/test_roi.py
```

Checklist:

- [ ] 1. Download the pose weights on good internet and check that `GET /health` shows `yolo: loaded`.
- [x] 2. Pose branch in `roi.py`: run on the 5 sample frames, best box per frame, medians of box and keypoints, chest ROI from shoulders and hips (perception.md 4 step 2).
- [x] 3. Box branch (upright, lying, other) and the `k` table; visibility from the keypoint fraction (perception.md 5), none when no person is found.
- [x] 4. Still path: when a detection with `camera_image_url` arrives, run YOLO on it, save `det<id>_person.jpg`, and store the result for `GET /breathing/detection/<id>`.
- [ ] 5. Run all E1 clips again; check that `roi.jpg` puts the green chest box on the chest for lying and sitting clips, and fix the factors in config if not.
- [ ] 6. Send Cayden the image URL fields and confirm where the dashboard's survivor detail shows them.

Done when: the box is drawn on the dashboard image for the E1 clips.
Tests with pass criteria:

- On every room-light E1 clip with the chest visible, `roi_source` is `pose` or `box`, and the green chest box overlaps the real chest in `roi.jpg` (checked by eye, noted in the results table).
- A covered clip gives `visibility_pct` under 30 or none, and therefore `immediate`.
- No person in frame gives `visibility_source = "none"` and `visibility_pct` none (never 0).
- The dashboard's survivor detail shows the drawn image for at least one simulator survivor fed with an E1 still.

Prompt for your coding agent:

```
Read docs/specs/perception.md section 4 step 2 (YOLO pose details, chest ROI from keypoints, from the box,
fixed region, background ROI, chest visible fraction k, ROI checks) and section 5 (visibility estimate).
In backend/perception/perception/roi.py, implement the pose and box branches with Ultralytics:
model name from config [breathing] yolo_model (yolo26n-pose.pt), falling back to yolo11n-pose.pt if loading fails;
model(frames, conf=yolo_conf, verbose=False) on the 5 sampled frames; medians over frames; keypoints 5, 6, 11, 12.
Return roi_source, the chest ROI, the background ROI, k, visibility_pct (or None), and visibility_source.
Draw roi.jpg (person box white, chest ROI green, background ROI blue, keypoints, roi_source text).
Add a still path: for a detection with camera_image_url, run the model on the still, write det<id>_person.jpg
to the media index, and include person_image_url, person_confirmed, person_conf in GET /breathing/detection/<id>
(these are additive, PROPOSED fields). Load the model once at startup. Write tests/test_roi.py with a synthetic
image (no person) giving visibility_source "none".
```

Pitfalls and fixes:

- Dim frames give low YOLO confidence: keep `yolo_conf` at 0.25 and rely on the `box` and `center` fallbacks; never lower confidence gates on the breathing side to compensate.
- Weights download on first use: run step 1 on good internet, never first at the venue.
- A person under cover has no keypoints: that is expected; `k` stays low, so the result is `unknown`, not `not_detected`.
- YOLO and OpenCV competing for the CPU: run everything on the one worker thread.

## Phase 1: agents (PROPOSED)

### E6. Shared agent runner
Estimate with AI: 2 h.

Goal: one Node.js TypeScript runner; each agent is a configuration (prompt, tools, model, wake rules, fallback); coordination only through `agent_task`; every call logged with `chain_id`.

Why it matters: MVP priority 2, the agent hand-off chain on the `agent_task` board shown live on the Agents panel (NVIDIA multi-agent with tools, State Farm coordination, SpacetimeDB agents as clients).

Inputs: E0 tool-mode decision; Cayden's module and bindings in `backend/spacetimedb-bindings/` (until then, `FakeWorld`); the simulator.

Outputs: three connected agent identities (`orchestrator`, `comms_agent`, `auditor`), `agent_task` claims and completions, `agent_action` rows with `agent`, `model`, `step`, `chain_id`, `reason`, and `logs/trace-<date>.jsonl`; read by Cayden's Agents panel.

Files to create (agent.md 3.1; skip the agent configs, they are E7):

- `src/index.ts`, `src/config.ts`, `src/stdb/connect.ts`, `src/stdb/convert.ts`, `src/world.ts`, `src/chain.ts`, `src/board.ts`.
- `src/llm/client.ts`, `src/llm/budget.ts`, `src/llm/parse.ts` (from E0), `src/loop.ts`.
- `src/tools/schemas.ts`, `src/tools/reads.ts`, `src/tools/writes.ts`, `src/tools/dispatch.ts`, `src/guards.ts`, `src/priority.ts`, `src/geo.ts`, `src/log.ts`.
- `test/*.test.ts` with `FakeWorld`, `FakeActions`, and `MockLLM` replaying `test/fixtures/`.

Key behavior:

- One `DbConnection` per agent with its own token in `.tokens/<name>.token`; `register_participant(name, role)` on first connect; reconnect with backoff 1, 2, 4, 8, then every 10 s.
- Wake rules from subscriptions only (agent.md 5.4), debounced by `DEBOUNCE_MS` and `MAX_WAIT_MS`, except `critical` tasks.
- One cycle (agent.md 5.2): claim, resolve `chain_id`, one wake packet, budgeted model request, dispatch tool calls, complete, `cycle_summary`.
- Shared budget: `RPM_BUDGET` token bucket, priority `critical` then `high` then `normal`, then orchestrator, comms agent, auditor, then oldest; 429 backoff 2, 4, 8 s with jitter, at most 3 retries; two failures in a row marks the model down for 60 s.
- `dispatch.ts`: ajv validation, allow list, guard on fresh data, execute, `log_agent_action`, trace line; rejected calls are logged too.
- Argument lists: use the generated bindings; `spacetimedb.md` lists `post_agent_task(to_agent, kind, payload_json, priority, reason, chain_id)` and `log_agent_action(tool, args_json, result, reason, step, model, chain_id)`; if the published module lacks the `chain_id`, `model`, or `step` arguments, put them as the first keys of `payload_json` and `args_json` (our temporary fallback until the module publishes the version 8 signatures; agent.md 5.5 passes `chain_id` as the last argument).
- Dry-run: `DRY_RUN=1` calls no reducer at all (write tools return `{ok:true, dry_run:true}`); `DRY_RUN=log` calls only `log_agent_action` with result `dry_run: not executed`.

Commands:

```bash
cd backend/agent
npm run typecheck && npm test
DRY_RUN=1 AGENTS=all npm start          # against the local module, real model
DRY_RUN=log AGENTS=all npm start        # dashboard team sees rows, no state changes
```

Environment variables: everything in agent.md 3.2, especially `STDB_URI`, `STDB_DATABASE`, `STDB_TOKEN_DIR`, `AGENTS`, `RPM_BUDGET`, `DRY_RUN`, `DEBOUNCE_MS`, `MAX_WAIT_MS`.
For the dry-run test with no model calls, add a runner switch that swaps the OpenAI client for `MockLLM` (for example `LLM_MODE=mock`); this switch is our own addition, not in agent.md, so document it in the folder README.

Checklist:

- [x] 1. `config.ts` (typed, fails fast on a missing key unless `LLM_MODE=mock`), `log.ts` (console plus JSONL trace).
- [x] 2. `geo.ts` (haversine, R = 6,371,000 m, bearing, 8 compass words) and `priority.ts` (tiers 0, 1, 2; G3), with tests.
- [x] 3. `tools/schemas.ts` with every schema from agent.md 7.1 to 7.4 as one source for native and JSON modes, and `guards.ts` G1 to G8 (death-word regex, 120-character briefings, ASCII, no names to models).
- [x] 4. `stdb/connect.ts` and `stdb/convert.ts` (camelCase to snake_case, bigint ids to numbers, tagged enums to strings, `Identity` to hex, `Timestamp` to ISO).
- [x] 5. `world.ts` (active run filter, rescuer fresh and available, robot idle) and `FakeWorld` with the same interface.
- [ ] 6. Connect three identities to the local module, register them, and print the active run (needs Cayden's module; else continue on `FakeWorld`).
- [x] 7. `chain.ts` (survivor chain is the `survivor_created` event id; tasks carry their chain) and `board.ts` (post, claim, complete; 120 s stale rule).
- [x] 8a. Implement dispatch validation, guards, action logs and chain IDs; fake-module task/log tests pass.
- [ ] 8b. Confirm a task round trip and matching `agent_action` in the live database.
- [x] 9. `llm/client.ts` and `llm/budget.ts` with the priority queue, 429 backoff, model-down switch, and tests (25 queued in a minute send 20; critical jumps normal).
- [x] 10. `loop.ts` with step and tool-call limits, the cycle deadline (lease minus 5 s), `<think>` stripping, and the JSON mode path through `parse.ts`.
- [ ] 11. Dry-run modes and `MockLLM`; run one full chain against the local module and the simulator with `DRY_RUN=1 LLM_MODE=mock`.

Done when: dry-run mode logs a full chain against the local SpacetimeDB and the simulator without calling the model.
Tests with pass criteria:

- `npm run typecheck` and `npm test` pass (priority, guards, parse, budget, chain, templates).
- `DRY_RUN=1 LLM_MODE=mock`: the console and trace show, for one simulator survivor, a wake, a proposal, a `brief_rescuer` task, a `review`, and a briefing, all with the same `chain_id`, and the SpacetimeDB tables are unchanged (`spacetime sql assess-0hw81 "SELECT * FROM agent_task"` shows no new rows).
- Tool-calling smoke test: `npm run smoke:llm` still passes with the runner's real `llm/client.ts` (not only the script's own client).
- `DRY_RUN=log`: `agent_action` rows appear with result `dry_run: not executed`, and nothing else changes.

Prompt for your coding agent:

```
Read docs/specs/agent.md sections 1, 2, 3, 4.2, 4.4, 4.5, 5 (all), 6 (all), 7.1, 12.1, 12.2, and the
"Proposed contract changes"; then docs/AGENT_WORKFLOW.md (it wins on the agent set: orchestrator, auditor,
comms_agent only; there is no robot_agent), then docs/specs/CONTRACTS.md (FINAL, version 8) and the
reducer signatures in docs/specs/spacetimedb.md (post_agent_task ends with chain_id; log_agent_action is
(tool, args_json, result, reason, step, model, chain_id)). The generated bindings in backend/spacetimedb-bindings/
are the final word on argument lists.
In backend/agent/src, build the shared runner: config.ts, log.ts, geo.ts, priority.ts, tools/schemas.ts,
guards.ts, stdb/connect.ts, stdb/convert.ts, world.ts, chain.ts, board.ts, tools/dispatch.ts, tools/reads.ts,
tools/writes.ts, llm/client.ts, llm/budget.ts, loop.ts, index.ts. Only stdb/ and world.ts import the bindings.
Implement DRY_RUN=0|1|log exactly as section 12.2, and add an LLM_MODE=mock switch that swaps the OpenAI client
for a MockLLM replaying test/fixtures/ (document it as our addition in README.md). Write vitest tests with
FakeWorld, FakeActions, and MockLLM for every case in section 12.1. Do not write the agent configs yet.
```

Pitfalls and fixes:

- Rate limits: one model call per survivor at simulator scale blows the budget; one orchestrator cycle covers all pending survivors in one wake packet.
- JSON tool-call fallback: a parse failure gets one correction ("Reply with one JSON object only."); a second failure ends the cycle and the fallback runs; never loop.
- Timeouts: the OpenAI client's `maxRetries` must be 0, or it retries outside the budget and doubles the request count.
- Row callbacks before `onApplied`: ignore them, or the agents act on half-loaded state.
- `u64` ids arrive as `bigint`: convert at the edge; `JSON.stringify` throws on bigint.
- Enum tag strings: the module sets `CaseConversionPolicy.None`, but bindings use PascalCase keys; map in `convert.ts` only.
- Identity hex to `Identity` for `propose_assignment` is UNCONFIRMED; check the bindings for a `fromString` helper early.
- A reducer call resolves before the cache has the new row (UNCONFIRMED): wait for the insert callback, at most 2 s.
- Logging failures must never loop; write the error to the console and continue.

### E7. Orchestrator and auditor first, then the comms agent's model
Estimate with AI: 2 h.

Goal: the orchestrator proposes rescuers, plans the search, creates robot missions, and delegates; the auditor judges each proposal's quality (wrong rescuer, unfair load).
Comms briefings start as templates (at most 120 characters); add the comms agent's model once the core demo runs end to end.

Why it matters: demo beat 5 (the hand-off chain live on the Agents panel) and beat 8 (stop the agent, the database still assigns); the core of the NVIDIA track.

Inputs: E6 runner; Cayden's module (with `propose_assignment` creating the `review` task, `agent_watchdog`, `set_site_timings`); the simulator with rescuers, a robot, and person reports; E3 and E4 scores.

Outputs: proposals, missions, `brief_rescuer` tasks, review verdicts and `audit_flag` rows (`proposal_disagree` or `load_imbalance`, `filed_by = auditor`), and briefings; read by the glasses service (Cayden), the robot bridge (Camille, through missions), and the dashboard.

Files to create: `src/agents/orchestrator.ts`, `src/agents/auditor.ts`, `src/agents/comms.ts`, `src/templates.ts`, `src/rules.ts`, `scripts/scenario.ts`, scenario fixtures in `test/fixtures/`.

System prompts: use the full texts in agent.md 7.2 (orchestrator), 7.3 (comms agent), and 7.4 (auditor) word for word; do not rewrite them here or in code comments; the only change is that no prompt mentions a search agent.

Tool allow lists:

| Agent | Model | Tools |
| --- | --- | --- |
| Orchestrator | `MODEL_SUPER`, `reasoning_effort: "low"` | `get_board`, `get_survivor`, `list_rescuers`, `list_cells`, `get_robot`, `propose_assignment`, `delegate`, `set_flag_status`, `create_mission`, `cancel_own_mission` (`sitrep` in E10) |
| Auditor | `MODEL_NANO` | `get_board`, `get_survivor`, `list_rescuers`, `submit_review` |
| Comms agent | `MODEL_NANO` (or templates with `ENABLE_COMMS_MODEL=0`) | `get_survivor`, `send_briefing` (`describe_still` in E10) |

Rules to get right:

- Review task: the `agent_task` kinds table in CONTRACTS.md and `spacetimedb.md` section 8.6 say `propose_assignment` itself creates the `review` task (also for watchdog proposals); `dispatch.ts` posts one only if none appears within 2 s (our fallback, not in agent.md), so there is never a second review.
- Heartbeat policy (agent.md 8.1): the orchestrator calls `agent_heartbeat()` every 5 s only while its model is up and no tier 0 wake waited more than 8 s; when the model is down, it stops the heartbeat so the watchdog takes over.
- No double proposals (agent.md 8.2): re-read the survivor just before `propose_assignment`; if the watchdog already proposed, skip and log "already proposed by watchdog".
- The comms agent also wakes on a `proposed` assignment with no `brief_rescuer` task after 5 s (a watchdog proposal) and briefs it from the template.
- Auditor rules verdict (`rules.ts`): `disagree` if a higher-tier survivor is unassigned or a free rescuer is over 50% closer, else `agree` with "rules check only"; these checks also go into the auditor's wake packet.
- Every fallback action is logged with `model: "rules"` and the reason prefixed `[fallback]`.

Commands:

```bash
cd backend/agent
ENABLE_COMMS_MODEL=0 AGENTS=all npm start                       # build order: templates first
npm run scenario -- chain
npm run scenario -- priority
npm run scenario -- auditor_disagrees
npm run scenario -- comms_fallback
# kill test: two processes whose budgets add up to 20
AGENTS=orchestrator RPM_BUDGET=10 npm start
AGENTS=comms_agent,auditor RPM_BUDGET=10 npm start
npm run scenario -- kill_orchestrator
npm run scenario -- race
npm run scenario -- all_down
npm run scenario -- budget
ENABLE_COMMS_MODEL=1 npm run scenario -- chain                  # comms model last
TOOL_MODE=json npm run scenario -- chain
```

Checklist:

- [x] 1. `orchestrator.ts`: config, the agent.md 7.2 prompt, the wake packet builder (format in agent.md 7.2, including `WATCHDOG: fires in N s`), and wake rules.
- [x] 2. Orchestrator guards for `propose_assignment` (survivor unassigned, rescuer available, no higher-tier survivor waiting, lapsed-rescuer rule, 50% closer rule needs a reason) and `delegate`.
- [x] 3. `create_mission` and `cancel_own_mission` guards, the continue and inspect decisions, and the `rules.ts` continue rule for an idle robot when the model is down.
- [x] 4. Heartbeat policy, model-down switch (stop heartbeat, one `model_down` action), and the "already proposed by watchdog" check.
- [x] 5. `auditor.ts`: the agent.md 7.4 prompt, the review wake packet with `RULE CHECKS (code)`, `submit_review` (completes the task; on `disagree` files the flag with `flag_kind`), and the `rules.ts` verdict fallback.
- [x] 6. `templates.ts` and `comms.ts` with `ENABLE_COMMS_MODEL=0`: briefing, breathing part, nudge at half of `proposal_lease_s`, navigation hint with terrain, model-down answer; every template at most 120 characters.
- [x] 7. `scenario.ts` with the eight scenarios of agent.md 12.3, checking end states and required tool names, not exact order.
- [x] 8. Pass mock scenarios plus the recorded real-Brev chain, priority and seeded auditor-disagreement checks; these use the fake database.
- [ ] 9. Two-process run; `kill_orchestrator`, `race`, `all_down`, `budget` until they pass.
- [x] 10. Verify modeled briefings and three consecutive native/JSON Brev chains against the fake database; briefing guards remain enforced. The integrated demo is still pending.
- [x] 11. Pass three recorded real JSON chains and all eight mock scenarios; mock regression tests pass.

Done when: on the simulator, one detection produces a proposal, an auditor verdict, and a briefing, all with the same `chain_id`, and stopping the orchestrator still lets the module's watchdog assign.
Tests with pass criteria:

- `chain` passes three times with the real models: a proposal to the nearest free rescuer, a `brief_rescuer` task, a `review` task with a verdict in `result_json`, an `inspect` mission for the house with a person unaccounted for, and a briefing of at most 120 characters, all with one `chain_id`; no proposal by the comms agent or the auditor; no death words.
- `priority`: with one free rescuer, it goes to the `not_detected` survivor, not the earlier `delayed` one.
- Kill the orchestrator, the watchdog still assigns: with two processes running, kill the orchestrator process (Ctrl+C) before the simulator adds a new `immediate` survivor; an `agent_watchdog_fallback` event and a module proposal appear within `site.agent_watchdog_s`; the comms agent briefs it from the template (`model: "rules"`); the headline stays "Critical survivors unattended over 60 s: 0"; there are never two proposals for one survivor.
- `race`: with the orchestrator slowed to just past the watchdog time, exactly one proposal exists, and "already proposed by watchdog" is in the log.
- `auditor_disagrees`: the auditor completes `review` with `disagree`, one `proposal_disagree` flag with `filed_by = auditor` exists, and the orchestrator wakes and sets the flag status with a reason; the proposal was never blocked.
- `comms_fallback` and `all_down`: template briefings with `model: "rules"`, a nudge at half the proposal lease, no empty glasses panel, and no stuck survivor.
- `budget`: 10 detections in 10 s use at most 20 requests per minute, and the auditor falls back first, with no 429 loops.

Prompt for your coding agent:

```
Read docs/AGENT_WORKFLOW.md first (three agents: orchestrator, auditor, comms_agent; no search agent;
build order orchestrator and auditor first, comms templates, comms model last; cut order).
Then read docs/specs/agent.md sections 5.4, 5.6, 7.1, 7.2, 7.3, 7.4, 8, 9, 10, 11, 12.3, and 13, and
docs/specs/CONTRACTS.md (FINAL, version 8). Note that propose_assignment in the module creates the review task
(the agent_task kinds table in CONTRACTS.md, docs/specs/spacetimedb.md); dispatch.ts must post one only if none appears within 2 s.
On the existing runner in backend/agent/src, add agents/orchestrator.ts, agents/auditor.ts, agents/comms.ts,
templates.ts, and rules.ts. Use the system prompts in agent.md 7.2, 7.3, 7.4 verbatim. Implement every guard in the
tool tables, the wake packets as shown, the heartbeat policy of 8.1, the double-proposal check of 8.2, the
comms wake on a proposed assignment with no brief_rescuer task after 5 s, and the fallbacks of section 9 with
model "rules" and reasons prefixed [fallback]. Honor ENABLE_COMMS_MODEL and ENABLE_AUDITOR_MODEL.
Write scripts/scenario.ts with the eight scenarios of 12.3 (chain, priority, kill_orchestrator, race,
auditor_disagrees, comms_fallback, all_down, budget) against the local module and backend/sim in demo mode,
checking end states and required tool names, not exact order. Add MockLLM fixtures so chain runs in npm test.
```

Pitfalls and fixes:

- Super is slow: the orchestrator must propose in its first request and delegate after, or the watchdog fires first; if replies take more than about 10 s, try `reasoning_effort: "none"`.
- Rate limits during rehearsal: two processes need `RPM_BUDGET=10` each, so the total stays 20.
- JSON tool-call fallback: if the native mode starts returning tool calls in `content` under load, set that model's `TOOL_MODE_*=json` and restart; it is a config change, not code.
- Timeouts: comms 6 s, auditor 10 s, orchestrator 15 s; a request past its agent's deadline is dropped and the fallback runs.
- The watchdog never fires in the kill test: the orchestrator's last `model_down` action counts as an agent action and delays it once; wait one more watchdog period, or ask Cayden whether the module counts only the heartbeat (the Timers table in CONTRACTS.md and agent.md 8.1 say it does).
- Long briefings: the guard rejects them with the length in the error, so the model can shorten; templates drop parts from the end.
- A disagree verdict must not cancel a proposal already on the glasses; only coordinators reassign.

### E8. Speech-to-text for rescuer questions (should have)
Estimate with AI: 1.5 h.

Goal: transcript for questions rescuers ask through the G2 glasses microphone (NVIDIA speech model if available, else Whisper), handed to the comms agent as an `answer_rescuer` task.

Why it matters: MVP priority 6 (NVIDIA: the comms agent earns its place by answering a real question); cut third in the agent cut order, so build it only after E7 passes.

Inputs: Cayden's glasses service (it wraps the 16 kHz, 16-bit, mono PCM in a WAV, uploads it with `POST /media` `kind=voice`, calls `POST /transcribe`, then the `rescuer_ask` reducer); the module inserts the `answer_rescuer` task for `comms_agent`.

Outputs: `{"transcript","confidence","engine"}` from `POST /transcribe` for the glasses service; the comms agent's answer briefing (`kind` answer) on the rescuer's glasses.

Files to create: `perception/stt.py`, the `POST /transcribe` handler in `app.py`, `tests/test_stt.py` with a recorded question WAV and a silence WAV; on the agent side, the `answer_rescuer` path in `src/agents/comms.ts`.

Engines (perception.md 12.2):

- `nvidia_riva` (default): Parakeet ASR on build.nvidia.com through `nvidia-riva-client`; copy the exact server, flags, and function id from the model's API page (`parakeet-ctc-1.1b-asr` for English, or `parakeet-tdt-0.6b-v2`); UNCONFIRMED until the smoke test passes.
- `whisper_local`: `WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")`, then `model.transcribe(path)`.
- `none`: last resort.
- Startup picks the engine with a 1 s test clip and falls back in order; `GET /health` and each result show `engine` as `nvidia_riva:<model name>`, `whisper_local:<size>`, or `none`.

Commands:

```bash
cd backend/perception && source .venv/bin/activate
python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', device='cpu', compute_type='int8')"   # download weights
curl -F file=@testdata/voice/is_anyone_else_in_house_3.wav http://localhost:8080/transcribe
STT_ENGINE=whisper_local uvicorn perception.app:app --host 0.0.0.0 --port 8080
pytest -q tests/test_stt.py
```

Environment variables: `STT_ENGINE`, `NVIDIA_API_KEY` (perception's own `.env`), `RIVA_SERVER`, `RIVA_FUNCTION_ID`, `WHISPER_MODEL`; on the agent side `ENABLE_QUESTIONS=1`.

Checklist:

- [x] 1a. Keep the existing question/silence WAV fixtures; public speech and generated silence also provide reference-version development checks without new recordings.
- [ ] 1b. Verify the primary engine on the chosen demo question fixtures and noisy rescuer-style audio; keep this separate from a public general-speech smoke.
- [x] 2. `stt.py` `whisper_local` engine with resampling to 16 kHz mono (`scipy.signal.resample_poly`) and `tests/test_stt.py`.
- [x] 3. `POST /transcribe` (`file` or `audio_url`, optional `rescuer` logged only), synchronous, no database write.
- [ ] 4. `nvidia_riva` engine: run the model page's `transcribe_file.py` command once by hand with the key, then wrap the same call in `stt.py`.
- [x] 5. Engine selection at startup with fallback, and `engine` in `GET /health` and in every result.
- [x] 6a. Implement the facts-only template answer path and recipient/briefing guards.
- [ ] 6b. Implement and test model-generated `answer_rescuer` answers from task/board facts with template fallback.
- [ ] 7. With Cayden, run the full loop from the glasses (or the fallback page's Ask button) and time it.

Done when: a spoken question on the glasses comes back as an answer on the display.
Tests with pass criteria:

- `tests/test_stt.py`: a recorded question gives a non-empty transcript on `whisper_local`; silence gives an empty transcript.
- `POST /transcribe` with a recorded question returns text in under 3 s on the hosted engine and under 10 s on `whisper_local` (perception.md 10, end to end 5).
- Unset `NVIDIA_API_KEY`: `GET /health` shows `whisper_local`, and the previous test still passes (end to end 6).
- From the glasses: the transcript shows on the lens, the `answer_rescuer` task appears on the Agents panel, and the answer appears on the lens within 30 s (glasses.md test step 8).

Prompt for your coding agent:

```
Read docs/specs/perception.md section 12 (input, engines, POST /transcribe, tests) and section 10 end to end
tests 5 and 6, and docs/specs/glasses.md section 5.15 (the rescuer_ask flow), and the answer_rescuer rows in
docs/specs/agent.md 5.6 and 7.3. In backend/perception, implement perception/stt.py with engines nvidia_riva
(nvidia-riva-client, server and function id from RIVA_SERVER and RIVA_FUNCTION_ID, key from NVIDIA_API_KEY as a
Bearer token, never logged), whisper_local (faster-whisper, WHISPER_MODEL, cpu, int8), and none; resample to
16 kHz mono with scipy.signal.resample_poly; pick the engine at startup with a 1 s test clip and fall back in
order. Add POST /transcribe returning {transcript, confidence, engine}, and engine in GET /health.
Write tests/test_stt.py. Then in backend/agent/src/agents/comms.ts, handle answer_rescuer tasks: answer only
from the task payload and board facts, at most 120 characters, template "Board: {place} {found} found,
{unaccounted} unaccounted. Ask coordinator for more." when the model is down. Respect ENABLE_QUESTIONS.
```

Pitfalls and fixes:

- The Riva function id or server is wrong: copy both from the model's API page; do not guess; if it fails, ship `whisper_local` and say so.
- Loud venue audio transcribes badly: the glasses show the transcript before the answer, so a bad transcript is visible, not silent.
- Whisper weights download on first use: download before the venue.
- The comms agent invents facts: the prompt says to answer from the task facts only; if the facts do not answer it, it says to ask a coordinator.
- Privacy: the hosted engine sends the recording to NVIDIA; for the demo the voices are teammates'.

### E9. Terrain camera model (should have)
Estimate with AI: 2 h.

Goal: advisory classes flat, debris, step, gap, blocked from the robot's camera; never overrides a safety stop.

Why it matters: MVP "should have" terrain recognition and priority 6 (NVIDIA); start only after E3 and E4 work end to end with a real clip.

Inputs: forward camera frames from Camille's bridge (`POST /terrain` with `file`, `robot_id`, `rule_class`), the robot's sensor log frames, and Matthew's mock rubble set (M7) in full and dim light.

Outputs: `{"terrain_class","confidence"}` returned to the bridge as an advisory hint (Camille fuses it), `GET /terrain/latest`, and, only with `terrain_write_db = true`, `report_terrain(..., source = "camera_model")`.

Files to create: `perception/terrain.py`, the `POST /terrain` and `GET /terrain/latest` handlers, `scripts/label_terrain.py`, `scripts/train_terrain.py`, `data/terrain_labels.csv`, `data/terrain_model.joblib`, a JSON evaluation report.

Commands:

```bash
pip install transformers scikit-learn        # torch comes with ultralytics
python scripts/label_terrain.py --frames data/media/run_0/dog1
python scripts/train_terrain.py --labels data/terrain_labels.csv --test-run <run id>
curl -F file=@frame.jpg -F robot_id=dog1 -F rule_class=flat http://localhost:8080/terrain
```

Checklist:

- [ ] 1. Record frames over each mock rubble type in full and dim light, at least 50 per class (by hand or from the bridge).
- [x] 2. `terrain.py` zero-shot CLIP baseline with one prompt per class (perception.md 9), `unknown` below 0.5.
- [x] 3. `POST /terrain` (skip frames older than 5 s, store with `kind=terrain`, at most 1 per second per robot) and `GET /terrain/latest`.
- [x] 4. `label_terrain.py`: keys 1 to 6, Enter accepts the rule class, `s` skips; label the disagreements first.
- [x] 5a. Implement the frozen-CLIP/logistic-regression training script with run-separated evaluation.
- [ ] 5b. Train it on independent labels and retain a full held-out source/run; no completed training/evaluation is claimed.
- [ ] 6. Evaluation report: confusion matrix, recall on `gap`, `step`, `blocked`, agreement with the robot's rules, latency p50 and p95, baseline versus probe.
- [ ] 7. Turn the hint on only if the probe beats the baseline on the held-out run; agree with Camille how the dashboard map shows it (the robot's fused report, or a test with `terrain_write_db = true` and the robot's own reports off).

Done when: it labels frames from the mock rubble set, and the labels show on the dashboard map.
Tests with pass criteria:

- The evaluation report exists for a held-out run, and the probe's recall on `gap`, `step`, and `blocked` is at least the baseline's.
- p95 latency under 300 ms per image on the laptop CPU.
- A camera class never makes an action less cautious, and never changes `stop` (the fusion rule in perception.md 9; unit-test it).
- The dashboard map shows a terrain label for the robot during a run on the mock rubble set.

Prompt for your coding agent:

```
Read docs/specs/perception.md section 9 (role, where it runs, fusion rule, weekend approach, training data,
latency limits, evaluation, permission) and the report_terrain row in docs/specs/CONTRACTS.md (version 8:
it overwrites the robot's latest terrain fields). In backend/perception, implement perception/terrain.py
with classify(image) -> (terrain_class, confidence): a zero-shot baseline with openai/clip-vit-base-patch32
(CLIPModel and CLIPProcessor) and the class prompts in section 9, and a linear probe (frozen image embeddings,
sklearn LogisticRegression) loaded from data/terrain_model.joblib when present. Add POST /terrain (file,
robot_id, rule_class; skip frames older than terrain_max_age_s; store as kind=terrain) and GET /terrain/latest.
Write report_terrain only when config terrain_write_db is true (default false). Write scripts/label_terrain.py
and scripts/train_terrain.py with a split by run and the evaluation metrics listed. Unit-test the fusion rule.
Classes are exactly flat, debris, step, gap, blocked, unknown.
```

Pitfalls and fixes:

- Dark frames: the same regular camera needs light, so dim frames lower CLIP accuracy; label dim frames too.
- Random frame splits overstate accuracy; split by run.
- Two writers flip the robot's terrain fields: keep `terrain_write_db = false` unless the robot's own reports are off.
- Stale advice: drop frames older than 5 s; the robot never waits for the laptop.

### E10. Vision describer and sitrep tools (could have, cut first)
Estimate with AI: 1 h.

Goal: the vision describer tool (`describe_still`, comms agent) and the sitrep tool (orchestrator); only after everything above works.

Why it matters: extra NVIDIA tool use; first and second in the cut order, so skip without regret.

Inputs: `detection.camera_image_url` from the media server; `world.ts` counts.

Outputs: a description of at most 15 words that the comms agent may put into a briefing; a sitrep briefing of at most 120 characters to `commander` or `coordinators`.

Files to create: `src/tools/vision.ts`, `src/tools/sitrep.ts`, `scripts/smoke-vision.ts`.

Commands:

```bash
npm run smoke:vision
ENABLE_VISION=1 ENABLE_SITREP=1 npm start
```

Checklist:

- [ ] 1. `smoke-vision.ts`: one test still, downsized to at most 640 px, as a base64 data URL to `MODEL_VISION` with the fixed prompt in agent.md 7.5; record the reply and latency.
- [ ] 2. If the smoke test passes, `describe_still` (once per survivor, 8 s timeout, one budget request, `ENABLE_VISION=1`); ask the team first whether one camera still per survivor may go to NVIDIA's cloud.
- [ ] 3. `sitrep`: numbers from `world.ts`, words from the model, at most once every 5 minutes in an orchestrator cycle, `ENABLE_SITREP=1`.

Done when: `smoke:vision` returns a description for one test still, a description appears in one briefing, and one sitrep briefing reaches the commander audience.
Tests with pass criteria: the description is at most 15 words with no names or ids sent; the sitrep is at most 120 characters and passes G2; with both flags at 0, nothing changes.

Prompt for your coding agent:

```
Read docs/specs/agent.md section 7.5 and the vision rows of 4.1 and 4.5. Write backend/agent/scripts/smoke-vision.ts
that sends one still (downsized to 640 px on the long side) to MODEL_VISION as a user message with an image_url
part holding a base64 data URL, with the fixed prompt from 7.5, stream false, max_tokens 256, 8 s timeout.
Then add src/tools/vision.ts (describe_still, comms agent only, ENABLE_VISION) and src/tools/sitrep.ts
(orchestrator only, ENABLE_SITREP, numbers from world.ts, at most once per 5 minutes). Both use the shared
budget and pass the G2 and G8 guards. Send no names, identities, ids, or coordinates to the model.
```

Pitfalls and fixes:

- The vision model id is UNCONFIRMED; if the smoke test fails, cut the tool and move on.
- A dark still gives a useless description; the tool needs a lit scene.

## Hand-offs by checkpoint

| Checkpoint | You need | You deliver | To whom |
| --- | --- | --- | --- |
| 0 Setup | NVIDIA key; Cayden's database name | Smoke test result, tool mode per model in `specs/agent.md` and the team chat (E0); the first E1 clips in the shared drive | Team; Cayden for the pitch |
| 1 Module and mocks | Cayden's module published with bindings; demo mode or `grant_role` | Media server reachable on the hotspot (E2); `smoke_stdb.py` passing; three agent identities registered (E6) | Camille (upload URL), Cayden (identities to grant) |
| 2 Whole flow, no robot | Cayden's simulator and fallback glasses page; the dashboard reading `agent_action` and `agent_task` | Breathing and score from a `curl`-posted E1 clip (E3, E4); `chain` scenario passing with templates; kill test passing (E7) | Cayden (dashboard and glasses show it live) |
| 3 Robot on the board | Camille's bridge posting real clips with `clip_url`, `survivor_id`, `detection_id`; Matthew's light (M4) | A real robot clip comes back with a rate, or an honest `unknown` with its reason; tuned `config.toml`; person box image (E5) | Camille, Matthew (light verdict) |
| 4 End to end | Real G2 glasses through Cayden's glasses service; the M6 range test result | Agents reacting to a real find; comms model on (E7 step 10); voice questions if time (E8); terrain hint if time (E9) | Everyone |
| 5 Demo ready | Two rehearsals of `specs/demo.md` | Every fallback switch tried once (below); weights pre-downloaded; numbers for the slides (latency, requests per chain, clip results table) | Cayden (slides, video, Devpost) |

## Cut order if time runs short

From `docs/AGENT_WORKFLOW.md` and perception.md section 11:

1. E10 vision describer (`ENABLE_VISION=0`).
2. E10 sitrep (`ENABLE_SITREP=0`).
3. E8 rescuer voice questions (`ENABLE_QUESTIONS=0`).
4. The comms agent's model (`ENABLE_COMMS_MODEL=0`, templates stay).
5. The auditor's model review (`ENABLE_AUDITOR_MODEL=0`, rules verdicts stay).

Perception cuts: EVM clip first, then E9 terrain model; keep the operator ROI if YOLO is not finished.
The orchestrator, the breathing check, and the critical score are never cut.

## Demo day checklist

API key and budget:

- [ ] `NVIDIA_API_KEY` is in `backend/agent/.env` and `backend/perception/.env` on the demo laptop, and neither file is in git.
- [ ] Run `npm run smoke:llm` the morning of judging; if a model fails, switch its `TOOL_MODE_*` or its fallback flag now, not on stage.
- [ ] `RPM_BUDGET=20` for one process, or `10` plus `10` for the two-process kill demo.
- [ ] Ask the NVIDIA mentors (again, if not answered) what rate limit applies to the key.

Fallbacks, each tried once in rehearsal:

- [ ] Agents stopped: the watchdog assigns, template briefings appear with "RULES FALLBACK", the headline stays 0.
- [ ] Comms model off: `ENABLE_COMMS_MODEL=0` gives template briefings.
- [ ] Auditor model off: `ENABLE_AUDITOR_MODEL=0` gives rules verdicts.
- [ ] Tool calls failing: `TOOL_MODE=json` for both models.
- [ ] Speech-to-text: `STT_ENGINE=whisper_local` works with the network unplugged.
- [ ] Maincloud down: `STDB_URI`, `STDB_URI` point at the local server, and both services reconnect.
- [ ] Breathing unreliable in the venue light: the dashboard shows the signal and an honest low confidence; the operator ROI (`roi` form field) is ready.

Perception ready:

- [ ] YOLO pose weights, faster-whisper `small.en`, and CLIP (if used) are downloaded on the demo laptop.
- [ ] `GET /health` shows `ok`, `stdb: ok`, `yolo: loaded`, and the speech engine.
- [ ] Record one clip in the venue's real light, run it, and adjust `clip_dark_mean_min` and `clip_noise_max` only if a well-lit clip is rejected.
- [ ] The macOS firewall allows Python; the Pi reaches `PUBLIC_BASE_URL` over the hotspot.

What to show on the Agents panel (full screen with `A`, or `?view=agents&survivor=<id>` for the video):

- [ ] Agent status cards: Orchestrator on Nemotron 3.5 Super VL, Auditor and Comms agent on Nemotron 3.5 Lightning, each with its model chip and heartbeat.
- [ ] The task board: `brief_rescuer` and `review` cards moving from open to claimed to done as the robot finds the teammate.
- [ ] The chain for the found survivor: detection, score, proposal, auditor verdict, briefing, acknowledgement, with the total "detection to acknowledgement" time.
- [ ] One auditor objection (the `load_imbalance` example from agent.md section 10) and the orchestrator's response under it.
- [ ] The kill beat: stop the orchestrator process, then point at the watchdog fallback event, the "RULES FALLBACK" chip on the comms briefing, and the headline still at 0.
- [ ] Say plainly in the pitch: the agents improve decisions; the database keeps the promise that nobody is dropped; no agent drives the robot, resolves a survivor, or labels anyone dead.
