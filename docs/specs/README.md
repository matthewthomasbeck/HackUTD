# Specs

Implementation specs for the rubble search robot dog, written 2026-11-07.
Start with `docs/MVP.md` (scope and owners), then `CONTRACTS.md` (shared names and formats), then your component's spec.

## Files

| Spec | Component | Folder in the team repo | Owner (see `docs/MVP.md`) |
| --- | --- | --- | --- |
| [CONTRACTS.md](CONTRACTS.md) | Shared tables, reducers, roles, message formats (FINAL, version 8.1, SpacetimeDB) | all | everyone |
| [robot.md](robot.md) | Robot C++ program, Pico firmware, Node.js bridge, terrain rules | `raspberrypi/`, `pico/` | Camille (with Matthew for hardware) |
| [drone.md](drone.md) | Drone C++ program, MCU firmware, Node.js bridge, mirrored from the dog (PROPOSED) | `drone/` | TBD |
| [perception.md](perception.md) | Breathing rate, critical score, media server, camera terrain model | `backend/perception/` | Eric |
| [glasses.md](glasses.md) | Even Hub plugin, glasses service, fallback glasses page | `frontend/glasses/`, `backend/glasses-service/` | Cayden |
| [spacetimedb.md](spacetimedb.md) | SpacetimeDB module and client bindings (tested on 2.14.1) | `backend/spacetimedb/`, `backend/spacetimedb-bindings/` | Cayden (PROPOSED) |
| [agent.md](agent.md) | Nemotron agents: orchestrator, auditor, comms agent, on one shared runner | `backend/agent/` | Eric (PROPOSED) |
| [dashboard.md](dashboard.md) | Coordinator dashboard: live view, agent chains, replay | `frontend/dashboard/` | Cayden (PROPOSED) |
| [demo.md](demo.md) | Demo simulator, demo script, recorded video plan | `backend/sim/` | Cayden (PROPOSED) |

## Rules for coding agents

- Follow `CONTRACTS.md` exactly.
  `CONTRACTS.md` is FINAL, version 8.1; it wins wherever a component spec differs.
  For reducer argument lists, `spacetimedb.md` wins.
- Never put keys in the repo; each component has a git-ignored `.env` and a committed `.env.example`.
- The team repo is public, so keep private notes and keys out of it.
- Items marked TBD, UNCONFIRMED, or PROPOSED in a spec need a human decision or a test before they are locked in code.

## Time estimates

The hour estimates inside each spec are for writing the code by hand.
With coding agents, plan 1 to 2 hours per task, as listed in `docs/tasks/<name>.md`.

## Build order

The SpacetimeDB module comes first, because every other part reads and writes it.
Each part can start against mocks or fake data in parallel, then integrate at the checkpoints.

1. SpacetimeDB module: tables, reducers, schedule tables, and lifecycle reducers published to a local server, bindings generated (`spacetimedb.md`).
2. In parallel, against the local server or mocks:
   - Robot: state machine and safety gate on a laptop with mock devices, then the bridge (`robot.md`).
   - Perception: breathing pipeline on recorded clips, critical score, media server (`perception.md`).
   - Agent: tool-calling smoke test with Nemotron, then tools against the local server (`agent.md`).
   - Glasses: fallback page first, then the Even Hub plugin in the simulator, then the real G2 (`glasses.md`).
   - Dashboard: live tables and map, then the pipeline canvas, then replay (`dashboard.md`).
   - Simulator: demo config, scale data, fake robot and rescuers (`demo.md`).
3. Hardware bring-up in parallel (Matthew): power, e-stop, every sensor talking, drive on mecanum wheels.

## Integration checkpoints

1. Module published to Maincloud and a local fallback; every component can connect and call one reducer.
2. Simulator runs the whole flow with no robot: detection, breathing result, score, agent assignment, dashboard, glasses.
3. Robot on mock devices talks to SpacetimeDB through the bridge and uploads a clip to the media server.
4. Real robot finds a real teammate in dim light, end to end.
5. Full demo rehearsal (`demo.md`) at least twice, trying every fallback once.

## First things to test, because they could change the plan

- One Nemotron tool call through NVIDIA's hosted API (tool calling on the hosted models is unconfirmed).
- The SpacetimeDB items marked unconfirmed in `spacetimedb.md`, plus schedule tables and row-level visibility for a rescuer's glasses session.
- A thermal range test: at what distance the robot's thermal camera still picks out a person.
- A breathing clip of a teammate in the demo lighting, through the perception pipeline.
- The Even Hub plugin loading on the real G2 over the team hotspot.

## Contracts version 8.1 (2026-11-07)

`CONTRACTS.md` is FINAL, version 8.1: one clean document with every earlier change merged.
Version 8.1 adds four team-approved items: the person-check image, clearing a possible-duplicate flag (`clear_possible_duplicate`), the terrain hint to the robot, and (agent-internal) the `LLM_MODE=mock` switch.
It also fixes the SpacetimeDB environment variable names (`STDB_URI`, `STDB_DATABASE`, `STDB_TOKEN`; `VITE_` prefixed in browser apps) and the design tokens file (`frontend/design-tokens/tokens.css`).
All seven component specs were audited against it, and none has an open proposed contract change except as listed in its own spec.
Changes to `CONTRACTS.md` need a team decision.
