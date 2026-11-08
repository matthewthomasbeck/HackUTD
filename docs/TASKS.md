# Tasks: who builds what

Written 2026-11-07 from `docs/MVP.md` (scope) and `docs/specs/` (how).
This file splits the work; each person's detailed list, with "done when" for every task, is in `docs/tasks/<name>.md`.
Design and slides follow `docs/DESIGN.md` (design control).
Swap tasks freely, and update this file and the person's file when you do.

## Owners

Confirmed owners come from Cayden (2026-11-07).
Items marked PROPOSED were unassigned in the MVP; confirm or move them at the next check-in.

| Person | Owns | Code folders (team repo) | Detail |
| --- | --- | --- | --- |
| Matthew Beck | Electrical system, robot assembly, leg motion with Camille, the physical demo set, outdoor test and footage (PROPOSED) | `3d_parts/`, `raspberrypi/` config for hardware, `images/` | `tasks/matthew.md` |
| Camille | Robot edge software: C++ program on the Pi, Pico firmware, the bridge to SpacetimeDB, robot missions, terrain rules | `raspberrypi/`, `pico/` | `tasks/camille.md` |
| Eric Lee | Computer vision and models: breathing check, thermal confirmation, critical score, media server, speech-to-text for rescuer questions from the glasses, terrain camera model; the Nemotron agents (PROPOSED) | `backend/perception/`, `backend/agent/` | `tasks/eric.md` |
| Cayden Hutcheson | G2 glasses; extra work: SpacetimeDB module and contracts, dashboard, simulator, design control, slides and pitch, integration (all PROPOSED except glasses) | `frontend/glasses/`, `backend/glasses-service/`, `backend/spacetimedb/`, `frontend/dashboard/`, `backend/sim/` | `tasks/cayden.md` |

Eric took over R1 (state machine, safety gate, main loop) and the C++ build skeleton from R0 that it needs on 2026-11-07.
Those task descriptions stay in `tasks/camille.md` (R0 and R1).

Cayden's PROPOSED list is the largest.
If it is too much, move the simulator or the dashboard to whoever finishes first, and say so in the team chat.

## Priority

When tasks compete for time, follow "Priority by sponsor track" in `docs/MVP.md`: the SpacetimeDB module and its guarantees first, then the agent hand-off chain, then the robot's find and breathing check, then the glasses.

## Time estimates

Every task has an "Estimate with AI" line: 1 to 2 hours each, assuming coding agents write most of the code from the specs.
Totals with AI: Matthew about 12.5 h, Camille about 15.5 h, Eric about 15 h, Cayden about 17.5 h.
The hour figures inside `docs/specs/` are for writing the code by hand; use the task files' estimates for planning.
Hardware tasks (Matthew, and Camille's bring-up with him) are bench time, so coding agents shorten them less.

## Phases

Times are relative because the exact deadline is not recorded in these docs.
Confirm the submission time and judging time, then write clock times into this table.

| Phase | Goal | Ends with |
| --- | --- | --- |
| 0. Setup (first 1 to 2 h) | Accounts, repo layout, design tokens, smoke tests | Checkpoint 0 |
| 1. Build in parallel | Every part works alone against mocks or the local SpacetimeDB | Checkpoints 1 and 2 |
| 2. Integrate | Real robot, real perception, agents, glasses, dashboard together | Checkpoints 3 and 4 |
| 3. Demo and polish | Rehearsals, video, slides, Devpost, feature freeze | Checkpoint 5 |

## Checkpoints

| # | Checkpoint | Owner | Done when |
| --- | --- | --- | --- |
| 0 | Setup | everyone | Every account in "Accounts" below works; Nemotron tool-call smoke test passes or the JSON fallback is chosen; SpacetimeDB module skeleton publishes locally; design tokens exist in Figma and as CSS variables |
| 1 | Module and mocks | Cayden, Camille | The SpacetimeDB module is published (local and Maincloud) with bindings; the robot program runs on a laptop with mock devices and sends a heartbeat through the bridge |
| 2 | Whole flow with no robot | Cayden, Eric | The simulator creates a detection; perception scores it; the orchestrator proposes a rescuer; the auditor reviews; the comms agent briefs; the fallback glasses page and the dashboard show it live |
| 3 | Robot on the board | Camille, Matthew | The real robot drives a scripted path, sends real thermal detections and a breathing clip, and the clip comes back with a breathing rate |
| 4 | End to end | everyone | The real robot finds a teammate in dim light, the board, the agents, and the real G2 glasses all react, and replay works |
| 5 | Demo ready | everyone | Two full rehearsals of `specs/demo.md` with every fallback tried once; video recorded; slides final; Devpost submitted; feature freeze |

### Checkpoint status (2026-11-08)

- Checkpoint 1: the module half is done.
  The module is published locally and on Maincloud as `assess-0hw81`, with bindings in `backend/spacetimedb-bindings/` and 62 passing smoke checks.
  The robot half is open: the robot program foundation is in `raspberrypi/robot/` (task R1), but the bridge to SpacetimeDB and the Pico firmware are not pushed, so no bridge heartbeat has reached the module yet.
- Checkpoint 2: the whole flow with no robot runs in the simulator, but it is not marked passed.
  The sim robot finds survivors, and the dashboard and the glasses service show changes live.
  With Eric's agents merged locally (`integration/eric-agents`) and `LLM_MODE=mock`, the orchestrator proposed, the auditor reviewed, and the comms agent briefed against the live module.
  Still open: perception scoring a sim detection in the same run, a real Nemotron key, and one recorded run with its run id.
- Checkpoints 3 to 5: not started; they need the real robot, the real G2, and rehearsals.

## What blocks what

1. Cayden's SpacetimeDB module (C1) unblocks everyone; publish a skeleton with the core tables early, even before every reducer is done.
2. Camille's mock robot and Matthew's hardware work run in parallel; the real robot joins at checkpoint 3.
3. Eric's breathing pipeline needs only recorded clips at first; record clips of teammates in the demo lighting early.
4. Eric's agents need the module's `agent_task` table and reducers; until then, they run in dry-run mode.
5. Cayden's glasses fallback page and dashboard need the bindings; until then, they run on fake data from the simulator.
6. The design tokens (D1 in `tasks/cayden.md`) come before any frontend styling, so the dashboard, the glasses fallback page, and the slides share one look.

## Accounts (set up in phase 0)

| Account | Who | Notes |
| --- | --- | --- |
| NVIDIA API key (build.nvidia.com) | Eric | In `backend/agent/.env`, never committed |
| SpacetimeDB (`spacetime login`, code `HACKUTD2026`) | Cayden | One credit per GitHub account |
| Even Hub developer mode | Cayden | Sign in at hub.evenrealities.com with the Even app account |
| Figma (design file and slides) or Canva (slides) | Cayden | See `docs/DESIGN.md` |
| GitHub team repo access | everyone | https://github.com/matthewthomasbeck/HackUTD (public) |

## Team rules

- Read `docs/specs/CONTRACTS.md` before writing code that talks to another part; it changes only by a team decision.
- Keep keys in git-ignored `.env` files; the team repo is public.
- Every UI change follows design control (`docs/DESIGN.md`): tokens and components from the design file, and a screenshot check before merge.
- No agent ever drives motors, resolves a survivor, or labels anyone dead.
- Post in the team chat when you finish a checkpoint task or change an interface.
