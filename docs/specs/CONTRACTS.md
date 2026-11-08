# Shared contracts

Status: FINAL, version 8.2 (2026-11-08). Changes need a team decision.
Version 8.2 adds one item approved by Cayden on 2026-11-08: the unproposed-immediate backstop in the sweep.
Version 8.1 adds four team-approved items: the person-check image, clearing a possible-duplicate flag, the terrain hint to the robot, and (agent-internal) the mock model switch.

Every component spec in `docs/specs/` must use these names, types, and formats.
If a component needs a change, it lists it under "Proposed contract changes" in its own spec, and the team decides before this file changes.
For exact reducer argument lists and checks, `spacetimedb.md` is the source; this file names every reducer with the same arguments.

Read `docs/PROJECT.md` for what the system does, `docs/MVP.md` for the final scope, and `docs/AGENT_WORKFLOW.md` for the agent set.

## Components and where their code lives

The team code repo is https://github.com/matthewthomasbeck/HackUTD.
It already has the folders `raspberrypi/`, `pico/`, `backend/`, `frontend/`, `3d_parts/`, and `images/`.

| Component | Language | Folder in the team repo | Spec |
| --- | --- | --- | --- |
| SpacetimeDB module (tables, reducers, schedule tables, lifecycle reducers, views) | TypeScript | `backend/spacetimedb/` | `spacetimedb.md` |
| Nemotron agents (orchestrator, auditor, comms agent) | TypeScript (Node.js) | `backend/agent/` | `agent.md` |
| Perception service (breathing, critical score, terrain camera model, speech to text) | Python | `backend/perception/` | `perception.md` |
| Media server (images, clips, logs, voice questions) | part of the perception service | `backend/perception/` | `perception.md` |
| Robot main program | C++ | `raspberrypi/robot/` | `robot.md` |
| Robot bridge to SpacetimeDB | TypeScript (Node.js) | `raspberrypi/bridge/` | `robot.md` |
| Pico firmware | C/C++ (Pico C SDK) | `pico/` | `robot.md` (design in `docs/ROBOT.md`) |
| Glasses service | TypeScript (Node.js) | `backend/glasses-service/` | `glasses.md` |
| Glasses plugin (Even Hub) | TypeScript + Vite | `frontend/glasses/` | `glasses.md` |
| Coordinator dashboard (live view and replay) | React + Vite with the SpacetimeDB TypeScript SDK (`spacetimedb/react` hooks) | `frontend/dashboard/` | `dashboard.md` |
| Demo simulator and scripts | TypeScript (Node.js) | `backend/sim/` | `demo.md` |

All TypeScript components share generated SpacetimeDB client bindings (`spacetime generate --lang typescript`), output to `backend/spacetimedb-bindings/` and imported from there.
The module is published to Maincloud, with a local SpacetimeDB server on a laptop as the venue fallback.

## Conventions

- Positions: WGS84 latitude and longitude in degrees, as 64-bit floats, field names `lat` and `lon`.
- Distances in meters, angles in degrees clockwise from true north (0 = N, 90 = E).
- Time: SpacetimeDB `Timestamp` in tables; ISO 8601 UTC strings in JSON messages.
- IDs: `u64` auto-increment primary keys named `id`, except `robot.robot_id` (a short string such as `"dog1"`) and `Identity` values for participants.
- Identities in strings (for example `briefing.audience`) are the 64-character lowercase hex of the `Identity`, without `0x`.
- Names: snake_case for tables, columns, reducers, and JSON fields.
- A robot's `participant.name` must equal its `robot_id`.
- Every enum below is a tagged enum in SpacetimeDB and a string union in TypeScript; spell values exactly as written.
  The module sets `CaseConversionPolicy.None`, because SpacetimeDB's default renames values on the wire (for example `SAFE_STOP` to `safeStop`).
  Generated TypeScript bindings use camelCase field names and PascalCase enum keys; each client maps them to the contract names in one helper.
