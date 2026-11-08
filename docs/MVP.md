# MVP: rubble search robot dog

HackUTD 2026. Status: FINAL (2026-11-07); scope changes need a team decision.
Tracks: NVIDIA ("Use Nemotron Beyond a Chatbot"), State Farm ("The Worst Day, at Scale"), and SpacetimeDB (it powers the whole backend).
Photon and phone calls were dropped on 2026-11-07 (too much work and too many edge cases).
Full plan: `docs/PROJECT.md`.
Build specs for each part: `docs/specs/` (shared names and formats in `docs/specs/CONTRACTS.md`).

## One sentence

After a disaster, our robot dog searches rubble, finds survivors with a thermal camera, checks whether they are breathing, scores how critical each person is, and guides a rescuer wearing smart glasses to the most critical people first, so no one is overlooked.

## Priority by sponsor track

Build in this order: first what scores on all three tracks, then what each track's judges must see.
Use what each sponsor offers at the event, and ask their mentors the questions below early.

| Priority | Feature | NVIDIA | State Farm | SpacetimeDB |
| --- | --- | --- | --- | --- |
| 1 | SpacetimeDB module with the survivor states, leases, escalation, and watchdog in reducers and schedule tables | | yes (no one overlooked) | yes (it is the backend) |
| 2 | Agent hand-off chain on the `agent_task` board, shown live on the dashboard | yes (multi-agent, tools) | yes (coordination) | yes (agents as clients) |
| 3 | Robot finds a person with thermal, breathing check, critical score with confidence | yes (real-world use) | yes (most urgent needs) | |
| 4 | Glasses count, acknowledge, and arrow | yes (comms agent output) | yes (coordinate assistance) | yes (live subscriptions) |
| 5 | Two screens in sync, disconnect release, stop the agents and the watchdog still assigns | | yes | yes |
| 6 | Auditor verdicts, comms agent's model, terrain camera model, voice questions | yes | | |

What each sponsor offers and expects:

- NVIDIA: Nemotron through build.nvidia.com (API key; tool calling unconfirmed until the smoke test); the track wants agents that plan and execute multi-step work with tools, not a chatbot; Brev credits are prizes, not provided up front.
  Ask the mentors: is tool calling supported on the hosted Nemotron 3 models, and what rate limit applies to our key.
- State Farm: "The Worst Day, at Scale"; prizes are Beats Studio Pro, a drone, and a monitor; judging criteria are not on the slide.
  Ask the mentors: how they judge, whether they provide data, and whether hardware counts.
- SpacetimeDB: Maincloud credit with code `HACKUTD2026`; SpacetimeDB must power the primary functionality; public source on GitHub is required to win.
  Ask the mentors: whether views are the right way to filter what each client sees, and how they want the demo to show SpacetimeDB.
- All: confirm that one project can enter 3 sponsor tracks.

## The demo we must be able to show

### Decision 2026-11-08: hard-coded demo

