# AGENTS.md

This file provides guidance to Codex and other coding agents when working with code in this repository.

## Status

As of 2026-11-07 the target tracks are NVIDIA, State Farm, and SpacetimeDB, and the backend is SpacetimeDB (Photon calls were dropped).
The project is LOCKED (Cayden, 2026-11-07): a robot dog searches rubble after a disaster, finds survivors with the thermal camera, checks for breathing with Eulerian video magnification, gives each survivor a critical score, and guides an operator wearing glasses to the most critical people.
Read `docs/PROJECT.md` first for the project, then `docs/ROBOT.md` for the robot.
`docs/MVP.md` is final (2026-11-07) and sets the scope (must, should, could have) and the build priority by sponsor track; build in that order.
Scope changes now need a team decision; do not add features that `docs/MVP.md` does not list.
Before writing code for any component, read `docs/specs/CONTRACTS.md` (shared names, tables, reducers, message formats, and which folder of the team repo each component lives in) and that component's spec in `docs/specs/`.
The contracts file changes only by a human decision; a component spec lists any change it needs under "Proposed contract changes".
The robot plan is still to build reusable robot plumbing first (device init, HAL with mocks, Pi to Pico link, state machine, safety gate) and keep the application layer swappable.

`docs/ROBOT.md` is the source of truth for the robot: confirmed decisions, hardware inventory, proposed pin map, architecture, state machine, protocol, and open questions.
`docs/research/` holds the research behind the plan: `platform.md` (SpacetimeDB, Nemotron, GPS, network), `g2-glasses.md` and `bluebook-reference.md` (glasses app and map view), and `perception.md` (thermal detection, breathing, triage).
Its older files (produced water, leak detection, inspection robots, images) were for the dropped EOG direction.
`docs/PROJECT.md` has the proposed platform, glasses view, and the accounts and keys list.
`docs/IDEAS.md` and `docs/notes/` are the history of the ideation phase (the grid outage idea led until this pivot), so do not treat them as current decisions.

Code has landed in the SpacetimeDB module, simulator foundation, and glasses plugin.
Run the module typecheck and build with `cd backend/spacetimedb && npx tsc --noEmit -p . && spacetime build`.
Run the module smoke suite with `cd backend/spacetimedb && npm test`.
Run the glasses plugin checks with `cd frontend/glasses && npm test && npm run build`.
Run the glasses service checks with `cd backend/glasses-service && npm test && npx tsc --noEmit`.
Run the simulator checks with `cd backend/sim && npm test && npx tsc --noEmit`.
The robot main program is in `raspberrypi/robot/` (C++17, CMake): the state machine, safety gate, threads (main, movement, vision), control socket, and mocks (task R1).
Build and test it with `cmake -B build && cmake --build build -j && ctest --test-dir build --output-on-failure` inside `raspberrypi/robot/`, and run it on a laptop with `./build/robot --config config/robot.laptop.yaml`; `raspberrypi/README.md` has the dependencies and the `robotctl` commands.
Component run and integration commands remain in their specs in `docs/specs/`.

Primary perception and agents are in `backend/perception/` and `backend/agent/`.
Run `.venv/bin/python -m pytest -q` from `backend/perception/`.
Run `npm run typecheck` and `npx vitest run --exclude '**/codex-reference/**'` from `backend/agent/`.
Separate reference implementations remain in their `codex-reference/` subfolders.
Their setup, public-data commands and measured limitations are in their READMEs
and `docs/research/breathing-repos.md`; they do not replace the primary services.
Local tests and fake-database scenarios do not prove live integration.

