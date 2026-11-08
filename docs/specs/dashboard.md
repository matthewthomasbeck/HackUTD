# Spec: coordinator dashboard (live view, agents, replay)

Status: PROPOSED (2026-11-07), follows `docs/specs/CONTRACTS.md` version 8.1.
Folder in the team repo: `frontend/dashboard/`.
Read `docs/specs/CONTRACTS.md` first, including "Recording and replay", then `docs/AGENT_WORKFLOW.md` and `docs/PROJECT.md`.
Every table, column, enum value, reducer, and role name in this file comes from the contract.
Where this spec needs something the contract does not have, it is listed under "Proposed contract changes" at the end, with what the dashboard does until the change lands.
`docs/specs/spacetimedb.md` is the source for exact reducer arguments; where it differs from `CONTRACTS.md` version 8.1, the contract wins.

Backend: SpacetimeDB only (TypeScript SDK, `spacetimedb/react` hooks, subscriptions, generated bindings in `backend/spacetimedb-bindings/`).

## Purpose

The dashboard is the coordinators' live board and the main screen the judges watch.
Since 2026-11-08 the judged demo is hard-coded: the dashboard is a live client rendering scripted simulator data from SpacetimeDB, and the run of show is `docs/specs/demo.md`, "Judged demo (hard-coded, 2026-11-08)".
It must show, at a glance from across a room:

- who needs help most (State Farm: urgent needs),
- who is going to whom, and what happens when someone goes silent (State Farm: coordination, no one overlooked),
- what each Nemotron agent is doing, and how the agents hand work to each other (NVIDIA: multi-agent orchestration, not a chatbot),
- that every screen updates from the same database at the same moment, that the database runs every rule and timer, and that it is also the full record of the run (SpacetimeDB: subscriptions, reducers, schedule tables, lifecycle reducers, replay).

The headline, always visible, is: "Critical survivors unattended over 60 s: 0".

The dashboard holds no business rules.
It reads tables through subscriptions and calls reducers.
All rules (survivor states, leases, heartbeats, escalation, the agent watchdog, who can resolve a survivor) live in the SpacetimeDB module.
The dashboard only computes display values (rankings, countdowns, the headline) from the same rows.
It reads the per-cell counts (`found`, `reported_missing`, `reported_safe`, `unaccounted`) from `search_cell`, where the module keeps them.

It has four views that share one set of components:

- Live: the coordinator board from subscriptions.
- Agents: one Agents panel with each agent's status, the live task board, the action log, and the chain per survivor.
- Commander: a simpler board for the incident commander.
- Replay: the state of a chosen run at time T, rebuilt from `event_log`, `agent_action`, and `detection`, played at 1x, 4x, or 16x.
  Replay shows survivors, assignments, agents, and robot state changes, not smooth movement trails, because positions are not recorded (see "Transport bar and replay").

## UI direction: the Pacioli approach

The team's reference is Pacioli, a SpacetimeDB winner at Cal Hacks 13.0 (https://devpost.com/software/pacioli, notes in `docs/notes/2026-11-07-spacetime-winners.md`).
It is a UI reference only.
Pacioli has no license, so do not copy its code, styles, or assets.
Take the approach only, as the team described it in `docs/PROJECT.md`:

- One main canvas where each stage of the pipeline is a card with one big live number, connected by edges.
- A sidebar on the left (theirs holds scenarios, ours holds runs).
- Presence avatars at the top right showing who is connected.
- A transport bar at the bottom (ours: the live and replay timeline).
- Agent decisions shown with a reason for each call, and only unsure items brought to a person (our approvals, audit flags, and possible duplicates).

Pacioli's "Ask" chat button is left out.
This dashboard shows data only.

### Light theme, with a dark option

Default: light theme.
Reason: in a lit hall a projector cannot show black darker than the screen under room light, so a dark page turns gray and loses contrast, while dark text on a light page keeps it.
`?theme=dark` switches to the dark token set (for a dark room, or for video close-ups near the dim rubble pile).
Both themes use the same tokens and must pass the same contrast checks.

## Stack

| Choice | Value | Reason |
| --- | --- | --- |
| Framework | React + Vite + TypeScript | The SpacetimeDB React bindings (`spacetimedb/react`) give a provider and table hooks, so live tables need no glue code. |
| SpacetimeDB client | `spacetimedb` npm package, version 2.14.x (the version `docs/specs/spacetimedb.md` tested), plus the generated bindings in `backend/spacetimedb-bindings/` | Same bindings as the agents, the sim, the glasses service, and the robot bridge. |
| Pipeline canvas | React Flow (`@xyflow/react`) | Cards and edges as custom nodes, with animated edges; https://reactflow.dev/ |
| Map | Leaflet 1.9.4, used directly (no `react-leaflet`) | Direct control of hundreds of markers and in-place updates; https://leafletjs.com/ |
| Tiles | Esri World Light Gray Base by default, Esri World Dark Gray Base with `?theme=dark`; CARTO only with a key | Keyless; CARTO now watermarks keyless tiles "API KEY REQUIRED" (`docs/specs/glasses.md`); attribution required. |
| Tests | Vitest (unit) and Playwright (end to end, two browser contexts) | Fast unit tests for the pure logic, and a real two-screen test. |

