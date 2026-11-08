# Devpost draft: Rubble Search

Status: draft for C6, updated 2026-11-08.
This is not a submission-ready entry; replace each `TBD` only with evidence from an integrated run.

## Inspiration

After a disaster, responders need to find people, understand who needs help first, and keep every report visible while many teams work at once.
At the Mayfield candle factory in 2021, Kyanna Parsons-Perez described being trapped under debris for about two hours before rescuers reached her ([TODAY](https://www.today.com/today/amp/rcna8462)).
One 1980 southern Italy earthquake study found that 87.9% of the rescued casualties extricated on day zero were alive at extrication, compared with 35.3% on day one; those figures describe one event and are not a universal survival curve ([De Bruycker et al., WHO Bulletin](https://www.iris.unina.it/retrieve/e268a72d-8b54-4c8f-e053-1705fe0a812c/The%201980%20earthquake%201983.pdf)).

## What it does

Rubble Search is a prototype for a robot dog that searches a disaster site, reports possible survivors, and helps a human rescuer reach the most critical people first.
The planned flow combines thermal confirmation, a camera-based breathing check, a confidence-based critical score, coordinated assignments, and navigation cues on Even Realities G2 glasses.
The robot does not diagnose a person, and the system does not claim to see through rubble.

## How we built it

### SpacetimeDB

SpacetimeDB is the whole backend: there is no separate web server or API layer.
The module holds every survivor, search cell, robot, mission, assignment, briefing, agent task, and event, and its reducers enforce the survivor state machine, roles, and the rule that no one is labelled dead.
Every timer is a schedule-table row inside the database: assignment and proposal leases, rescuer and robot heartbeats, two-level escalation, the agent watchdog, and a sweep that repairs missing timers.
If no agent proposes a rescuer in time, the watchdog assigns the nearest one itself, so the "no one overlooked" guarantee holds with every agent down.
A dropped glasses connection releases its assignment after a 2 s grace, and per-rescuer views (`my_assignment`, `my_briefing`, `my_survivor`) give each pair of glasses only its own rows.
A 62-check smoke suite runs against a local SpacetimeDB server; Maincloud deployment is still `TBD`.

### Nemotron agents

The planned orchestrator, auditor, and comms agent hand work to one another through a durable `agent_task` board.
The model and tool-call flow is `TBD` until the agent implementation and hosted Nemotron smoke test are complete.

### Robot and perception

The planned robot searches a mock rubble site, sends a detection, and records a camera clip for breathing analysis.
Robot detection, breathing results, model performance, thermal range, and hardware behavior are `TBD` until measured during an integrated run.

### G2 glasses

The glasses show a critical-survivor count, an acknowledgement prompt, and a map or direction arrow for an accepted assignment.
A glasses service holds one SpacetimeDB connection per rescuer and pushes live changes to the Even Hub plugin and to a fallback web page drawn like the lens.
Against a local server, a proposal reaches the glasses, an accept moves the survivor to assigned, and closing the glasses connection releases the assignment; real-lens behavior is `TBD`.

## Challenges

The main challenge is keeping the database rules, robot reports, model outputs, dashboard, and glasses aligned while making each component work without the others.
The project also has to distinguish a live human or robot action from simulator data and keep uncertain detections visible without presenting them as medical conclusions.

## Accomplishments

The SpacetimeDB module, the coordinator dashboard, the glasses service, plugin, and fallback page, and the simulator are built, and each has passing tests.
Without the robot and without any agent, the simulator drives the full flow: a finding, a database watchdog assignment, a rescuer accept, and a resolution, with the headline "Critical survivors unattended over 60 s" at 0.
Performance and scale numbers are still `TBD` until a measured integrated run.

## What we learned

`TBD` after the team records the integration run, model evaluation, and hardware tests.

## What's next

Connect the robot and perception pipeline, show the live agent handoff on the dashboard, and verify the glasses flow with both the fallback page and real G2 hardware.
Measure each reported result and publish the final demo video and source repository before submission.

## Built with

SpacetimeDB, TypeScript, Even Realities G2, Nemotron, thermal sensing, camera-based breathing analysis, Raspberry Pi, Raspberry Pi Pico, and a robot dog.
Items in this list are planned or in progress unless demonstrated in the final run.

## Live and simulated in the demo

Live components: `TBD` after rehearsal.
Simulated components: `TBD` after rehearsal, including any extra survivors or rescuers and any injected failures.
Measured results: `TBD`; no timing, accuracy, range, or scale result is claimed in this draft.

## Unconfirmed

- Maincloud deployment and database description output.
- Nemotron hosted tool calls and agent decisions.
- End-to-end robot detection, breathing analysis, and critical scoring.
- Thermal detection range and breathing evaluation results.
- Real G2 acknowledgement, navigation, and disconnect behavior.
- Integrated simulator scale run and unattended-survivor count.
- Measured timings and final team roles.
