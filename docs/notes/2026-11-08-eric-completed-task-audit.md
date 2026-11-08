# Eric completed-task audit, 2026-11-08

Audited on `codex/eric-transition-validation`, based on `main` at `3635d22`,
including the uncommitted transition fixes. Scope: every checked implementation
item in `docs/tasks/eric.md`, plus Eric's eight checked R1 items in
`docs/tasks/camille.md`. That is 75 checklist claims, including repeated setup
claims. The requirements are `docs/MVP.md`, `docs/TASKS.md`, the component task
files, `docs/specs/CONTRACTS.md`, and the perception, agent and robot specs.

Brev is the intended model deployment. Both models were tested through Eric's
existing SSH aliases and configured servers, without a Build API key. No new
compute instances were created and no model deployment was changed.

## Outcome

Most checked implementation items are supported by fresh tests. They are not
whole-task or whole-MVP completion claims. Three areas need qualification:

1. **R1 step 6 fails the non-blocking main-loop requirement.** The logger takes
   a mutex and calls blocking `fprintf(stderr, ...)` in `src/core/log.cpp`.
   During ACTIVE on mocks, filling the unread stderr pipe and requesting e-stop
   made the next `robotctl status` time out after 2.01 s. Draining the pipe let
   the loop resume in latched SAFE_STOP. The independent movement deadman test
   passes, but it does not make this main loop non-blocking. Reopened this item.
   No actuator or motion implementation was changed by this audit.
2. **E6 step 3 does not establish all of G8.** The initial packet removed known
   participant names, but subsequent tool results did not. A synthetic
   `get_survivor` location note containing a known participant's name reached
   the second model request. Fixed by redacting each outbound turn and matching
   names case-insensitively; native and JSON regression tests pass. Persistent
   rescuer identity hex still reaches models through packets and read tools.
   G8 forbids this, while the same spec's tool examples require these identities.
   Full G8 therefore remains open for a consistent identity/alias policy. This
   finding concerns request contents, not the decision to use Brev.
3. **Real-model repeatability is conditional.** Three consecutive native chains
   and three consecutive JSON chains passed. A later native chain failed:
   proposal attempts did not produce a committed assignment, so no review or
   briefing chain formed. A diagnostic native rerun passed, with rejected model
   actions handled by rules/template fallbacks; a later JSON chain also passed.
   Retain the failure as evidence of intermittent behavior. A passing streak is
   not proof of reliable judging-day operation. Added an open reliability check.

## Defects fixed during the audit

- `scripts/analyze_clip.py --score` silently skipped scoring because its argument
  aliases did not match the primary `compute_score` API. A regression reproduced
  the missing result. The command now uses the actual API, loads the service's
  breathing and score configuration, applies `--set` last, and returns an error
  if explicitly requested scoring fails. Both the regression and an actual
  video invocation pass.
- Known participant names in later native/JSON model turns are now redacted.
  The authoritative cache and reducer inputs remain unchanged by redaction.
- Added tests that drive terrain label keys 1 to 6, Enter, skip, back/relabel,
  and quit/save without opening a window.

The earlier branch changes to the helper test command, simulator Node typings,
live adapter smoke and SQL fixture remain included and pass again.

## Fresh evidence

