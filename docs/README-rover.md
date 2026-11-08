# HackUTD

Robot entry for HackUTD.
The team is Cayden Hutcheson, Matthew Beck, Eric Lee, and Camille (last name to add).

Target tracks: NVIDIA ("Use Nemotron Beyond a Chatbot"), State Farm, and SpacetimeDB, which also runs the whole backend.
The project: a robot dog searches rubble after a disaster, finds survivors with a thermal camera, checks for breathing with Eulerian video magnification, scores how critical each person is, and guides an operator wearing smart glasses to the most critical survivors.
See `docs/PROJECT.md`.
The robot is a Raspberry Pi 4B running a C++ state machine that drives the actuators, and a Raspberry Pi Pico that reads the sensors and streams them to the Pi.

- `docs/MVP.md` - the MVP to share with the team: demo, scope, workstreams, fallbacks.
- `docs/TASKS.md` and `docs/tasks/` - who builds what, with phases, checkpoints, and "done when" for every task.
- `docs/DESIGN.md` - design control for the dashboard, glasses, and slides, plus the slide outline.
- `docs/PROJECT.md` - what the team is building (source of truth).
- `docs/AGENT_WORKFLOW.md` - one-page summary of how the three agents (orchestrator, auditor, comms agent) work.
- `docs/specs/` - implementation specs per component, with the shared contracts and build order (start at `docs/specs/README.md`).
- `docs/ROBOT.md` - the robot brief and source of truth (hardware, pin map, architecture, protocol, open questions).
- `docs/research/` - research behind the plan (`platform.md`, `g2-glasses.md`, `bluebook-reference.md`, `perception.md`); its older files are for the dropped EOG direction.
- `docs/IDEAS.md` - the ideation history and earlier candidate ideas.
- `docs/notes/` - dated meeting and chat notes.

The team's code repo is https://github.com/matthewthomasbeck/HackUTD.

## Code

| Folder | What it is | Status (2026-11-08) |
| --- | --- | --- |
| `backend/spacetimedb/` | SpacetimeDB module, the whole backend | Built; published on Maincloud as `assess-0hw81` |
| `backend/spacetimedb-bindings/` | Generated TypeScript bindings | Committed; regenerate after every module change |
| `backend/sim/` | Demo simulator: site, sim robot, sim rescuers, failures, timelines | Built |
| `backend/glasses-service/` | One SpacetimeDB connection per glasses session; renders the glasses views | Built |
| `backend/agent/`, `backend/perception/` | Nemotron agents and the perception service (Eric) | Arriving with the `integration/eric-agents` merge |
| `frontend/dashboard/` | Coordinator dashboard | Built; some panels still open |
| `frontend/glasses/` | Even Hub plugin, fallback page, phone page | Built; not yet checked on the real G2 |
| `frontend/design-tokens/` | Shared CSS tokens | Built |
| `raspberrypi/`, `pico/` | Robot program, bridge, and firmware (Camille) | Robot program foundation in `raspberrypi/robot/` (state machine, safety gate, mocks); the bridge and Pico firmware are not pushed yet, so the sim robot stands in |

How to run each part is in `backend/README.md` and `frontend/README.md`.

Every client reads `STDB_URI` and `STDB_DATABASE` (`assess-0hw81`); browser apps read `VITE_STDB_URI` and `VITE_STDB_DATABASE`.
Keys and tokens go in git-ignored `.env` files, because the repo is public.

Tests:

```bash
cd backend/spacetimedb && npx tsc --noEmit -p . && spacetime build && npm test
cd backend/sim && npm test && npx tsc --noEmit
cd backend/glasses-service && npm test && npx tsc --noEmit
cd frontend/dashboard && npm test && npm run build
cd frontend/glasses && npm test && npm run build
cd backend/agent && npm test && npx tsc --noEmit          # after the integration merge
cd backend/perception && python -m pytest                 # after the integration merge
```

## Run the demo

The judged demo is hard-coded (decision 2026-11-08): only SpacetimeDB runs live, and the simulator scripts the robot, the find, the breathing result and critical score, and any rescuer actions.
The agents, perception, the real robot, and the real G2 hardware are built and tested separately, and they do not run in the judged demo.
The dashboard and the glasses view (on the G2 or the fallback page) render the scripted data live from SpacetimeDB.
The story ends when the robot dog finds the hidden person in 2520 Rutford Ave on the UT Dallas campus (house 3).

```bash
cd backend/sim
export STDB_URI=https://maincloud.spacetimedb.com STDB_DATABASE=assess-0hw81   # or the local fallback server
npm run sim -- setup
npm run sim -- timeline demo
```

Before judging, republish Maincloud clean from the repo root with `spacetime publish assess-0hw81 -p backend/spacetimedb --server maincloud --delete-data=always --yes`, then run `setup` again.
The full run of show is in `docs/specs/demo.md`, "Judged demo (hard-coded, 2026-11-08)".
