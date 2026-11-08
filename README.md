# Rubble Search: drone scouting for disaster response

HackUTD entry by Camille Rivera, Cayden Hutcheson, Matthew Beck, and Eric Lee.
Target tracks: NVIDIA ("Use Nemotron Beyond a Chatbot"), State Farm ("The Worst Day, at Scale"), and SpacetimeDB, which runs the whole backend.

After a disaster, a **DJI Mini 4 Pro** drone scouts the damaged area from above and streams live video to a laptop, where computer vision spots people.
Every person it spots becomes a survivor on a live dashboard shared by every coordinator, with a critical rating and its reasons.
Nemotron agents decide who should help whom, and the most critical people go to rescuers wearing Even Realities G2 smart glasses, which show how many critical people are nearby and point the way to the next one.

## How it works

1. **Scout from above.** The drone flies over the search area and streams live video from DJI Fly (RTMP) to a laptop. Rubble that is slow and dangerous to cross on foot is quick to fly over.
2. **Spot people.** A person detector on the video marks each possible survivor and where they are.
3. **Report.** Each find goes into SpacetimeDB, and every dashboard and pair of glasses sees it at the same moment.
4. **Rate.** Transparent rules turn what is known (how visible or buried the person is, how long they have waited, and signs of life when a close check is available) into a critical level with its reasons. The system never labels anyone dead: "no signs of life detected" stays at the top of the list.
5. **Coordinate.** Nemotron agents rank survivors, propose the nearest free rescuer, and brief that rescuer; an auditor agent checks every proposal; the database enforces the rules, so no one is overlooked even with every agent down.
6. **Guide.** The rescuer's glasses show "1 critical within 0.3 mi", then an arrow and distance.

**Close check, when available:** a ground rover built in this repo (thermal camera, lidars, mecanum wheels) can be sent to a find for a closer look and a 20-second breathing check, which a hovering drone shakes too much to do.

## Tracks

### State Farm: Intelligent Catastrophe Response

"The Worst Day, at Scale": when a disaster hits many people at once, find the most urgent needs, coordinate help, and make sure no one is overlooked.
Rubble Search covers the three stages in one workflow: the drone **discovers** survivors, the critical score **assesses** who needs help first, and the shared board **coordinates** rescuers.
"No one overlooked" is enforced by the database, not by the AI: every survivor stays on the board until a person resolves them, a dropped rescuer releases their assignment at once, and a watchdog assigns the nearest rescuer if no agent does.
The dashboard headline is "Critical survivors unattended over 60 s: 0".

### NVIDIA: Nemotron Beyond a Chatbot

Three Nemotron agents plan multi-step work and call tools; none of them is a chatbot:

- **Orchestrator**: ranks survivors, proposes the nearest free rescuer, and plans where the drone scouts next.
- **Auditor**: independently checks every proposal (wrong rescuer, unfair load) and gives a verdict with a reason.
- **Comms agent**: briefs rescuers on their glasses and answers their questions.

The agents talk only through a shared task board in SpacetimeDB (`agent_task`), so every hand-off is logged and replayable, and no agent can fly the drone or resolve a survivor.
See `docs/AGENT_WORKFLOW.md`.

### SpacetimeDB: Real-Time Rescue Coordination

SpacetimeDB is the whole backend, with no separate web server or API layer, published on Maincloud as `assess-0hw81`:

- **One live board**: survivors, search areas, the drone, missions, assignments, briefings, and the agents' tasks, streamed to every dashboard and pair of glasses through subscriptions.
- **Rules in reducers**: the survivor state machine, roles, and the rule that no one is labelled dead.
- **Timers in schedule tables**: assignment leases, heartbeats, two-level escalation, and the agent watchdog all run inside the database.
- **Instant disconnect handling**: `client_disconnected` releases a dropped rescuer's assignment, so the survivor goes back in the queue.

## What is live and what is simulated

The judged demo is hard-coded (team decision, 2026-11-08): only SpacetimeDB runs live.
The simulator scripts the drone's flight, the find, the breathing result and critical score, and any rescuer actions.
The dashboard and the glasses view (on the G2 or the fallback page) are real clients rendering that data live from SpacetimeDB.
The DJI Mini 4 Pro video link (DJI Fly RTMP to a laptop) is planned and not yet tested; the agents and the perception service are built and tested separately and do not run in the judged demo.
Later, DJI's Mobile SDK v5 (Android, Mini 4 Pro with the RC-N2 controller, from v5.13.0) could also send the drone's live GPS position to the dashboard map.

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
| `raspberrypi/`, `pico/` | The ground rover for close checks: Pi program (state machine, safety gate, wheel drive, thermal seek, remote driving) and Pico sensor firmware (thermal camera, lidars, IMU), with a Node.js bridge to SpacetimeDB |

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
- Presentation: https://canva.link/dv874lbguzouirt
- `docs/devpost-draft.md`: the Devpost entry.
- `docs/PROJECT.md`, `docs/MVP.md`: the team's original plan, before the drone.
- `docs/AGENT_WORKFLOW.md`: how the three agents (orchestrator, auditor, comms agent) work.
- `docs/specs/`: implementation specs and the shared contracts (start at `docs/specs/README.md`).
- `docs/ROBOT.md`: onboard hardware, pin map, and protocol.
- `docs/README-rover.md`: the earlier README, from the ground-robot plan.