Use the React version that the official React quickstart pins (https://spacetimedb.com/docs/quickstarts/react).
Node.js 22 or newer.
Dev server port 5180 (`vite --port 5180 --host`), because the glasses plugin and fallback page use 5173 and 5174 (`docs/specs/glasses.md`).

### SpacetimeDB client API used

Sources: https://spacetimedb.com/docs/clients/typescript and https://spacetimedb.com/docs/quickstarts/react.
The names below are from the docs; check each against the installed 2.14.x typings before building on it, and fix this list if one differs.

- `DbConnection.builder().withUri(uri).withDatabaseName(name).withToken(token).onConnect((conn, identity, token) => ...).onConnectError(...).onDisconnect(...)`.
- `<SpacetimeDBProvider connectionBuilder={builder}>` takes the builder, not `.build()`.
- `useSpacetimeDB()` gives the connection state, the identity, and the connection.
- `useTable(tables.survivor)` gives the rows and a ready flag.
  UNCONFIRMED: whether `useTable` takes insert and update callbacks in 2.14.x.
  If it does not, `LiveSource` registers `conn.db.<table>.onInsert` and `onUpdate` on the connection for the sync cue.
- `useReducer(reducers.approveMission)` (or `conn.reducers.approveMission({...})`) calls a reducer.
  A failed reducer reports its `SenderError` text; show it, never retry.
- Generated accessors are camelCase (`approve_mission` becomes `approveMission`, `search_cell` becomes `searchCell`).
- `identity.toHexString()` for comparing identities with `participant.identity`, `assignment.rescuer_identity`, and `briefing.audience`.
- The app saves the token to `localStorage` in `onConnect`; persistence is the app's job.
- Timestamps: `Timestamp.microsSinceUnixEpoch` (bigint) is tested in `docs/specs/spacetimedb.md`; convert with `Number(ts.microsSinceUnixEpoch / 1000n)` in one helper, `src/stdb/time.ts`.

### Enum handling

Contract enums are tagged enums in SpacetimeDB, and a generated value is an object with a `tag` field (tested in `docs/specs/spacetimedb.md`).
One adapter file, `src/stdb/enums.ts`, converts generated values to the contract strings (`"immediate"`, `"not_detected"`, `"partially_searched"`, and so on) and back.
No other file reads `.tag` directly.
`event_log.payload_json` is plain JSON with contract strings, so replay code reads it directly.

## Folder layout

```
frontend/dashboard/
  package.json
  vite.config.ts
  index.html
  .env.example             VITE_STDB_URI, VITE_STDB_DATABASE, VITE_STDB_URI_LOCAL, VITE_TILE_SOURCE, VITE_CARTO_KEY, VITE_PERCEPTION_URL
  src/
    main.tsx               URL params, connection, providers
    App.tsx                layout per view
    stdb/
      connection.ts        builder, token storage, register with the right role
      enums.ts             tag <-> contract string
      time.ts              Timestamp -> ms, "12 s ago", countdown text
    data/
      BoardData.ts         the BoardState type every component reads
      LiveSource.tsx       BoardState from subscriptions
      ReplaySource.tsx     BoardState at time T from history (uses replay/)
      useBoard.ts          hook: active BoardState and the clock "now"
      personCheck.ts       person check per detection, fetched from the perception service (not SpacetimeDB)
    replay/
      history.ts           collect and sort one run's history rows
      fold.ts              apply event_log payloads to entity maps
      snapshots.ts         snapshot every 10 s of run time for fast scrubbing
      player.ts            play, pause, speed, seek
    model/
      headline.ts          "Critical survivors unattended over 60 s" (shared with the sim)
      ranking.ts           survivor sort order
      labels.ts            every user-facing string for enums
      geo.ts               cell bounds, point in cell, distance
      timers.ts            every countdown: leases, heartbeats, escalation, watchdog, task leases
      accounting.ts        per-cell display text from the search_cell summary columns
      duplicates.ts        possible duplicate pairs
      agents.ts            agent list, status, current task
      chains.ts            one survivor's chain by chain_id, in order
      runs.ts              group agent actions into bursts
      pipeline.ts          stage card numbers
    components/
      TopBar.tsx           site, DEMO MODE, SCREEN label, headline, presence
      Headline.tsx
      RunsSidebar.tsx
      PipelineCanvas.tsx   React Flow canvas
      StageCard.tsx
      MapView.tsx
      SurvivorList.tsx
      SurvivorDetail.tsx   media, duplicates, resolve
      DuplicatePair.tsx
      ResolveDialog.tsx
      Buildings.tsx        person reports and unaccounted counts
      MissionQueue.tsx
      Assignments.tsx
      Timers.tsx           all countdowns in one list
      AgentsPanel.tsx      one Agents panel: agent status, task board, action log, chain per survivor
      ChainView.tsx        a survivor's whole chain, step by step
      TaskBoard.tsx
      AuditFlags.tsx
      AgentLog.tsx
      EventLog.tsx
      BriefingBanner.tsx
      RobotHealth.tsx
      CommanderView.tsx
      TransportBar.tsx
    styles/
      app.css              imports ../../../design-tokens/tokens.css (light and dark tokens, the one shared file in frontend/design-tokens/)
  tests/
    unit/*.test.ts
    e2e/*.spec.ts
```

### Importing the shared bindings

The bindings live outside the Vite root at `backend/spacetimedb-bindings/`.
In `vite.config.ts`:

- `resolve.alias`: `@bindings` points to `../../backend/spacetimedb-bindings`.
- `resolve.dedupe: ['spacetimedb']`, so the bindings use the dashboard's copy of the `spacetimedb` package.
- `server.fs.allow`: include `../../backend/spacetimedb-bindings`.

Vite options: https://vite.dev/config/shared-options.html and https://vite.dev/config/server-options.html.

## Connection, identity, and role

URL parameters (all optional):

| Param | Default | Meaning |
| --- | --- | --- |
| `screen` | `A` | Label in the top bar ("SCREEN A"), and the suffix of the token key, so two tabs on one laptop get two identities. |
| `db` | `cloud` | `cloud` uses `VITE_STDB_URI`, `local` uses `VITE_STDB_URI_LOCAL` (the laptop fallback server). |
| `role` | `coordinator` | `coordinator` or `commander`; the role this screen registers with. |
| `theme` | `light` | `light` or `dark`. |
| `view` | `live` | `live`, `agents`, `commander`, or `replay`. |
| `run` | none | Run id for `replay`. |
| `t` | `0` | Replay start offset in seconds from the run start. |
| `speed` | `1` | Replay speed: `1`, `4`, or `16`. |
| `survivor` | none | Selected survivor; with `view=agents` it opens that survivor's chain. |
| `focus` | none | `canvas`, `map`, `list`, `agents`, `chain`, `tasks`, `events`, or `buildings` opens that panel full screen (for video close-ups). |

Startup:

1. Read the token from `localStorage` key `stdb_token_<db>_<screen>` inside try/catch (a blocked store means a fresh identity, not an error).
2. Build the connection with `withToken(token)` (undefined on the first run).
3. In `onConnect`, save the new token to the same key.
4. Subscribe once, in `LiveSource`, to every public contract table: `participant`, `site`, `search_cell`, `robot`, `device_status`, `mission`, `detection`, `survivor`, `assignment`, `briefing`, `agent_action`, `event_log`, `run`, `audit_flag`, `person_report`, `agent_task`.
   The robot's latest terrain is on its `robot` row (`terrain_class`, `terrain_confidence`, `terrain_source`, `terrain_action`); there are no track or terrain history tables.
   Also subscribe to the four public schedule tables (`lease_timer`, `heartbeat_timer`, `escalation_timer`, `agent_watchdog`); each row has a `due_at`.
   Live, Agents, Commander, and Replay all read this one client cache.
   At hackathon scale (a few runs, tens of thousands of rows) this is fine.
   If a run exceeds about 50,000 history rows, subscribe to that run's history only with `WHERE run_id = <id>` queries (filtering on `u64` columns is supported; `docs/specs/spacetimedb.md` section 11).
5. When `participant` is ready, if no row has `identity == my identity`, call `register_participant(name, role)` with name `coordinator-<screen>` or `commander-<screen>`.
   The contract allows roles other than `rescuer` only in demo mode or after a `grant_role`.
   If registration fails, show "Not registered: <error message>" in red in the top bar and keep the board read-only.

Site: show the newest `site` row (largest `created_at`) and filter cells and survivors by its `id`.
Show a "DEMO MODE" badge in the top bar when `site.demo_mode` is true.
It stays visible in every recording, because the demo uses simulated data and fixed coordinates.

### One data shape for every view

Every component reads `useBoard()`, never a table hook directly.
`useBoard()` returns `{ mode, now, state }`:

- `mode`: `live` or `replay`.
- `now`: the clock for countdowns and "ago" text (wall clock in live mode, replay time T in replay).
- `state`: a `BoardState` with arrays of contract rows (`survivors`, `detections`, `missions`, `assignments`, `cells`, `robots`, `devices`, `participants`, `briefings`, `agentActions`, `agentTasks`, `auditFlags`, `personReports`, `events`, `timers`), the `site`, and the current `run`.

`LiveSource` fills it from subscriptions.
`ReplaySource` fills it from the replay engine.
This is the only way replay can reuse every panel without forks of each component.

In replay mode, all action buttons are hidden, and a wide yellow strip under the top bar reads "REPLAY of `<run name>`, `<T>` of `<duration>`, nothing here changes the database".

## The headline (`model/headline.ts`, `Headline.tsx`)

Text, exactly: "Critical survivors unattended over 60 s: `<n>`".

Definition (one pure function, also imported by the sim's `status` command so both agree):

- Candidates: survivors of the current site with `critical_level = immediate` and `status = unassigned`.
  A `proposed` assignment does not count as attended, because the contract says an assignment counts only after the rescuer acknowledges it.
- `unattended_since`: the `since` of the survivor's `escalation_timer` row (contract).
  In replay, or if the row is missing, derive it: the newest `event_log` row for that survivor whose `payload_json.after.status` is `unassigned`, or `survivor.created_at` if there is none, or the time its level became `immediate` (a `score_changed` event), whichever is latest.
  Do not use `survivor.updated_at`, because score updates change it.
- `n` = candidates with `now - unattended_since > 60 s`.

Display:

- In the top bar, 32 px bold, always visible in every view, including replay.
- At 0: text color with a check mark icon.
- Above 0: `--crit-immediate` background, white bold text, a warning icon, and the survivor ids as links ("#41, #57").
- Under it, small: "longest wait now `<m:ss>`" for the oldest candidate under 60 s, so judges see the clock that the headline guards.
- The 60 s threshold is a display constant in `headline.ts`, separate from the module's `site.escalate_after_s`; both are shown in the Timers panel so nobody confuses them.

## Reducers the dashboard calls

| Reducer | Where in the UI | Notes |
| --- | --- | --- |
| `register_participant(name, role)` | on startup | role `coordinator` or `commander` |
| `grant_role(identity, role)` | People drawer, "Grant role" | coordinator only; lists participants by name and identity |
| `start_run(site_id, name)` | Transport bar, "Start run" (live, no active run) | default name "Run `HH:MM`", editable |
| `end_run(run_id, notes)` | Transport bar, "End run" | confirm dialog with an optional notes field |
| `approve_mission(mission_id)` | Mission queue, "Approve" on `proposed` rows | |
| `cancel_mission(mission_id)` | Mission queue, "Cancel" on `proposed`, `queued`, `leased`, `active` rows | confirm dialog for `leased` and `active` |
| `create_mission(robot_id, kind, target_cell_ids, target_lat, target_lon, reason, chain_id)` | Map cell popup, "Send robot to search" | `robot_id = ""` (any robot), `kind = search_cells`, `target_cell_ids = [cell.id]`, no target point, reason "coordinator request", `chain_id = 0` |
| `propose_assignment(survivor_id, rescuer_identity, reason)` | Survivor detail, "Assign rescuer" | lists online `rescuer` participants by distance; reason "coordinator assignment"; the rescuer must still acknowledge on the glasses |
| `resolve_survivor(survivor_id, resolution, note)` | Survivor detail, "Resolve"; duplicate pair, "Same person" | `ResolveDialog` (below) |
| `clear_possible_duplicate(survivor_id)` | Duplicate pair, "Different people" | coordinator and commander; called on B (the survivor with `possible_duplicate_of` set); confirm dialog |
| `post_briefing(audience, text, priority, survivor_id, kind)` | Transport bar "Sync test", survivor detail "Send note" | sync test uses audience `coordinators`; `survivor_id` and `kind` optional (none from the dashboard) |
| `mark_cell(cell_id, status, observed_at)` | Map cell popup, "Mark searched" or "Mark partially searched" | for areas a human team checked; `observed_at` none |
| `label_cell(cell_id, label)` | Map cell popup, "Rename" | |
| `report_person(cell_id, kind, count, name_or_unit, note, source)` | Buildings panel and cell popup, "Add person report" | entered by a coordinator; `source` is `family`, `neighbor`, `hotline`, or `coordinator` |
| `set_audit_flag_status(flag_id, status)` | Audit flags, "Dismiss" and "Mark acted" | |
| `log_event(kind, message, payload_json)` | Event log, "Add note" | `kind = note` only; the dashboard never writes `sim_injection` |

Every call shows a toast with the result.
A `SenderError` shows its message in red for 6 seconds.
Never retry a reducer call automatically.
The dashboard never calls robot, agent, auditor, perception, or sim reducers (`post_agent_task`, `claim_agent_task`, `complete_agent_task`, `agent_heartbeat`, `file_audit_flag`, and so on).

### Resolve dialog (`ResolveDialog.tsx`)

- Four large buttons, one per `resolution`: "Rescued", "Handed off", "False alarm", "Duplicate of #`<id>`" (the last only when the survivor has `possible_duplicate_of` set, or is the target of another survivor's `possible_duplicate_of`).
- A note field, required for "False alarm" and "Duplicate".
- Confirm text: "Resolve survivor #`<id>` as `<resolution>`? Only a person can do this, and it removes them from the active board."
- The contract allows "Rescued" and "Handed off" only from `reached`; before that those two buttons read "(after a rescuer reaches this person)" and are disabled.
  A coordinator or commander may resolve as "False alarm" or "Duplicate" from any unresolved status (the module releases any assignment).

## Layout (1920x1080 projector)

```
+-------------------------------------------------------------------------------------------+
| TOP BAR: site | DEMO MODE | SCREEN A | REC run | HEADLINE: Critical ... over 60 s: 0 | avatars |
+-----------+--------------------------------------------------------+----------------------+
| RUNS      | PIPELINE CANVAS (React Flow), 7 stage cards in one row  | RANKED SURVIVORS     |
| sidebar   +-------------------------------+------------------------+  (top 10 visible)   |
| (240 px)  |                               | TABS: Agents | Missions |                      |
| layers    |            MAP                | Assignments | Timers |  +----------------------+
|           |                               | Flags | Buildings |      | SURVIVOR DETAIL      |
|           |                               | Events | Robot          | media, duplicates,   |
|           |                               |                        | resolve              |
+-----------+-------------------------------+------------------------+----------------------+
| TRANSPORT BAR: LIVE or REPLAY | timeline scrubber with event ticks | speed | events | run    |
+-------------------------------------------------------------------------------------------+
```

- Widths at 1920: sidebar 240 px, right column 440 px, center 1240 px.
- Center: canvas band 300 px tall across the full center width; below it the map (60%) and the tabbed panels (40%).
- Transport bar 72 px tall, always visible.
- Below 1400 px width, the sidebar collapses to icons and the right column moves under the center.
- Keyboard: `1` canvas, `2` map, `3` survivors, `4` agents, `5` events, `6` buildings: maximize that panel; `A` opens the Agents panel full screen; `Esc` restores; `Space` play or pause in replay; `[` and `]` step 10 s in replay.
- The Agents tab and `view=agents` (or `A`) show the same Agents panel, in the tab and full screen; full screen is the one to show judges.

### Top bar and presence

- Left: site name, "DEMO MODE" badge, "SCREEN A" (28 px), and a red dot with "REC `<run name>`" while a `run` row has no `ended_at`.
- Center: the headline.
- Right: presence avatars, one per `participant` row with `online = true` (set by the module's `client_connected` and `client_disconnected` lifecycle reducers).
  - 36 px circles with initials from `name`, and a small role icon in the corner (commander: star, coordinator: monitor, rescuer: person, robot: paw, agent: spark, auditor: magnifier, perception: eye, sim: dice).
  - Ring color by role, and the role name in the tooltip, so color is not the only cue.
  - A rescuer whose `last_heartbeat` is older than 10 s gets a faded avatar and "silent `<n>` s" under it.
  - When a participant goes offline, its avatar fades out over 1 s and a small "left" chip stays for 5 s, so a dropped glasses session is visible.
  - More than 8: show 7 and a "+`<n>`" circle with a dropdown.
- A "COMMANDER ONLINE" chip when a `commander` participant is online.

### Runs sidebar (`RunsSidebar.tsx`)

- "Live" at the top, with a red dot when a run is active.
- Then all `run` rows for the current site, newest first: name, start time, duration, survivors found, resolved.
- Click a past run: replay it (`view=replay&run=<id>`).
- Under the runs, map layer toggles: cells, survivors, robot, terrain, rescuers, unaccounted badges.

### Pipeline canvas (`PipelineCanvas.tsx`, `StageCard.tsx`)

React Flow setup:

- `nodeTypes = { stage: StageCard }`, seven nodes at fixed positions in one row, edges between neighbors.
- `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={true}`, `panOnDrag={false}`, `zoomOnScroll={false}`, `zoomOnPinch={false}`, `fitView`.
- Import `@xyflow/react/dist/style.css` once.
- An edge has `animated: true` while items moved across it in the last 5 s, and a label like "+12 last min".
- Click a card: highlight its items on the map and filter the survivor list (click again to clear).

Cards (big number 44 px, label 16 px uppercase, two detail lines 18 px), computed in `model/pipeline.ts`:

| Card | Big number | Detail lines |
| --- | --- | --- |
| Robot search | "`<searched>` / `<total>` cells" | robots online and state; `searching` now; "`<n>` partially searched" |
| Detections | detections this run | thermal and camera counts; robot that found the latest |
| Breathing and score | "`<n>` IMMEDIATE" | `delayed`, `minor`, not scored; "`<n>` no signs of life detected, low confidence" |
| Agents | agent tasks this run | agents online of total; open tasks; "`<n>` missions need approval" |
| Assignments | "`<n>` IMMEDIATE unassigned" | proposed (waiting for acknowledgement), active, released this run |
| Rescuers | rescuers en route | rescuers online; rescuers silent |
| Resolved | resolved this run | by resolution; reached and waiting |

A card whose number signals risk ("IMMEDIATE unassigned" above 0, "missions need approval" above 0, an agent offline, a robot offline) gets a 4 px left border in `--crit-immediate`, a warning icon, and the word "ACTION".
"This run" means rows with the active `run_id`; with no active run, the cards count everything for the site and say "all time".

### Colors, shapes, and fonts (color-blind safe)

Colors come from the Okabe-Ito palette, chosen to stay distinct for common color-vision deficiencies (https://jfly.uni-koeln.de/color/).
Color is never the only signal: every level, state, and layer has a text label and a shape.

| Level | Token | Light fill | Dark fill | Badge text | Map marker | Badge label |
| --- | --- | --- | --- | --- | --- | --- |
| `immediate` | `--crit-immediate` | `#D55E00` | `#E66100` | white, bold, 18.66 px or larger | filled triangle with `!` | `IMMEDIATE` |
| `delayed` | `--crit-delayed` | `#F0E442` with a `#5C5300` outline | `#F0E442` | black | filled square | `DELAYED` |
| `minor` | `--crit-minor` | `#0072B2` | `#56B4E9` | white on light, black on dark | filled circle | `MINOR` |
| `unknown` | `--crit-unknown` | `#6B7280` | `#A7B0BA` | white on light, black on dark | hollow dashed circle with `?` | `NOT SCORED` |

Other tokens (light / dark): background `#F7F8FA` / `#0B0F14`, panel `#FFFFFF` / `#121821`, text `#111827` / `#E8EDF2`, muted text `#4B5563` / `#9AA6B2`, border `#D1D5DB` / `#2A3441`, robot `#111827` / `#FFFFFF`, rescuer `#CC79A7` in both, searched `#009E73`, partial `#E69F00`.

- Check every text and badge pair for at least 4.5:1 contrast, and 3:1 for bold text of 18.66 px or larger (WCAG 2.2, https://www.w3.org/TR/WCAG22/#contrast-minimum).
  White on `#D55E00` is below 4.5:1, so that badge text is always bold 18.66 px or larger.
- The levels follow the START triage words (immediate, delayed, minor), as `docs/PROJECT.md` suggests.
  There is no "expectant" or "deceased" level, and the UI never shows those words, "dead", or "no pulse".
- Font: system UI stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`), `font-variant-numeric: tabular-nums`, monospace for tool names, task kinds, and ids.
  No web font download, so it works on a weak network.
- Minimum text size 18 px, except the map attribution; list rows 22 px; big numbers 44 px.
- Rule: readable from 5 m on a 1080p projector.

## Views and panels

### Map (`MapView.tsx`)

- Leaflet map, fit to the site circle (`center_lat`, `center_lon`, `radius_m`) on first load and on a "Fit site" button.
- Tile source, chosen by `VITE_TILE_SOURCE` (same names as `docs/specs/glasses.md`):

  | Source | URL template | Attribution |
  | --- | --- | --- |
  | `esri-light` (default, light theme) | `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}` (`{y}` before `{x}`, JPEG) | `Esri, HERE, Garmin, &copy; OpenStreetMap contributors` (UNCONFIRMED wording, check Esri's attribution page) |
  | `esri-dark` (default, dark theme) | `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` | same as above |
  | `carto-light`, `carto-dark` (only with a key) | `https://{s}.basemaps.cartocdn.com/<light_all or dark_all>/{z}/{x}/{y}{r}.png?key=<VITE_CARTO_KEY>`, `subdomains: 'abcd'` (template from https://github.com/CartoDB/basemap-styles) | `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>` |
  | `none` | no tiles | none |

  `maxZoom: 19` for Esri sources (`maxNativeZoom` 16 if deeper tiles come back blank; check at the site).
  UNCONFIRMED: Esri's terms for keyless use of these services; Cayden decides, as in `docs/specs/glasses.md`.
  Agents must not sign up for any key.
  With a CARTO key, set `VITE_TILE_SOURCE` and `VITE_CARTO_KEY`; nothing else changes.
- The attribution is always visible in the map corner (Leaflet `attribution` option on the tile layer), and the full text is in the video credits.
- Tiles offline: after more than 5 `tileerror` events, hide the tile layer and show "Map tiles offline" on a plain background.
  The site circle, cells, and markers still draw, because they are our own geometry.
- Site circle: dashed muted outline, no fill, label "0.3 mi search radius" when `radius_m` is 483.
- Cells: `L.rectangle` from the cell center and `size_m`.
  Half side in degrees: `dLat = (size_m / 2) / 111320`, `dLon = (size_m / 2) / (111320 * cos(lat in radians))` (in `geo.ts`, unit tested).

  | `status` | Style | Text |
  | --- | --- | --- |
  | `unsearched` | dashed muted outline, no fill | label at zoom 17 and above |
  | `searching` | solid text-color outline, 15% fill, outline pulses once per second (off under `prefers-reduced-motion`) | label plus "SEARCHING" |
  | `partially_searched` | dashed text-color outline, 25% `#E69F00` fill | label plus "PARTIAL, still in queue" |
  | `searched` | solid border-color outline, 35% `#009E73` fill | label plus a check mark |

  A `partially_searched` cell never shows a check mark and never reads "clear".
  Labels starting with `house` always show as permanent tooltips, so "house 3" is visible on the projector.
- Unaccounted badge (toggle "unaccounted"): a cell with `unaccounted > 0` shows a bold `--crit-immediate` badge "`<n>` UNACCOUNTED" (see Buildings).
- Cell popup (live mode): label, status, `searched_by`, `updated_at`, person report totals (missing, safe) and the unaccounted count, and buttons "Send robot to search", "Mark searched", "Mark partially searched", "Add person report", "Rename".
- Survivors: `L.marker` with an `L.divIcon` holding an inline SVG of the level shape, 28 px (36 px for `immediate`), with the rank number under it for the top 10.
  - Possible duplicate: a dotted line between the two markers and a "?=" badge on both.
  - Resolved survivors are hidden by default (toggle "resolved"), drawn as a small hollow gray circle with a check mark.
  - Click: select in the list and open the detail.
  - Update markers in place (`setLatLng`, `setIcon`) keyed by `id`; never rebuild layers on each change.
    Batch map updates with `requestAnimationFrame`, so a burst of hundreds of inserts from the sim does not freeze the page.
- Robot: one marker per `robot` row with a `lat`; a chevron rotated by `heading_deg`, label "`<name>` `<state>`".
  `online = false`: gray chevron and "`<name>` OFFLINE" with a line through.
  `gps_fix = false`: label adds "no GPS fix, +`<indoor_offset_m>` m indoors".
  A thin dashed line goes from the robot to its current mission target.
- Terrain (the robot's latest terrain fields): one 16 px marker beside each robot chevron, with one letter in a rounded square, so class is not color only.
  There is no terrain history, so the map shows only the class the robot reported last, not a trail of past readings.

  | `terrain_class` | Glyph | Fill |
  | --- | --- | --- |
  | `flat` | hidden by default (toggle "show flat") | none |
  | `debris` | `D` | `#E69F00` |
  | `step` | `S` | `#56B4E9` |
  | `gap` | `G` | `#CC79A7` |
  | `blocked` | `X` | `#D55E00` |
  | `unknown` | `?` | gray |

  Opacity follows `terrain_confidence` (0.4 to 1.0); the popup shows class, confidence, `terrain_source`, and `terrain_action` as a word.
- Rescuers: one diamond per `participant` with role `rescuer` and a position, with the name.
  `last_heartbeat` older than 10 s: 50% opacity and "silent `<n>` s"; `online = false`: hollow diamond and "OFFLINE".
  A solid line from each rescuer to the survivor of their `active` assignment, and a dashed line for a `proposed` one.
- Legend in the bottom left: level shapes, duplicate badge, cell states, unaccounted badges, terrain glyphs, robot, rescuer.

### Ranked survivor list (`SurvivorList.tsx`)

Rows: all survivors of the current site except `resolved`, sorted by `ranking.ts`:

1. `critical_score` descending.
2. Ties: `critical_level` order `immediate`, `unknown`, `delayed`, `minor` (unscored people stay above delayed and minor while they wait for a score).
3. Ties: `created_at` ascending (longest wait first).

The dashboard never computes or changes scores.
The perception service owns the score and keeps `not_detected` people high (contract rule).

Each row (two lines, 22 px):

- Line 1: rank, level badge (shape and text), `critical_score` as an integer, "conf `<score_confidence>`" with two decimals, house label or "no house", status text.
- Line 2: breathing text, first `score_reasons` entry, and "unattended `<m:ss>`" from `headline.ts` while the survivor has no active assignment.
- `breathing = not_detected` also gets a thin left border in `--crit-immediate`.
- "?=" chip for possible duplicates, "ESCALATED" chip when `escalated_at` is set.
- A row changed in the last 2 s flashes its outline for 2 s (the sync cue); rows created in the last 30 s show "NEW".

Breathing text (`labels.ts`, exact strings):

| `breathing` | Text |
| --- | --- |
| `detected` | `Breathing seen, <breathing_rate_bpm> per min (confidence <breathing_confidence>)` |
| `not_detected` | `No signs of life detected, low confidence` |
| `unknown` | `Breathing not checked yet` |

For `not_detected`, the detail adds: "The camera could not see breathing. The chest may be covered, the camera may have moved, or the light may be poor. Treat as urgent."

Status text (`labels.ts`):

| `status` | Text |
| --- | --- |
| `unassigned` with no proposal | `UNASSIGNED, no rescuer` |
| `unassigned` with a `proposed` assignment | `PROPOSED to <name>, waiting for acknowledgement <n> s` |
| `assigned` | `ASSIGNED to <name>, acknowledged` |
| `en_route` | `EN ROUTE, <name>` |
| `reached` | `REACHED by <name>` |
| `resolved` | `RESOLVED: rescued`, `RESOLVED: handed off`, `RESOLVED: false alarm`, `RESOLVED: duplicate of #<id>` |

Show the top 10 rows, then a scrollable list with a footer "`<n>` more".
With more than 200 rows, render only visible rows (windowing by fixed row height).
A collapsed "Resolved (`<n>`)" section sits at the bottom.
Filter chips: All, Immediate, Unattended, Possible duplicates, Not breathing seen.

### Survivor detail (`SurvivorDetail.tsx`)

Opens for the selected survivor.
Default: the top-ranked survivor; when a new `immediate` survivor appears, select it unless the user clicked something in the last 20 s.

- Level badge, score, confidence, status text, house label, `location_note`, coordinates, unattended time, and the escalation state ("escalated to everyone at `<time>`").
- All `score_reasons` as a list.
- Breathing text, rate, confidence, and "`<visibility_pct>`% of body visible".
- Assignment: rescuer name and status (`proposed` with its acknowledgement countdown, or `active` with its lease countdown), or "No rescuer".
- Times: detected, proposed, acknowledged, reached, resolved (from `event_log`).
- Detections: every `detection` row with `survivor_id` = this survivor, newest first, each with its source chip (`THERMAL`, `CAMERA`):
  - `thermal_image_url`: `<img>` with `image-rendering: pixelated`, captioned "max `<max_temp_c>` C, thermal confidence `<thermal_confidence>`".
  - `camera_image_url`: `<img>`, "Camera" (a regular camera that needs some visible light, so a dark frame means poor light, not an empty room).
  - `breathing_clip_url`: `<video controls muted loop playsinline>`, "Breathing clip".
    `survivor.breathing_display_url`, when set, shows next to it as "Magnified breathing clip".
  - Missing media: gray box "No media yet".
  - Person check, per detection: fetched from the perception service with `GET {VITE_PERCEPTION_URL}/breathing/detection/<detection_id>` (CONTRACTS.md version 8.1 "Media server"), never from SpacetimeDB, because these fields are not in the module.
    - `person_image_url`: `<img>` (the camera still with the person box and keypoints drawn), captioned "Person check".
    - `person_confirmed` and `person_conf`: a status chip "PERSON CONFIRMED" with an icon, or "PERSON NOT CONFIRMED", always followed by "confidence `<person_conf>`" (two decimals), so it is never color only.
    - `personCheck.ts` fetches once when the detection appears and again every 10 s while a field is missing (at most 6 tries); in replay it fetches the same way, since the endpoint returns the latest result.
    - A `404`, a network error, or missing fields: gray box "Person check not available yet"; the rest of the detail never waits for it.
    - The image, chip, and caption follow design control (`docs/DESIGN.md`): a frame in the design file first, the existing status chip component and tokens only (no raw colors), and a screenshot check against the frame before merge.
  - Media URLs are plain HTTP from the perception media server, so serve the dashboard over HTTP too; an HTTPS page would block them as mixed content.
    The perception service's `CORS_ORIGINS` must include the dashboard's origin, or the person check fetch fails.
- Possible duplicate: the side-by-side panel below.
- Buttons (live mode only): "Assign rescuer", "Resolve", "Send note".

### Possible duplicates side by side (`DuplicatePair.tsx`, `model/duplicates.ts`)

The module keeps both sightings when it is unsure and sets `possible_duplicate_of`; only a person decides.

- Pairs: every survivor B with `possible_duplicate_of = A` (not 0), where neither is resolved.
- The panel opens in the survivor detail of either one, and as a list in the Survivors filter "Possible duplicates".
- Two equal columns, A on the left and B on the right, with the same rows aligned: level and score, breathing, visibility, detection sources, thermal image, camera image, `location_note`, house, first seen time, assignment.
- Between the columns: distance apart in meters (haversine in `geo.ts`), time apart, and whether they are in the same cell.
- Buttons:
  - "Same person: resolve #B as duplicate of #A": opens `ResolveDialog` on B with `resolution = duplicate`, note prefilled "duplicate of #A".
    Enabled while B is unresolved (a coordinator or commander may resolve as `duplicate` from any unresolved status).
  - "Different people: keep both", beside "Same person": calls `clear_possible_duplicate(B)` after the confirm "Keep #A and #B as two different people?"; the module sets B's `possible_duplicate_of` to 0 and logs `possible_duplicate_cleared`, so the pair leaves every screen at once.
    Enabled while B is unresolved, in live mode, for coordinators and commanders; a `SenderError` shows as usual.
- Both survivors stay on the board and in the ranking until a person resolves one.

### Buildings: person reports (`Buildings.tsx`, `model/accounting.ts`)

Pitch line from `docs/PROJECT.md`: "We never say a building is empty. We show what we know and where it came from."
What the board knows about people not yet found comes only from person reports.

Per cell, `accounting.ts` reads the summary columns the module keeps on `search_cell` and computes nothing itself:

- `found`: survivors with this `cell_id`, excluding those resolved as `false_alarm` or `duplicate`.
- `reported_missing` and `reported_safe`: sums of `person_report.count` by `kind` for the cell.
- `unaccounted`: `max(0, reported_missing - found - reported_safe)`.

Panel (a tab, and `focus=buildings`): one row per cell that has a person report or a survivor, sorted by unaccounted, then label.

- Label, cell status.
- Counts: found, reported missing, reported safe.
- Unaccounted: "`<n>` UNACCOUNTED" as a bold `--crit-immediate` badge with a warning icon.
- Reports list: time, `kind` ("missing" or "safe"), count, `name_or_unit`, `source` as a word, `note`, `reported_by`.
- "Add person report" form: kind (missing or safe), count, name or unit (placeholder "unit 3B"), source (family, neighbor, hotline, coordinator), note.
  It calls `report_person`.
  Help text under the form: "Enter what family, neighbors, or a hotline told you. Use a unit or a first name only."
- A cell never shows "empty", "clear", or "0 people"; with no information it shows "No reports".

### Tabs: missions, assignments, and timers

Mission queue (`MissionQueue.tsx`):

1. `proposed`: yellow left border, "NEEDS APPROVAL", "Approve" and "Cancel" buttons 48 px tall.
2. `queued`, `leased`, `active`: robot, kind, targets (cell labels from `target_cell_ids`, or the target point for `inspect` and `return_home`), and a lease countdown for `leased` and `active`.
3. The last 5 `done`, `failed`, `cancelled`, collapsed.

Each row shows `created_by` and `reason` in full, plus an "AGENT" or "HUMAN" chip (agent if `created_by` names a participant with role `agent` or `auditor`).

Assignments (`Assignments.tsx`): `proposed` and `active` rows, plus `released` and `completed` rows from the last 60 s.

- Survivor (rank, level, house), rescuer name, `created_by` with the AGENT or HUMAN chip.
- `proposed`: "WAITING FOR ACKNOWLEDGEMENT ON THE GLASSES" with a countdown to `lease_expires_at` (the proposal lease, `site.proposal_lease_s`).
- `active`: lease countdown and a bar, renewed by heartbeats, so in normal use it jumps back up every 5 s.
  Under 5 s: "EXPIRING" and a `--crit-immediate` bar.
  At 0 before the row changes: "EXPIRED, waiting for the database".
- `released`: gray, "RELEASED, survivor back on the board", with the cause from `assignment.release_cause`: `declined` "released by rescuer", `expired` "lease expired" (for a proposal, "not acknowledged in time"), `heartbeat` "heartbeat missed", `disconnected` "glasses disconnected", `reassigned` "reassigned by coordinator".
  The glasses-disconnected cause (`disconnected`) is the `client_disconnected` path; it must read differently from a lease expiry so the demo can point at it.

Timers (`Timers.tsx`, `model/timers.ts`): one list of every running timer, soonest first, refreshed every 250 ms.

Each countdown is `due_at - now` from its schedule-table row; the derived source is the fallback when a row is missing (and the only source in replay, since schedule rows are not history).

| Timer | Schedule table (derived fallback) | Text |
| --- | --- | --- |
| Assignment and proposal leases | `lease_timer` (`assignment.lease_expires_at`) | "lease, survivor #41 / Cayden, 18 s" |
| Mission leases | `lease_timer` (`mission.lease_expires_at`) | "mission #7 lease, dog1, 12 s" |
| Rescuer heartbeat | `heartbeat_timer` (`participant.last_heartbeat` + 15 s, for rescuers with an active assignment) | "heartbeat, R2 (sim), 9 s" |
| Robot heartbeat | `heartbeat_timer` (`robot.last_heartbeat` + 5 s) | "heartbeat, dog1, 4 s" |
| Escalation | `escalation_timer` (unattended since + `site.escalate_after_s`, then 2N) | "escalate #41 to everyone, 31 s", then "to commander and everyone" |
| Agent watchdog | `agent_watchdog` (orchestrator `last_heartbeat` + `AGENT_WATCHDOG_S`, 30 s or 15 s in demo mode), shown only while urgent work exists | "watchdog: module assigns in 7 s if the orchestrator stays silent" |
| Agent task leases | `lease_timer` (`agent_task.lease_expires_at` for `claimed` tasks) | "task #12 brief_rescuer, comms_agent, 6 s" |

Each row carries a chip "SCHEDULE TABLE" when it is read from a schedule-table row, or "DERIVED" when computed from the entity, so the team knows which one it is.
Countdowns compare the local clock with server timestamps, so both demo laptops need automatic time sync on.

### Agents panel (`AgentsPanel.tsx`, `TaskBoard.tsx`, `AgentLog.tsx`, `ChainView.tsx`, `model/agents.ts`)

The NVIDIA screen.
One panel holds all agent activity: agent status, the task board, the action log, and the chain per survivor, so there is one place to look.
The agent set is decided (`CONTRACTS.md` version 8, `docs/AGENT_WORKFLOW.md`): the orchestrator (which also plans the search and creates robot missions), the auditor (a verifier that judges every orchestrator proposal), and the comms agent (glasses).
The panel lists whatever agents exist, so it keeps working if an agent is down.

Agent list (`agents.ts`):

- Every `participant` with role `agent` or `auditor`, plus any `agent_task.to_agent`, `agent_task.from_agent`, or `agent_action.agent` value with no participant row (shown as "never connected").
  The name `module` (watchdog actions and module-posted tasks) and rescuer names (`from_agent` of `answer_rescuer` tasks) are not agents; they show as "MODULE" and "HUMAN" chips instead.
- Display name from `participant.name` (`orchestrator`, `comms_agent`, `auditor`), with a fixed friendly label for known names ("Orchestrator", "Comms agent (glasses)", "Auditor (verifier)") and the raw name otherwise.
- Status, in this order:
  - `OFFLINE`: `online = false`.
  - `SILENT`: online, but `last_heartbeat` older than 15 s (UNCONFIRMED threshold; set it to three heartbeat intervals once `agent.md` fixes the interval).
  - `WORKING`: has a `claimed` task addressed to it.
  - `IDLE`: otherwise.
  Each status has a word, an icon, and a color, never color only.

Where it shows: in the live board it is the "Agents" tab; `A` (or `view=agents`) opens the same panel full screen, which is the one to show judges.

Layout full screen (1920x1080):

```
+-------------------------------------------------------------------------------------------+
| TOP BAR (same as live, with the headline)                                                  |
+-------------------------------------------------------------------------------------------+
| AGENT STATUS: one card per agent, side by side                                              |
+------------------------------------------------+------------------------------------------+
| TASK BOARD: open | claimed | done |            | CHAIN PER SURVIVOR: the selected         |
| failed or expired                              | survivor's whole chain; picker on top    |
+------------------------------------------------+------------------------------------------+
| ACTION LOG: newest first, grouped into bursts                                               |
+-------------------------------------------------------------------------------------------+
| TRANSPORT BAR                                                                               |
+-------------------------------------------------------------------------------------------+
```

In the tab (40% of the center), the same four parts stack: agent status as one row of compact cards, then the chain for the selected survivor, then the task board and the action log as two sub-sections.

Agent cards:

- Name, status word and icon, model id from the newest `agent_action.model` where `agent_action.agent` is that agent.
- "heartbeat `<n>` s ago", updating every 250 ms.
- Current task: kind, from, priority, age, and the lease countdown, or "no task".
- Last action: tool chip and `reason` on one line.
- Counts this run: tasks done, failed, expired; for the auditor also reviews "agree" and "disagree".
- `rules` in `agent_action.model` (the deterministic fallback) shows a "RULES FALLBACK" chip, so judges see when the model was not used.

Chain per survivor (`ChainView.tsx`, `model/chains.ts`), inside the Agents panel: a judge clicks a survivor and sees its whole chain in order.

- How to open it: click a survivor anywhere (map marker, ranked list, task card, survivor detail "Show chain" button, or the survivor picker at the top of the chain part, which lists the 10 newest chains by house and level).
  With nothing selected, the chain part follows the newest chain.
  `?view=agents&survivor=<id>` opens it directly, for the video.
- What a chain is: the contract gives `chain_id` (u64, the `event_log` id of the chain's first event; for a survivor, its `survivor_created` event) on `detection`, `mission`, `assignment`, `briefing`, `agent_task`, and `agent_action`.
  `chains.ts` finds a survivor's `chain_id` values from its detections and assignments, then collects:
  - every `detection`, `mission`, `assignment`, `briefing`, `agent_task`, and `agent_action` with that `chain_id`,
  - the `event_log` rows, which have no `chain_id`: the row whose `id` is the `chain_id`, plus rows with `entity = survivor` and this survivor's id, or `entity = assignment` for its assignments,
  - ordered by `(created_at, id)`.
  If a survivor has more than one `chain_id`, each chain is a section with its own header, newest first.
- The steps the demo shows, each as one line with the time from the first step, the actor, and a chip (original live plan; since 2026-11-08 the judged demo is hard-coded with no agents running, so no agent steps appear in its chain):

  | Step | Source row | Example line |
  | --- | --- | --- |
  | Detection | `detection` (source chip) | "0.0 s dog1: warm shape at house 3, thermal 0.82" |
  | Score | `event_log` `score_changed` | "21.6 s perception: IMMEDIATE, score 88, conf 0.70" |
  | Orchestrator proposal | `agent_action` with `tool = propose_assignment`, `agent = orchestrator` | "23.0 s orchestrator: propose Cayden, nearest free rescuer, 140 m" |
  | Auditor verdict | `agent_task` `kind = review`, `to_agent = auditor`, `result_json`, and the `review_verdict` event | "24.9 s auditor: AGREE, nearest free and no other IMMEDIATE waiting" |
  | Comms briefing | `agent_task` `brief_rescuer`, then `briefing` | "25.3 s comms_agent: briefing to Cayden, 'IMMEDIATE house 3 ...'" |
  | Acknowledgement | `event_log` `assignment_accepted` | "31.2 s Cayden: acknowledged on the glasses" |

  Other steps in the same chain show the same way: missions the orchestrator creates, the auditor's `proposal_disagree` and `load_imbalance` flags, lease releases with their cause, escalations, watchdog fallbacks, reached, resolved.
- The auditor verdict line shows the verdict as a word ("AGREE" or "DISAGREE", from `result_json.verdict`), the reason in full, and the model chip.
  A disagreement is drawn in `--crit-immediate` with a warning icon, links to the `proposal_disagree` or `load_imbalance` flag (from `result_json.flag_kind`, default `proposal_disagree`) that the module filed inside `complete_agent_task`, and shows the orchestrator's next action under it.
  A review still open or claimed shows "auditor reviewing, `<n>` s"; reviews never block the assignment, so the acknowledgement may come first, and the view says so ("acknowledged before review finished").
- Chips: "AGENT" with the agent name and model, "RULES FALLBACK" when `model = rules`, "MODULE" for reducer and schedule-table actions (watchdog fallback, release, escalation), "HUMAN" for rescuer and coordinator actions.
- A total line at the bottom of the chain: "detection to acknowledgement `<s>` s, `<k>` agent steps, `<m>` model calls".
- Replay: the chain works at time T and shows only steps at or before T.

Task board (`TaskBoard.tsx`), inside the Agents panel:

- Columns by `status`: `open`, `claimed`, `done`, and `failed` or `expired` (last 20 of each closed column).
- Card: id, `kind` in monospace, "`<from_agent>` to `<to_agent>`", `priority` (`CRITICAL`, `HIGH`, `NORMAL` as words), `reason`, age, lease countdown for `claimed`, and for closed cards a one-line `result_json` summary (red when `failed`).
- Click: expand pretty-printed `payload_json` and `result_json` (try/catch).
- A task that goes back to `open` after its lease expired gets a "RETRY" chip.
- Filter by agent (click an agent card).

Audit flags (`AuditFlags.tsx`), as the "Flags" tab, linked from the chain steps:

- `open` flags first, newest first, then `acted` and `dismissed` from this run, collapsed.
- Row: `kind` as words ("auditor disagrees with proposal" for `proposal_disagree`, "unfair load" for `load_imbalance`), `message`, `suggested_action`, the entity as a link, a "Show chain" link, and age.
- Every flag has `filed_by = auditor`: a `disagree` review's flag is filed by the module inside `complete_agent_task`, and `file_audit_flag` covers problems the auditor finds outside a review; there are no counting flags, because "too long unattended" belongs to the escalation timer and the watchdog, which the Timers panel shows.
- Buttons (live mode): "Dismiss" (`set_audit_flag_status(flag_id, dismissed)`) and "Mark acted" (`acted`).
  When the orchestrator acts on a flag, the row shows who changed it from the `event_log` row.
- An open flag adds a count badge to the Flags tab and the auditor's status card.

Action log (`AgentLog.tsx`), inside the Agents panel:

- `agent_action` rows, newest at the top, auto-scroll unless the user scrolled.
- `runs.ts` groups rows into bursts per `agent`: a new burst starts after a gap of more than 10 s, or when `step` resets to 1.
  Burst header "Plan, `<k>` steps, `<time>`"; each row shows its `step`.
- Row: time, `agent` name, `model` chip, tool in a monospace chip, `reason` as the main text (22 px), `result` on one line (red if it starts with `error`).
  Click to expand pretty-printed `args_json` and the full result, and "Show chain" when `chain_id` is not 0.
- Filter by agent (click an agent card) and by chain.
- If the newest action is under 3 s old, the Agents tab title shows "AGENTS WORKING".

### Tab: events and briefings (`EventLog.tsx`, `BriefingBanner.tsx`)

- `event_log` rows, newest first, with a `kind` chip, the `entity` and `entity_id` as a link, and `message`.
  Kinds with icons: `survivor_created`, `possible_duplicate`, `score_changed`, `assignment_proposed`, `assignment_accepted`, `assignment_released`, `assignment_expired`, `escalation`, `escalation_commander`, `agent_watchdog_fallback`, `review_verdict`, `audit_flag`, `person_report`, `unaccounted`, `cell_reopened`, `mission_requeued`, `robot_offline`, `rescuer_offline`, `sim_injection`, `note`.
  Others show the raw kind.
- `sim_injection` rows always show a "SIMULATED" chip, so the record is honest about what the sim did.
- Filter chips: All, Escalations, Releases, Agents and watchdog, Robot, Simulated.
- Briefings with `audience` `all` or `coordinators` (and `commander` on a commander screen):
  - `critical`: full-width banner under the top bar in `--crit-immediate`, until "Seen" is clicked (kept in memory).
  - `warning` and `info`: rows in this tab with a "BRIEFING" chip.
- Briefings to one rescuer show as "to `<rescuer name>`: `<text>`", so coordinators see what each person's glasses show.

### Tab: robot health (`RobotHealth.tsx`)

One card per `robot` row: name, state (`FAULT` and `SAFE_STOP` in the critical style), ONLINE or OFFLINE, heartbeat age, battery, GPS fix or "indoor offset `<n>` m", current mission, and the latest terrain class and action.
`device_status` rows: device, `OK` / `DEGRADED` / `FAILED` as text with a check, half circle, or cross icon, and `detail`.
Any `FAILED` device or offline robot also turns the Robot search card red with "dog1 OFFLINE" or "dog1 thermal FAILED".

### Commander view (`CommanderView.tsx`, `view=commander`)

For the incident commander, who receives the second-level escalations.
It registers with role `commander` (`role=commander`), which needs demo mode or a `grant_role` from a coordinator.
It is read-mostly and large:

- The headline at 64 px.
- Escalations to the commander: `briefing` rows with `audience = commander`, newest first, each with the survivor's level, house, unattended time, and a "Seen" button (in memory).
  A new one also shows the critical banner and plays no sound (the venue is loud, and sound is not a reliable cue).
- Tiles: survivors by level, by status, resolved by resolution, rescuers online, robots online, agents online of total, open audit flags, cells searched, partially searched, and unsearched.
- Buildings with unaccounted people, sorted by count.
- The top 10 ranked survivors (same list component, compact).
- Buttons: "Resolve" (the commander may resolve) and "Open coordinator view".
  No mission or person report controls, to keep it simple.

## Transport bar and replay

### Live mode

`LIVE` pill, then:

- The active run name and elapsed time, or "No run recording" and a "Start run" button.
- "`<n>` events" (this run's `event_log` count, ticking up).
- The timeline from run start to now, with ticks for events (below); the playhead is pinned to the right.
- "Sync test" button and "Last change `HH:MM:SS.mmm`, `<table>` #`<id>`".
- "End run" button.

### Replay mode

`REPLAY` pill, then: play or pause, "Back to live", speed buttons `1x`, `4x`, `16x`, the time "`<T>` / `<duration>`" (m:ss from run start), and the scrubber.

- Scrubber: full width, drag or click to seek.
  Ticks at each history item time, by kind: detection (triangle), escalation (red bar), assignment released (hollow bar), watchdog fallback (diamond), audit flag (flag), robot offline (cross), resolved (check).
  Hover a tick to see its message; click to seek to 1 s before it.
- Playback: `player.ts` advances T by `elapsed real ms * speed` on each `requestAnimationFrame`; it stops at the run end (or at the newest history row for a run still recording).
- Every view replays: live board, Agents panel (status, task board, action log, and chains at T), Commander view, and the headline at T.
- What replay shows: survivors (found, scored, assigned, released, reached, resolved), assignments, agent tasks and actions, audit flags, briefings, person reports, and robot state changes (online, offline, state, terrain class).
  What it does not show: smooth movement trails.
  Robot and rescuer positions are current state only and are never logged (there are no track tables), so the robot marker stays where the `run_started` snapshot put it, labelled "position not recorded in replay", and rescuer markers are hidden.

### Rebuilding state at time T (`replay/`)

Inputs for run R (all from the client cache, every table filtered by `run_id = R`):

- `event_log`, `agent_action`, `detection`, `briefing`, `person_report`.
- Current-state rows for geometry and labels: the `run` row, the site's `search_cell` rows.
- `agent_task` and `audit_flag` rows with `run_id = R` (current-state tables, see below).

Algorithm:

1. `history.ts` builds one array of items sorted by `(created_at, id)`, each tagged with its source table.
2. `fold.ts` keeps maps of entities keyed by `entity` and `entity_id`: `survivor`, `mission`, `assignment`, `robot`, `search_cell`, `device_status`, `participant`, `agent_task`, `audit_flag`.
   The starting state is the `run_started` snapshot (the module writes one); entities created later come from their `*_created` events.
   For each `event_log` row, parse `payload_json` in try/catch and merge `after` into the entity (create it if missing).
   A row that cannot be parsed is skipped and counted, and the replay strip shows "`<n>` events could not be read".
3. Cell status changes come from `cell_status` and `cell_reopened` events, so area searched over time replays exactly.
4. Robot state at T comes from `robot_online`, `robot_offline`, `robot_state`, `device_status`, and `terrain` events (a `terrain` event is written only when the class changes), folded into the `robot` entity; positions are not rebuilt.
5. Agent actions, detections, briefings, and person reports at T: all rows at or before T.
6. Agent tasks and audit flags at T: `audit_flag` events give exact flag history, and the `agent_task_posted`, `agent_task_claimed`, `agent_task_done` (done or failed), `agent_task_expired`, and `review_verdict` events give exact task history.
7. `snapshots.ts` stores a deep copy of the folded maps every 10 s of run time, computed once when the run loads, so a seek starts from the nearest snapshot and applies at most 10 s of items.
8. `ReplaySource` turns the maps into a `BoardState` and sets `now = T`, so countdowns, "unattended" times, and the headline show what they showed then.

Fidelity check: folding all of a finished run's events must give the same `status`, `resolution`, `critical_level`, `critical_score`, and `breathing` for every survivor as the live tables (an e2e test; a mismatch means a reducer forgot to log a change).

## The "two screens in sync" moment (for SpacetimeDB judges)

1. The top bar shows "SCREEN A" or "SCREEN B" in 28 px, on two laptops facing the judges.
2. Presence avatars show both coordinators, each agent, the perception service, the robot, and each rescuer, so judges see one shared session; when the glasses session drops, its avatar leaves on both screens at once.
3. The transport bar shows "Last change `HH:MM:SS.mmm`, `<table>` #`<id>`" from the insert and update callbacks; both screens show the same row at nearly the same time.
4. Changed rows, cards, and markers flash for 2 s on both screens; canvas edges animate when items flow.
5. "Sync test" calls `post_briefing(audience = coordinators, text = "Sync test from SCREEN A at HH:MM:SS.mmm", priority = info, survivor_id = none, kind = none)`; each screen shows the text and "received about `<n>` ms after it was sent" (meaningful only with synced clocks).
6. Demo move (original live plan, not in the hard-coded judged demo of 2026-11-08): click "Approve" on Screen A while pointing at Screen B, where the mission flips from `proposed` to `queued` and the Robot search edge starts to animate.
7. Say what makes it work: both screens are plain SpacetimeDB subscribers, with no API server or polling between them.

## Accessibility and clarity checklist

- Body background set explicitly in both themes; `color-scheme` set to match.
- Every color-coded item has text and a shape (levels, cells, unaccounted badges, terrain, device health, lease warnings, agent status, presence roles).
- Check with Chrome DevTools "Emulate vision deficiencies" (https://developer.chrome.com/docs/devtools/rendering/emulate-css); in grayscale, levels must still read from shape and text.
- Contrast at least 4.5:1 for text, 3:1 for large bold text and big numbers.
- Buttons at least 44 by 44 px, visible focus outlines, keyboard reachable.
- `prefers-reduced-motion`: no pulses or animated edges; flashes become a static outline for 2 s.
- Confirm dialogs for cancelling an active mission, resolving a survivor, and ending a run.
- The words "dead", "deceased", "expectant", and "no pulse" never appear (tested), and no building ever reads "empty" or "clear".

## Environment

`.env.example`:

```
VITE_STDB_URI=https://maincloud.spacetimedb.com
VITE_STDB_DATABASE=assess-0hw81
VITE_STDB_URI_LOCAL=ws://<laptop A LAN IP>:3000
VITE_TILE_SOURCE=esri-light
VITE_CARTO_KEY=
VITE_PERCEPTION_URL=http://<laptop LAN IP>:8080
```

The Maincloud URI and database name follow `docs/specs/spacetimedb.md` section 1.4 (the name is not confirmed free on Maincloud).
No secrets live in the dashboard.
Run `npm run dev` (Vite on `0.0.0.0:5180`) on Laptop A, so Screen B opens `http://<laptop A IP>:5180/?screen=B`.

## Test plan

### Unit tests (Vitest)

- `headline.test.ts`: a proposed-but-unaccepted assignment still counts as unattended; a release resets the clock; score updates do not; 59 s is not counted and 61 s is.
- `ranking.test.ts`: score order, level tie-break order, waiting-time tie-break, resolved excluded.
- `labels.test.ts`: the three breathing strings exactly; every status and resolution string; no banned word in any label; every enum value has a label.
- `enums.test.ts`: every contract enum value round-trips through the adapter.
- `geo.test.ts`: a 30 m cell at latitude 33 is about 30 m a side (within 0.5 m); point in cell.
- `timers.test.ts`: each derived countdown; "EXPIRING" under 5 s; "EXPIRED" at 0; watchdog shown only while urgent work exists.
- `accounting.test.ts`: a cell row with `unaccounted = 1` shows "1 UNACCOUNTED"; the counts shown are the `search_cell` columns as given, never recomputed; a cell with no reports shows "No reports", never "empty" or "clear".
- `duplicates.test.ts`: pairs from `possible_duplicate_of`, distance apart, resolved pairs dropped; a pair is gone after B's `possible_duplicate_of` becomes 0.
- `personCheck.test.ts`: a fixture response shows the image, "PERSON CONFIRMED", and its confidence; `person_confirmed = false` shows "PERSON NOT CONFIRMED"; a `404` shows "Person check not available yet".
- `agents.test.ts`: agent list from participants, task names, and `agent_action.agent`; status order; an unknown agent name still shows.
- `chains.test.ts`: a fixture chain (detection, score, proposal, review with `{"verdict":"agree"}`, briefing, acknowledgement) comes out in that order; a `disagree` verdict links its `proposal_disagree` flag; a survivor with two `chain_id` values gives two sections; a malformed `result_json` shows "verdict unreadable".
- `runs.test.ts`: grouping by the 10 s gap and by `step` reset.
- `pipeline.test.ts`: card numbers from a fixture `BoardState`.
- `fold.test.ts`: a fixture event list folds to the expected survivor states at three times; a bad `payload_json` is skipped and counted.
- `fold.test.ts` also: two `terrain` events (`debris`, then `flat`) give the robot entity the right class at each time.
- `snapshots.test.ts`: seeking via a snapshot gives the same state as folding from the start.

### End-to-end tests (Playwright)

Setup: a local server (`spacetime start`), the module published with data deleted, then `backend/sim` `setup` and `scale 50` (see `demo.md`).

- `sync.spec.ts`: two contexts, `?screen=A&db=local` and `?screen=B&db=local`; the sim creates a proposed mission; A clicks "Approve"; B shows `queued` within 1 s; both show each other in presence.
- `disconnect.spec.ts`: sim `fail rescuer-drop`; both screens show "RELEASED" with cause "glasses disconnected" within 2 s, the survivor reads "UNASSIGNED, no rescuer", and the avatar leaves.
- `heartbeat.spec.ts`: sim `fail rescuer-silent`; "RELEASED" with cause "heartbeat missed" within 15 s plus 3 s.
- `watchdog.spec.ts`: no agents running; sim `spawn immediate house 8`; a `proposed` assignment with a "MODULE FALLBACK" step appears within the watchdog time plus 3 s.
- `headline.spec.ts`: after `scale 300` with the sim rescuers running, the headline reads 0 for 3 minutes.
- `reports.spec.ts`: the coordinator adds "missing 2, family" to house 4 in the form; house 4 shows "1 UNACCOUNTED" on both screens.
- `duplicates.spec.ts`: sim `dupes 1`; the pair shows side by side, and "Different people" writes a `note` event.
- `agents.spec.ts`: with `DRY_RUN=log` agents or a fixture, the Agents panel lists every agent, and a posted task shows on the task board and in the action log on both screens.
- `chain.spec.ts`: with the agents running against the sim (`spawn immediate house 8`), clicking that survivor shows detection, proposal, auditor verdict, briefing, and acknowledgement in that order within 30 s.
- `banned-words.spec.ts`: after `scale 300`, no banned word in the page text, and every `not_detected` row contains "No signs of life detected, low confidence".
- `offline.spec.ts`: sim `fail robot-offline`; OFFLINE shows within 7 s.
- `tiles-offline.spec.ts`: block `server.arcgisonline.com` with `page.route`; "Map tiles offline" shows and cells still render.
- `replay.spec.ts`: run the sim timeline `e2e`, end the run, open `view=replay`; at the end, folded survivor states equal the live tables; at 16x the run plays through with no console errors; a `sim fail robot-offline` during the run shows the robot OFFLINE at the right replay time.

### Manual checks before judging

- Both screens on the real network (hotspot), not localhost.
- Screen A on the projector from 5 m in the hall lighting, in light and dark themes; pick the one that reads better there.
- The vision deficiency emulations above.
- Attribution visible on the map.
- The Agents panel full screen readable from 5 m with all agents running.

## Build order and estimates

The order follows "Priority by sponsor track" in `docs/MVP.md`: first what shows the SpacetimeDB guarantees (headline, assignments, releases, timers), then the Agents panel, then the robot's find and breathing check (survivor list and detail with media), then the rest.
The glasses (priority 4) have no dashboard step beyond the briefings to each rescuer in the events tab.

| Step | Work | Hours |
| --- | --- | --- |
| 1 | Scaffold, bindings alias, connection, token storage, register, `LiveSource`, `useBoard`, top bar, presence, headline | 1.25 |
| 2 | `enums`, `labels`, `ranking`, `timers`, `geo`, `accounting`, `duplicates`, `agents`, `runs`, `pipeline` with unit tests | 1.5 |
| 3 | Missions, assignments with release causes, timers | 1.0 |
| 4 | Agents panel: agent status, task board, action log, chain per survivor; audit flags tab | 1.75 |
| 5 | Survivor list and detail with media, resolve dialog, duplicate pair | 1.75 |
| 6 | Map: tiles, attribution, offline mode, cells with partial, survivors, robot with its latest terrain, rescuers, legend | 1.75 |
| 7 | Pipeline canvas | 0.75 |
| 8 | Buildings panel and person report form, events, briefing banner, robot health | 1.0 |
| 9 | Transport bar live mode, start and end run, sync cue and sync test | 0.5 |
| 10 | Commander view | 0.5 |
| 11 | Replay engine (fold `event_log`, `agent_action`, `detection`), `ReplaySource`, scrubber with ticks | 1.75 |
| 12 | e2e tests, projector and color-blind pass, focus mode, polish | 1.25 |
|  | Total | 14.75 |

Steps 1 to 9 are the live board and must be done first (about 11.25 hours); steps 1 to 5 matter most for the demo.
Steps 10 and 11 can go to a second person in parallel once `BoardState` and `useBoard` exist, because they only produce or read a `BoardState`.
If time runs short, cut in this order: the commander view (show the coordinator view and say who would see what), the snapshots (fold from the start).
Steps 1 and 2 can start before the module exists by filling `BoardState` from contract-shaped fixtures.

## Dependencies on other specs

- Module (`spacetimedb.md`, being updated to match `CONTRACTS.md` version 8): database name, exact reducer arguments, `event_log` payloads per kind, the schedule-table columns, and whether `register_participant` accepts `coordinator` and `commander` in demo mode.
- Agents (`agent.md`, being updated): agent `participant.name` values, heartbeat interval, `survivor_id` in task payloads, and `DRY_RUN=log` for building the Agents panel.
- Perception (`perception.md`): whether `breathing_clip_url` is raw and `breathing_display_url` magnified.
- Robot (`robot.md`): `report_terrain` rate (the map shows only the latest class).
- Glasses (`glasses.md`): closing the rescuer's SpacetimeDB connection when the glasses session drops (the demo's disconnect beat depends on it).
- Demo (`demo.md`): the sim commands the e2e tests use.

## Proposed contract changes

Proposed contract changes: none open.
`clear_possible_duplicate(survivor_id)` and the person check fields were merged into `CONTRACTS.md` version 8.1.