| Evidence | Result | Scope |
| --- | --- | --- |
| P: primary perception `pytest -q -ra` | 761 passed, zero skipped, 105.34 s | Includes actual cached YOLO, Whisper small.en and CLIP; 576 cases are conservative-fusion parameter combinations, not independent scene trials |
| A: agent `npm run typecheck && npm test` | Typecheck passed; 129 tests passed | 99 primary and 30 separate reference tests; mocks are not live database integration |
| S: `npm run scenario -- all` | 8/8 passed | Fake module, MockLLM; covers chain, priority, kill, race, disagreement, comms fallback, all-down and budget |
| B: Brev `smoke:llm` | Both models passed native calls, tool results, reasoning-off and JSON actions | Super native call 1,550 ms; Lightning 907 ms; HTTP 200 |
| B: real Brev scenario repeats | Initial native 3/3, JSON 3/3; priority/disagreement/kill 3/3 | Fake database with real models; later native 0/1, diagnostic native 1/1, final JSON 1/1 retained |
| L: local adapter smoke | Passed on actual SpacetimeDB 2.14.1 | Three registrations, active run, task/action round trips, proposal, review, briefing, simulated acknowledgement, mission option arguments |
| L: perception database smoke | Passed | Actual identity, breathing then score writes, SQL readback and helper subscription update |
| H: real HTTP primary pipeline | Passed | Synthetic video upload -> queued job -> actual analysis -> ordered local database writes -> served ROI; 15.0/min, confidence 0.8, 2.42 s with fixture ROI |
| H: automatic watcher/person path | Passed | New detection containing uploaded clip and public still -> automatic analysis at 15.0/min -> person confirmed 0.885 -> served overlay |
| D: module `npm test` and TypeScript | 68 printed smoke checks passed; typecheck passed | Real disposable database schedules, leases, disconnection, escalation, watchdog and backstop |
| N: helper and simulator | Helper typecheck/build and 3 tests; simulator typecheck and 20 tests passed | Actual generated bindings; no physical Pi |
| R: robot clean CMake build with `ROBOT_WERROR=ON` | Build and all 60 tests passed | All hardware mocked; optional hardware backends off on this laptop |
| R: robot scripted control sequence | Passed | READY -> ACTIVE -> latched SAFE_STOP -> reset -> READY -> SIGINT -> exit 0 in 0.128 s |
| R: blocked logger diagnostic | Failed | Main control loop stalled for over 2 s until stderr was drained |
| F: reference perception suite | 33 passed | Separate implementation, not primary accuracy |
| F: reference comparison rerun | 140/140 executions, zero errors | All four methods on 35 existing inputs; pinned upstream hashes checked by harness |
| F: public preparation and belt labels | Passed | Rehashed all 16 prepared clips, verified 20 s and 30 fps; recomputed four reference labels from both belt files |
| M: actual local speech | Passed | small.en: "Is anyone else in House 3?", confidence 0.73, 1,020 ms; silence/fallback checks pass |
| M: actual CLIP timing | Passed | 20 generated test frames, p50 20 ms, p95 21 ms; timing check is not hazard-class accuracy |

The reference comparison reproduced MAE 2.293/min on four reference windows,
with three within 3/min. The fourth returned 11.3/min for reference 19.12/min
with confidence 0.26. Unlabelled MPSC inputs remain excluded from accuracy.
Source alignment and limited subject/scene coverage remain unchanged.
The concise fresh report is
`backend/perception/codex-reference/reports/comparison-retest-2026-11-08.json`.
Complete raw rerun output is retained locally under the ignored
`backend/perception/data/audit/reference-comparison-2026-11-08.json`.

The first HTTP attempt used a smaller trial ROI and returned `unknown` with a
lighting/exposure reason. The documented fixture ROI returned 15.0/min.
The automatic watcher used a center ROI and returned 15.0/min at confidence 0.4.
An early watcher assertion incorrectly expected that valid detection to be an
unclear rescan; the final check asserts its actual supported behavior instead.
Unknown-rescan preservation is covered by the primary worker regression tests.

## What is not established

No combined simulator -> primary perception -> real Nemotron -> dashboard ->
glasses run, real Pi upload, robot camera/lighting acceptance, physical e-stop,
real G2 acknowledgement, or two-process live-agent kill rehearsal is claimed.
The full primary public benchmark, real hazard-labelled terrain evaluation,
model-generated rescuer answers, hosted Riva and optional E10 work remain open.
The deployment lock remains an explicit open task; the fresh test environment
is not being declared the chosen demo environment.

One perception smoke invocation accidentally used its default Maincloud target.
It registered a perception identity and read empty survivor/detection tables,
then exited before any survivor write. Subsequent write checks explicitly used
the isolated localhost database. No shared schema, timings, or survivor data
were modified, and no teammate messages were sent.

## Per-item checklist audit

The table below preserves the original checked claims, before the status
corrections above. Evidence codes refer to the results table. "Pass" means
the stated implementation step passed at its documented scope, not that its
task's separate "Done when" acceptance is complete.

