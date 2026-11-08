# Eric: unfinished work and dependencies

Updated 2026-11-08 from branch `eric`. This is the practical handoff for
[Eric's full checklist](eric.md), not a change to MVP scope or assignments.
The owner names below follow the existing task files. An artifact missing from
this checkout may already exist on a teammate's branch; request its location
and published interface before rebuilding it.

## What is already working

- Primary perception service: media uploads, durable breathing jobs, PIC/ROI
  analysis, person/pose code, scoring, re-scans, watcher, HTTP database client,
  optional speech and terrain modules. Fresh local suite: 750 tests passed.
- Primary agent runner: shared runner, tools/guards, task board, budgets,
  orchestrator, auditor, comms, templates and model routing. Fresh local suite:
  87 tests passed and TypeScript check passed.
- Both Nemotron models on Brev passed tool calls, tool-result round trips,
  reasoning-off and JSON actions. Recorded native and JSON chains each passed
  three consecutive runs; priority, seeded auditor disagreement and watchdog
  recovery also passed. These scenarios use a fake database.
- Separate reference implementation: public-data preparation, 140 breathing
  comparisons, actual YOLO person/blank smoke, local Whisper speech/silence
  smoke, and display-only EVM. Its 33 perception and 30 agent tests passed.

Evidence: [Brev validation](../notes/2026-11-08-brev-validation.md),
[public-data methods/results](../research/breathing-repos.md), and
[all 140 reference method runs](../../backend/perception/codex-reference/testdata/public/comparison-results.json).
These test counts describe separate implementations, not one combined
end-to-end system.

## Which implementation to use

The primary app is `backend/perception/` plus `backend/agent/`.
The `codex-reference/` directories beneath them preserve a separately tested
implementation and its datasets/reports. They are not imported automatically
by the primary app. Do not replace the primary runner with the reference copy:
the primary runner includes the newer Brev routing and real-model fixes.

In particular, reference public-data results do not establish primary-pipeline
accuracy. Port the inputs/harness through the primary offline analysis API and
save a separate report before claiming E1/E3 primary benchmark completion.

## What Eric can finish without waiting

| Task | Remaining action | Complete when |
| --- | --- | --- |
| E1/E3 | Adapt the public-data harness to primary analysis; evaluate reference-labelled windows and synthetic nuisance cases; retain subject/source splits | A primary results table records coverage, rates, confidence, errors and abstentions; unlabelled MPSC rows are excluded from accuracy metrics |
| E3 | Diagnose primary false rejections and document any threshold changes using development inputs only | Known rates and nuisance tests still pass; held-out results are reported without tuning on them |
| E2 | Generate and commit the primary demo environment lock | The lock comes from the working primary environment, not the separate reference venv |
| E4/E5 | Batch-score the primary public cases and visually review chest/person overlays | Each result has score/reasons and a reviewed ROI; difficult covered or dark cases remain uncertain |
| E8 | Implement model-generated `answer_rescuer` using only task/board facts | Mock and real-model tests verify factual answers, unknown-answer handling, recipient checks, 120-character limit and template fallback |
| E8 | Verify primary local transcription on public/question audio and silence; record timings | Public fixtures produce expected speech/silence behavior; model size and noise limitations are documented |
| E9 | Obtain independently labelled public hazard imagery and assess class coverage before training | A source/run-separated report compares baseline and probe, with critical-class recall and p50/p95 latency; no self-generated labels presented as truth |
| E10, optional | Implement primary vision/sitrep tools only after the core integration | Feature flags, budgets, timeouts and length guards work; a model smoke and actual briefing delivery pass |

E8 and E9 are should-have work. E10 is could-have and is cut first. Keep the
orchestrator, breathing pipeline and score ahead of optional enhancements.

## Upstream availability checked during this update

Fetched `origin/main` at `93b49a7`. It already contains
`backend/spacetimedb/`, `backend/spacetimedb-bindings/`, `backend/sim/`,
`backend/glasses-service/`, `frontend/dashboard/` and `frontend/glasses/`.
Cayden's workstream branch also contains these components. The next step is
bringing these sources into Eric's integration checkout and checking the
interfaces, not waiting for their first implementation. Source availability
does not confirm a running database, service roles or a working end-to-end flow.

## What Eric is waiting on

| Dependency | Existing owner/task | Specific handoff needed | What it unblocks |
| --- | --- | --- | --- |
| SpacetimeDB deployment and binding integration; source already on main | Cayden, C1; Eric integrates | Bring in upstream code, confirm database URI/name and local/Maincloud deployment, check reducer arguments/enums/options/timestamps | Perception live smoke; agent/helper build; actual subscriptions and reducers |
| Service identities and demo configuration | Cayden, C1/C4, with Eric | Demo mode or granted perception/orchestrator/auditor/comms roles; confirmed demo lease/watchdog timings | Registration, permitted writes and meaningful live watchdog tests |
| Simulator and demo site; source already on main | Cayden, C3; Eric integrates | Run upstream simulator and seed active run, robot, survivors, rescuers, person reports and fixed coordinates | Integrated flow without robot hardware; score ageing and failure demonstrations |
| Dashboard and Agents panel; source already on main | Cayden, C2; Eric integrates | Confirm subscriber/media compatibility with Eric's outputs and verify task/action/chain display | Visible scores/person images, shared live board, acknowledgement timing and replay |
| Glasses service/fallback and voice flow; source already on main | Cayden, G1-G3; Eric integrates | Verify upload/transcribe/`rescuer_ask` flow, live briefing display, acknowledge and heartbeat events | E8 spoken question/answer; E7 rescuer acknowledgement; disconnect/lease checks |
| Robot bridge uploads | Camille, R3/R5/R6 | Reachable media URL; still/clip uploads with detection/survivor IDs; correct reducer calls | E2 Pi upload and real thermal-to-breathing path |
| Inspect capture behavior | Camille, R5 | Stopped/settled camera, approximately 20 s visible-light clips, locked exposure/gain/white balance | Real-camera breathing and person/ROI validation |
| Lighting, thermal range and mock scene | Matthew, M4/M6/M7, with Camille/Eric | Confirmed light setup, camera placement/range observations, available mock rubble scene | Scene-specific quality checks and the actual demonstration |
| Terrain frame/hint integration | Camille, R7, plus Cayden's dashboard | Timestamped forward frames/rule class and an agreed single writer for terrain fields | Advisory hints/map labels after model evaluation passes |

These are integration dependencies, not proof that those teammates have not
started their work. Do not change assignments or shared contracts implicitly.

## Live acceptance that has not happened yet

- [ ] Connect all three agent identities and the perception identity to the real module.
- [ ] Capture actual SQL/reducer fixtures and verify adapter/helper wire formats.
- [ ] Run simulator detection -> primary breathing -> score -> proposal -> audit -> briefing -> glasses acknowledgement with one chain ID.
- [ ] Show the results on the dashboard and a second subscribed screen.
- [ ] Stop/disconnect actual workers and glasses; verify the database's real schedule tables, leases, escalation and watchdog. The fake-module tests are not this test.
- [ ] Show score ageing without flooding the event log.
- [ ] Upload from the Pi over the team network and process an actual inspect clip.
- [ ] Run glasses voice question -> transcription -> agent answer -> display and time it.
- [ ] Enable terrain advice only after held-out evaluation and conservative fusion checks pass.
- [ ] Try the documented fallbacks in rehearsal and repeat model smoke before judging.

## Public data instead of new recordings

No new teammate dataset is required to continue development. Available inputs:
16 MPSC-RR windows, 15 deterministic synthetic cases and four VRWi windows
with independently measured belt signals in the reference implementation.
MPSC-RR has no public rate labels in the pinned release. VRWi rates are derived
from dual belts; time-zero alignment follows the authors' preprocessing and was
not independently verified. Four windows from one seated subject cannot prove
general rescue-scene accuracy.

Public speech and generated silence can test transcription. Pretrained YOLO
avoids training a new person detector. Public robotics projects such as
[RELLIS-3D](https://github.com/unmannedlab/RELLIS-3D) offer labelled terrain
imagery, but their classes do not automatically cover our step/gap hazards.
Dataset selection, licensing, class mapping and independent evaluation remain
work; do not manufacture missing labels from model predictions.

Checking whether the actual camera, light and mounting produce usable frames
is still necessary during robot integration. A public video cannot verify
that hardware path, but it is enough to keep implementation moving now.

## Decisions and external checks

- Confirm the exact Riva server/function/model from the selected NVIDIA API
  page if hosted speech is wanted. Local Whisper remains the fallback; Riva
  has not been verified in this checkout.
- Before sending person images to a hosted vision model, obtain the team
  decision required by E10. This does not block local person detection.
- Ask the NVIDIA mentors about the applicable limits; repeat smoke against
  the chosen deployment before judging.
- E0's result publication in team chat is not verified. No teammate message
  was sent as part of this documentation update.
- Any proposed contract change still needs the existing human decision process.

## Next order

1. Integrate the available upstream module/bindings/simulator/dashboard/glasses sources. Confirm Cayden's deployed server/roles and Camille's bridge upload interface.
2. While waiting, port the public benchmark to primary perception, generate its lock, and finish primary score/ROI results.
3. With a running module, run `scripts/smoke_stdb.py`, build the subscription helper, register service roles, and verify each wire assumption.
4. Prove the full simulator-to-dashboard/glasses flow and real database failure handling.
5. Join the robot capture path and rehearse the MVP.
6. Finish voice questions and terrain only after the core path; leave E10 until ahead.
