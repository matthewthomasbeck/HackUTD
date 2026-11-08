# Rubble Search: a drone that finds survivors first

HackUTD entry by Camille Rivera, Cayden Hutcheson, Matthew Beck, and Eric Lee.
Target tracks: NVIDIA ("Use Nemotron Beyond a Chatbot"), State Farm ("The Worst Day, at Scale"), and SpacetimeDB, which runs the whole backend.

After a disaster, a **DJI Mini 4 Pro** drone flies over the rubble first and streams live video to a laptop, where computer vision spots people from above.
A ground rover is then sent in second to each spot: its thermal camera confirms a warm, person-sized shape, and its camera records about 20 seconds of video for a breathing check.
Every find becomes a survivor with a critical score, on a live dashboard shared by every coordinator, and the most critical people go to rescuers wearing Even Realities G2 smart glasses, which show how many critical people are nearby and point the way to the next one.

## How it works

1. **Search from above.** The DJI Mini 4 Pro flies over the search area and streams live video from DJI Fly (RTMP) to a laptop. A person detector marks possible survivors and where they are.
2. **Send the rover in second.** The ground rover (mecanum wheels, built in this repo) drives to a marked spot, by remote control or on its own. Its thermal camera confirms a warm, person-sized shape, picking the closest one by lidar, and it stops about 1 m away.
3. **Hold still and record.** The rover's camera records about 20 seconds of video. A hovering drone shakes too much for this, so the close look happens on the ground.
4. **Signs of life.** A motion signal on the chest region gives a breathing rate with a confidence. The system never labels anyone dead: "no signs of life detected" stays at the top of the list.
5. **Critical score.** Breathing, how buried the person is, and the thermal reading combine into a triage level with its reasons.
6. **Report.** The find goes into SpacetimeDB, and every dashboard and pair of glasses sees it at the same moment.
7. **Coordinate.** Nemotron agents rank survivors, propose the nearest free rescuer, and brief that rescuer; the database enforces the rules, so no one is overlooked even with every agent down.
8. **Guide.** The rescuer's glasses show "1 critical within 0.3 mi", then an arrow and distance.

Why this split: the Mini 4 Pro weighs 249 g, has a regular camera but no thermal camera, and has no payload port, so it cannot carry the Pi, Pico, and sensors. It does what it is good at (seeing a wide area fast), and the rover carries the heavy sensing.

## Tracks

### State Farm: Intelligent Catastrophe Response

"The Worst Day, at Scale": when a disaster hits many people at once, find the most urgent needs, coordinate help, and make sure no one is overlooked.
Rubble Search covers the three stages in one workflow: the drone and rover **discover** survivors, the critical score **assesses** who needs help first, and the shared board **coordinates** rescuers.
"No one overlooked" is enforced by the database, not by the AI: every survivor stays on the board until a person resolves them, a dropped rescuer releases their assignment at once, and a watchdog assigns the nearest rescuer if no agent does.
The dashboard headline is "Critical survivors unattended over 60 s: 0".

### NVIDIA: Nemotron Beyond a Chatbot

Three Nemotron agents plan multi-step work and call tools; none of them is a chatbot:

- **Orchestrator**: ranks survivors, proposes the nearest free rescuer, and plans where the drone looks next and where the rover goes.
- **Auditor**: independently checks every proposal (wrong rescuer, unfair load) and gives a verdict with a reason.
- **Comms agent**: briefs rescuers on their glasses and answers their questions.

The agents talk only through a shared task board in SpacetimeDB (`agent_task`), so every hand-off is logged and replayable, and no agent can fly the drone, drive the rover, or resolve a survivor.
See `docs/AGENT_WORKFLOW.md`.

### SpacetimeDB: Real-Time Rescue Coordination

SpacetimeDB is the whole backend, with no separate web server or API layer, published on Maincloud as `assess-0hw81`:

- **One live board**: survivors, search areas, the drone and rover, missions, assignments, briefings, and the agents' tasks, streamed to every dashboard and pair of glasses through subscriptions.
- **Rules in reducers**: the survivor state machine, roles, and the rule that no one is labelled dead.
- **Timers in schedule tables**: assignment leases, heartbeats, two-level escalation, and the agent watchdog all run inside the database.
- **Instant disconnect handling**: `client_disconnected` releases a dropped rescuer's assignment, so the survivor goes back in the queue.

## What is live and what is simulated

The judged demo is hard-coded (team decision, 2026-11-08): only SpacetimeDB runs live.
The simulator scripts the drone's flight and the rover, the find, the breathing result and critical score, and any rescuer actions.
The dashboard and the glasses view (on the G2 or the fallback page) are real clients rendering that data live from SpacetimeDB.
The DJI Mini 4 Pro video link (DJI Fly RTMP to a laptop) is planned and not yet tested; the agents, the perception service, and the ground rover are built and tested separately and do not run in the judged demo.
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
| `raspberrypi/`, `pico/` | The ground rover: Pi program (state machine, safety gate, wheel drive, thermal seek, remote driving) and Pico sensor firmware (thermal camera, lidars, IMU), with a Node.js bridge to SpacetimeDB |

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
