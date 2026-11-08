# Rubble Search: a drone that finds survivors first

HackUTD entry by Cayden Hutcheson, Matthew Beck, Eric Lee, and Camille.
Target tracks: NVIDIA ("Use Nemotron Beyond a Chatbot"), State Farm ("The Worst Day, at Scale"), and SpacetimeDB, which runs the whole backend.

After a disaster, a drone flies over the rubble with a thermal camera, finds warm, person-sized shapes, and hovers over each one to record about 20 seconds of video for a breathing check.
Every find becomes a survivor with a critical score, on a live dashboard shared by every coordinator, and the most critical people go to rescuers wearing Even Realities G2 smart glasses, which show how many critical people are nearby and point the way to the next one.

## How it works

1. **Search from above.** The drone flies a grid over the search area. Its thermal camera looks for warm shapes the size of a person.
2. **Hover and look.** At each candidate it holds still and records about 20 seconds of camera video.
3. **Signs of life.** A motion signal on the chest region gives a breathing rate with a confidence. The system never labels anyone dead: "no signs of life detected" stays at the top of the list.
4. **Critical score.** Breathing, how buried the person is, and the thermal reading combine into a triage level with its reasons.
5. **Report.** The find goes into SpacetimeDB, and every dashboard and pair of glasses sees it at the same moment.
6. **Coordinate.** Nemotron agents rank survivors, propose the nearest free rescuer, and brief that rescuer; the database enforces the rules, so no one is overlooked even with every agent down.
7. **Guide.** The rescuer's glasses show "1 critical within 0.3 mi", then an arrow and distance.
8. **Sent in second.** The ground rover (mecanum wheels, built and calibrated in this repo) can be sent to a find afterwards for a close look where the drone cannot reach.

## What is live and what is simulated

The judged demo is hard-coded (team decision, 2026-11-08): only SpacetimeDB runs live.
The simulator scripts the drone's flight, the find, the breathing result and critical score, and any rescuer actions.
The dashboard and the glasses view (on the G2 or the fallback page) are real clients rendering that data live from SpacetimeDB.
The drone hardware is TBD; the agents, the perception service, and the ground rover are built and tested separately and do not run in the judged demo.

## Code

| Folder | What it is |
| --- | --- |
| `backend/spacetimedb/` | SpacetimeDB module, the whole backend; published on Maincloud as `assess-0hw81` |
| `backend/spacetimedb-bindings/` | Generated TypeScript bindings |
| `backend/sim/` | Demo simulator: site, search vehicle, rescuers, failures, timelines |
| `backend/glasses-service/` | One SpacetimeDB connection per glasses session; renders the glasses views |
| `backend/agent/`, `backend/perception/` | Nemotron agents and the breathing and perception service |
| `frontend/dashboard/` | Coordinator dashboard |
| `frontend/glasses/` | Even Hub plugin, fallback page, phone page |
| `frontend/design-tokens/` | Shared CSS tokens |
| `raspberrypi/`, `pico/` | Onboard software and sensor firmware: thermal camera, lidars, IMU, wheel drive, Node.js bridge to SpacetimeDB |

How to run each part is in `backend/README.md`, `frontend/README.md`, and `raspberrypi/README.md`.
Every client reads `STDB_URI` and `STDB_DATABASE` (`assess-0hw81`); browser apps read `VITE_STDB_URI` and `VITE_STDB_DATABASE`.
Keys and tokens go in git-ignored `.env` files, because the repo is public.

## Run the demo

```bash
cd backend/sim
export STDB_URI=https://maincloud.spacetimedb.com STDB_DATABASE=assess-0hw81   # or the local fallback server
npm run sim -- setup
npm run sim -- timeline demo
```

Before judging, republish Maincloud clean from the repo root with `spacetime publish assess-0hw81 -p backend/spacetimedb --server maincloud --delete-data=always --yes`, then run `setup` again.
The full run of show is in `docs/specs/demo.md`.

## Tests

```bash
cd backend/spacetimedb && npx tsc --noEmit -p . && spacetime build && npm test
cd backend/sim && npm test && npx tsc --noEmit
cd backend/glasses-service && npm test && npx tsc --noEmit
cd frontend/dashboard && npm test && npm run build
cd frontend/glasses && npm test && npm run build
cd backend/agent && npm test && npx tsc --noEmit
cd backend/perception && python -m pytest
cd raspberrypi/robot && cmake -B build && cmake --build build -j && ctest --test-dir build
```

## Docs

- `docs/devpost-draft.md`: the Devpost entry.
- `docs/PROJECT.md`, `docs/MVP.md`: what the team set out to build (written for the earlier robot dog plan).
- `docs/AGENT_WORKFLOW.md`: how the three agents (orchestrator, auditor, comms agent) work.
- `docs/specs/`: implementation specs and the shared contracts (start at `docs/specs/README.md`).
- `docs/ROBOT.md`: onboard hardware, pin map, and protocol.
- `docs/README-rover.md`: the earlier README, from when the project was a robot dog and then a rover.