Cayden decided on 2026-11-08 that the judged demo is hard-coded (scripted by the simulator).
Only SpacetimeDB runs live: the Maincloud database `assess-0hw81` (dashboard https://spacetimedb.com/assess-0hw81), or the local fallback server with the same name.
Every rule, timer, and subscription in the module is real.
The simulator scripts everything else in the judged demo: the robot (`sim-dog`), the find, the breathing result and critical score, and any rescuer actions.
The Nemotron agents, the perception service, the real robot, and the real G2 hardware do not run live in the judged demo.
They exist and are tested separately: the agents (136 primary tests and typecheck on `eric-cv-benchmark`, 2026-11-08, plus the eight mock scenarios and the earlier Brev real-model validation in `docs/notes/2026-11-08-brev-validation.md`), perception (770 primary tests on that branch), the robot foundation in `raspberrypi/robot/` (88 tests and the scripted mock lifecycle check), and the Pico firmware in `pico/`. These are local branch validation counts; rerun after merging further changes.
The dashboard and the glasses view (on the G2 or the fallback page) are real clients that render live from SpacetimeDB subscriptions of the scripted data.

The judged story is short and ends at the find:

1. The robot dog enters 7716 Worthing St (house 3) and searches inside.
2. It finds the hidden person: IMMEDIATE, breathing 8/min, back bedroom under debris.
3. The dashboard and the glasses view show the find, and the demo ends there.

The judged demo has no scale 300 run, no glasses walk, no disconnect beat, and no agent-stop beat.
How to run it is in `docs/specs/demo.md` ("Judged demo (hard-coded, 2026-11-08)"): `npm run sim -- setup`, then `npm run sim -- timeline demo` from `backend/sim/`.

### Original plan (2026-11-07, superseded for the judged demo on 2026-11-08)

The list below is the original live demo plan.
It stays as the plan for rehearsal and video material, not for judging.

1. Dim light, a teammate partly hidden under boxes and blankets (mock rubble).
2. The robot drives in, finds the warm body with the thermal camera, and stops.
3. It records about 20 seconds of camera video and measures breathing.
4. The dashboard shows a new survivor: IMMEDIATE, breathing rate, confidence, and why.
5. The agents hand off live on the dashboard's Agents panel: the robot reports the find, the orchestrator proposes the nearest rescuer, and the comms agent briefs that rescuer on the glasses; the rescuer acknowledges on the glasses, and the auditor flags anything off.
6. The rescuer's G2 glasses show "1 critical within 0.3 mi", then an arrow and distance as they get close.
7. A second screen shows the same data updating at the same moment (SpacetimeDB subscriptions).
8. A rescuer's glasses go silent, the database releases the assignment at once, and the survivor goes back in the queue (no one overlooked).
   We stop the agent, and the database's own fallback still assigns the next rescuer.
   The dashboard headline stays at "Critical survivors unattended over 60 s: 0".
   A coordinator enters a family report for house 4 (two people live there); the robot found one, so house 4 shows "1 unaccounted" and moves up the search list.
9. Afterward, the dashboard replays the run.

## MVP scope

### Must have (the demo fails without these)

- Electrical system: power, wiring, common ground, e-stop on actuator power, and every sensor powered and talking.
- Robot drives on its mecanum wheels over mock rubble, by script or remote control (wheels first; leg inverse kinematics for stepping over obstacles if time allows).
- Light for the camera: the camera is a regular camera, so the breathing check needs room light or a white light on the robot (TBD).
- Thermal camera finds a warm, person-size shape and sends a detection.
- Breathing check: robot stops, records about 20 seconds of camera video, and the laptop computes the breathing rate with a confidence.
- Critical score with levels and reasons, never labelling anyone dead.
  "No breathing detected" shows as "no signs of life detected, low confidence" and stays at the top of the list.
- SpacetimeDB holds everything and runs the rules: survivors, search areas, robot, missions, assignments, briefings, and the event history, with the rules in reducers and every timer in schedule tables.
- "No one overlooked" enforced in the database, not by the AI: strict survivor states, glasses heartbeats and acknowledgement, every timer as a schedule-table row (lease, heartbeat, escalation, agent watchdog), and a fallback that assigns rescuers if the agent is down.
- Multi-agent orchestration (Nemotron), with agents that talk only through a shared task board in SpacetimeDB (`agent_task`), so every hand-off is logged and replayable:
  - Orchestrator (Nemotron 3.5 Super VL): triage, proposes rescuers, plans the search and creates robot missions, delegates work.
  - Auditor (Nemotron 3.5 Lightning): judges the quality of every orchestrator proposal (wrong rescuer, unfair load) with a verdict and a reason; the timers, not the auditor, own "too long unattended".
  - Comms agent (glasses, Nemotron 3.5 Lightning): starts with templates for briefings and nudges (the arrow and distance are plain math); its model is added once the core demo runs end to end, and it earns its place on rescuer voice questions.
  - Build order: orchestrator and auditor first, then the comms agent's model.
  - All agents are configurations of one shared agent runner (agent set from `docs/research/agents.md`).
  - If time runs short, cut in this order: vision tool, sitrep tool, rescuer voice questions, the comms agent's model (templates stay), then the auditor's model review; the orchestrator is never cut (`docs/AGENT_WORKFLOW.md`).
  - Every agent runs on events only, with strict JSON tools, short timeouts, its own deterministic fallback, and a shared request budget.
  - No agent drives motors or resolves a survivor, and the database guarantees still hold with every agent down.
- Dashboard: live map, ranked survivor list, timer countdowns, the headline "Critical survivors unattended over 60 s: 0", and one Agents panel that holds the agents' status, the live task board, the action log, and the hand-off chain per survivor.
- Glasses: count of critical survivors, acknowledge a new assignment, heartbeat, and an arrow with distance to the assigned one.
  Fallback: a web page drawn like the glasses view.
- Fixed demo coordinates for the mock houses, since GPS has no fix indoors.

### Should have (strong for judging)

- Terrain recognition: the robot classifies the ground ahead (flat, loose debris, step or ledge, gap or hole, blocked) from the camera, the LiDARs, the IMU tilt, and the force sensors, then slows, steers around, or stops, and logs what it saw.
- Rescuer voice questions: the rescuer asks through the glasses microphone (if the SDK allows), and the comms agent answers on the display.
- Second screen in sync, lease expiry, and two-level escalation (everyone, then the incident commander) shown live.
- Map view on the glasses when far, switching to the arrow when close.
- Replay of a run on the dashboard.
- Simulator that adds hundreds of survivors across the area to show "at scale", with the unattended headline staying at 0.
  (This applied to the earlier rehearsal plan; since 2026-11-08 the sim crew is minimal, R1 and R2 only with `extra_sim_rescuers` 0, so it would need extra helper rescuers, and it is not in the judged demo.)
- Person reports: a coordinator enters what family or neighbors report (2 people live in house 4, or someone is safe); a house with anyone unaccounted for stays open.
- Blocked or partly covered areas marked partially searched, never clear.

### Could have (only if ahead)

- Leg inverse kinematics to step over or climb obstacles.
- Agent tools: a vision describer (a Nemotron vision model turns one camera still into a scene description for the briefing, "head visible, legs under debris", if a suitable model is on build.nvidia.com) and the sitrep tool (a short situation summary for the incident commander).
- Robot calls reducers directly over SpacetimeDB's HTTP API instead of through the bridge (test first).
- Real GPS outdoors, shown in a short video clip.
- Magnified breathing video (Eulerian video magnification) on the dashboard.
- Ring controls on the glasses.

### Out of scope

- Real medical diagnosis.
- Seeing through walls, boxes, or rubble (thermal cannot).
- The public Even Hub store.

## Frontend look

All screens follow design control in `docs/DESIGN.md`: one design file, tokens before styling, components before screens, and a screenshot check against the frame before merge.

| Surface | Look | Reference |
| --- | --- | --- |
| Coordinator dashboard (Assess, a desktop app) | The real block as a full-screen map with floating cards: who needs help first, the headline "critical unattended over 60 s: 0", rescuers and robots, houses; night-purple top bar; status always labelled, not color only (built 2026-11-08, `docs/specs/dashboard.md`) | Standard Response (Cal Hacks 13.0), Stochastic, HackUTD Zero Day colors; UI only, no copied code |
| Agents page | The hand-off chain per survivor, a card per agent with its tornado mascot, the database fallback, and the live task board | Stochastic's agent tints and Agents page (`../Stochastic/docs/design/README.md`) |
| Glasses (G2) and the fallback page | Green on black (black is see-through), large text, map when far, arrow when close | bluebook and tesla-even-g2 (`docs/research/bluebook-reference.md`) |
| Slides and video | Same tokens and type as the dashboard, real screenshots, one idea per slide | `docs/DESIGN.md` outline; Cal Hacks deck plan and Stochastic evidence cards |

More references the team wants to match: TBD (add links here).

## Workstreams

Each workstream can start now with mocks or fake data, and they meet at SpacetimeDB.
Owners are listed in "Assignments" below.

| Workstream | What it delivers | Spec |
| --- | --- | --- |
| Electrical system | Power, wiring, common ground, e-stop, logic levels, sensor and motor bring-up (thermal, camera, LiDARs, IMU, force sensors, GPS) | `docs/ROBOT.md` |
| Robot edge software | C++ program on the Pi with mocks, Pico firmware, missions, thermal detection, Node.js bridge to SpacetimeDB | `specs/robot.md` |
| Computer vision and models | Person detection, breathing rate, critical score, media server, terrain recognition | `specs/perception.md` (terrain recognition to be added) |
| Glasses | Even Hub plugin, glasses service, map and arrow views, fallback glasses page | `specs/glasses.md` |
| SpacetimeDB module | Tables, reducers with the rules, schedule tables for every timer, lifecycle reducers, subscriptions | `specs/spacetimedb.md` |
| Nemotron agents | Orchestrator and auditor first, then the comms agent's model, on one shared runner, coordinated through the task board | `specs/agent.md` |
| Dashboard | Live view, agent chains, replay | `specs/dashboard.md` |
| Demo and pitch | Simulator, mock rubble set, demo script, video, slides (design control in `docs/DESIGN.md`) | `specs/demo.md` |

## Assignments (2026-11-07, can change)

The detailed task lists, phases, and checkpoints are in `docs/TASKS.md` and `docs/tasks/<name>.md`; update assignments there and here together.
Design and slides follow design control in `docs/DESIGN.md`.

| Person | Owns | Notes |
| --- | --- | --- |
| Matthew Beck | Electrical system, assembly, legs with Camille, mock rubble set, outdoor test and footage (PROPOSED) | `docs/tasks/matthew.md` |
| Camille | Robot edge software (robot dog code on the Pi and Pico, the bridge, missions, terrain rules) | `docs/tasks/camille.md`; R1 and the C++ part of R0 moved to Eric (2026-11-07) |
| Eric Lee | Computer vision and models (breathing, scoring, person confirmation, speech-to-text for rescuer questions, terrain model), and the Nemotron agents (PROPOSED); robot state machine, safety gate, and main loop (R1, from Camille, 2026-11-07) | `docs/tasks/eric.md`, R1 in `docs/tasks/camille.md` |
| Cayden Hutcheson | Even Realities G2 glasses, and extra work: SpacetimeDB module, design control, dashboard, simulator, slides, video, Devpost, integration (PROPOSED) | `docs/tasks/cayden.md` |

## Venue and testing

The final demo is indoors at the venue, so GPS has no fix and the demo uses fixed coordinates.
Test real GPS and outdoor runs outside beforehand, and show them in the video.

## Integration checkpoints

1. SpacetimeDB module published (Maincloud and a local server), and every other part can read and write fake data.
2. Simulator drives the whole flow with no robot: fake detection, score, agent assignment, dashboard, glasses.
3. Robot on mocks talks to SpacetimeDB through the bridge.
4. Real robot finds a real teammate in the dark, end to end.
5. Full demo rehearsal at least twice, with every fallback tried once.

## Fallbacks

| If this fails | Do this |
| --- | --- |
| Robot cannot cross rubble | Flat floor with low obstacles, or push the robot by hand and say so |
| Breathing check is unreliable | Show the measured signal and an honest low confidence |
| G2 glasses do not work | The fallback glasses page on a phone or laptop |
| Venue Wi-Fi blocks devices | Our own phone hotspot or travel router |
| Maincloud or internet down | Local SpacetimeDB server on a laptop |
| Nemotron API slow or failing tool calls | The database's watchdog fallback keeps assigning; the agent uses strict JSON tools and a short timeout |
| Robot breaks | Simulator robot plus the recorded video |

Since 2026-11-08 the judged demo is hard-coded, so the robot, breathing, glasses, and Nemotron rows above apply to rehearsal and video runs, not to judging.
For the judged demo the fallbacks are: if the scripted search does not report the find, the timeline runs `robot replay house3`; if Maincloud or the internet is down, point the sim and both clients at the local server; if the glasses view fails on the G2, use the fallback page.

## Accounts to set up now

- NVIDIA API key (build.nvidia.com).
- SpacetimeDB account and `spacetime login`, with code `HACKUTD2026` for free Maincloud credit (one per GitHub account).
- GitHub for the team repo (it must be public to win the SpacetimeDB track).
- Even Hub developer mode (sign in at hub.evenrealities.com with the Even app account).

Keys go in a local `.env` file that git ignores, never in the repo.

## Open questions for the team

- Confirm the PROPOSED owners in `docs/TASKS.md`.
- What the servos move (Matthew), and whether the first robot is drive-only.
- Thermal camera model, and a range test: how far away it still sees a person.
- GPS module model, connected over USB.
- Confirm with organizers that one project can enter 3 sponsor tracks.
- Ask State Farm how they judge.
