# Eric: unfinished work and dependencies

Updated 2026-11-08; the `eric-cv-benchmark` work (A1, A3 to A8) merged to `main` in PR #11.
The earlier quick-wins handoff
was recorded on `eric-quick-wins` (from `main` at `38e8e31`).
This is the practical handoff for [Eric's full checklist](eric.md), not a change
to MVP scope or assignments. The owner names below follow the existing task files.
An artifact missing from this checkout may already exist on a teammate's branch;
ask for its location and interface before rebuilding it.

## Read this first

- **The judged demo is hard-coded** (Cayden, 2026-11-08). Only SpacetimeDB runs live,
  and `backend/sim/` scripts the robot, the find, the breathing result, the score and
  the rescuer actions. Nothing below changes what judges see. This work makes the agents
  and perception real and honest for questions, side demos and after the event. Never
  describe the agents, perception, the real robot or the real G2 as live in the demo.
- **Brev state (2026-11-08):** `hackutd-super` (Super VL NVFP4 on the RTX PRO 6000) was
  **deleted** to save credits; it could not be paused. `hackutd-lightning` (Lightning BF16
  on the A100) can be stopped and started. After `brev start`, its vLLM container must be
  started by hand: `ssh hackutd-lightning 'sudo docker start lightning'`, then wait a few
  minutes for the model to load (`curl 127.0.0.1:8000/v1/models` on the instance).
  Any task below that needs the orchestrator's model (Super) needs a new Super instance or
  the hosted build.nvidia.com API with a key. Stop Lightning when it is not in use.

## Finished on 2026-11-08 (branch `eric-quick-wins`)

| Item | What changed | Evidence |
| --- | --- | --- |
| E2 1b, environment lock | `backend/perception/requirements.lock` is `pip freeze` of the working primary `.venv` (Python 3.12.12, macOS arm64); the README says how to use it | 766 perception tests passed in that environment |
| R1 step 6, blocking logger | `raspberrypi/robot/src/core/log.cpp` only queues lines (bounded at 1024; extra lines are dropped and counted, with a "log dropped N lines" note later); a writer thread does the stderr I/O | `tests/test_log.cpp` (20,000 lines into an unread pipe return in under 500 ms); a rerun of the audit case answered every `robotctl` command in about 40 ms and latched SAFE_STOP on e-stop; 62 robot tests pass |
| E6 3b, G8 identity policy | Models see only callsigns. `redactForModel` (`backend/agent/src/guards.ts`) replaces every participant's identity hex with a callsign or role on every outbound turn; the model-facing `rescuer_identity` and `audience` take callsigns; `resolveCallsigns` maps them back to hex before dispatch; packets no longer print `id <hex>` | `test/guards.test.ts`; native and JSON G8 cases in `test/loop-runtime.test.ts` assert no 64-hex string in any model request and that a callsign proposal commits the right rescuer; 115 agent tests and 8/8 mock scenarios pass; rule written into `specs/agent.md` G8 |

Real-model check of the G8 change (2026-11-08, Lightning on Brev standing in for all three
agents, since Super was deleted): `npm run scenario -- --real` passed `priority`,
`auditor_disagrees` and `kill_orchestrator`. The model proposed "Rescuer A" by callsign, the
assignment committed to Rescuer A's identity, the auditor cited callsigns and distances, and
both briefings reached Rescuer A. `chain` failed one check in all three runs: the orchestrator
created a mission, but not of kind `inspect`. That is the orchestrator's model choice (the
audit saw Super skip inspection at low reasoning too), not the identity mapping, and Lightning
is not the orchestrator's real model. Rerun on Super under B1.

R1 step 9's local scripted check passed on `eric-cv-benchmark`, 2026-11-08:
88 robot tests pass, and the executable passed hold, latched e-stop, rejected restart,
reset and SIGINT shutdown with exit 0. The [captured log](../notes/2026-11-08-r1-scripted-mock-check.md)
is ready for review; pasting it into the PR remains open. The G8 change has not been
run against Super; see E7 10b.

## What is already working (unchanged)

- Primary perception service: media uploads, durable breathing jobs, PIC/ROI analysis,
  person/pose code, scoring, re-scans, watcher, HTTP database client, optional speech and
  terrain modules.
