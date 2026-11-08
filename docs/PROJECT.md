# Project: rubble search robot dog

Locked by Cayden on 2026-11-07.
This file is the source of truth for what the team is building.
`docs/ROBOT.md` is the source of truth for the robot's hardware and its control software.

Tracks: NVIDIA ("Use Nemotron Beyond a Chatbot"), State Farm ("The Worst Day, at Scale", catastrophe response), and SpacetimeDB (main track; it powers the whole backend).
Photon phone calls and a short-lived Supabase plan were dropped on 2026-11-07.
Track details are in `docs/notes/`.

## The idea (Cayden's words, lightly edited)

The scenario is rubble after a disaster.
The robot dog traverses rubble and finds survivors.
The thermal camera spots people.
A second camera uses Eulerian video magnification to see whether a person is breathing, that is, alive.
Each survivor gets a critical score.
A person stuck in rubble who is barely visible is labelled extremely critical, because the robot cannot help them.
The robot sends its findings to an operator wearing glasses.
The glasses show how many people are critical in the area (for example a 0.3 mile radius), and how to navigate to the people who are most in need.

## Pipeline

1. Search: the robot moves through the rubble area, and the thermal camera looks for warm shapes the size of a person.
2. Stop and look: at each candidate, the robot stops so the camera is still, and records about 20 seconds of camera video.
   The camera is a regular camera, so the scene needs visible light (room light or a white light on the robot, TBD).
3. Signs of life: a simple motion signal on the chest region gives the breathing rate and a confidence (`docs/specs/perception.md`); Eulerian video magnification only renders a magnified clip for the dashboard.
4. Critical score: combines signs of life, how buried the person is (how much of the body is visible), and thermal readings, into a triage level with a confidence.
5. Report: the finding (location, score, thermal image, camera frame, breathing result) goes into SpacetimeDB.
6. Coordinate: the orchestrator agent ranks survivors, proposes the nearest free rescuer, and plans the robot's next search; the auditor checks each proposal; the comms agent sends short briefings to the glasses.
7. Guide: the operator's Even Realities G2 glasses show the count of critical survivors nearby and directions to the next one.

## How each track is covered

- NVIDIA: multi-agent orchestration on Nemotron: an orchestrator plans and delegates, an auditor independently checks every proposal, and a comms agent briefs rescuers on the glasses, all talking through a shared task board (`docs/AGENT_WORKFLOW.md`).
  None of them is a chatbot.
- State Farm: the system identifies those with the most urgent needs (critical score), coordinates assistance (routes and briefings), and makes sure no one is overlooked (every area must be searched and every survivor stays on the board until a rescuer confirms them).
- SpacetimeDB: holds survivors, search areas, robot state, rescue assignments, and the agents' task board, and runs all the rules.
  Every operator sees the same live board through subscriptions, reducers enforce the rules (a survivor cannot leave the board until a person resolves them), schedule tables run every timer (leases, heartbeats, two-level escalation, the agent watchdog), lifecycle reducers catch a dropped glasses connection at once, and agents and workers are ordinary clients, so state survives any crash.

## Proposed tables (PROPOSED, SpacetimeDB; full list in `docs/specs/CONTRACTS.md`)

- `survivor`: location, critical level, confidence, breathing rate, visibility, images, status (unassigned, assigned, en route, reached, resolved).
- `search_cell`: a grid cell (a house) of the area, with status (unsearched, searching, partially searched, searched) and who searched it.
- `robot`: position, battery, current mission, health (OK, DEGRADED, FAILED).
- `assignment`: which rescuer is going to which survivor, with a lease that expires.
- `briefing`: the comms agent's latest short messages for each operator's glasses.
- `agent_task`: the agents' shared task board.
- `event_log`: every state change, used for the Agents panel and for replay.

## Platform (PROPOSED, SpacetimeDB)

```
robot (Pi 4B)                         laptop                          operator
C++ main program --local socket--> Node.js bridge --+                 phone (Even app WebView)
  (control loop never waits                         |                   ^  glasses plugin
   on the network)                                  v                   |  (WebSocket)
                               SpacetimeDB (TypeScript module on Maincloud:
                               tables, reducers, schedule tables, lifecycle reducers)
                                        ^           |   subscriptions
                                        |           +--> web dashboard (coordinators)
            Nemotron agents (Node.js) --+           +--> glasses service (Node.js)
            tools = reducers, agent_task board
```

- SpacetimeDB: one TypeScript module on Maincloud, with a local SpacetimeDB server on a laptop as the venue fallback.
  Reducers hold every rule, schedule tables hold every timer, `client_connected` and `client_disconnected` track who is online, and clients subscribe for live updates.