- SQL cannot filter on enum columns, so clients filter enums in their own code.
- Secrets (NVIDIA key, tokens) live in a git-ignored `.env` per component, with a committed `.env.example`.
- SpacetimeDB environment variables, in every component: `STDB_URI` (server URL, Maincloud or the local server), `STDB_DATABASE` (database name), `STDB_TOKEN` (this client's identity token); browser apps use the Vite-prefixed `VITE_STDB_URI` and `VITE_STDB_DATABASE`.
- Design tokens live in one file, `frontend/design-tokens/tokens.css`, used by the dashboard, the glasses fallback page, and the slides.
- No component may label a person as dead.
  There is no "deceased" or "expectant" value anywhere in these contracts, and the module rejects stored free text (briefings, score reasons, notes, reasons, task payloads and results) that contains death words such as "dead", "deceased", or "expectant".
  A rescuer's question (`rescuer_ask` text) is exempt, because it records what a person said; the answer briefing is not.
- Optional id fields use `0` to mean "none" (ids start at 1).
- Robot reducers take a last argument `observed_at` (optional Timestamp); when present, history rows use it instead of the server time, so spooled messages keep their original times.
  Liveness always uses the server time.
- The C++ code names the terrain action `continue` as `kContinue` (C++ keyword); the wire value stays `continue`.
- Still to confirm by test: the JSON form of a `Timestamp` argument (for `observed_at`), and the enum tag strings a TypeScript client sees on a live row.

## Identities and roles

Each client connects to SpacetimeDB with its own identity (people and each service get their own).
The `participant` table maps an identity to a role, and every reducer checks that role:

| Role | Who | Allowed to |
| --- | --- | --- |
| `commander` | the incident commander, a human at the dashboard | everything a coordinator can do; receives second-level escalations |
| `coordinator` | humans at the dashboard | everything a rescuer can do, plus set up the site, create, approve, and cancel missions, reassign survivors, enter person reports, dismiss audit flags |
| `rescuer` | humans in the field (glasses and phone) | update own position, heartbeat, acknowledge or release an assignment, start en route, mark reached, resolve a survivor, ask a voice question |
| `robot` | the robot bridge | heartbeat, position, device status, detections, cells, mission progress, terrain, for its own `robot_id` only |
| `agent` | the orchestrator and the comms agent; `participant.name` is `orchestrator` or `comms_agent` | the writes listed for that agent below; never resolve a survivor |
| `auditor` | the auditor agent; `participant.name` is `auditor` | read everything; claim and complete its own tasks, file audit flags, heartbeat, log actions; no other writes |
| `perception` | the perception service | write breathing results, critical scores, and camera terrain reports |
| `sim` | the demo simulator | every non-human reducer, but only when the site is in demo mode; it acts as rescuers through one simulated rescuer identity each |

Only a `rescuer` (the assignee), `coordinator`, or `commander` can resolve a survivor.
The human-only reducers (`accept_assignment`, `release_assignment` as the assignee, `start_en_route`, `mark_reached`, `resolve_survivor`, `rescuer_ask`, `approve_mission`, `cancel_mission`) reject `agent`, `auditor`, `robot`, `perception`, and `sim`, even in demo mode.

Per-agent writes, checked by `participant.name`:

| Agent | Role | May call |
| --- | --- | --- |
| `orchestrator` | `agent` | `propose_assignment` (the only agent that may), `create_mission`, `cancel_own_mission`, `post_agent_task`, `set_audit_flag_status`, plus the shared agent calls |
| `comms_agent` | `agent` | `post_briefing`, `post_agent_task`, plus the shared agent calls |
| `auditor` | `auditor` | `file_audit_flag`, `post_agent_task`, plus the shared agent calls |

Shared agent calls: `claim_agent_task` and `complete_agent_task` (only for tasks addressed to the caller), `agent_heartbeat`, `log_agent_action`.
No agent may call `resolve_survivor`, `mark_cell`, `mark_reached`, `accept_assignment`, `approve_mission`, `cancel_mission`, or any robot reducer.
`register_participant` refuses an agent name that another online identity holds.

## Tables

### `participant`
`identity` (Identity, primary key), `name` (string), `role` (`commander` | `coordinator` | `rescuer` | `robot` | `agent` | `auditor` | `perception` | `sim`), `lat` (f64, optional), `lon` (f64, optional), `online` (bool, set by the module's lifecycle reducers), `last_heartbeat` (Timestamp), `last_seen` (Timestamp).
Each rescuer's glasses session holds its own SpacetimeDB connection with that rescuer's identity (the glasses service opens one connection per session), so the module sees a dropped session.

### `site`
`id`, `name`, `center_lat`, `center_lon`, `radius_m` (f64, default 483, about 0.3 mile), `demo_mode` (bool), `require_mission_approval` (bool), `mission_lease_s`, `assignment_lease_s`, `proposal_lease_s`, `escalate_after_s` (u32 timings), `created_at`.
Default timings: mission lease 30 s, assignment lease 120 s, unaccepted proposal 60 s, escalation after 180 s.
Demo-mode defaults: 15 s, 30 s, 30 s, and 45 s, so lease expiry and escalation are visible during a short demo.

### `search_cell`
A square of the search area, usually one mock house.
`id`, `site_id`, `lat`, `lon` (cell center), `size_m` (f64), `label` (string, for example `"house 3"`), `status` (`unsearched` | `searching` | `partially_searched` | `searched`), `searched_by` (string, optional robot_id or participant name), `found`, `reported_missing`, `reported_safe`, `unaccounted` (u32, the per-cell summary), `updated_at`.
The module keeps the summary; no client computes its own:
- `found` = survivors with this `cell_id` that are not resolved as `false_alarm` or `duplicate`.
- `reported_missing` and `reported_safe` = the sums of `count` over this cell's `person_report` rows of kind `missing` and `safe`.
- `unaccounted` = `max(0, reported_missing - found - reported_safe)`.
- The reducers that create survivors, resolve them, or add person reports update it in the same transaction.

Search order: cells with `unaccounted > 0` first, then `unsearched` and `partially_searched` cells.
A cell whose view was blocked or only partly covered becomes `partially_searched`, never `searched`, and stays in the search queue.
A cell is never shown as empty.
If a robot goes offline while searching a cell, that cell goes back to `unsearched`.

### `robot`
`robot_id` (string, primary key; the row is created by the robot's first `robot_heartbeat`), `name`, `lat`, `lon` (optional), `gps_fix` (bool), `indoor_offset_m` (f64, optional, distance traveled since the last outdoor fix), `heading_deg` (optional), `battery_pct` (optional), `state` (`BOOT` | `INIT` | `READY` | `ACTIVE` | `SAFE_STOP` | `FAULT` | `SHUTDOWN`, same as `docs/ROBOT.md`), `online` (bool), `current_mission_id` (u64, optional), `last_heartbeat` (Timestamp), `terrain_class` (`flat` | `debris` | `step` | `gap` | `blocked` | `unknown`, default `unknown`), `terrain_confidence` (f64, 0 to 1), `terrain_source` (string, `"lidar_imu_rules"` from the robot or `"camera_model"` from perception), `terrain_action` (`continue` | `slow` | `steer` | `stop`, default `continue`).
The four terrain fields hold the latest terrain report only; there is no terrain history table.
The robot acts on terrain locally and never waits for the module.

### `device_status`
`id`, `robot_id`, `device` (string, for example `"thermal"`, `"camera"`, `"ld19"`, `"gps"`), `status` (`OK` | `DEGRADED` | `FAILED`), `detail` (string), `updated_at`.
One row per robot and device.

### `mission`
`id`, `chain_id` (u64, 0 for none), `robot_id` (`""` means any robot), `kind` (`search_cells` | `inspect` | `return_home` | `hold`), `target_cell_ids` (list of u64, for `search_cells`), `target_lat`, `target_lon` (optional, for `inspect` and `return_home`), `status` (`proposed` | `queued` | `leased` | `active` | `done` | `failed` | `cancelled`), `lease_expires_at` (Timestamp, optional), `created_by` (string, participant name), `reason` (string, why it was created), `created_at`, `updated_at`.
A mission the orchestrator creates starts as `proposed` if `site.require_mission_approval` is true, otherwise `queued`; coordinator missions start `queued`.
While a mission is `leased` or `active`, each `robot_heartbeat` and `mission_progress` renews its lease.
A mission whose lease expires goes back to `queued`, with `robot_id = ""` if its robot is offline.

### `detection`
Raw finding from the robot.
`id`, `run_id`, `chain_id`, `robot_id`, `mission_id`, `source` (`thermal` | `camera`), `survivor_id` (set by the module when it creates or merges the survivor; 0 for a detection below the confidence floor), `client_ref` (string, a robot-side id so the bridge can find the survivor for `/breathing`), `lat`, `lon`, `gps_fix` (bool), `location_note` (string, for example `"8 m in from the front door"`), `max_temp_c` (f64, optional), `thermal_confidence` (f64, 0 to 1), `thermal_image_url`, `camera_image_url`, `breathing_clip_url` (string, optional), `created_at`.
Append-only.

### `survivor`
One person.
`id`, `site_id`, `cell_id` (u64, 0 for none), `first_detection_id`, `lat`, `lon`, `location_note`, `house_label` (string, optional), `breathing` (`detected` | `not_detected` | `unknown`), `breathing_rate_bpm` (f64, optional), `breathing_confidence` (f64, 0 to 1), `visibility_pct` (f64, optional, 0 to 100, how much of the body is visible, approximate), `critical_level` (`immediate` | `delayed` | `minor` | `unknown`), `critical_score` (f64, 0 to 100, higher is more urgent), `score_confidence` (f64, 0 to 1), `score_reasons` (list of strings), `status` (`unassigned` | `assigned` | `en_route` | `reached` | `resolved`), `resolution` (`rescued` | `handed_off` | `false_alarm` | `duplicate`, set only with `resolved`), `resolved_by` (string, optional), `possible_duplicate_of` (u64, 0 for none), `breathing_display_url` (string, optional, the magnified breathing clip), `escalated_at` (Timestamp, optional), `created_at`, `updated_at`.
Rows are never deleted.
A detection within `MERGE_RADIUS_M` (4 m) of a survivor that is not `resolved` merges into it.
Between 4 m and `DUPLICATE_RADIUS_M` (10 m), the module keeps both and sets `possible_duplicate_of`; only a person can resolve one as `duplicate`, and a coordinator clears the flag with `clear_possible_duplicate` when the two sightings are different people.
A detection below `MIN_THERMAL_CONFIDENCE` (0.30) is stored but creates no survivor.

Status steps; reducers reject any other change:

| From | To | Caused by |
| --- | --- | --- |
| `unassigned` | `assigned` | `accept_assignment` |
| `assigned` | `en_route` | `start_en_route`, or the first step of `mark_reached` |
| `en_route` | `reached` | `mark_reached` |
| `reached` | `resolved` | `resolve_survivor` |
| any unresolved status | `resolved` with `false_alarm` or `duplicate` | `resolve_survivor` by a coordinator or commander |
| `assigned`, `en_route`, `reached` | `unassigned` | the active assignment is released, expires, loses its heartbeat, or its rescuer disconnects |

`resolved` is terminal.
`mark_reached` on an `assigned` survivor writes two logged steps, so no step is skipped in the record.
A survivor is `assigned`, `en_route`, or `reached` if and only if exactly one `active` assignment points at it.
`breathing: not_detected` means the system could not see breathing; it is shown as "no signs of life detected, low confidence" and keeps the person high on the list.
A survivor whose breathing is `not_detected` or `unknown` cannot be scored `minor`.

### `assignment`
`id`, `chain_id`, `survivor_id`, `rescuer_identity`, `status` (`proposed` | `active` | `released` | `completed`), `lease_expires_at`, `accepted_at` (Timestamp, optional), `release_cause` (`declined` | `expired` | `heartbeat` | `disconnected` | `reassigned`, optional, set with `released`), `created_by`, `created_at`, `updated_at`.
`propose_assignment` creates a `proposed` row with a short lease (`site.proposal_lease_s`); the assignment counts only after the rescuer acknowledges it on the glasses (`accept_assignment`), which makes it `active` and moves the survivor to `assigned`.
A survivor has at most one open proposal and at most one `active` assignment; a rescuer has at most one open proposal at a time.
A rescuer may hold several active assignments.
A rescuer with active assignments can still be proposed; the orchestrator prefers rescuers with fewer active assignments, and the auditor flags `load_imbalance` when a proposal makes the load uneven.
A proposal that is not accepted in time becomes `released` (cause `expired`).
An active lease is renewed by the rescuer's glasses heartbeat (`rescuer_heartbeat`) and position updates.
If the heartbeat stops, or the rescuer's connection drops, the assignment becomes `released` and the survivor goes back to `unassigned`; the lease expiry is the backup.

### `briefing`
Short text for a person's glasses or dashboard.
`id`, `run_id`, `chain_id`, `audience` (`all` | `coordinators` | `commander` | a rescuer's identity hex), `text` (string, at most 120 characters), `priority` (`info` | `warning` | `critical`), `kind` (`briefing` | `nav` | `nudge` | `answer` | `escalation`, optional), `survivor_id` (optional), `created_by`, `created_at`.
Append-only.
At most one briefing every 3 s per (`created_by`, `audience`).

### `agent_action`
Transparency log for the NVIDIA demo.
`id`, `run_id`, `chain_id` (u64, 0 for none), `agent` (string, which agent, or `module` for the watchdog), `step` (u32, the step number within one planning cycle), `model` (string, the model id used, or `rules` for any deterministic path), `tool` (string, reducer or tool name), `args_json` (string), `result` (string), `reason` (string, the agent's one-line rationale), `created_at`.
Append-only.

### `event_log`
`id`, `run_id`, `kind`, `entity` (string, for example `survivor`), `entity_id` (u64, 0 for none), `message` (string), `payload_json` (string), `created_at`.
`kind` is one of:

| Entity | Kinds |
| --- | --- |
| `run` | `run_started` (with a snapshot), `run_ended` |
| `survivor` | `survivor_created`, `survivor_merged`, `possible_duplicate`, `possible_duplicate_cleared`, `breathing_reported`, `score_changed`, `en_route`, `survivor_reached`, `survivor_resolved`, `escalation`, `escalation_commander` |
| `assignment` | `assignment_proposed`, `assignment_accepted`, `assignment_released`, `assignment_expired`, `assignment_completed`, `agent_watchdog_fallback` |
| `mission` | `mission_created`, `mission_approved`, `mission_leased`, `mission_requeued`, `mission_done`, `mission_failed`, `mission_cancelled` |
| `robot` | `robot_online`, `robot_offline`, `robot_state`, `device_status`, `terrain` (only when the terrain class changes) |
| `search_cell` | `grid_created`, `cell_status`, `cell_reopened`, `person_report`, `unaccounted` (when a cell's `unaccounted` goes up) |
| `participant` | `rescuer_offline`, `rescuer_question` |
| `agent_task` | `agent_task_posted`, `agent_task_claimed`, `agent_task_done` (done or failed), `agent_task_expired`, `review_verdict` |
| `audit_flag` | `audit_flag` |
| `site` | `timings_changed` |
| any | `sim_injection` (simulator), `note` (coordinator) |

The event log is also the action log: agent and auditor actions are mirrored into it with their reason.
`payload_json` is `{"before":{...},"after":{...}}` with only the changed fields, or `{}` when nothing changed.
Every reducer that changes a survivor, mission, assignment, task, audit flag, cell, or robot state appends one row, so a run can be replayed.
Position-only and battery updates write no event.
Append-only: never updated or deleted.

### `run`
One recorded session (a demo, a drill, or a real deployment).
`id`, `site_id`, `name`, `started_at`, `ended_at` (optional), `notes`.
At most one run is active (no `ended_at`).
Every history row carries the active `run_id` (0 if none).

### `audit_flag`
Problems the auditor finds with orchestrator (and watchdog) proposals.
`id`, `run_id`, `kind` (`proposal_disagree` | `load_imbalance`), `entity`, `entity_id`, `message` (string), `suggested_action` (string, optional), `status` (`open` | `acted` | `dismissed`), `filed_by` (always `auditor`), `created_at`, `updated_at`.
`proposal_disagree` means the wrong rescuer (for example a more urgent survivor is waiting, or a much closer rescuer is free); `load_imbalance` means the proposal makes the load uneven.
The orchestrator treats a new flag as a trigger; the orchestrator or a coordinator marks it `acted` or `dismissed`.

### `person_report`
What people report about who was in a building.
`id`, `run_id`, `cell_id`, `kind` (`missing` | `safe`), `count` (u32), `name_or_unit` (string, optional, for example `"unit 3B"`), `note`, `source` (`family` | `neighbor` | `hotline` | `coordinator`), `reported_by`, `created_at`.
A coordinator enters each report.
Append-only.

### `agent_task`
How agents talk to each other (a shared task board, so every hand-off is logged and replayable).
`id`, `run_id`, `chain_id` (u64, the `event_log` id of the first event of the chain; for a survivor, its `survivor_created` event), `from_agent` (string), `to_agent` (`orchestrator` | `comms_agent` | `auditor`), `kind` (string), `payload_json` (string), `priority` (`critical` | `high` | `normal`), `status` (`open` | `claimed` | `done` | `failed` | `expired`), `claimed_at`, `lease_expires_at` (optional), `result_json` (string, optional), `reason` (string), `created_at`, `updated_at`.
Agents never call each other directly; they post and claim tasks.
A claimed task has a lease (a `lease_timer` row, `AGENT_TASK_LEASE_S`); if the agent does not finish, it goes back to `open`, and after `AGENT_TASK_MAX_ATTEMPTS` expiries it becomes `expired`.
Rows are never deleted; each status change is also an `event_log` row.

Task kinds:

| Kind | Posted by | To | `result_json` |
| --- | --- | --- | --- |
| `brief_rescuer` | orchestrator | `comms_agent` | the briefing id and text |
| `review` | the module, inside `propose_assignment`, for every orchestrator or watchdog proposal (`from_agent` = `orchestrator` or `module`) | `auditor` | `{"verdict":"agree"\|"disagree","reason":"...","flag_kind":"proposal_disagree"\|"load_imbalance"}` (`flag_kind` optional, default `proposal_disagree`) |
| `answer_rescuer` | the module, inside `rescuer_ask` (`from_agent` = the rescuer's name) | `comms_agent` | the briefing id and text |
| `sitrep` (could have) | orchestrator | `comms_agent` | the summary briefing id and text |

Reviews never block an assignment.
When the auditor completes a `review` task with verdict `disagree`, the module itself files the `audit_flag` (kind from `flag_kind`, entity `assignment`, the reason as the message, `filed_by = auditor`) inside `complete_agent_task`, and logs `review_verdict`.
The auditor does not call `file_audit_flag` for reviews; `file_audit_flag` is only for a problem the auditor finds outside a review.

## Recording and replay

- SpacetimeDB is the record of everything that happened: the current-state tables plus the append-only `event_log`, `detection`, `briefing`, `agent_action`, and `person_report` tables, all tagged with `run_id`.
- `agent_task` and `audit_flag` rows are updated in place, and each status change is also an `event_log` row.
- There are no separate track, terrain, or outcome tables; positions are current state only.
- Large files (thermal frames, camera images, breathing clips, voice questions, raw LiDAR scans) stay out of the database.
  They live on the media server, and the database stores their URLs.
- The robot does not host the database.
  It writes through the bridge, and when the network is down the bridge spools messages to a local file on the Pi and sends them in order when it reconnects.
  The robot also keeps raw sensor logs on its SD card for later upload (media kind `log`).
- Replay: the dashboard starts from the `run_started` snapshot, applies `event_log` rows up to time T in order, and plays forward at a chosen speed.
  It shows survivors, assignments, agents, missions, cells, and robot state changes, but no movement trails.

## Reducers (names and callers)

`spacetimedb.md` defines the checks.
Clients call reducers through the generated bindings; tables change only through reducers.
`sim` may call any reducer that lists coordinator, robot (for `robot_id` values starting with `sim`), perception, or agent, only in demo mode.
`commander` passes every check that lists coordinator.

| Reducer | Caller role | Purpose |
| --- | --- | --- |
| `register_participant(name, role)` | any (roles other than `rescuer` need demo mode, a prior `grant_role`, or bootstrap before any site exists) | join with a role |
| `grant_role(identity, role)` | coordinator (anyone at bootstrap) | give an identity a role |
| `participant_update_position(lat, lon)` | rescuer, coordinator | position; renews the caller's assignment leases and heartbeat |
| `rescuer_heartbeat()` | rescuer, coordinator | glasses heartbeat about every 5 s; renews leases |
| `create_site(name, center_lat, center_lon, radius_m, demo_mode, require_mission_approval)` | coordinator, sim (demo sites only) | create the area with default or demo timings |
| `set_site_timings(site_id, mission_lease_s, assignment_lease_s, proposal_lease_s, escalate_after_s)` | coordinator, sim | tune timings (tests, drills); event `timings_changed` |
| `create_search_grid(site_id, size_m)`, `create_search_cell(site_id, lat, lon, size_m, label)`, `label_cell(cell_id, label)` | coordinator, sim | set up the cells |
| `mark_cell(cell_id, status, observed_at)` | robot, coordinator | search progress (`partially_searched` when the view was blocked) |
| `report_person(cell_id, kind, count, name_or_unit, note, source)` | coordinator, sim | a missing or safe report from family, neighbors, a hotline, or a coordinator |
| `robot_heartbeat(robot_id, state, battery_pct, observed_at)` | robot | liveness, about once a second; the first one creates the robot row |
| `robot_report_position(robot_id, lat, lon, gps_fix, indoor_offset_m, heading_deg, observed_at)` | robot | position, about once a second |
| `robot_report_device(robot_id, device, status, detail, observed_at)` | robot | device health |
| `report_detection(robot_id, mission_id, source, client_ref, lat, lon, gps_fix, location_note, max_temp_c, thermal_confidence, thermal_image_url, camera_image_url, breathing_clip_url, observed_at)` | robot | a finding; the module creates or merges a `survivor` and sets `detection.survivor_id` |
| `claim_next_mission(robot_id)` | robot | lease the next queued mission (unaccounted cells first) |
| `mission_progress(mission_id, status, note, observed_at)` | robot | `active`, `done`, `failed` |
| `report_terrain(robot_id, lat, lon, terrain_class, confidence, source, action, image_url, observed_at)` | robot, perception (`source = "camera_model"` only) | latest terrain on the robot row; event `terrain` on a class change; sent on a change or about once a second |
| `create_mission(robot_id, kind, target_cell_ids, target_lat, target_lon, reason, chain_id)` | orchestrator, coordinator | propose or queue a mission |
| `cancel_own_mission(mission_id)` | orchestrator | cancel a mission it created while it is `proposed` or `queued` |
| `approve_mission(mission_id)`, `cancel_mission(mission_id)` | coordinator | human control |
| `report_breathing(survivor_id, breathing, rate_bpm, confidence, visibility_pct, display_url)` | perception | breathing result (`rate_bpm`, `visibility_pct`, `display_url` optional) |
| `set_critical_score(survivor_id, level, score, confidence, reasons)` | perception | score; the perception service owns re-scoring (a 60 s timer that writes only on meaningful change) |
| `propose_assignment(survivor_id, rescuer_identity, reason)` | orchestrator, coordinator | send a rescuer; creates the auditor's `review` task for orchestrator proposals |
| `accept_assignment(assignment_id)`, `release_assignment(assignment_id)` | rescuer (the assignee); a coordinator may also release | take or drop a task |
| `start_en_route(assignment_id)` | rescuer (the assignee) | survivor `assigned` to `en_route`; the glasses service calls it once after acceptance |
| `mark_reached(survivor_id)` | rescuer (the assignee), coordinator | arrived |
| `clear_possible_duplicate(survivor_id)` | coordinator | the two sightings are different people; sets `possible_duplicate_of` to 0 and logs `possible_duplicate_cleared` |
| `resolve_survivor(survivor_id, resolution, note)` | rescuer (the assignee), coordinator | the only way to `resolved` |
| `rescuer_ask(text, audio_url, survivor_id)` | rescuer (through the glasses service) | a voice question; the module logs `rescuer_question` and posts an `answer_rescuer` task to the comms agent |
| `agent_heartbeat()` | agent, auditor | this agent is alive; only the orchestrator's heartbeat resets the watchdog |
| `post_agent_task(to_agent, kind, payload_json, priority, reason, chain_id)` | agent, auditor | hand work to another agent |
| `claim_agent_task(task_id)`, `complete_agent_task(task_id, status, result_json)` | agent, auditor (only the addressed agent) | work a task; completing a `review` with `disagree` files the audit flag |
| `log_agent_action(tool, args_json, result, reason, step, model, chain_id)` | agent, auditor | transparency; `agent` is the caller's name |
| `file_audit_flag(kind, entity, entity_id, message, suggested_action)` | auditor | a problem found outside a review |
| `set_audit_flag_status(flag_id, status)` | orchestrator, coordinator | mark a flag `acted` or `dismissed` |
| `post_briefing(audience, text, priority, survivor_id, kind)` | comms agent, coordinator | glasses and dashboard text (`survivor_id`, `kind` optional) |
| `start_run(site_id, name)`, `end_run(run_id, notes)` | coordinator, sim | begin and end a recorded session |
| `log_event(kind, message, payload_json)` | sim (`kind = sim_injection`), coordinator (`kind = note`) | label simulator injections and manual notes |

The module fills `chain_id` on `detection`, `assignment`, and `briefing` from the survivor's chain, and on `mission` from the `chain_id` argument.

## Timers

Every timer is a row in a public SpacetimeDB schedule table with a `due_at` column, so the dashboard shows each one as a countdown.
Each schedule table runs its scheduled reducer when a row comes due, and the reducer re-checks the state before acting:

| Schedule table | One row per | Fires | Does |
| --- | --- | --- | --- |
| `lease_timer` | proposal, active assignment, leased mission, claimed agent task | at expiry | proposal or assignment `released` (survivor back to `unassigned`); mission back to `queued`; task back to `open` |
| `heartbeat_timer` | rescuer with an active assignment, robot, dropped connection | no heartbeat for 15 s (rescuer) or 5 s (robot); no open connection for 2 s (people) or 5 s (robots) | release the rescuer's assignments, or mark the robot offline and reopen its `searching` cells |
| `escalation_timer` | `immediate` survivor that is `unassigned` | at N s (`site.escalate_after_s`) and again at 2N s | at N: a `critical` briefing to `all`; at 2N: to the `commander` and to `all` |
| `agent_watchdog` | the orchestrator | no orchestrator `agent_heartbeat` for `AGENT_WATCHDOG_S` | deterministic fallback inside the module: for each unassigned `immediate` survivor with no open proposal, propose the nearest rescuer with the fewest active assignments (free rescuers first); logged as `agent_watchdog_fallback` and an `agent_action` with `agent = module`, `model = rules` |

A private sweep every 10 s re-checks all of these from the data and repairs a missing timer row.
The sweep is also a backstop for a live but stuck orchestrator: any unassigned `immediate` survivor with no open proposal for `UNPROPOSED_BACKSTOP_S` gets the same deterministic fallback proposal as the watchdog, even while the orchestrator heartbeats (logged the same way, with `agent_action.reason = "unproposed immediate backstop"`).
The sweep files no audit flags: "too long unattended" belongs to the escalation timer (alerts people), the watchdog (assigns when the orchestrator is silent), and the backstop (assigns when the orchestrator is alive but has not proposed).
Scheduled reducers are private, but the database owner can call them for tests.
The 2 s disconnect grace exists because every HTTP reducer call connects and disconnects; a closed WebSocket meets it almost at once, an HTTP call never does.

Module constants (in `spacetimedb.md`): `AGENT_WATCHDOG_S` 30 s (15 s in demo mode), `UNPROPOSED_BACKSTOP_S` 30 s (15 s in demo mode), `AGENT_TASK_LEASE_S` 30 s, `AGENT_TASK_MAX_ATTEMPTS` 3, rescuer heartbeat 15 s, robot heartbeat 5 s, sweep 10 s, unattended headline 60 s.

The dashboard headline is "Critical survivors unattended over 60 s: 0": the count of `immediate`, `unassigned` survivors whose unattended period (from their `escalation_timer` row) is over 60 s.
A pending proposal does not count as attended.

## Views (per-session visibility)

Each glasses session sees only its own rows through SpacetimeDB views keyed on the caller's identity (row-level security is experimental in TypeScript and is not used):

| View | Returns |
| --- | --- |
| `my_assignment` | the caller's assignments |
| `my_briefing` | briefings for `all` plus the caller's identity hex |
| `my_survivor` | survivors of the caller's `proposed` and `active` assignments |
| `critical_open` | survivors with `critical_level = immediate` that are not resolved (the glasses show the count) |

Base tables stay public for the dashboard and the agents; the views limit what each glasses session receives.
If a view fails, the glasses service subscribes to the base tables with string filters and filters in its own code.

## Robot bridge local protocol (C++ program to Node.js bridge)

- Transport: Unix domain socket at `/run/robot/bridge.sock` (configurable), the bridge listens and the C++ program connects.
- Framing: one JSON object per line (newline-delimited JSON), UTF-8.
- The C++ program never blocks on this socket: non-blocking writes, drop the oldest queued message if the buffer is full, and reconnect with backoff.
  If the bridge is gone, the robot keeps its safety behavior from `docs/ROBOT.md`.
- Robot to bridge: `{"type":"heartbeat",...}`, `{"type":"position",...}`, `{"type":"device",...}`, `{"type":"detection",...}`, `{"type":"cell",...}`, `{"type":"mission_progress",...}`, `{"type":"terrain",...}`.
  Field names match the reducer arguments above.
- Bridge to robot: `{"type":"mission","mission":{...mission row fields...}}`, `{"type":"cancel","mission_id":...}`, `{"type":"site","demo_mode":true|false,...}` (sent on connect and on change), `{"type":"terrain_hint","terrain_class":...,"confidence":...,"observed_at":...}` (the latest camera terrain report from the perception service; advisory only: it may raise or lower the robot's terrain confidence, and it never overrides a safety stop or loosens the robot's own rules).
- Media: the C++ program saves images and clips to local files and includes the file path (`thermal_image_path`, `camera_image_path`, `clip_path`, terrain `image_path`); the bridge uploads them to the media server and passes the returned URL to the reducer.
- Breathing clips are MP4 (H.264).
- Messages may carry `observed_at`; the bridge passes it through, including for spooled messages.
- The robot has no microphone and no speaker.
- Option to test, not rely on: the robot could call reducers directly through SpacetimeDB's HTTP API (`POST /v1/database/:name/call/:reducer`) and skip the Node.js bridge; the bridge stays the plan until that is tested.

## Glasses protocol (glasses service to Even Hub plugin)

- Transport: WebSocket, JSON messages.
- Service to plugin: `{"type":"page","containers":[...]}` (full layout, rebuild; may carry `ack_assignment_id` and an optional `layout` name), `{"type":"text","id":n,"content":"..."}` (in-place text update), `{"type":"image","id":n,"png_b64":"..."}` (image update), `{"type":"exit"}`.
- Plugin to service: `{"type":"hello","serial":"...","rescuer":"<optional name>"}`, `{"type":"input","source":"ring"|"left"|"right"|"unknown","event":"tap"|"double_tap"|"long_press"|"scroll_up"|"scroll_down"}` (scroll events carry no source, so `unknown`), `{"type":"position","lat":..,"lon":..,"accuracy_m":..}` (forwarded to `participant_update_position`), `{"type":"heartbeat"}` about every 5 s (forwarded as `rescuer_heartbeat`), `{"type":"ack","assignment_id":...}` (forwarded as `accept_assignment`).
- The container schema inside `page`, and the microphone messages for voice questions, are defined in `glasses.md`.
  The G2 microphone gives 16 kHz 16-bit mono PCM (permission `g2-microphone`).
- Text container id 8 is reserved in every layout as the status line (for example "link lost").
- A new proposal shows an acknowledge prompt; a ring tap acknowledges it.
- Voice question flow: the service uploads the recording to the media server (`kind = voice`), gets the text from `POST /transcribe`, and calls `rescuer_ask`; the comms agent answers with a briefing of kind `answer`.
- The plugin holds no product logic.
  The service decides the view (map when far, arrow when close, arrived) from SpacetimeDB data and the rescuer's position.

## Media server

- Part of the perception service, HTTP on the laptop.
- `POST /media` (multipart file upload, optional form fields `run_id`, `robot_id`, `detection_id`, `kind`: `thermal`, `camera`, `clip`, `terrain`, `log`, or `voice`) returns `{"url":"http://<host>:<port>/media/<name>"}`.
- The same endpoint takes the robot's SD card logs (`kind = log`), grouped on disk by run and robot.
- `GET /media/<name>` serves the file.
- `POST /breathing` (a clip upload or a `clip_url`, plus `survivor_id` and optional `detection_id`) starts breathing analysis; results go to SpacetimeDB through `report_breathing` and `set_critical_score`.
- `GET /breathing/detection/<detection_id>`: the analysis result for a detection, including `roi_image_url`, and the person check: `person_image_url` (the camera still with the person box and keypoints drawn), `person_confirmed` (bool), and `person_conf` (0 to 1).
  The dashboard shows the image and "person confirmed" with its confidence; these fields live on the perception service, not in SpacetimeDB.
- `POST /terrain` (optional): a camera frame for the advisory terrain model, which may call `report_terrain` with `source = "camera_model"`.
- `POST /transcribe`: a rescuer's recorded voice question in, its text out, for the glasses service.
- Read-only `GET` endpoints for listing media are defined in `perception.md`.

## Demo coordinates

The venue is indoors, so GPS has no fix during judging.
The demo site uses fixed coordinates from a config file in `backend/sim/`, and the simulator places mock houses, survivors, the robot, and rescuers there.
Real GPS is used only when `site.demo_mode` is false.

## Agent-internal switches (not part of the shared contract)

- `LLM_MODE=mock` in `backend/agent/` swaps the Nemotron client for a mock model that replays recorded answers from `test/fixtures/`, for tests and dry runs with no API calls; it is documented in `agent.md` and the agent README.

## History

Versions 1 to 7.5 were merged into this version 8 on 2026-11-07.
- Photon phone calls, text check-ins, and contact data are gone; the backend is SpacetimeDB.
- The robot's microphone and speaker (call-outs, audio detections, robot audio) are removed.
- The drone survey and cell damage levels are removed.
- Beacon missions are removed.
- Occupancy estimates are removed; person reports stay.
- Outcomes, the dataset export, and the separate track and terrain history tables are removed.
- The search agent (`robot_agent`) is cut; the orchestrator plans the search.
- The module's counting flags (unassigned too long, module load imbalance) and the stale-area timer are removed.