This is the team repo, https://github.com/matthewthomasbeck/HackUTD (public, branch `main`).
The planning docs live in `docs/`, next to the code folders.
Code folders, per `docs/specs/CONTRACTS.md`: `raspberrypi/` (robot C++ program and Node.js bridge), `pico/` (Pico firmware), `backend/` (SpacetimeDB module, bindings, agents, perception service, glasses service, simulator), `frontend/` (dashboard, glasses plugin and fallback page, design tokens), `3d_parts/` (Matthew's robot parts), and `images/`.
The repo is public: never commit keys (they go in git-ignored `.env` files) or anything a teammate marks private.

## Working rules

These come from the team brief in `docs/ROBOT.md`.

- Anything marked PROPOSED, TBD, or TBC is open.
  Ask before locking it in code.
- Never assume hardware details: I2C addresses, baud rates, driver protocols, servo channel maps, rail voltages.
  The only fixed values are the ones in `docs/ROBOT.md` (ADS1115 at 0x48, LD19 at 230400, single-point LiDAR at 115200 default).
  Everything else goes in `config/robot.yaml`, marked TBD.
- Every device gets a mock.
  The full state machine must run on a laptop with no hardware attached.
- Ask before writing motion code.
  What the servos move, and whether the DC motors are the drivetrain, are unconfirmed.
- Motion is inverse kinematics, not reinforcement learning, and must not depend on a URDF.
- The team learns by reading the code.
  Explain what changed and why, and trace one example through it.
  For the learning teammate (S2), give hints before full solutions.
- Prefer iterative over recursive code.
- No em dashes in docs, comments, or commit messages.

## Architecture in brief

The details are in `docs/ROBOT.md`.
These are the invariants that span files and are easy to break:

- The Pi drives all actuators (2 Pololu Maestros, 2 dual DC drivers over UART).
  The Pico owns all sensors (IMU, thermal camera, ADS1115 with 4 FSRs, single-point LiDAR, LD19) and streams parsed values to the Pi over USB serial.
- Device code refers only to the stable udev names: `/dev/servo45`, `/dev/servo25`, `/dev/dcmotorA`, `/dev/dcmotorB`, `/dev/pico`.
- Every device init returns OK | DEGRADED | FAILED.
  A failed required device sends the state machine to FAULT, and a Pico firmware version mismatch counts as FAILED.
- The Pi main loop runs at a fixed rate and never blocks on I/O.
  Reader threads (Pico link, camera, optional inference) write into mutex-guarded latest-value slots with timestamps, not queues.
- Each tick runs observe, step, behavior, safety gate, send, log, in that order.
  Behaviors return commands and never touch hardware.
  Only the safety gate passes commands to the drivers.
- Stale data, a lost Pico heartbeat (about 250 ms), a loop overrun, an out-of-limits command, or the e-stop sends ACTIVE to SAFE_STOP.
  The e-stop latches until a human resets it.
- Only the main loop calls `sd_notify("WATCHDOG=1")`, so a hung loop trips the systemd watchdog.
- The Pico has no OS.
  Its "threads" are non-blocking `poll()` tasks in one superloop on core 0, driven by timers and UART IRQ ring buffers, and the loop feeds the hardware watchdog once per pass.
  Use FreeRTOS only if the team explicitly picks it.

## Team

The brief names roles, not people: S0 (analytics, electrical, assembly), S1 (architecture lead, teaches S2), and S2 (software, learning).
Roles may change.
The team from the ideation notes is Cayden, Matthew Beck (hardware lead, owns most of the parts), Eric Lee, and Camille.
Do not guess which person holds which S role.
Current workstream owners are in the "Assignments" table in `docs/MVP.md` (Matthew: electrical system and assembly; Camille: robot edge software; Eric: computer vision, models, and the agents (proposed); Cayden: G2 glasses and extra work).
Detailed tasks are in `docs/TASKS.md` and `docs/tasks/<name>.md`; update assignments there and in `docs/MVP.md` together.
All frontend, glasses, and slide work follows design control in `docs/DESIGN.md`: tokens and components from one design file, no raw colors or fonts in code, and a screenshot check against the frame before merge.

## Event constraints

- First target track: NVIDIA, "Use Nemotron Beyond a Chatbot" (LOCKED 2026-11-07).
  The project must use Nemotron as an agent that plans multi-step tasks and calls external tools, not as a chatbot.
  See `docs/notes/2026-11-07-nvidia-track.md`.
- Second target track: State Farm (chosen 2026-11-07).
  "The Worst Day, at Scale": when a disaster hits thousands of people at once, use AI to identify the most urgent needs, coordinate assistance, and make sure no one is overlooked.
  See `docs/notes/2026-11-07-state-farm-track.md`, and `docs/AGENT_WORKFLOW.md` for how the backend enforces "no one overlooked".
- Third target track: SpacetimeDB main track (back in on 2026-11-07, after a short switch to Photon).
  SpacetimeDB must power the app's primary functionality, not just chat or player movement, and the source must be public on GitHub.
  Use SpacetimeDB for what it is good at, and show it in the demo:
  - Server logic lives in reducers, with no separate web server or API layer.
  - Schedule tables run every timer inside the database (leases, heartbeats, escalation, the agent watchdog).
  - Business rules and permissions are enforced in reducers, so an agent can only propose what the rules allow.
  - `client_connected` and `client_disconnected` catch a dropped glasses or robot connection at once.
  - Every client view is a live subscription, so changes appear for every user at once (multiplayer by default).
  - Agents and workers are ordinary clients that coordinate through tables (the `agent_task` board), so state survives a worker crash.
  See `docs/notes/2026-11-07-spacetime-winners.md` for how past winners did this.
- Dropped on 2026-11-07: Photon and phone calls (too much work, too many edge cases).
- Confirm with the organizers that one project can enter 3 sponsor tracks.
- Dropped on 2026-11-07: EOG, CBRE, T-Mobile, and NMC² (notes stay in `docs/notes/`).
- The Nemotron agent never drives actuators directly.
  It sends high-level requests to the robot, and the state machine and safety gate stay in charge of motion.
- Confirm the exact event dates before planning a schedule.
- Parts lead time drives the schedule.
  Build with hardware the team already owns unless the team decides to order.
  Keep a bill of materials with lead times once the MVP is chosen.
- MLH coaches are ineligible for MLH tracks, and Cayden is a coach.
  Whether this affects the whole team is unconfirmed.

## Docs

- Meeting and chat notes go in `docs/notes/`, one dated file each.
- Do not invent hardware specs, part numbers, or deadlines.
  If a fact is not in `docs/ROBOT.md` or confirmed by the team, ask.
- `CLAUDE.md` mirrors this file for Claude Code.
  Keep the two in sync.
- Follow the global rules in `~/AGENTS.md`.
  This project does not share conventions with its sibling hackathon projects.
