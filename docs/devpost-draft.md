# Devpost draft: Rubble Search

Status: draft for C6, updated 2026-11-08 for the drone direction (the robot dog version is in `docs/devpost-draft-rover.md`).
This is not a submission-ready entry; replace each `TBD` only with evidence from an integrated run.
Decision 2026-11-08: the judged demo is hard-coded; only SpacetimeDB runs live, and the simulator scripts everything else (see "Live and simulated in the demo").

## Inspiration

After a disaster, responders need to find people, understand who needs help first, and keep every report visible while many teams work at once.
At the Mayfield candle factory in 2021, Kyanna Parsons-Perez described being trapped under debris for about two hours before rescuers reached her ([TODAY](https://www.today.com/today/amp/rcna8462)).
One 1980 southern Italy earthquake study found that 87.9% of the rescued casualties extricated on day zero were alive at extrication, compared with 35.3% on day one; those figures describe one event and are not a universal survival curve ([De Bruycker et al., WHO Bulletin](https://www.iris.unina.it/retrieve/e268a72d-8b54-4c8f-e053-1705fe0a812c/The%201980%20earthquake%201983.pdf)).
A drone can cover rubble that people and ground robots cannot cross quickly, so it goes in first.

## What it does

Rubble Search is a prototype for a drone that searches a disaster site from above, reports possible survivors, and helps human rescuers reach the most critical people first.
The drone flies a grid with a thermal camera, hovers over each warm, person-sized shape, and records about 20 seconds of video for a camera-based breathing check.
Each find gets a confidence-based critical score, rescuers are assigned and briefed, and Even Realities G2 glasses show how many critical people are nearby and point the way to the next one.
A ground rover can be sent in second for a close look where the drone cannot reach.
The drone does not diagnose a person, and the system does not claim to see through rubble.
In the judged demo, the simulator scripts the drone's search of one house and the find, and SpacetimeDB, the dashboard, and the glasses view run live on that scripted data.

## How we built it

### SpacetimeDB

SpacetimeDB is the whole backend: there is no separate web server or API layer.
The module holds every survivor, search cell, search vehicle, mission, assignment, briefing, agent task, and event, and its reducers enforce the survivor state machine, roles, and the rule that no one is labelled dead.
Every timer is a schedule-table row inside the database: assignment and proposal leases, rescuer and vehicle heartbeats, two-level escalation, the agent watchdog, and a sweep that repairs missing timers.
If no agent proposes a rescuer in time, the watchdog assigns the nearest one itself, so the "no one overlooked" guarantee holds with every agent down.
A dropped glasses connection releases its assignment after a 2 s grace, and per-rescuer views (`my_assignment`, `my_briefing`, `my_survivor`) give each pair of glasses only its own rows.
A 62-check smoke suite runs against a local SpacetimeDB server, and the module is published on Maincloud as `assess-0hw81` (dashboard https://spacetimedb.com/assess-0hw81).

### Nemotron agents

The planned orchestrator, auditor, and comms agent hand work to one another through a durable `agent_task` board.
The model and tool-call flow is `TBD` until the agent implementation and hosted Nemotron smoke test are complete.
The agents are tested separately (109 tests and 8 scenarios, plus a real-model validation on Brev in `docs/notes/2026-11-08-brev-validation.md`), and they do not run in the judged demo.

### Drone, sensing, and perception

The planned drone carries the thermal camera and a regular camera, flies a search grid, and hovers to record a breathing clip at each candidate.
The drone airframe and flight software are `TBD`; in the judged demo the simulator stands in for it.
The sensing stack is built from the team's ground hardware: a Raspberry Pi Pico reads the thermal camera, a 360-degree lidar, a single-point lidar, and an IMU, and streams them to a Raspberry Pi, which finds warm, person-sized shapes with explainable rules and reports them to SpacetimeDB through a Node.js bridge.
Detection range, breathing results, model performance, and flight behavior are `TBD` until measured during an integrated run.
The perception service (753 tests), the onboard program (`raspberrypi/robot/`), and the Pico firmware (`pico/`) are built and tested separately, and they do not run in the judged demo.

### G2 glasses

The glasses show a critical-survivor count, an acknowledgement prompt, and a map or direction arrow for an accepted assignment.
A glasses service holds one SpacetimeDB connection per rescuer and pushes live changes to the Even Hub plugin and to a fallback web page drawn like the lens.
Against a local server, a proposal reaches the glasses, an accept moves the survivor to assigned, and closing the glasses connection releases the assignment; real-lens behavior is `TBD`.
In the judged demo, the glasses view (on the G2 or the fallback page) renders the scripted find live from SpacetimeDB subscriptions.

## Challenges

The project started as a robot dog, became a wheeled rover when the legs could not walk in time, and moved to a drone when the leg servos overheated; keeping one backend, dashboard, and glasses flow through those pivots was the main challenge.
The project also has to distinguish live actions from simulator data and keep uncertain detections visible without presenting them as medical conclusions.

## Accomplishments

The SpacetimeDB module, the coordinator dashboard, the glasses service, plugin, and fallback page, and the simulator are built, and each has passing tests.
Without any vehicle and without any agent, the simulator drives the full flow: a finding, a database watchdog assignment, a rescuer accept, and a resolution, with the headline "Critical survivors unattended over 60 s" at 0.
The onboard sensing works on the bench: the Pico streams the thermal camera, both lidars, and the IMU to the Pi.
Performance and scale numbers are still `TBD` until a measured integrated run.

## What we learned

`TBD` after the team records the integration run, model evaluation, and hardware tests.

## What's next

Fly the sensing stack on a real drone, connect the perception pipeline, show the live agent handoff on the dashboard, and verify the glasses flow with both the fallback page and real G2 hardware.
Measure each reported result and publish the final demo video and source repository before submission.

## Built with

SpacetimeDB, TypeScript, Even Realities G2, Nemotron, thermal sensing, camera-based breathing analysis, Raspberry Pi, Raspberry Pi Pico, lidar, and a drone.
Items in this list are planned or in progress unless demonstrated in the final run.

## Live and simulated in the demo

The judged demo is hard-coded (decision 2026-11-08).

Live: SpacetimeDB only, the Maincloud database `assess-0hw81` (or a local SpacetimeDB server with the same name as a fallback).
Every rule, timer, and subscription in the module is real.
The dashboard and the glasses view (on the G2 or the fallback page) are real clients that render live from SpacetimeDB subscriptions.

Simulated (scripted by the simulator): the drone's search of 2520 Rutford Ave, UT Dallas (house 3), the find, the breathing result (8 per minute) and critical score (IMMEDIATE), and any rescuer actions.
The simulator's vehicle is still named `sim-dog` in the code.

Not live in the judged demo: the drone hardware, the Nemotron agents, the perception service, the ground rover, and the real G2 hardware.
They are built and tested separately, except the drone hardware (`TBD`): agents 109 tests, 8 scenarios, and a Brev real-model validation; perception 753 tests; the onboard program in `raspberrypi/robot/` and the Pico firmware in `pico/`.

The story ends at the find; the judged demo has no scale run, no glasses walk, no disconnect, and no agent stop.
Measured results: `TBD`; no timing, accuracy, range, or scale result is claimed in this draft.

## Unconfirmed

- Drone airframe, flight software, and flight behavior.
- Database description output (`spacetime describe`) for the published Maincloud module.
- Nemotron hosted tool calls and agent decisions.
- End-to-end detection, breathing analysis, and critical scoring.
- Thermal detection range from the air and breathing evaluation results.
- Real G2 acknowledgement, navigation, and disconnect behavior.
- Integrated simulator scale run and unattended-survivor count.
- Measured timings and final team roles.