- Robot link: SpacetimeDB has no standalone C++ client (official clients: Rust, C#, TypeScript, Unreal), so a small Node.js bridge on the Pi holds the connection, and the C++ program talks to it over a local non-blocking socket.
  Option to test: the C++ program calls reducers directly with an HTTP POST to `/v1/database/:name/call/:reducer`.
- Agents: Node.js SpacetimeDB clients on a laptop whose write tools are reducers and who coordinate through the `agent_task` board.
  Model: `nvidia/nemotron-3-super-120b-a12b` through NVIDIA's OpenAI-compatible API at `https://integrate.api.nvidia.com/v1`, with `nvidia/nemotron-3-nano-30b-a3b` for the smaller agents and as the fallback.
  The hosted API schema does not list `tools`, so test one tool call first.
- GPS: Matthew's module on the Pi's USB through a USB-to-TTL adapter (or a USB GPS dongle), read with `gpsd`.
  This uses no Pi or Pico UART.
  About 2.5 m accuracy in open sky, no fix indoors or under rubble, so use the last outdoor fix plus the LiDAR offset.
- Demo network: the team's own phone hotspot or travel router, not venue Wi-Fi.
  A real deployment would use FirstNet deployable networks or Starlink, with LoRa only for small survivor reports.
- Breathing video clips go to the laptop over the local network for processing.

## Glasses view (PROPOSED, from `docs/research/g2-glasses.md` and `docs/research/bluebook-reference.md`)

- A small Even Hub plugin (TypeScript + Vite, official SDK `@evenrealities/even_hub_sdk` 0.0.16), loaded onto the glasses by QR code.
  The public Even Hub store is skipped: its rules ban emergency-routing apps.
- A glasses service on the laptop reads SpacetimeDB and pushes ready-made text and images to the plugin over a WebSocket.
  The plugin only renders and sends ring taps back.
- One adaptive view:
  - Far (more than about 50 m): a 2D map of the 0.3 mile area with markers (filled ring for critical survivors, hollow ring for others, dot for the operator), plus text with the count and the nearest critical survivor.
    The map is drawn from dark map tiles on a canvas and sent as two stacked 288x144 images (the approach in tesla-even-g2), redrawn only when markers change.
  - Close (less than about 50 m): one of 8 pre-drawn arrow images, the distance, and the house ("NE 32 m, house 3").
    The SDK has no compass, so the arrow is a compass direction (north up), not relative to where the operator faces.
  - Arrived (less than about 5 m): what the robot learned (where inside, breathing, confidence).
  - Switch to the arrow at 40 m and back to the map only after 60 m, so the view does not flicker.
  - Ring tap shows the map at any time.
    A long press jumps to the next critical survivor.
- What the arrow points at:
  - By default, a survivor's saved GPS position, recorded when the robot found them, so the robot can keep searching while rescuers go to each survivor.
  - The robot dog is always shown as its own marker on the map, from its live position (published about once a second).
  - A ring press can switch the target to the robot.
  - Accuracy: two GPS errors combine (robot and operator phone, a few meters each), so expect about 5 m, enough for the house or pile, not the exact spot.
    The robot's note ("8 m in from the front door") covers the rest.
- Display limits: 576x288, 4-bit green, black is see-through, at most 4 image and 8 text containers, about 83 ms per text update and about 100 ms per image update.
- Map tiles need internet, so pre-download the tiles for the demo area.
  CARTO tiles now return an "API KEY REQUIRED" watermark without a key (found by the glasses spec, 2026-11-07), so the glasses spec defaults to keyless Esri Dark Gray tiles (terms unconfirmed) and keeps CARTO as an option with a key.
  Show the attribution the chosen provider requires.
- Risks: the Even app must stay open on an unlocked phone, and venue Wi-Fi may block phone-to-laptop traffic.
- Fallback: a web page drawn exactly like the 576x288 green glasses view.
- Demo video: record the glasses view (simulator or the fallback page), lay it over real footage with a Screen or Add blend so black disappears, as in the bluebook demo video.

## Coordinator dashboard (PROPOSED)

A web app separate from the glasses, for coordinators and anyone overseeing or replaying a run (spec: `docs/specs/dashboard.md`).
UI reference: Pacioli, a SpacetimeDB winner at Cal Hacks 13.0 (React + Vite, `spacetimedb/react` hooks, live presence, a pipeline canvas with a big live number on each card, and a bottom transport bar).
Ours shows only data:

- Headline: "Critical survivors unattended over 60 s: 0".
- Pipeline canvas: robot search, detections, breathing and score, agents, assignments, rescuers, resolved, each card with live counts (for example "3 IMMEDIATE unassigned").
- Live map: search cells by status, survivors by critical level (labels, not only color), robot, rescuers.
- Ranked survivor list with level, score, confidence, reasons, breathing result, and waiting time.
- One Agents panel: each agent's status, the live task board, the action log (tool, reason, result), and the hand-off chain per survivor, so judges can watch the agents decide.
- Timer countdowns for leases, heartbeats, escalations, and the agent watchdog.
- Event log: escalations, lease expiries, robot offline.
- Robot health and media (thermal and camera images, breathing clip).
- Replay: pick a run, scrub a timeline, play at 1x, 4x, or 16x.

## Recording (PROPOSED)

- Every state change is recorded per run in SpacetimeDB's append-only event log, together with the agent action log and the detections (see `docs/specs/CONTRACTS.md`); replay rebuilds a run from these.
- Large files stay on the media server, with URLs in SpacetimeDB.
- The robot writes through its bridge, which spools to the Pi's SD card when offline and sends in order when it reconnects.

## Accounts and keys

| Service | What is needed | Cost |
| --- | --- | --- |
| NVIDIA | Developer Program account and an API key from build.nvidia.com | Free for prototyping (about 40 requests per minute, from forum reports) |
| SpacetimeDB | Account and `spacetime login` | Free plan 2,500 TeV a month, plus 100,000 TeV with code `HACKUTD2026` (one per GitHub account) |
| GitHub | Account for the credit and the public repo | Free |
| Even Hub | Sign in at hub.evenrealities.com with the Even app account, then restart the Even app for developer mode | Free, minutes |
| Map tiles | Esri Dark Gray needs no key (terms unconfirmed); CARTO now needs a key | Free for the demo, with attribution |
| Routing | Optional openrouteservice key; the bearing formula and the OSRM demo server need none | Free |

Keep every key in a local `.env` file that git ignores.

## How no one is overlooked (PROPOSED, version 3)

The AI improves decisions; the database guarantees nobody is dropped, even if the AI is down (Eric's proposal, 2026-11-07).
The full list is in `docs/AGENT_WORKFLOW.md` and `docs/specs/CONTRACTS.md`.

1. Coverage: every search area must reach searched; blocked or partly covered areas are "partially searched", never clear; an area the robot was searching reopens if the robot goes offline.
2. Accountability: people reports per building (below).
3. People who cannot be seen: anyone reported missing but not yet found stays "unaccounted" and keeps their house open in the search queue (the robot has no microphone).
4. Strict survivor states: unassigned, assigned, en route, reached, resolved; only a person can resolve; uncertain duplicates both stay on the board.
5. Nobody forgotten in the queue: glasses heartbeats and acknowledgement, leases, two-level escalation (everyone, then the incident commander), and an agent watchdog that assigns rescuers if the AI is silent.
6. Dashboard headline: "Critical survivors unattended over 60 s: 0".

## Who was in the building (PROPOSED)

Estimates of how many people live somewhere are not accurate, so the system uses only what people report:

- A coordinator enters reports per house: "2 people live here" or "these people are missing" (from family, neighbors, or a hotline), and "this person is safe".
- "Unaccounted" = reported missing, minus found, minus reported safe; a house with anyone unaccounted stays open in the search queue.
- Upper floors the robot cannot reach are flagged unsearched for human teams, never implied clear.
- Pitch line: "We never say a building is empty. We show what we know and where it came from."

## Person reports (PROPOSED)

Phone calls (Photon) were dropped on 2026-11-07 as too much work with too many edge cases.
Person reports come in from family, neighbors, or a hotline, and a coordinator enters them on the dashboard.
Contacts are never scraped or bought.

## Glasses voice questions (PROPOSED)

The robot has no microphone or speaker (removed 2026-11-07).
The only audio in the system is the G2 glasses microphone: a rescuer can ask a question out loud, speech-to-text on the laptop turns it into text (an NVIDIA speech model if available, Whisper as the fallback), and the comms agent answers on the display.

## Rules for the critical score

- The score is a triage aid for rescuers, not a medical diagnosis.
- Never label a person as dead.
  "No breathing detected" means the system could not see breathing, which can happen when the chest is covered, the camera moves, or the light is poor.
  Show it as "no signs of life detected, low confidence" and keep the person high on the list.
- Always show the confidence next to the score.
- Real mass-casualty triage uses systems such as START (immediate, delayed, minor, expectant).
  If the score uses similar levels, say so and keep it simple.

## Known risks

- The breathing check needs a still camera and about 20 seconds of video, so the robot must stop and hold still at each candidate; the processing runs on the laptop.
- Breathing is hard to see when the chest is covered by debris.
  The demo needs a visible chest or back.
- Driving over real rubble is hard for a small robot.
  The demo uses mock rubble (boxes, foam blocks, bricks) the robot can actually cross.
  The servos move the legs with inverse kinematics; the leg geometry comes from Matthew before anyone writes motion code.
- GPS has no fix indoors, so the indoor demo uses fixed coordinates for each mock house, with a short outdoor clip of real GPS if possible.
- The G2 glasses have no camera and no compass API.
- The thermal camera model is unconfirmed, so run a range test to learn how far away it can still pick out a person.

## Demo sketch

The full 4-minute script is in `docs/specs/demo.md`, and the steps judges must see are in `docs/MVP.md`.
In short: in dim light, the robot crosses mock rubble, finds a partly hidden teammate with the thermal camera, and checks breathing; the agents hand off on the dashboard's Agents panel; the rescuer's glasses guide them; a second screen stays in sync; stopping the agents shows the database still assigns.

## Open questions

Decided since this list was first written: the breathing rate comes from a simple motion signal on the laptop (`docs/specs/perception.md`), and the critical score formula is in the same spec.
Still open:

- Leg geometry and how the robot crosses obstacles (Matthew).
- The USB GPS module and adapter (Matthew).
- Whether tool calling works on NVIDIA's hosted Nemotron models (Eric's smoke test).
- How State Farm judges, and whether they provide data.
- Confirm with the organizers that one project can enter 3 sponsor tracks.
