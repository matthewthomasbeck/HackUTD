# Spec: demo simulator and demo script

Status: PROPOSED (2026-11-07), follows `docs/specs/CONTRACTS.md` version 8.
Code folder in the team repo: `backend/sim/`.
Read `docs/specs/CONTRACTS.md` first, including "Recording and replay" and "Demo coordinates", then `docs/MVP.md`, `docs/AGENT_WORKFLOW.md`, and `docs/specs/dashboard.md`.
Every table, column, enum value, reducer, and role name here comes from the contract.
`docs/specs/spacetimedb.md` gives the exact reducer argument lists; where it differs from CONTRACTS.md version 8 on anything else, the contract wins.

Tracks: NVIDIA ("Use Nemotron Beyond a Chatbot"), State Farm ("The Worst Day, at Scale"), and SpacetimeDB (it powers the whole backend).
Backend: SpacetimeDB only (TypeScript SDK, generated bindings in `backend/spacetimedb-bindings/`).
There is no Photon, no phone calls, and no contact data in the sim or the demo.
Agents: the orchestrator (which also plans the search and creates robot missions), the auditor (verifier), and the comms agent (glasses), coordinating through the `agent_task` board.

Decision 2026-11-08: the judged demo is hard-coded (scripted by the simulator).
Only SpacetimeDB runs live; the simulator scripts the robot, the find, the breathing result and critical score, and any rescuer actions.
The judged run is in Part 3, "Judged demo (hard-coded, 2026-11-08)"; the longer live script below it is the original plan, kept for rehearsal and video material.

This spec has four parts:

1. The demo site config (fixed coordinates, because the venue is indoors and GPS has no fix).
2. The Node.js simulator (role `sim`).
3. The live demo script for judges, with a fallback for every risky step.
4. The outdoor tests and the recorded video.

## Honesty rules for the demo

For the judged demo (hard-coded since 2026-11-08), the presenter says that only SpacetimeDB runs live and that the robot, the find, the breathing result, the critical score, and any rescuer actions are scripted by the simulator.
The presenter does not say that the robot, the agents, perception, or the real G2 ran live in the judged demo.
The rules below that mention the real robot, the real breathing check, or the real agents were written for the original live plan (2026-11-07) and apply to rehearsal and video runs that actually use those parts.

- The dashboard shows "DEMO MODE" whenever `site.demo_mode` is true, and it stays on screen in the video.
- Simulated robot ids say so (`sim-dog`, `sim-dog-2` and up; the dashboard shows them as Dog 1 and Dog 2).
  Since 2026-11-08 (Cayden) nothing people see says "(sim)": the sim rescuer is named R1 (R2 was dropped on 2026-11-08), and texts the sim writes to the board (notes, mission reasons, resolutions) carry no "simulated" wording.
  The `sim_injection` events and DEMO MODE still mark what the simulator did.
- The presenter says out loud which parts are live (the real robot, the real breathing check, the real agents, the real glasses) and which are simulated (the hundreds of other survivors, the extra rescuers, injected failures).
- Every sim injection writes `log_event(kind = sim_injection, message, payload_json)`, so the dashboard marks it "SIMULATED" and the replay stays honest.
  The `message` names the command and its target (for example `"sim: fail rescuer-drop r2"`), and `payload_json` is `{}`, because an injection changes no entity.
- Never fake an agent decision.
  If Nemotron is slow, a human acts on the dashboard instead, or the module's watchdog acts, and the presenter says which.
- The hundreds of scale survivors are handled by the agents' deterministic fallback, not one model call each, because the shared budget is 20 requests a minute (`docs/AGENT_WORKFLOW.md`, `docs/research/agents.md`); the dashboard marks those actions "RULES FALLBACK", and the presenter says so.

## Part 1: demo site config

File: `backend/sim/demo-site.json`, committed.
The sim, the dashboard e2e tests, the robot bridge (demo anchor), and the glasses service (rescuer start point) all read this one file.