| Original checked claim | Result | Evidence |
| --- | --- | --- |
| Setup models 1: Configure the primary runner for both models on Brev; no Build API key is needed for this deployment. Local placeholder credentials stay in the ignored `.env`. | Pass | B, A |
| Setup models 2: Verify both models' native tool call, tool-result round trip, reasoning-off and JSON action behavior. | Pass | B, A |
| Setup models 3: Record model names, routing and measured results in `backend/agent/README.md`, `specs/agent.md` and `notes/2026-11-08-brev-validation.md`. | Pass | B, A |
| Setup inputs 1: Prepare 16 MPSC-RR video windows, 15 synthetic cases and four VRWi windows with independent dual-belt reference checks in `backend/perception/codex-reference/`. | Pass | F |
| Setup inputs 2: Compare the reference PIC implementation with the external baseline configurations; retain all 140 runs and the limitations. | Pass | F |
| E0 1: 1. Scaffold `backend/agent/` (package.json scripts, tsconfig with `"module": "NodeNext"`, `.env.example`, `.gitignore`) and install the dependencies. | Pass | B, A |
| E0 2: 2. Run the curl one-liner for both model ids and note the HTTP status and latency. | Pass | B, A |
| E0 3: 3. Write `smoke-llm.ts` step 1: one request per model with one tool, `compute_bearing` (`{from_lat, from_lon, to_lat, to_lon, reason}`), and the message from agent.md 4.3; pass if `tool_calls[0].function.name === "compute_bearing"` and four numbers parse. | Pass | B, A |
| E0 4: 4. Step 2: send the tool result back as a `role: "tool"` message with `tool_call_id`; pass if the reply has no tool calls and mentions meters. | Pass | B, A |
| E0 5: 5. Step 3: try `reasoning_effort: "none"` on Super and `chat_template_kwargs: {"enable_thinking": false}` on Nano; record whether each is accepted and whether reasoning text disappears. | Pass | B, A |
| E0 6: 6. Write `parse.ts` (strip `<think>` blocks and code fences, take the first balanced `{...}`, accept `{"actions":[...]}`, `{"done":true,...}`, and `{"name","arguments"}`), then step 4: repeat step 1 with no `tools` field and the catalog in the prompt. | Pass | B, A |
| E2 1a: 1a. Create the primary environment and requirements using `opencv-python`; the 750-test primary suite passes. | Pass | P, H |
| E2 2: 2. `config.py`: load `config.toml`, then `.env`, then `PERCEPTION_<SECTION>_<KEY>` overrides. | Pass | P, H |
| E2 3: 3. `store.py`: SQLite at `data/perception.db` with the `media` index table (`name, path, kind, robot_id, run_id, original_filename, bytes, sha256, created_at`) and a `jobs` table. | Pass | P, H |
| E2 4: 4. `media.py` and `POST /media`: name format, extension allow list, size limit, never use the client filename on disk. | Pass | P, H |
| E2 5: 5. `GET /media/<name>` with the name regex and index lookup; `GET /health`. | Pass | P, H |
| E2 6: 6. `POST /breathing` that saves the clip like `POST /media` with `kind=clip`, records a queued job, and returns 202 (the worker comes in E3). | Pass | P, H |
| E2 7: 7. CORS for `CORS_ORIGINS`; tests for upload, name format, path traversal (`../etc/passwd` gives 400), bad extension (415). | Pass | P, H |
| E3 1: 1. `video.py`: read frames, fps rule, duration, 5 full-resolution sample frames, downscale, and the darkness and noise gates. | Pass | P, H, L, N |
| E3 2: 2. `make_synthetic.py`: 640 by 480, 30 fps, 20 s, textured torso moved by `A * sin(2 pi f t)` with sub-pixel shifts and sigma 2 noise, plus the gate cases in the perception.md 10 table. | Pass | P, H, L, N |
| E3 3: 3. `roi.py` with `operator` and `center` ROI, background ROI, ROI checks, and `roi.jpg` drawing (pose and box come in E5). | Pass | P, H, L, N |
| E3 4: 4. `breathing.py` steps 3 to 6: PIC with PCA, detrend, band-pass, Hann, zero-padded FFT, parabolic peak. | Pass | P, H, L, N |
| E3 5: 5. Step 7 quality measures and step 8 decision and confidence; `analyze_clip.py` prints the result JSON. | Pass | P, H, L, N |
| E3 6: 6. `tests/test_breathing_synthetic.py`: every row of the synthetic table passes. | Pass | P, H, L, N |
| E3 7: 7. Farneback flow cross-check, background gate, flicker gate; re-run the synthetic tests. | Pass | P, H, L, N |
| E3 8a: 8a. Implement the identity/reducer HTTP client, retry policy, SATS encoding/decoding and smoke script; local tests pass. | Pass | P, H, L, N |
| E3 8b: 8b. Run `smoke_stdb.py` against the published module and capture a real SQL fixture (isolated local module, 2026-11-08). | Pass | P, H, L, N |
| E3 9: 9. `worker.py`: one background thread, job states, writes `report_breathing` then `set_critical_score` (score from E4; until E4, skip it), `pending_write` retry every 10 s. | Pass | P, H, L, N |
| E3 10a: 10a. Implement helper source and watcher filtering/deduplication, with HTTP polling fallback. | Pass | P, H, L, N |
| E3 10b: 10b. Build and run the subscription helper using the actual generated bindings (live survivor update under 0.01 s, 2026-11-08). | Pass | P, H, L, N |
| E4 1: 1. `score.py` with `breath_term`, level, score, confidence, and reasons; every weight and threshold from `[score]`. | Pass | P, H |
| E4 2: 2. `tests/test_score.py`: each level rule, the hand-checked example (`not_detected`, `v = 0.2`, `t = 15` gives 84.0), the 0.3 cap, never `minor`, reason limits, and the banned-words test. | Pass | P, H |
| E4 3: 3. Call `set_critical_score` right after `report_breathing` in `worker.py`; skip it if `report_breathing` failed. | Pass | P, H |
| E4 4: 4. Re-score timer in `watcher.py` with the meaningful-change rule and the `score_writes` table; new survivors scored at once with `no breathing clip yet`. | Pass | P, H |
| E5 2: 2. Pose branch in `roi.py`: run on the 5 sample frames, best box per frame, medians of box and keypoints, chest ROI from shoulders and hips (perception.md 4 step 2). | Pass | P, H, M |
| E5 3: 3. Box branch (upright, lying, other) and the `k` table; visibility from the keypoint fraction (perception.md 5), none when no person is found. | Pass | P, H, M |
| E5 4: 4. Still path: when a detection with `camera_image_url` arrives, run YOLO on it, save `det<id>_person.jpg`, and store the result for `GET /breathing/detection/<id>`. | Pass | P, H, M |
| E6 1: 1. `config.ts` (typed, fails fast on a missing key unless `LLM_MODE=mock`), `log.ts` (console plus JSONL trace). | Pass | A, S, L |
| E6 2: 2. `geo.ts` (haversine, R = 6,371,000 m, bearing, 8 compass words) and `priority.ts` (tiers 0, 1, 2; G3), with tests. | Pass | A, S, L |
| E6 3: 3. `tools/schemas.ts` with every schema from agent.md 7.1 to 7.4 as one source for native and JSON modes, and `guards.ts` G1 to G8 (death-word regex, 120-character briefings, ASCII, no names to models). | Partial: full G8 unresolved | A, S, L |
| E6 4: 4. `stdb/connect.ts` and `stdb/convert.ts` (camelCase to snake_case, bigint ids to numbers, tagged enums to strings, `Identity` to hex, `Timestamp` to ISO). | Pass | A, S, L |
| E6 5: 5. `world.ts` (active run filter, rescuer fresh and available, robot idle) and `FakeWorld` with the same interface. | Pass | A, S, L |
| E6 6: 6. Connect three identities to the local module, register them, and print the active run (`npm run smoke:stdb`, 2026-11-08). | Pass | A, S, L |
| E6 7: 7. `chain.ts` (survivor chain is the `survivor_created` event id; tasks carry their chain) and `board.ts` (post, claim, complete; 120 s stale rule). | Pass | A, S, L |
| E6 8a: 8a. Implement dispatch validation, guards, action logs and chain IDs; fake-module task/log tests pass. | Pass | A, S, L |
| E6 8b: 8b. Confirm a task round trip and matching `agent_action` in the live database (auditor and comms tasks, isolated local module, 2026-11-08). | Pass | A, S, L |
| E6 9: 9. `llm/client.ts` and `llm/budget.ts` with the priority queue, 429 backoff, model-down switch, and tests (25 queued in a minute send 20; critical jumps normal). | Pass | A, S, L |
| E6 10: 10. `loop.ts` with step and tool-call limits, the cycle deadline (lease minus 5 s), `<think>` stripping, and the JSON mode path through `parse.ts`. | Pass | A, S, L |
| E7 1: 1. `orchestrator.ts`: config, the agent.md 7.2 prompt, the wake packet builder (format in agent.md 7.2, including `WATCHDOG: fires in N s`), and wake rules. | Pass | A, S, B |
| E7 2: 2. Orchestrator guards for `propose_assignment` (survivor unassigned, rescuer available, no higher-tier survivor waiting, lapsed-rescuer rule, 50% closer rule needs a reason) and `delegate`. | Pass | A, S, B |
| E7 3: 3. `create_mission` and `cancel_own_mission` guards, the continue and inspect decisions, and the `rules.ts` continue rule for an idle robot when the model is down. | Pass | A, S, B |
| E7 4: 4. Heartbeat policy, model-down switch (stop heartbeat, one `model_down` action), and the "already proposed by watchdog" check. | Pass | A, S, B |
| E7 5: 5. `auditor.ts`: the agent.md 7.4 prompt, the review wake packet with `RULE CHECKS (code)`, `submit_review` (completes the task; on `disagree` files the flag with `flag_kind`), and the `rules.ts` verdict fallback. | Pass | A, S, B |
| E7 6: 6. `templates.ts` and `comms.ts` with `ENABLE_COMMS_MODEL=0`: briefing, breathing part, nudge at half of `proposal_lease_s`, navigation hint with terrain, model-down answer; every template at most 120 characters. | Pass | A, S, B |
| E7 7: 7. `scenario.ts` with the eight scenarios of agent.md 12.3, checking end states and required tool names, not exact order. | Pass | A, S, B |
| E7 8: 8. Pass mock scenarios plus the recorded real-Brev chain, priority and seeded auditor-disagreement checks; these use the fake database. | Pass | A, S, B |
| E7 10: 10. Verify modeled briefings and three consecutive native/JSON Brev chains against the fake database; briefing guards remain enforced. The integrated demo is still pending. | Conditional: later native chain failed | A, S, B |
| E7 11: 11. Pass three recorded real JSON chains and all eight mock scenarios; mock regression tests pass. | Pass | A, S, B |
| E8 1a: 1a. Keep the existing question/silence WAV fixtures; public speech and generated silence also provide reference-version development checks without new recordings. | Pass | P, M, A |
| E8 2: 2. `stt.py` `whisper_local` engine with resampling to 16 kHz mono (`scipy.signal.resample_poly`) and `tests/test_stt.py`. | Pass | P, M, A |
| E8 3: 3. `POST /transcribe` (`file` or `audio_url`, optional `rescuer` logged only), synchronous, no database write. | Pass | P, M, A |
| E8 5: 5. Engine selection at startup with fallback, and `engine` in `GET /health` and in every result. | Pass | P, M, A |
| E8 6a: 6a. Implement the facts-only template answer path and recipient/briefing guards. | Pass | P, M, A |
| E9 2: 2. `terrain.py` zero-shot CLIP baseline with one prompt per class (perception.md 9), `unknown` below 0.5. | Pass | P, M |
| E9 3: 3. `POST /terrain` (skip frames older than 5 s, store with `kind=terrain`, at most 1 per second per robot) and `GET /terrain/latest`. | Pass | P, M |
| E9 4: 4. `label_terrain.py`: keys 1 to 6, Enter accepts the rule class, `s` skips; label the disagreements first. | Pass | P, M |
| E9 5a: 5a. Implement the frozen-CLIP/logistic-regression training script with run-separated evaluation. | Pass | P, M |
| R1 1: 1. Write `LatestSlot<T>` (mutex, value, steady-clock write time, `age(now)`), `Clock` with `FakeClock`, and a `WorldSnapshot` struct with the fields robot.md 4.3 needs. | Pass | R |
| R1 2: 2. Write the state and event enums and the pure `step(state, snapshot, events)` returning next state, reason, and `latched`, with the transition table from robot.md section 5. | Pass | R |
| R1 3: 3. Write one test per transition row, plus the latch, reset, retry, and SIGTERM tests below. | Pass | R |
| R1 4: 4. Write `MotionCommand` and the pure `SafetyGate::filter(state, snapshot, output)` with the rules from robot.md 10.1 (terrain rules can be a stub until R7). | Pass | R |
| R1 5: 5. Write the safety gate tests below. | Pass | R |
| R1 6: 6. Write the main loop in `main.cpp`: fixed rate with `sleep_until`, the six steps in order, overrun detection, and a 1 Hz summary log line. | Fail: blocking logger | R |
| R1 7: 7. Write the control server (non-blocking Unix socket, NDJSON commands `start`, `stop`, `estop`, `reset`, `status`) and `robotctl`. | Pass | R |
| R1 8: 8. Handle SIGTERM and SIGINT: raise the `sigterm` event, stop motion, then SHUTDOWN within `shutdown.timeout_ms`. | Pass | R |