- Primary agent runner: shared runner, tools and guards, task board, budgets, orchestrator,
  auditor, comms, templates and model routing.
- Local transition validation ([note](../notes/2026-11-08-eric-transition-validation.md)):
  the actual module accepted all three agent identities, task/action round trips, proposals,
  review, briefing and simulated acknowledgement; perception writes and the helper's live
  subscription passed. These local checks do not establish Maincloud roles or the full flow.
- Recorded Brev validation ([note](../notes/2026-11-08-brev-validation.md)): both models
  passed tool calls, tool results, reasoning off and JSON actions, against a fake database.

The primary app is `backend/perception/` plus `backend/agent/`. The `codex-reference/`
folders are a separately tested implementation and are not imported by the primary app.
Do not replace the primary runner with the reference copy.

## Remaining tasks in detail

Each task lists why it matters, the steps, and when it is done. Estimates assume coding agents.

### A. Can be done now on a laptop (no Brev, no hardware, no teammates)

#### A1. E1/E3: run the public benchmark through the primary pipeline (about 2 h)

**Completed on `eric-cv-benchmark`, merged in PR #11, 2026-11-08.**
`backend/perception/scripts/benchmark_public.py` runs the 15 synthetic, 4 VRWi and 16
MPSC-RR windows through `perception.breathing.analyze` in two modes: "reference" (the same
inputs as the reference run, YOLO off) and "service" (no operator ROI, YOLO pose on).
Results with scores are in `backend/perception/testdata/public/primary-results.json`; the
"primary" table is in `docs/research/breathing-repos.md`. Synthetic: average error
0.01/min, 15/15 expected outcomes in reference mode. VRWi: 2/4 within 3/min in reference
mode, 3/4 in service mode (all at confidence 0.4 or below). MPSC-RR (no labels): 4 of 16
detected in each mode, the rest abstained on "lighting or exposure changed" or "camera or
scene moved". `tests/test_benchmark_public.py` covers the synthetic path. No threshold was
tuned. The prepared clips live in git-ignored `codex-reference/` folders; the doc has the
commands to rebuild them.

Why: the 140 public-data results in `backend/perception/codex-reference/` measure the
reference code, not the code the service runs. Any accuracy claim about the primary
pipeline needs its own numbers.

Steps:
1. Read `codex-reference/scripts/compare_breathing.py` and `prepare_public_clips.py`, and
   `codex-reference/testdata/public/` (`prepared.json`, `truth.csv`, `mpsc-rr.json`,
   `vrwi.json`, `baselines.json`). Find where the prepared clips live on disk; if they are
   not in the checkout, rerun the preparation script into a git-ignored folder.
2. Write `backend/perception/scripts/benchmark_public.py` that feeds each prepared window
   through the primary offline analysis (the same entry point `scripts/analyze_clip.py`
   uses, so the service and the benchmark share code) and writes one JSON row per window:
   source, subject, window, truth rate, result, rate, confidence, reason, abstained.
3. Keep subject and source splits: VRWi (4 windows, one seated subject, belt-derived truth),
   the 15 synthetic cases (known truth), and MPSC-RR (16 windows, **no public rate labels**:
   report coverage and abstentions only, never accuracy).
4. Write `backend/perception/testdata/public/primary-results.json` and a short table in
   `docs/research/breathing-repos.md` next to the reference table, labelled "primary".
5. Add a pytest that runs the synthetic cases only (fast, no downloads) and checks the
   known rates stay within the current tolerance.

Done when: a primary results table records coverage, rate error, confidence, failures and
abstentions per source; MPSC-RR rows are excluded from accuracy metrics; the synthetic
regression test passes.

#### A2. E3: diagnose false rejections, then tune on development inputs only (about 1 h, after A1)