All positions are meter offsets from the site center (`east_m`, `north_m`), so moving the whole demo is a change to two numbers.
Since 2026-11-08 the site is 2520 Rutford Ave, Richardson TX 75080 (UT Dallas), centered on its engineering building, and each house is a real campus building from OpenStreetMap (`backend/glasses-service/site/site.geojson`, built by `backend/sim/scripts/build-site.mjs`; the building itself is missing from OpenStreetMap and was traced from the coordinator's Google Maps screenshot).
House 3 is the search cell on the person, in the east side of 2520 Rutford Ave (the coordinator's location); the others are Modular Labs 1 and 2, Karl Hoblitzelle Hall (house 4), Engineering and Computer Science North and South, Parking Structure 4, and University Village Buildings 24 to 27.
Earlier the center was 7716 Worthing St, Dallas TX 75252, with houses on the Worthing St block: houses 1 to 5 on Worthing St, houses 6 to 10 on Benchmark Dr, and 11 and 12 north of Worthing.
The houses are about 17 m apart, so cells are 15 m.
`src/geo.ts` converts offsets with `lat = center_lat + north_m / 111320` and `lon = center_lon + east_m / (111320 * cos(center_lat in radians))`, accurate to well under a meter over 500 m.
`npm run sim -- coords` prints every named point with its `lat` and `lon`.

```json
{
  "site": { "name": "Tornado response, UT Dallas", "center_lat": 32.9861898, "center_lon": -96.7516083, "radius_m": 350, "demo_mode": true, "require_mission_approval": true },
  "cell_size_m": 15,
  "houses": [
    { "label": "house 1", "east_m": -154.0, "north_m": 72.6 },
    { "label": "house 2", "east_m": -97.8, "north_m": 72.5 },
    { "label": "house 3", "east_m": 15.8, "north_m": -14.2, "demo_pile": true },
    { "label": "house 4", "east_m": -4.6, "north_m": 66.5, "view_blocked": true },
    { "label": "house 5", "east_m": 110.5, "north_m": 87.9 },
    { "label": "house 6", "east_m": -124.8, "north_m": -5.4 },
    { "label": "house 7", "east_m": 105.1, "north_m": -6.0 },
    { "label": "house 8", "east_m": -17.0, "north_m": -116.5 },
    { "label": "house 9", "east_m": -67.1, "north_m": -111.0 },
    { "label": "house 10", "east_m": -136.5, "north_m": -108.7 },
    { "label": "apartments 11", "east_m": -26.5, "north_m": -157.9 },
    { "label": "house 12", "east_m": 82.9, "north_m": 49.3 }
  ],
  "scale_lots": { "file": "site-lots.json", "label_prefix": "lot", "exclude_within_m": 40 },
  "demo_anchor": { "label": "house 3 southeast door", "east_m": 48.3, "north_m": -37.2 },
  "robots": {
    "real": { "robot_id": "dog1" },
    "sim": {
      "robot_id": "sim-dog",
      "home": { "east_m": 56.0, "north_m": 12.0 }
    },
    "fleet_size": 1
  },
  "rescuers": [
    { "key": "cayden", "name": "Cayden", "real": true },
    { "key": "r1", "name": "R1", "start": { "east_m": -150, "north_m": -60 } }
  ],
  "extra_sim_rescuers": 0,
  "hidden_survivors": [
    { "house": "house 3", "east_m": 15.8, "north_m": -14.2, "note": "east side, under rubble", "level": "immediate", "breathing": "detected", "rate_bpm": 8, "visibility_pct": 35 },
    { "house": "house 4", "east_m": -4.6, "north_m": 70.0, "note": "front room", "level": "delayed", "breathing": "detected", "rate_bpm": 18, "visibility_pct": 70 },
    { "house": "house 10", "east_m": -136.5, "north_m": -106.0, "note": "under stairs", "level": "immediate", "breathing": "not_detected", "visibility_pct": 15 }
  ],
  "family_report": { "house": "house 4", "kind": "missing", "count": 2, "name_or_unit": "family of 2", "source": "family", "note": "both were home" },
  "scale": {
    "count": 300,
    "rate_per_s": 15,
    "seed": 7,
    "mix": { "immediate": 0.05, "delayed": 0.25, "minor": 0.6, "unknown": 0.1 },
    "not_detected_share_of_immediate": 0.3,
    "min_spacing_m": 12,
    "duplicate_pairs": 3
  },
  "patrol": { "roads_file": "site-roads.json", "speed_mps": [0.8, 1.2], "follow_m": 3, "together_m": 8, "rejoin_speed_mps": 1.8, "min_leg_m": 60 },
  "scene": {
    "searched_houses": ["house 1", "house 2", "house 5"],
    "partial_houses": ["house 4", "house 9"],
    "radius_m": 250,
    "immediate": 1,
    "delayed": 4,
    "minor": 5
  },
  "timing": {
    "speedup": 3,
    "robot_heartbeat_ms": 1000,
    "rescuer_heartbeat_ms": 5000,
    "position_ms": 1000,
    "accept_delay_s": [
      2,
      4
    ],
    "on_scene_s": 8,
    "auto_resolve_sim_rescues": true
  },
  "media": { "rehearsal_thermal": "assets/rehearsal/thermal.png", "rehearsal_camera": "assets/rehearsal/camera.jpg", "rehearsal_clip": "assets/rehearsal/breathing.mp4", "rehearsal_result": "assets/rehearsal/result.json", "sim_thermal_pool": "assets/sim-thermal/" }
}
```

Notes:

- Updated 2026-11-08: the JSON above is copied from the committed `backend/sim/demo-site.json`.
  The simulated crew is minimal at Cayden's request: `fleet_size` 1 (so two robot dogs, `sim-dog` and `sim-dog-2`), rescuers Cayden (real, glasses) plus R1 (sim rescuer, key `r1`; R2 was dropped later on 2026-11-08), and `extra_sim_rescuers` 0.
  `sim-dog` (Dog 1) has its home on Rutford Ave next to 2520 Rutford Ave (`home` 56 m east, 12 m north), so the Play demo search starts at once.
  Cayden (the glasses demo walker) starts in the parking lot south of Franklyn Jenifer Dr (92 m at bearing 158 from the center) and walks about 115 m at 2 m/s, under a minute.
  `setup` prints "Robots: sim-dog, sim-dog-2" and "Rescuers: R1".
  `hidden_survivors` now starts with the house 3 person the judged demo finds (in the east side of 2520 Rutford Ave under rubble, IMMEDIATE, breathing 8 per minute).
- The center is an approximate point near UT Dallas, a placeholder.
  Before the first run, open the dashboard map, move the center to a residential block nearby so mock houses sit on houses, and run `coords` again.
- "house 3" is the real mock rubble pile at the booth, 140 m north of the center.
- "house 4" is the person report story: a family reports 2 missing, the sim fleet finds 1 (`hidden_survivors`), so it shows "1 unaccounted" and stays open in the search queue, because the second person is never found.
  `view_blocked` makes the sim robot mark it `partially_searched`, never clear.
- There are no occupancy estimates; what the board knows about people not yet found comes only from person reports.
- `scale_lots` fills the rest of the circle with 30 m cells on a 60 m grid ("lot 1" and up, row-major from the north-west), skipping points within 40 m of a named house, about 200 cells.
- `demo_anchor` is the "last outdoor fix" the robot bridge reports in demo mode, plus `indoor_offset_m`; the robot spec owns how the bridge reads it (environment variable `DEMO_SITE_CONFIG` pointing at this file).
- The real rescuer's identity and position belong to the glasses service: each glasses session holds its own SpacetimeDB connection (contract), and the service's demo walker moves the rescuer in demo mode (`docs/specs/glasses.md` section 5.9).
  The sim never connects as Cayden.
- Earlier rehearsal plan (2026-11-07): `extra_sim_rescuers` was 36, so with 40 sim rescuers and about 15 `immediate` survivors in the scale run, every immediate person can be acknowledged inside 60 s and the headline stays at 0.
  The presenter says the extra rescuers are simulated; the point is that nobody is lost when the queue is long, not that 40 people are at the booth.
  Since 2026-11-08 `extra_sim_rescuers` is 0 (only R1), so the scale beat would need extra helper rescuers added back.
- Site timings are the contract's demo-mode defaults: mission lease 15 s, assignment lease 30 s, proposal 30 s, escalation after 45 s (and the commander at 90 s).
  Heartbeat timeouts are 15 s for rescuers and 5 s for robots.
  The watchdog delay is the module constant `AGENT_WATCHDOG_S` (30 s, 15 s in demo mode), not a `site` column; `set_site_timings(site_id, mission_lease_s, assignment_lease_s, proposal_lease_s, escalate_after_s)` does not change it.

## Part 2: the simulator (`backend/sim/`)

### Stack and layout

- Node.js 22 or newer, TypeScript run with `tsx`, the `spacetimedb` npm package (2.14.x, as tested in `docs/specs/spacetimedb.md`), and the shared bindings from `backend/spacetimedb-bindings/`.
- Client API as in `docs/specs/dashboard.md` ("SpacetimeDB client API used"), from https://spacetimedb.com/docs/clients/typescript.
- The seeded random generator is a 10-line mulberry32 function in `src/rng.ts`.
- `src/status.ts` imports the headline function from `frontend/dashboard/src/model/headline.ts` (pure TypeScript, no dependencies), so the console and the dashboard compute the same number.

```
backend/sim/
  package.json            scripts: sim, reset, test
  .env.example            STDB_URI, STDB_DATABASE, MODULE_PATH, MEDIA_BASE, PERCEPTION_BASE, GLASSES_BASE
  demo-site.json
  timelines/
    demo.json             the judged demo (hard-coded, 2026-11-08): sim-dog searches house 3 and finds the hidden person
    judge.json            the original live judging run (superseded for judging on 2026-11-08; rehearsal and video material)
    video.json            the recorded video run
    e2e.json              short run for the dashboard tests
    stress.json           900 survivors, 10 minutes, headline check
  assets/
    rehearsal/            media recorded by the real robot at rehearsal: thermal, camera, breathing clip, result
    sim-thermal/          generic warm-shape thermal images for scale survivors
  .tokens/                saved identity tokens, one per simulated identity (git-ignored)
  src/
    cli.ts                command parser and the interactive console
    config.ts             load and validate demo-site.json
    geo.ts                offsets to lat/lon, distance, bearing, walking
    rng.ts
    pool.ts               one SpacetimeDB connection per identity, with saved tokens
    guard.ts              refuse to act unless the site is in demo mode
    inject.ts             log_event(sim_injection) wrapper used by every injection
    setup.ts              site, cells, participants
    run.ts                start and end runs
    scale.ts              hundreds of survivors, duplicate pairs
    simrobot.ts           simulated robots and their detections
    rescuers.ts           simulated rescuers
    failures.ts           injected failures
    timeline.ts           scripted timeline runner
    status.ts             counts and the headline for the console
  tests/
```

### Identities (`pool.ts`)

- Each simulated actor is its own SpacetimeDB identity with its own connection, because reducers such as `rescuer_heartbeat`, `participant_update_position`, and `accept_assignment` act on the caller, because a closed connection is what `client_disconnected` sees, and because the human-only reducers (`accept_assignment`, `release_assignment`, `start_en_route`, `mark_reached`, `resolve_survivor`, `rescuer_ask`, `approve_mission`, `cancel_mission`) reject the `sim` identity even in demo mode.
  The sim acts as rescuers only through the simulated rescuer identities.
- Identities:
  - `sim` (role `sim`): setup, scale, runs, person reports, `log_event`.
  - One per sim robot (`sim-dog`, `sim-dog-2` and up), role `robot`, with `participant.name` equal to its `robot_id` (contract rule), so robot reducers run the same code path as the real bridge.
  - One per sim rescuer, role `rescuer`.
- Roles other than `rescuer` need demo mode or a prior `grant_role` (contract), so `setup` creates the demo site first, then registers the rest.
- Tokens are saved to `.tokens/<key>.token` on the first `onConnect` and reused, so identities survive restarts and `reset`.
- The `sim` connection subscribes to every contract table; each robot and rescuer connection subscribes only to its own `mission` or `assignment` rows, `site`, and `survivor`.

### Demo mode guard (`guard.ts`)

Before any command except `setup` and `reset`, the sim reads the newest `site` row.
If `demo_mode` is false, it prints "Site is not in demo mode, refusing" and exits with code 2.
The module enforces the same rule; this guard only gives a clear message.

### Commands

Run as `npm run sim -- <command>` for one-shot commands, or `npm run sim -- console` for a long-running process with a prompt that accepts the same commands.
The console is the normal way to run the demo, because simulated robots and rescuers keep running between commands.
Every command that changes the story (marked "inj") also writes a `sim_injection` event.

| Command | Short | What it does |
| --- | --- | --- |
| `coords` |  | print every named point with `lat`, `lon` |
| `setup` |  | site, cells, sim robots and rescuers (below) |
| `run start [name]` | `rs` | `start_run(site_id, name)`; default "Judging `HH:MM`" |
| `run end [notes]` | `re` | `end_run(run_id, notes)` |
| `scene [seed]` |  | seed an in-progress board on the newest site, then `rescuers start` and `robot start` (below); `scene seed` only seeds (inj) |
| `scale [count]` | `s` | add simulated survivors and duplicate pairs (below) (inj) |
| `hidden` | `h` | arm the `hidden_survivors` so a sim robot finds them when it searches those houses (inj) |
| `robot start` / `robot stop` | `rb` / `rbx` | run or stop `sim-dog` |
| `search <house>` | `sr` | queue a `search_cells` mission for `sim-dog` on that house's cell (added 2026-11-08 for the judged demo) (inj) |
| `robot replay house3` | `rr` | fallback: `sim-dog` reports the house 3 detection with the rehearsal media (inj) |
| `rescuers start` / `rescuers stop` | `rc` / `rcx` | run or stop the sim rescuer loop |
| `spawn <level> <house>` | `sp` | one survivor at a named house, found by `sim-dog` (used for the watchdog beat and tests) (inj) |
| `report <house>` | `rp` | fallback for the dashboard form: `report_person` with `family_report` (inj) |
| `dupes [n]` | `d` | n near pairs just outside the merge radius, so the dashboard has possible duplicates (inj) |
| `imbalance [key]` | `ib` | give one sim rescuer three active assignments while another is idle, for the auditor's load judgement (inj) |
| `walk [house]` | `w` | ask the glasses service's demo walker to walk Cayden to the current assignment (`POST $GLASSES_BASE/demo/cayden/walk`); with a house, print a warning if that assignment is not at the house |
| `fail robot-offline [robot_id]` | `f1` | stop heartbeats for a sim robot (default `sim-dog`) (inj) |
| `fail rescuer-silent [key]` | `f2` | stop `rescuer_heartbeat` and positions for one sim rescuer with an active assignment; connection stays open (inj) |
| `fail rescuer-drop [key]` | `f4` | close that sim rescuer's SpacetimeDB connection (the `client_disconnected` path) (inj) |
| `fail device <device> [status] [robot_id]` | `f3` | `robot_report_device`; default `thermal FAILED sim-dog` (inj) |
| `recover` | `ok` | undo all injected failures, reconnect dropped rescuers (inj) |
| `timeline <name>` | `t` | run `timelines/<name>.json` |
| `status` | `?` | headline, survivors by level and status, cells by status, assignments, agents online, robots, active run |

`reset` is a separate script, because it republishes the module.

### In-progress board (`scene.ts`, added 2026-11-08)

`scene` makes a board with only 2 robots and 1 sim rescuer look like a search under way, on the newest site after `setup`:

1. Survivors from `scene` in `demo-site.json` (3 IMMEDIATE, 4 delayed, 5 minor): placed like `scale`, inside real building footprints and their lot cells, at least `min_spacing_m` apart, but only in lots within `scene.radius_m` (250 m) of the center, from seed `scale.seed + 300`.
   Each is a `report_detection` by `sim-dog` or `sim-dog-2` (mission 0), then breathing and score as in `scale`, so the module labels it with its lot ("lot 28").
2. Cells: `scene.searched_houses` (houses 1, 2, 5) and every lot with a scene survivor are marked `searched`; `scene.partial_houses` (house 4, whose view is blocked, and house 9) are marked `partially_searched`.
   The judged demo house (house 3, `demo_pile`) is never touched, and the config check rejects a scene that names it.
   The house 3 hidden survivor is not part of the scene.
3. The configured `family_report` for house 4 (2 missing), unless house 4 already has a person report, so house 4 shows 2 unaccounted.
4. `rescuers start` and `robot start`.
   The module backstop then proposes the nearest free sim rescuer for each IMMEDIATE survivor within about 15 s (demo mode), and R1 accepts, walks, reaches, and resolves them.

Running `scene` again adds nothing: it skips survivors already at their planned points, cells already in their state, and an existing house 4 report.
`timelines/scene.json` runs the same steps (`scene seed`, `rescuers start`, `robot start`) and waits for Enter.

### Site and grid (`setup.ts`)

1. `register_participant("sim", sim)` at bootstrap, before any site exists (a sim registered at bootstrap can only create a site with `demo_mode = true`).
2. `create_site(name, center_lat, center_lon, radius_m, demo_mode, require_mission_approval)` with the `site` block; the module sets the demo timings itself.
3. For each house and each scale lot: `create_search_cell(site_id, lat, lon, cell_size_m, label)`.
4. Each sim robot connection: `register_participant(robot_id, robot)`, then one `robot_heartbeat` so its `robot` row exists.
5. Each sim rescuer connection: `register_participant(name, rescuer)`, `participant_update_position(lat, lon)` at its start, and the heartbeat loop.
6. Print the site id, cell count, robot names, and rescuer names.

`setup` is idempotent: if a site with the same name exists, it reuses it and only creates what is missing.
Setup happens before `run start`, so the run's replay starts from the `run_started` snapshot, which holds the cells, robots, and other current state.

### Survivors at scale (`scale.ts`)

Goal for State Farm: show the board ranking hundreds of people at once, keeping every one visible until a person resolves them, with the headline at 0.

For each of `count` survivors (seeded, so every run is the same):

1. Pick a scale lot (never a named house, so the live story stays clean), and a point inside it at least `min_spacing_m` (12 m) from other survivors, so the module neither merges them (`MERGE_RADIUS_M`, 4 m) nor flags them as possible duplicates (`DUPLICATE_RADIUS_M`, 10 m).
2. Pick a fleet robot `sim-dog-2` to `sim-dog-<fleet_size + 1>`.
   Each has a `hold` mission created once at the start (`create_mission(robot_id, hold, [], none, none, reason, 0)` by `sim`, which starts `queued`, then claimed with `claim_next_mission`) so detections have a `mission_id`, and keeps its heartbeat and position running.
   When `scale` or `dupes` ends, even on an error, each fleet robot reports its hold mission `done` with `mission_progress`, so a one-shot run never leaves a hold mission to expire and sit `queued` with `robot_id = ""`; the next `scale` creates fresh ones.
3. `report_detection(...)` from that robot's connection with `source = thermal`, `gps_fix = false`, a `location_note` from a short list ("front room", "under a table", "basement stairs", "back bedroom", "garage"), `max_temp_c` 31 to 36, `thermal_confidence` 0.55 to 0.95, and a `thermal_image_url` from `sim-thermal/` (uploaded once with `POST /media`).
4. Wait for the `survivor` insert whose `lat` and `lon` match (both rounded to 7 decimals), or the `detection` row's `survivor_id`, because reducers return no value to the client.
5. Draw a level from `scale.mix`, then `report_breathing(survivor_id, breathing, rate_bpm, confidence, visibility_pct, display_url)` as `sim` (in demo mode the sim may call the perception reducers):
   - `immediate`: `not_detected` with share 0.3, else `detected` 8 to 10 or 28 to 34 per minute; visibility 5 to 30%.
   - `delayed`: `detected` 12 to 24; visibility 30 to 70%.
   - `minor`: `detected` 12 to 20; visibility 60 to 100%.
   - `unknown`: skip breathing and score, so they stay "not scored".
   Breathing confidence 0.4 to 0.9; for `not_detected` 0.2 to 0.4.
6. `set_critical_score(survivor_id, level, score, confidence, reasons)`: `immediate` 75 to 89, `delayed` 45 to 70, `minor` 10 to 40; confidence 0.5 to 0.85; reasons such as `["breathing seen 30 per min (fast)", "15% of body visible", "thermal 34.2 C"]`, and for `not_detected` `["no signs of life detected, low confidence", "15% of body visible"]`.
   Scale survivors stay below 90, so the live survivor in house 3 (scored by the real perception service) can reach the top.
   The sim never sets the live survivor's score.
7. Throttle to `rate_per_s` (15 a second, so 300 survivors arrive over about 20 s; `--rate 0` means as fast as possible).

Also in `scale`:

- Mark about 60% of the lots `searched` and about 5% `partially_searched` with `mark_cell` from the fleet robots, in random order over the same 20 s, so coverage climbs and partial cells stay in the queue.
- `dupes duplicate_pairs`: for 3 survivors, add a second detection 5 to 6 m away (from a different fleet robot), so the module keeps both and sets `possible_duplicate_of` (contract rule); the dashboard then has pairs to show side by side.

Load rule for the agent owner: 300 survivors in 20 s must not cause 300 Nemotron calls.
The orchestrator batches new survivors, and for the scale burst it uses its deterministic path (`docs/research/agents.md`); the live house 3 survivor still goes through the models.

### Simulated robot (`simrobot.ts`)

`sim-dog` runs only when asked (`robot start`), so it never fights the real `dog1`.

- Every `robot_heartbeat_ms`: `robot_heartbeat("sim-dog", state, battery_pct)`, battery dropping 1% a minute from 95.
- Every `position_ms`: `robot_report_position("sim-dog", lat, lon, false, indoor_offset_m, heading_deg)`.
- Loop: `claim_next_mission("sim-dog")`; on a lease (a `mission` row with `robot_id = sim-dog` and status `leased`), `mission_progress(id, active, "starting")`, then for each target cell:
  - walk to the cell center at 1.2 m/s times `speedup`, reporting position,
  - `mark_cell(cell_id, searching)`, sweep inside the cell for 5 s,
  - report terrain about once a second: `flat` (`continue`) on open ground, `debris` (`slow`) or `step` (`steer`) within 10 m of a house, at most one `blocked` (`stop`) per mission (each report updates the robot's latest terrain fields, and only a class change writes a `terrain` event),
  - if an armed `hidden_survivors` entry is in this cell, stop and report its detection, then its breathing and score as in `scale.ts` steps 5 and 6,
  - `mark_cell(cell_id, searched)`, or `partially_searched` for a cell with `view_blocked` in the config (house 4).
- Then `mission_progress(id, done, "searched <labels>")`.
- `return_home` walks to `home`; `hold` stands still; `inspect` walks to the target.
- With no mission, idle with state `READY`.

`robot replay house3` (fallback when the real robot fails):

1. Walk `sim-dog` to the `demo_anchor`, then 15 m north into house 3.
2. Upload the rehearsal thermal and camera images with `POST /media`.
3. `report_detection(...)` with those URLs, `location_note` "8 m in from the front door".
4. Wait for the survivor, then `POST /breathing` with the rehearsal clip and the `survivor_id`, so the real perception service runs the real breathing method on the recorded clip.
5. If perception does not answer within 20 s, write `rehearsal_result` with `report_breathing` and `set_critical_score`, and print a warning so the presenter says so.

### Simulated rescuers (`rescuers.ts`)

Each sim rescuer (the named ones, R1 since 2026-11-08 and R1 to R4 in the earlier plan, plus `extra_sim_rescuers`, 0 since 2026-11-08, named "R5" and up, starting at seeded points on the site circle) runs:

1. Every `rescuer_heartbeat_ms`: `rescuer_heartbeat()`; every `position_ms`: `participant_update_position(lat, lon)`.
   Both renew its leases.
2. When an `assignment` with `status = proposed` appears for its identity, wait a random `accept_delay_s`, then `accept_assignment(assignment_id)` (the same acknowledgement the glasses send), then `start_en_route(assignment_id)` once, as the glasses service does.
   This runs on its own, even while the rescuer is walking to an earlier survivor, so a 30 s demo proposal lease never lapses; each proposal is accepted at most once.
3. Take the active assignments one at a time, lowest id first, and walk to the survivor at 1.4 m/s times `speedup`.
   The walk stops early if the assignment is no longer active.
4. Within 5 m: `mark_reached(survivor_id)`.
5. After `on_scene_s`: `resolve_survivor(survivor_id, rescued, "sim")` if `auto_resolve_sim_rescues`, else wait.
6. Go to the next active assignment, or walk back toward its start until one appears.

A rescuer held by `imbalance` neither accepts proposals nor starts new walks until `recover`.

Cayden is never driven by this loop.

### Failure injection (`failures.ts`)

Each failure shows a database rule doing its job, and each writes a `sim_injection` event first.

| Failure | What the sim does | What the module does | What the screens show |
| --- | --- | --- | --- |
| `robot-offline` | stops `sim-dog` heartbeats and positions; connection open | `heartbeat_timer` fires after 5 s: robot `online = false`, its `searching` cell back to `unsearched`; the mission lease (15 s) returns the mission to `queued` | OFFLINE card and gray marker, cell reopened, mission back in the queue |
| `rescuer-silent` | stops heartbeats and positions for one sim rescuer with an active assignment | `heartbeat_timer` fires after 15 s: assignment `released`, survivor `unassigned` | "RELEASED, heartbeat missed"; the orchestrator re-proposes |
| `rescuer-drop` | closes that rescuer's connection | `client_disconnected` sets `participant.online = false` and starts the 2 s disconnect grace (`heartbeat_timer`); then the assignment is `released` (cause `disconnected`) | avatar leaves both screens; "RELEASED, glasses disconnected" within about 2 s |
| `device` | `robot_report_device(sim-dog, thermal, FAILED, "no frames for 3 s")` | row changes, `device_status` event | red device row and "sim-dog thermal FAILED" |

For the real robot, a real failure is shown by stopping the bridge on the Pi; the sim never writes rows for `dog1`.
`recover` restarts heartbeats and positions, reconnects dropped rescuers, and reports the device `OK`.

`imbalance [key]` (default `r1`): hold that rescuer's sim loop, then bring it to three active assignments: as `sim`, `propose_assignment` the nearest `delayed` scale survivors to that rescuer, one at a time (a rescuer has at most one open proposal), and that rescuer's identity accepts each before the next; another sim rescuer is held idle nearby.
If another proposer (the module watchdog or the orchestrator) already has a proposal pending for that rescuer, `imbalance` accepts it as part of the load instead of failing, and it retries a rejected proposal with the next survivor.
If it cannot reach three, it releases the hold and fails with the reason.
A rescuer may hold several active assignments and can still be proposed.
Then one `delayed` survivor is spawned next to that rescuer, so the orchestrator makes a new proposal while the load is uneven (it prefers rescuers with fewer active assignments, so it may pick the idle one).
The module posts a `review` task for that proposal; if it makes the load uneven, the auditor completes the review with verdict `disagree` and `flag_kind` `load_imbalance`, and the module itself files the `audit_flag` (`filed_by = auditor`) inside `complete_agent_task`.
The auditor does not call `file_audit_flag` for reviews, and the module files no counting flags.

### Scripted timeline (`timeline.ts`)

A timeline is a JSON list of steps, run in order.
The example below is the original `judge.json` story (superseded for the judged demo on 2026-11-08); the judged `demo.json` is in Part 3.

```json
[
  { "at": "0:00", "cmd": "run start Judging" },
  { "cmd": "rescuers start" },
  { "cmd": "hidden" },
  { "cmd": "robot start" },
  { "at": "0:20", "cmd": "scale 300" },
  { "say": "Approve the search of house 3 on Screen A, point at Screen B" },
  { "await": "survivor_in", "house": "house 3", "timeout_s": 120, "else": "robot replay house3" },
  { "await": "assignment_for", "rescuer": "cayden", "status": "proposed", "timeout_s": 30, "say_on_timeout": "Assign Cayden from the survivor detail" },
  { "await": "assignment_for", "rescuer": "cayden", "status": "active", "timeout_s": 30, "say_on_timeout": "Cayden: tap the ring" },
  { "cmd": "walk house 3" },
  { "say": "Cayden: close the Even app now" },
  { "await": "released", "rescuer": "cayden", "timeout_s": 10, "else": "fail rescuer-drop r2" },
  { "say": "Coordinator: add the family report for house 4", "await": "person_report", "house": "house 4", "timeout_s": 30, "else": "report house 4" },
  { "say": "Stop the agents now" },
  { "after_s": 3, "cmd": "spawn immediate house 8" },
  { "await": "watchdog_fallback", "timeout_s": 30, "say_on_timeout": "Point at the escalation banner instead" },
  { "say": "Restart the agents" },
  { "cmd": "imbalance r1" },
  { "await": "audit_flag", "kind": "load_imbalance", "timeout_s": 40 },
  { "await": "key", "say": "Press Enter to end the run" },
  { "cmd": "run end judged" }
]
```

- `at` is time from the timeline start; `after_s` is time after the previous step.
- `await` waits for a condition seen in the subscription (`survivor_in`, `assignment_for`, `released`, `person_report`, `mission_for`, `watchdog_fallback`, `audit_flag`, `status`, or `key` for Enter), with a timeout and an optional fallback command or cue.
  `survivor_in` and `assignment_for` pass on the current state; `released`, `person_report`, `watchdog_fallback`, and `audit_flag` pass only on rows that appear after the step starts; `mission_for` takes `house` and an optional `status`; `status` passes when the headline is at most the step's `status` value (default 0).
- A `cmd` or `else` that fails prints the error and the timeline continues, so a missing glasses service (`walk`) never stops the run.
  The unit tests check that every `cmd` and `else` in `timelines/` is a known command.
- The first three steps start the loops the timeline needs (sim rescuers, the hidden survivors, `sim-dog`); they change nothing when the console already runs them, except that `hidden` re-arms the hidden survivors.
- `say` prints a large cue line in the console for the presenter.
- With the same seed and timeline, the simulated parts happen the same way every time, which the video needs.
- `--dry` prints the steps with computed times without connecting.

### Reset (`npm run reset`)

1. `spacetime publish $STDB_DATABASE -p $MODULE_PATH --server $STDB_URI --delete-data=always --yes` (flags as tested in `docs/specs/spacetimedb.md` section 1.5; check `spacetime publish --help` on the installed CLI).
2. Run `setup` again.
3. Print "Reset done, `<n>` cells, `<k>` rescuers".

Identity tokens stay valid across a reset (they are not data in the module), but participants must register again, which `setup` does for sim identities; the real components (bridge, agents, perception, glasses service, dashboard) re-register on reconnect, which each spec owns.
Reset deletes every recorded run, so screen-record the replay of any run worth keeping first (there is no dataset export).
Never reset Maincloud during judging; between judges, end the run and start a new one.

### Tests

- `geo.test.ts`: offsets to lat/lon round-trip within 0.1 m; distance and bearing match `docs/research/platform.md`.
- `scale.test.ts`: seed 7 gives the same 300 points and levels every time; at least 12 m between survivors; scale scores below 90; about 15 immediate.
- `timeline.test.ts`: the parser accepts the committed timelines (four in the original plan; `demo.json` was added on 2026-11-08); `--dry` prints computed times.
- Integration (local server, module published with data deleted):
  - `setup`, `scale 50`: 50 survivors exist, and every house and lot has a cell.
  - `fail rescuer-drop`: the assignment is `released` within 2 s plus 1 s.
  - `fail rescuer-silent`: `released` within 15 s plus 3 s.
  - `fail robot-offline`: `online = false` within 7 s and its cell reopened.
  - No agents running, `spawn immediate house 8`: a proposal appears within `AGENT_WATCHDOG_S` (15 s in demo mode) plus 3 s, with an `agent_watchdog_fallback` event.
  - `report house 4` after `hidden` and a search of house 4: the house 4 `search_cell` row has `reported_missing = 2`, `found = 1`, and `unaccounted = 1` (the module's summary columns), and is `partially_searched`.
  - `stress` timeline (earlier rehearsal plan; with the minimal crew of 2026-11-08 it would need extra helper rescuers): 900 survivors with 120 sim rescuers for 10 minutes; `status` logs the headline every 5 s, and the test fails if it is ever above 0 for more than one sample.

## Part 3: live demo

### Judged demo (hard-coded, 2026-11-08)

Cayden decided on 2026-11-08 that the judged demo is hard-coded.
This section is the judged run; the sections after it ("Booth setup" to "Risky steps and their fallbacks") are the original live plan, superseded for judging and kept for rehearsal and video material.

What is live and what is scripted:

| Part | In the judged demo |
| --- | --- |
| SpacetimeDB module (Maincloud `assess-0hw81`, dashboard https://spacetimedb.com/assess-0hw81, or the local fallback server) | Live: every rule, timer, and subscription is real |
| Dashboard | Live client: renders from SpacetimeDB subscriptions of the scripted data |
| Glasses view (on the G2 or the fallback page), served by `backend/glasses-service/` | Live client: renders from SpacetimeDB subscriptions of the scripted data |
| Robot (`sim-dog`), the find, the breathing result and critical score, rescuer actions | Scripted by the simulator |
| Nemotron agents, perception service, real robot `dog1`, real G2 hardware input | Not live in the judged demo; built and tested separately |

Whether the glasses view is shown on the real G2 lenses or on the fallback page on the day is not decided.

The parts that are not live are tested separately, and the presenter can say so without claiming they ran in the demo:

- Agents: 109 tests and 8 scenarios, plus the Brev real-model validation in `docs/notes/2026-11-08-brev-validation.md`.
- Perception: 753 tests.
- Robot: the program foundation in `raspberrypi/robot/` and the Pico firmware in `pico/`.

The story is short and ends at the find:

1. The robot dog searches the east side of 2520 Rutford Ave (house 3).
2. It searches inside.
3. It finds the hidden person: IMMEDIATE, breathing 8/min, in the east side of the building under rubble (the house 3 entry in `hidden_survivors` in `demo-site.json`).
4. The dashboard and the glasses view show the find, and the demo ends there.

There is no scale 300 run, no glasses walk, no disconnect beat, and no agent-stop beat in the judged demo.

The timeline `timelines/demo.json`:

1. `run start Demo`.
2. `hidden` (arms the hidden survivors).
3. `robot start` (runs `sim-dog`).
4. Cue: "The robot dog searches the east side of 2520 Rutford Ave (house 3)".
5. After 2 s, `search house 3` (queues a `sim-dog` search mission for house 3).
6. Await `survivor_in` house 3 for up to 120 s; on timeout, run `robot replay house3` as the fallback.
7. Cue: "Found: IMMEDIATE, breathing 8/min, east side, under rubble. The dashboard and glasses show it now."
8. Await Enter, then `run end demo`.

Verified live on a local server on 2026-11-08: the find arrived at 0:14 with no fallback.

Fallback note: `robot replay house3` does not write the scripted house 3 entry.
It reports the detection with the note "8 m in from the front door" and, with no perception service and no `assets/rehearsal/result.json`, writes the sim's default rehearsal result (breathing 14 per minute, score 92).
If the fallback runs, the presenter reads the values on the screen, not the step 7 cue.

How to run it, from `backend/sim/`:

```bash
# Maincloud (or the local fallback: STDB_URI=ws://<laptop-a-ip>:3000)
export STDB_URI=https://maincloud.spacetimedb.com
export STDB_DATABASE=assess-0hw81
npm run sim -- setup
npm run sim -- timeline demo
```

Before judging, republish Maincloud clean, then run setup again (never during judging):

```bash
spacetime publish assess-0hw81 -p backend/spacetimedb --server maincloud --delete-data=always --yes   # from the repo root
cd backend/sim && npm run sim -- setup
```

Booth checklist for the judged demo:

- [ ] Maincloud republished clean with the command above, then `setup`; or the local fallback server running with the module published and `setup` done.
- [ ] Dashboard open and live against the same database (Maincloud or `?db=local`), "DEMO MODE" visible.
- [ ] Glasses view open and live: on the G2, or the fallback page (`docs/specs/glasses.md` section 6), served by `backend/glasses-service/`.
- [ ] Sim `.env` or shell has `STDB_URI` and `STDB_DATABASE` for the same database as both clients.
- [ ] Previous run ended before each judge group.
- [ ] `npm run sim -- timeline demo --dry` prints the steps.
- [ ] Network: the team hotspot or travel router, never the venue Wi-Fi.
- [ ] The presenter's line on what is live: only SpacetimeDB; everything else in the run is scripted by the simulator.

### Booth setup (original plan, superseded for judging on 2026-11-08)

- Laptop A: the local SpacetimeDB fallback server (`spacetime start --listen-addr 0.0.0.0:3000`), the perception service and media server, the agents, the glasses service, the sim console, and Screen A (dashboard on the projector or large monitor).
- Laptop B: Screen B, `http://<laptop A IP>:5180/?screen=B`, facing the judges next to Screen A.
- The mock rubble pile ("house 3"): boxes, foam blocks, and bricks the robot can cross, with a blanket over a frame so it is dim inside, not fully dark; a teammate lies partly covered, chest or back visible (`docs/PROJECT.md`, known risks).
  Thermal works in the dark, but the breathing check uses a regular camera, so it needs some visible light: leave a gap in the blanket or mount a small white light on the robot (TBD hardware).
  Test the breathing check at the booth's real light level during rehearsal.
- The robot `dog1` on its bridge, on the team hotspot.
- Cayden with the G2 glasses and the phone running the Even app (unlocked, app open).
- The fallback glasses page (`docs/specs/glasses.md` section 6) on a small screen angled toward the judges, so they see what the glasses show.
- Network: the team's own hotspot or travel router, never the venue Wi-Fi.
- Both laptops with automatic time sync on (countdowns compare clocks).

### Before each judge group (5 minutes) (original plan, superseded for judging on 2026-11-08)

1. `status` in the sim console: `dog1` online, every agent online, perception online, glasses connected, headline 0.
2. Previous run ended; a new run's cards count "this run", so no reset is needed unless the board is too busy (local server only).
3. Teammate in the pile, booth lights dimmed (white light on, if used), robot at the house 3 southeast door mark.
4. Glasses demo walker reset (`R` on the fallback page), so Cayden starts in the far map view.
5. Both screens live, map fitted; Screen A shows the live board, and the Agents panel full screen is one key (`A`) away.
6. Sim rescuers running (`rc`), `hidden` armed, `sim-dog` running (`rb`).

### Script (about 4 minutes 20 seconds) (original plan, superseded for judging on 2026-11-08)

This script is the original live plan; the judged demo is "Judged demo (hard-coded, 2026-11-08)" above.

| Time | Beat | What happens | Track | Fallback |
| --- | --- | --- | --- | --- |
| 0:00 to 0:20 | Hook | "A tornado hits a town. Thousands need help at once, and the ones who need it most often cannot call. Who do you reach first, and how do you make sure no one is forgotten?" Presenter clicks "Start run" on Screen A; REC shows on both screens. | State Farm | "Start run" fails: `rs` in the console. |
| 0:20 to 0:50 | Scale and second screen in sync | (Earlier rehearsal plan: with the minimal crew of 2026-11-08, R1 only, this beat would need extra helper rescuers.) `scale 300`: survivors stream onto both maps, the ranked list reorders, cells turn searched or partial. The headline stays at "Critical survivors unattended over 60 s: 0". The orchestrator proposes a mission "search house 3 (unsearched)"; the presenter clicks "Approve" on Screen A and points at Screen B, where it flips to `queued` at the same moment. "Two screens, one database, no API server between them." | State Farm, SpacetimeDB | Cloud slow: both screens `?db=local`. No proposal in 15 s: coordinator clicks house 3, "Send robot to search", and says "a human can always act". |
| 0:50 to 1:50 | Robot finds a person in dim light and checks breathing | `dog1` crosses the mock rubble into the dim pile; the terrain marker beside the robot changes to debris; the thermal camera finds the warm shape; it stops and records about 20 s of video. While it records, the presenter points at the partially searched cells ("never called clear") and the house 10 survivor that reads "No signs of life detected, low confidence", kept high on the list. The result arrives: "Breathing seen, 14 per min (confidence 0.7)", visibility, IMMEDIATE, reasons; the person jumps to the top. "A triage aid, not a diagnosis." | State Farm, NVIDIA | Robot stalls: `rr`, and say "this is the clip the robot recorded at rehearsal"; show the rehearsal robot video on a phone. Perception slow: `rr` writes the rehearsal result after 20 s; say so. |
| 1:50 to 2:30 | One agent chain end to end | Press `A` to open the Agents panel full screen, and click the house 3 survivor. Its chain fills in order: detection, score, orchestrator proposal ("Cayden, nearest free, 140 m"), auditor verdict ("AGREE" with its reason), comms briefing to Cayden, while the task board and the action log in the same panel update beside it. The glasses (and fallback page) show "1 critical within 0.3 mi", Cayden taps the ring, and "acknowledged on the glasses" closes the chain. `walk house 3` starts in the background. "Three Nemotron agents, each with one job, talking only through a task board in the database." | NVIDIA, SpacetimeDB | Agents slow: the coordinator proposes Cayden from the survivor detail; the auditor still reviews it. Auditor slow: the chain shows "auditor reviewing", which is honest, because reviews never block. Glasses fail: the fallback page, same view. Ring tap fails: tap on the fallback page. |
| 2:30 to 2:55 | Glasses connection drops | Cayden closes the Even app. Both screens at once: Cayden's avatar leaves, the assignment reads "RELEASED, glasses disconnected", the survivor is "UNASSIGNED, no rescuer" and back on top. "The database noticed the dropped connection itself, in a lifecycle reducer." Cayden reopens the app; the orchestrator re-proposes and he acknowledges again. | SpacetimeDB, State Farm | Release does not show within 3 s: `f4` (`fail rescuer-drop r2`) shows the same rule on a sim rescuer; if only the heartbeat path works, show the 15 s release and say which rule fired. |
| 2:55 to 3:10 | Family report | The coordinator opens Buildings, house 4 ("No reports"), and enters "missing 2, family". The sim fleet found one person there earlier, so house 4 shows "1 UNACCOUNTED" on both screens. "We never say a building is empty." House 4 stays at the front of the search queue while anyone there is unaccounted. | State Farm | Form fails: `rp` (`report house 4`). |
| 3:10 to 3:35 | Stop the agents, the watchdog still assigns | Ctrl-C in the agents' terminal; the Agents panel shows each agent OFFLINE. `spawn immediate house 8`. The Timers panel counts down the watchdog (`AGENT_WATCHDOG_S`, 15 s in demo mode); it fires, the chain in the Agents panel shows "MODULE FALLBACK: nearest free rescuer", a sim rescuer acknowledges, and the headline stays at 0. "The AI improves decisions. The database guarantees nobody is dropped." Restart the agents. | SpacetimeDB, State Farm, NVIDIA | Watchdog does not fire: the 45 s escalation banner appears on both screens, and the presenter says the escalation rule caught it. |
| 3:35 to 3:55 | Auditor flags an imbalance | `ib`: R1 holds three survivors while R2 is idle, and a new survivor appears next to R1. The auditor reviews the orchestrator's proposal for it; if the proposal adds to R1's load, the auditor's `disagree` verdict makes the module file `load_imbalance` with the auditor's reason, shown in the Agents panel, and the orchestrator rebalances (or the coordinator clicks "Mark acted"). | NVIDIA | No flag in 30 s (for example the orchestrator already picked R2): show the auditor's verdict from the house 3 chain again and a flag from the rehearsal run in replay. |
| 3:55 to 4:20 | Replay | Cayden's walk has arrived; the coordinator resolves house 3 as "Rescued". "End run", then the run in the sidebar, replay at 16x: the whole session, including the agent chain, the release, and the robot's state changes, plays back from the event log in the database (no movement trails, because positions are not recorded). Close: "Reducers are the backend, schedule tables run every timer, Nemotron agents propose and verify, and a person resolves every survivor." | SpacetimeDB, NVIDIA, State Farm | Replay errors: open the Events tab for the ended run, which holds the same history, and scroll the agent chain. |

Over time: cut lower-value beats in this order, and say nothing about the cut beats.

1. Auditor imbalance (3:35 to 3:55): the auditor's verdict is already shown in the chain beat.
2. Re-acknowledgement after the glasses drop: keep the release, skip reopening the app.
3. Replay shortened to 10 s.

The beats that are never cut: the robot find and breathing check, the agent chain with the auditor verdict, the glasses drop, the watchdog, and the headline at 0.
Cutting beat 1 brings the script to about 4 minutes.

Network failure at any point: all components point at the local server on Laptop A (`STDB_URI` and `?db=local`), started with `spacetime start` and with the module published.
Switching costs the board's state, so practice it once and do it between judges, not during.
If the whole network is down, play the recorded video.

### Who does what

- Presenter: talks and drives Screen A.
- Sim operator: the sim console on Laptop A (types `rs`, `s`, `sp`, `ib`, `re` and watches the timeline cues), and stops and restarts the agents.
- Robot handler: places and recovers `dog1`, hands off during the search.
- Cayden: glasses, ring tap, closing and reopening the Even app.

The timeline `judge.json` holds the same steps, so one person can run the console alone and the cues appear on screen.
Since 2026-11-08, `judge.json`'s longer story is superseded for the judged demo by `demo.json`; `judge.json`, `e2e.json`, `video.json`, and `stress.json` remain as rehearsal and video material.

### Risky steps and their fallbacks (original plan)

For the judged demo, the risky steps are only the scripted search (fallback: `robot replay house3`), the network (fallback: the local server), and the glasses view on the G2 (fallback: the fallback page).

| Risky step | Check before judging | Fallback |
| --- | --- | --- |
| Robot crosses the rubble | Three clean runs at rehearsal | `rr` and the rehearsal video |
| Breathing in dim light | Clip at the booth light level | Rehearsal result after 20 s, honest low confidence |
| Nemotron tool calls | Smoke test from `agent.md`; budget 20 per minute | Coordinator acts, or the watchdog acts; the dashboard shows "RULES FALLBACK" |
| Auditor verdict in time | Median verdict time at rehearsal under 5 s | "Auditor reviewing" is shown honestly; reviews never block |
| Glasses ring tap | Real G2 over the hotspot | Tap on the fallback page |
| Glasses drop releases in about 2 s | Close the app 3 times at rehearsal and time the release; close the app (a clean close), not airplane mode, because a lost link without a closed socket releases only after the 15 s heartbeat timeout | `f4` on a sim rescuer, or the 15 s heartbeat release |
| Watchdog fires | Integration test above | Escalation banner at 45 s |
| Imbalance flag | `ib` at rehearsal | Rehearsal flag in replay |
| Maincloud | Ping before each group | Local server on Laptop A |
| Map tiles | Load the site area once on the hotspot | "Map tiles offline", markers still draw |

## Part 4: outdoor tests and the recorded video

The venue is indoors, so judging uses fixed coordinates; real GPS and outdoor driving are shown only in the video.

Outdoor tests (before the video):

- Real GPS: run the robot and the glasses with `site.demo_mode` false on an open lot, walk 2 minutes, and confirm real positions reach the dashboard and the glasses arrow points the right way (about 2.5 m GPS accuracy in open sky, `docs/PROJECT.md`).
- Do not show strangers' faces, house numbers, or license plates in the footage.

Check the HackUTD Devpost rules for the video length limit before editing (UNCONFIRMED).
Record with the `video` timeline so every simulated step happens the same way in each take.

Shots:

1. Wide shot of the mock rubble pile with the lights on, the teammate climbing in, then the lights dimming.
2. Low shot following `dog1` across the mock rubble into the dim pile (phone at robot height).
3. Screen A and Screen B side by side at the moment of "Approve" (OBS Studio with two display captures, https://obsproject.com/, or one camera filming both screens).
4. Survivor detail as the thermal and camera images arrive, then the breathing result and score.
5. The survivor's chain in the Agents panel (`?view=agents&survivor=<id>&focus=chain`) filling in step by step, with the auditor verdict.
6. Over-the-shoulder shot of Cayden walking to the pile, for the glasses overlay, and the ring tap.
7. Both screens as the glasses connection drops and the assignment is released.
8. The Buildings panel with "1 UNACCOUNTED".
9. The agents stopped and the watchdog assigning, headline at 0.
10. Replay at 16x: survivors, assignments, agents, and robot state changes (no movement trails).
11. Outdoor: `dog1` and Cayden with a real GPS fix, their live markers moving on the dashboard.

Glasses overlay:

- Screen-record the fallback glasses page in record mode (`docs/specs/glasses.md` section 6) during shot 6, with the same timeline so it matches the walk.
- In the editor, put it on a track above shot 6, scale it to the upper middle, and set the blend mode to Screen (or Add), so black disappears and only the green shows, as in the bluebook demo video (`docs/research/bluebook-reference.md`).
- Add a small caption "glasses view" the first time it appears.
- Keep "DEMO MODE" visible in every indoor dashboard shot, and the map attribution visible, with the full attribution in the credits.

## Build order and estimates

The order follows "Priority by sponsor track" in `docs/MVP.md`.
Steps 2 to 4 put data on the board that exercises the SpacetimeDB guarantees (leases, escalation, the watchdog, releases) and feeds the Agents panel; step 5 stands in for the robot's find and breathing check; the glasses come in through the glasses service's demo walker (`walk`).

| Step | Work | Hours |
| --- | --- | --- |
| 1 | `demo-site.json`, `config.ts`, `geo.ts`, `rng.ts`, `coords` | 0.5 |
| 2 | `pool.ts` (identities and tokens), `guard.ts`, `inject.ts`, `setup.ts`, `run.ts` | 1.0 |
| 3 | `scale.ts` with throttling, survivor matching, partial cells, duplicate pairs | 1.25 |
| 4 | `rescuers.ts` with heartbeats, acknowledgement, reached, resolve | 1.25 |
| 5 | `simrobot.ts` with terrain, missions (search, inspect, return home, hold), hidden survivors, `spawn`, `robot replay house3` | 1.5 |
| 6 | `failures.ts` (including `rescuer-drop`), `imbalance`, `report`, `walk`, console, `status` with the headline | 1.0 |
| 7 | `timeline.ts`, the four timelines, `reset` | 1.0 |
| 8 | Rehearsal: record rehearsal media with the real robot, run `judge.json` end to end three times, time each beat, try every fallback once | 2.0 |
| 9 | Outdoor GPS test | 0.5 |
| 10 | Video shoot (shots 1 to 11) | 1.5 |
| 11 | Video edit with the glasses overlay | 1.5 |
|  | Total | 13.0 |

Steps 1 to 4 come first, because the dashboard and agent owners need data on the board to build against.
Step 8 needs the robot, perception, agents, glasses, and dashboard working; schedule it at least 6 hours before judging.

## Dependencies on other specs

- Module (`spacetimedb.md`): exact arguments for `create_site`, `create_search_cell`, `report_detection`, `report_person`, and `create_mission`; `MERGE_RADIUS_M`, `DUPLICATE_RADIUS_M`, and `AGENT_WATCHDOG_S`; the `search_cell` summary columns; that `sim` may call the non-human reducers in demo mode.
- Robot (`robot.md`): the bridge reads `demo_anchor` in demo mode.
- Glasses (`glasses.md`): the demo walker (`POST /demo/<name>/walk`), the fallback page, and closing the rescuer's SpacetimeDB connection as soon as the plugin socket closes (the glasses-drop beat depends on it).
- Agents (`agent.md`): agent names, Ctrl-C stops every agent cleanly, deterministic path for the scale burst, an orchestrator `inspect` mission for an unaccounted house, `review` tasks completed with a verdict and `flag_kind` (`load_imbalance` when a proposal makes the load uneven).
- Perception (`perception.md`): `/breathing` on the rehearsal clip.
- Dashboard (`dashboard.md`): the headline function, the Agents panel (with the chain per survivor), Buildings, and replay for the closing beat.

## Proposed contract changes

Proposed contract changes: none open (merged into CONTRACTS.md version 8).