**Completed on `codex/a2-quality-gate-audit`, 2026-11-08.** Development was fixed
to VRWi M14 resting 030s/060s; evaluation to 090s/120s before A2 reruns. The
smallest successful candidate changed only `flicker_c_max`, 0.5 to 0.6, recovering
030s in reference mode at 14.2/min versus belt 14.39. Both candidates preserved
all 15 synthetic expectations. Evaluation showed no improvement: 1/2 within
3/min in each mode, with 090s still wrong or abstained. MPSC-RR detected coverage
rose from 4/16 to 7/16 reference and 6/16 service, without accuracy evidence.
Its motion rejections are confounded by off-chest lying ROIs, so the motion
threshold stays fixed. All four VRWi windows were previously seen in A1 and
come from one subject; this is weak temporal-split evidence. The frozen trials,
all evaluation numbers and gate-bypass failures are in
[the audit](../notes/2026-11-08-quality-gates.md).

Why: if the primary pipeline rejects clean public windows as low quality, the dashboard
shows "not seen" for a breathing person.

Starting point from A1: 12 of 16 MPSC-RR windows and one VRWi window per mode abstain on
the flicker gate ("lighting or exposure changed") or the motion gate ("camera or scene
moved"). VRWi 030s is the clearest case: the reference code read 14.2/min (truth 14.39),
the primary rejects it in reference mode but reads 13.7 in service mode. Only VRWi has
labels, so the development and held-out split is small; say so in the result.

Steps: from A1, list windows rejected by a quality gate (`clip_dark_mean_min`,
`clip_noise_max`, ROI or motion gates in `config.toml`). Split the labelled windows into a
development half and a held-out half before looking at results. Change thresholds only on
the development half, write the reason and the clip names in a comment in `config.toml`,
then report the held-out half without further changes.

Done when: the synthetic and nuisance tests still pass, held-out numbers are reported as
they came out, and every threshold change names the clips it was tuned on.

#### A3. E4 step 5 and E4/E5 batch: score every case and review the chest boxes (about 1 h)

**Completed on public data on `eric-cv-benchmark`, merged in PR #11, 2026-11-08.**
YOLO pose (`yolo26n-pose`) loads in the primary `.venv`. Every public and synthetic row
has a score with reasons (`--score` in the benchmark, the same `try_score` as
`analyze_clip.py`), and every dark, noisy or abstained case scored with confidence at most
0.3 and "needs human triage". Every service-mode `roi.jpg` was opened: VRWi 4/4 on chest;
MPSC-RR front 8/8 on chest after a fix; MPSC-RR lying 8/8 off chest (filmed from above,
head out of frame, no usable pose), with the box factors left unchanged and the operator
ROI as the fallback. The fix: with both shoulders visible and the hips hidden, the torso
axis followed the person box's long axis, so a torso filling a wide frame got a sideways
chest box; it is now perpendicular to the shoulder line, away from the face
(`perception/roi.py`, two tests in `tests/test_roi.py`, spec line in `perception.md`).
Not covered: no public clip shows a covered person, and no robot-camera clip exists yet.

Why: the score is what orders survivors. `scripts/analyze_clip.py --score` exists but has
not been run across the clips, and the green chest box in `roi.jpg` has only been reviewed
for the reference version.

Steps:
1. Check `GET /health` or a direct load shows YOLO pose loaded in the primary `.venv`
   (E5 step 1; download the weights on good internet if missing).
2. Run `analyze_clip.py --score` over every public and synthetic case; save score and
   reasons next to the A1 results.
3. Open each `roi.jpg`; record "on chest", "off chest" or "no person" per clip. Fix the
   chest factors in `config.toml` only if lying or sitting clips are off chest.
4. Check that covered and dark cases come out uncertain, never confident.

Done when: every case has a score with reasons and a reviewed ROI, and covered or dark
cases stay uncertain.

#### A4. E6 11 and E7 7b: the live scenario path with the mock model (about 2 h)

**Completed locally on `eric-cv-benchmark`, 2026-11-08.** `scenario -- chain --live`
now runs actual primary agent runtimes in a child process against the real local module
and simulator. Detection, proposal, review and briefing shared chain 254, and a simulated
rescuer acknowledged. A separate fresh `DRY_RUN=1` run completed the shadow chain while
live assignments, tasks, briefings, actions, missions and audit flags stayed empty.
The harness rejects remote servers, shared database names and nonempty databases.
See [validation note](../notes/2026-11-08-live-agent-scenarios.md).
Primary breathing, real models, dashboard and glasses were not part of these runs.

Why: every agent scenario so far runs against a fake database. This proves the same agents
work against the real SpacetimeDB module and the simulator, with no model calls.

Steps:
1. Start a local SpacetimeDB server and publish `backend/spacetimedb/` to it under a
   throwaway database name (never the shared `assess-0hw81` on Maincloud; the run mutates
   data). `backend/README.md` has the commands.
2. Run `backend/sim` against it (`npm run sim -- setup`, then a timeline that produces a
   detection) with `STDB_URI` and `STDB_DATABASE` pointing at the local server.
3. Replace the placeholder in `backend/agent/scripts/scenario.ts` (the `--live` branch near
   line 44) with a runner that starts the three agents with `LLM_MODE=mock` (and
   `DRY_RUN=1` for the E6 11 variant), waits for the detection, and checks one chain:
   survivor, proposal, review verdict, briefing, all with the same `chain_id`.
4. Record the run in a dated note in `docs/notes/`.

Done when: `npm run scenario -- <name> --live` passes one full chain against the local
module and the simulator without calling a model, and the dry-run variant logs the chain
without writes.

#### A5. E7 9: two-process failure runs on the mock model (about 1 h, after A4)

**Completed locally on `eric-cv-benchmark`, 2026-11-08.** Actual worker processes
passed `kill_orchestrator`, `race`, `all_down` and `budget` against separate real local
databases. Kill verified the module watchdog and a `RULES FALLBACK` comms template.
The stable delayed-reply race was won by the module's sweep backstop, with exactly one
proposal and rejection of the late agent proposal. All-down verified escalation,
heartbeat release and replacement; budget covered ten detections, batched proposals,
rolling send limits and auditor-first queue fallback under an explicitly depleted
test budget. This is controlled local acceptance, not default-capacity load testing.
See [evidence and fixture limits](../notes/2026-11-08-live-agent-scenarios.md).

Steps: with the A4 setup, run the orchestrator and the other agents as two processes and
run `kill_orchestrator`, `race`, `all_down` and `budget`. For `kill_orchestrator`, kill the
process and check the module's own schedule-table watchdog assigns, the comms briefing shows
"RULES FALLBACK", and no survivor is left unassigned.

Done when: all four pass against the real module, and the note says which timer did the
work (module watchdog versus agent fallback).

#### A6. E8 6b: model answers to rescuer questions (about 1.5 h; mock tests now, real model in B2)

**Completed locally on `eric-cv-benchmark`, 2026-11-08.** The comms model now receives
an explicit question and an allowlisted board facts block, with callsign redaction and
the existing template fallback. Answers are guarded to the asking rescuer and the task's
survivor, including rejection of broadcast audiences. Native and JSON mock tests cover
factual and unknown answers, privacy, wrong recipients and survivors, 121-character
rejection, timeout/server failure, model down and both feature flags. The agent typecheck
and all 136 primary tests passed (17 question tests, plus a watchdog-briefing regression). Mock replies exercise the runner
and guards; they do not establish real-model factual accuracy. B2 and the live voice path
remain open. See [validation note](../notes/2026-11-08-comms-question-validation.md).

Original gap: `answer_rescuer` always used the template in `backend/agent/src/agents/comms.ts`.

Steps:
1. Build a facts block from the task payload and board only (survivor level, breathing,
   place, location note, the rescuer's own assignment). No names, no identity hex (G8 now
   handles that, but do not add them).
2. Ask the comms model for one `send_briefing` to the asking rescuer; keep the template as
   the fallback on timeout, rejection or model down.
3. Mock tests: a factual answer, an "I do not know, ask a coordinator" answer when the facts
   do not cover the question, a reply to the wrong rescuer is rejected, 121 characters is
   rejected, and the fallback fires when the model fails.

Done when: those mock tests pass and `ENABLE_COMMS_MODEL=0` still gives the template.

#### A7. E8 1b: check local transcription on the fixtures (about 45 min)

**Local evaluation completed on `eric-cv-benchmark`, 2026-11-08.** Primary
`whisper_local:small.en` CPU/int8 processed 54 calls: question fixtures, public speech,
and silence, clean and at two noise levels, with three repeats. All 18 silence/noise-only
calls returned empty text. Speech medians were 0.889 to 1.071 s on this laptop.
At 0 dB white noise, the house number was corrupted, so venue reliability is unproven.
Question reference transcripts and recording provenance are unverified; no question
accuracy claim is made. Results are in the perception README and
[validation note](../notes/2026-11-08-local-transcription-evaluation.md).
The existing STT tests passed all 17 cases. Actual glasses audio remains separate.

Steps: run `whisper_local` (`perception/stt.py`) on the question WAV fixtures, a public
speech clip and generated silence; add noise at two levels; record text, time per clip and
model size (`WHISPER_MODEL`). Silence must give empty text, not invented words.

Done when: results and timings are in `backend/perception/README.md`, with the noise and
model-size limits stated.

#### A8. Refresh the counts in the docs (15 min, any time)

**Refreshed 2026-11-08:** `docs/MVP.md` and `docs/TASKS.md` record 136 primary agent
tests plus typecheck, 770 primary perception tests, and 106 robot tests, rerun on
`eric-cv-benchmark` after merging `main` (which added Camille's leg and calibration tests)
and before PR #11 merged. The R1 step 9 evidence below was recorded at 88 robot tests,
before that merge.

Original gap: the overview docs quoted older test counts (109 agent, 753
perception). Update them from a fresh run when the branch merges.

### B. Needs a model server (Lightning on Brev, a new Super, or the hosted API)

#### B1. E7 10b: bound the intermittent native-chain failure

Why: one real native chain produced no committed assignment, then reruns passed. A passing
streak is not proof. The G8 change also means models now pass callsigns instead of hex, so
real chains must be rerun anyway.

Needs: Super for the orchestrator. Lightning alone covers the auditor and comms only.

Steps: run 10 native and 10 JSON chains (`npm run scenario -- <name> --real`), keep every
trace, count failures by cause (bad arguments, rejected guard, timeout, no tool call), and
check each failure ended in a rules fallback, not a stuck survivor.

Done when: the failure rate and causes are written in the Brev validation note, and every
failure was caught by a fallback.

#### B2. E8 6b real model: run the A6 tests against Lightning

Lightning is enough (comms runs on it). Open the tunnel
(`ssh -fNT -L 18000:127.0.0.1:8000 hackutd-lightning`), set `NANO_BASE_URL`, and run the
answer tests with the real model.

#### B3. Judging-day smoke (demo day checklist in `eric.md`)

`npm run smoke:llm` against whichever deployment is chosen; switch `TOOL_MODE_*` or the
fallback flags on failure. Only matters if the agents are shown outside the hard-coded demo.

### C. Needs a teammate or hardware

| Task | Who | What Eric needs | What it unblocks |
| --- | --- | --- | --- |
| Confirm Maincloud roles for the perception, orchestrator, auditor and comms identities | Cayden, C1/C4 | Demo mode or granted roles on `assess-0hw81`; confirmed lease and watchdog timings | Agents and perception writing to the shared database |
| Full flow on dashboard and glasses (simulator detection to glasses acknowledgement, one `chain_id`, plus a second subscribed screen) | Cayden, C2/C3/G1-G3 | A time to run it together, after A4 | The integrated story, outside the hard-coded demo |
| E8 7: voice question from the glasses or fallback page, timed | Cayden, G1-G3 | Upload, transcribe and `rescuer_ask` flow working | Spoken question and answer |
| E2 8: Pi upload over the team network | Camille, R3/R5/R6 | Node.js bridge pushed; reachable media URL; uploads with detection and survivor IDs | Real thermal-to-breathing path |
| Inspect capture and E1 recordings (steps 1 to 7) | Camille R5, Matthew M4/M6/M7 | Stopped camera, about 20 s clips, locked exposure, gain and white balance; agreed light and mock rubble scene | Real-camera breathing and ROI checks |
| E9: terrain model | Camille R7, Cayden dashboard | Timestamped forward frames, independently labelled hazard images, a single writer for terrain fields | Advisory terrain hints, only after held-out evaluation |
| E0 step 7: post the Brev results to the team chat | Eric | [Paste-ready draft](../notes/2026-11-08-human-posts.md); a person posts it, still unsent | Team knows what was measured |
| R1 step 9: scripted mock check log in the PR | Eric | Local check passed with 88 robot tests; [PR #11 comment draft with log](../notes/2026-11-08-human-posts.md), still unsent | Closes R1 after a person posts it |
| R3: Node.js bridge (`raspberrypi/bridge/`) | Camille (owner); Eric offered to take it on 2026-11-08 | Camille's agreement, and whether she has unpushed bridge work | The real robot reaching SpacetimeDB; E2 8 |
| First Pi camera clip over SSH (`rpicam-vid`, exposure, gain and white balance locked, 20 s) | Eric | **Done 2026-11-08** ([note](../notes/2026-11-08-first-pi-clip.md)): far clip abstains ("chest region too small"); close seated clip with a 33 ms shutter is "detected" at 7.2/min, confidence 0.35. Open: rate not counted, no held-breath clip, per-frame lock unconfirmed, camera runs at 34.4 fps not 30 | First check that the robot camera's clips pass the pipeline |

E10 (vision describer and sitrep) is could-have and is cut first. Before any person image
goes to a hosted model, the team must decide it is allowed.

## Live acceptance that has not happened yet

- [x] Connect all three agent identities and the perception identity to the actual local module (2026-11-08).
- [ ] Confirm the identities and roles on the shared Maincloud deployment.
- [x] Capture actual SQL fixtures and verify adapter/helper wire formats and reducer calls (isolated local module, 2026-11-08).
- [ ] Run simulator detection, primary breathing, score, proposal, audit, briefing and glasses acknowledgement with one chain ID (A4 does this with the mock model).
- [ ] Show the results on the dashboard and a second subscribed screen.
- [ ] Stop or disconnect actual workers and glasses; verify the database's real schedule tables, leases, escalation and watchdog (A5). The fake-module tests are not this test.
- [ ] Show score ageing without flooding the event log.
- [ ] Upload from the Pi over the team network and process an actual inspect clip.
- [ ] Run glasses voice question, transcription, agent answer and display, and time it.
- [ ] Enable terrain advice only after held-out evaluation and conservative fusion checks pass.
- [ ] Try the documented fallbacks in rehearsal and repeat the model smoke before judging.

## Public data instead of new recordings

No new teammate dataset is needed to continue development. Available inputs:
16 MPSC-RR windows, 15 deterministic synthetic cases and four VRWi windows with
independently measured belt signals in the reference implementation. MPSC-RR has no public
rate labels in the pinned release. VRWi rates come from dual belts; time-zero alignment
follows the authors' preprocessing and was not independently verified. Four windows from
one seated subject cannot prove general rescue-scene accuracy.

Public speech and generated silence can test transcription. Pretrained YOLO avoids training
a person detector. Public robotics sets such as [RELLIS-3D](https://github.com/unmannedlab/RELLIS-3D)
have labelled terrain images, but their classes do not cover our step and gap hazards by
themselves. Never make labels from model predictions and call them truth.

A public video cannot verify the robot's camera, light and mounting; that check still
happens during robot integration.

## Decisions and external checks

- Hosted Riva speech: confirm the server, function and model from the NVIDIA API page if
  wanted. Local Whisper stays the fallback; Riva is not verified in this checkout.
- Person images to a hosted vision model (E10) need a team decision first.
- Ask the NVIDIA mentors about rate limits; repeat the smoke against the chosen deployment.
- Any proposed contract change still goes through the human decision process.

## Next order

1. A2 is complete with weak evidence and no labelled evaluation gain; see the audit above. Eric can send the E0 and R1 drafts now (still unsent).
2. First Pi camera clip over SSH, then the E1 recordings with Camille and Matthew.
3. R3 Node.js bridge, if Camille agrees to hand it over.
4. With Cayden: Maincloud roles, then the full flow on dashboard and glasses.
5. B1 and B2 when a model server is up; stop Lightning afterwards.
6. Robot capture path with Camille and Matthew; rehearse.
7. E9 terrain only after the core path; E10 last, if at all.
