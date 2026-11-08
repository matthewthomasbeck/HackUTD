# Spec: coordinator dashboard (live view, agents, replay)

Status: PROPOSED (2026-11-07), follows `docs/specs/CONTRACTS.md` version 8.1.
Updated 2026-11-08: the UnderDog design is built (approved in review, mockup at `.lavish/ui-revamp.html`), and the dashboard ships as a desktop app (Electron); see "UI direction: UnderDog", "Desktop app", and "Layout".
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

## UI direction: UnderDog

Approved by Cayden on 2026-11-08 after four review rounds (the mockup and its versions are in `.lavish/`).
References, for approach only (no copied code or assets): Standard Response (Cal Hacks 13.0, the map as the whole screen with floating cards), Stochastic (agent tints, hand-off strip, shape plus word for every status), and the HackUTD Zero Day site (colors and the Satoshi font).

- The map is the screen: the buildings around 2520 Rutford Ave on the UT Dallas campus (since 2026-11-08; before that the Worthing St block in Dallas), drawn from OpenStreetMap outlines, with floating cards on top.
- One question first: "Who needs help first", the ranked survivors in the top-left card.
- Two pages only: Dashboard and Agents.
- Night-purple top bar (HackUTD Zero Day colors), light map and cards underneath, so the projector does not wash out the data.
- Every mark has a word: level pills, a map key card, and name tags on every rescuer, robot, and survivor.
- The mascot is a small cartoon tornado, one per agent, each with its agent's tint and one prop; the app logo is the dog with the visor (`public/brand/underdog-logo.png`).
- No simulator wording on screen: rescuers read R1, robots read Dog 1 and Dog 2 (`crewName` and `robotName` in `src/view/derive.ts`).

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
| Desktop app | Electron 44.9.3, packaged with electron-builder 26.18.0 | The dashboard runs as its own app window (Cayden, 2026-11-08); the same Vite build also still runs in a browser. See "Desktop app". |
| Map | Our own SVG map from OpenStreetMap geometry in `public/site/` (no Leaflet, no tiles) | Sharp on a projector, works with no network at the venue, no tile key; drag to pan and scroll to zoom. |
| Fonts | Satoshi (Fontshare, needs network; system font when offline), Chakra Petch Bold Italic and IBM Plex Mono (bundled from `@fontsource`) | HackUTD's body font; Chakra Petch stands in for HackUTD's Elevon, which is a trial license we cannot ship. |
| Tests | Vitest (unit) and Playwright (end to end, two browser contexts) | Fast unit tests for the pure logic, and a real two-screen test. |

Use the React version that the official React quickstart pins (https://spacetimedb.com/docs/quickstarts/react).
Node.js 22 or newer.
Dev server port 5180 (`vite --port 5180 --host`), because the glasses plugin and fallback page use 5173 and 5174 (`docs/specs/glasses.md`).
All runtime packages are `devDependencies`, because Vite bundles them into `dist/`; this keeps them out of the packaged desktop app (its own code is about 1.6 MB).

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

## Desktop app (Electron)

The coordinator dashboard is a desktop app (Cayden, 2026-11-08).
`electron/main.cjs` opens one window that loads the Vite build (`dist/index.html`), passes the run-time settings as URL parameters, and adds a Server menu.
The page itself is unchanged, so the web dashboard (`npm run dev`) and its tests keep working.
On desktop launch, a separate centered, transparent splash window (`electron/splash.html`) plays all 12 frames of the backflip (`electron/assets/backflip.png`, `Loading.gif` with its black background removed, 100 ms per frame), then fades to `Logo.png` placed over the last frame's dog, while the dashboard loads hidden.
The dashboard appears after the GIF and logo hold finish and the map is ready, with a 10 second readiness fallback.
On the local server the app starts the demo services itself (Cayden, 2026-11-08), so opening it from the Dock or Spotlight is enough for Play demo: `electron/services.cjs` runs `scripts/demo.mjs --services` from the repo the app was built from (`electron/repo.json`, written by `scripts/stamp-repo.mjs` when packaging), with the PATH of the user's login shell, because an app opened from the Dock cannot see Homebrew's `node`, `npm`, or `spacetime`.
The splash shows "Starting the demo…" and the board loads only once the services report ready (a few seconds, or about a minute when the module has to compile), because starting them wipes the local database; quitting the app stops them.
Their output goes to `~/Library/Logs/UnderDog/demo-services.log`, and a failure is shown in a dialog while the app still opens.
Only one run of the services is alive at a time (`.demo.pid`), and only one UnderDog: a second launch brings the first window forward.
`npm run demo` passes `--no-services` to the app, since it runs the services itself; on Maincloud the app starts nothing.

### Camera View and Take over (2026-11-08)

Camera View (bottom dock) shows the robot's live camera, model detections, and thermal feeds (from `raspberrypi/preview`, set with `--robot-preview-url` in the app or `?robotPreview=` on the website), the glasses heads-up, and saved findings.
A robot bar on top says what the selected robot is doing (state, mission in words, battery), with a robot picker when there is more than one.

Take over (contract version 8.3, `robot.md` 18.1) lets the person at the dashboard drive the robot:

1. Take over calls `take_over(robot_id, reason)`. The robot's running mission goes back into its queue, the bridge cancels it on the robot, and the robot claims the `teleop` mission (about 1 s with the sim, up to `CLAIM_INTERVAL_MS` plus a heartbeat on the real robot). Until then the pad says it is waiting.
2. The drive layout replaces the four tiles: the robot view (Camera, Model, or Thermal) on the left; the drive pad and a live map centred on the robot on the right. Everything fits the window without scrolling.
3. Hold a pad button or key to drive: W/S or the up and down arrows forward and back, A/D sideways, Q/E or the left and right arrows to turn (the same keys as `robotctl teleop`), Space stops. Each held input sends `teleop_drive` every 100 ms at the limits (0.2 m/s, 45 deg/s), and one zero command goes out on release. Losing window focus lets go of every key. The drive keys never reach the board shortcuts (A does not open Agents).
4. Hand back to autonomy, Esc, or × calls `cancel_mission` on the `teleop` mission; the robot resumes its paused mission. Another screen sees "Remote control by NAME" and can end that control.

The robot stops by itself 300 ms after the last command (closed tab, dropped Wi-Fi), and its safety gate still limits speed and acceleration. In the judged demo the sim dog obeys the same commands and moves on the map (a full stick is 4 m/s on the map so it shows); the real robot and its live feeds are not part of the judged demo.

### Play demo (2026-11-08)

On a demo_mode site, the top bar has a Play demo button next to Record run.
It runs the scripted house 3 rescue through the real path, so the board, the glasses panel, the G2 or Even simulator, and the replay all see the same rows:

1. It opens Cayden's glasses in a small terminal-style window (`GlassesPanel.tsx`): the glasses fallback page with `primary=1`, so it counts as Cayden's glasses and keeps his glasses session and database connection up.
   The window opens above the dock; drag its title bar to move it anywhere below the top bar, and drag its corner to resize it (the display keeps the G2's 2:1 shape).
   Its title bar buttons close it (red), fold it to the title bar (yellow, or double-click the title bar), and put it back in the default place and size (green).
   Its place and size are remembered in this browser (`localStorage`, key `underdog:glasses-window`).
   Folding and closing during a run only hide the display, because unloading it would drop his connection and release his assignment.
2. It resets the glasses service's demo walker (`POST /demo/cayden/reset`), which puts Cayden at the start in the parking lot south of Franklyn Jenifer Dr.
3. If house 3 has no open survivor, it queues a search of house 3 for `sim-dog` (`create_mission`) and waits for the simulator's robot to report the hidden person.
4. It proposes Cayden (`propose_assignment`), then accepts as Cayden through the glasses service (`POST /rescuer/cayden/action`, the same accept a ring tap sends).
5. It starts the walker (`POST /demo/cayden/start`) and waits until Cayden is within 8 m of the survivor.

The button shows the current step, then "Play again", which repeats steps 2 and 5 for an assignment that is still active.
The steps are in `src/view/demo.ts` (unit-tested with a fake board in `tests/unit/demo.test.ts`).
`npm run demo` (`scripts/demo.mjs`) starts everything the button needs on the local server: SpacetimeDB (and publishes the module if the database is missing), a fresh board (`npm run reset` in `backend/sim`, which wipes the local database and runs setup; `--keep` keeps the data instead), a sim console running `hidden` and `scene`, the glasses service, the glasses pages on port 5173, and the packaged UnderDog app, so the Dock shows its name and logo.
The board starts fresh because between runs a sim rescuer may rescue the house 3 person, which would leave Play demo nothing to find.
The app is rebuilt (`npm run app:pack`) first when the dashboard code is newer than the last build; `--dev` opens the hot-reload development app instead, which the Dock names Electron.
It uses the local sim identities in `backend/sim/.tokens/local` (`STDB_TOKEN_DIR`), so Maincloud tokens in `.tokens/` are never sent to the local server.
A port already in use counts as running, except that the glasses mock or a `FAKE_DB=1` service on port 8787 stops the script with a message.

Commands (from `frontend/dashboard/`):

```bash
npm run app                      # desktop app with hot reload (Vite dev server + Electron)
npm run app -- --db=local --local-uri=ws://127.0.0.1:3000
npm run app:start                # build, then open the built app in Electron
npm run app:pack                 # build UnderDog.app in release/mac-arm64/ (unsigned)
npm run app:dmg                  # build a .dmg installer in release/
npm run demo                     # everything Play demo needs, on the local server
```

Run-time settings, in order of precedence:

1. Command-line flags: `--db=cloud|local`, `--local-uri=ws://HOST:3000`, `--glasses-page=URL`, `--glasses-ws=URL`, `--screen=A`.
   For the packaged app: `open -n UnderDog.app --args --db=local --local-uri=ws://127.0.0.1:3000`.
2. The settings file `underdog-settings.json` in the app's user data folder, written by the Server menu ("Open settings file…" shows it).
3. Defaults: the local server `ws://127.0.0.1:3000` with the demo services (since 2026-11-08); Maincloud (`VITE_STDB_URI` and `VITE_STDB_DATABASE`, baked in at build time from `.env`) is in the Server menu.

- Server menu: "Maincloud (judging)" and "Local server (address)" switch the database at run time and reload, so a venue Wi-Fi failure needs no rebuild.
  The dashboard reads the address from `?uri=` (`src/stdb/connection.ts`), which overrides the build-time value.
- Glasses heads-up in Camera View: set `--glasses-page` and `--glasses-ws` (or `VITE_GLASSES_PAGE_URL` and `VITE_GLASSES_WS_URL` at build time).
- Security: `contextIsolation` on, `nodeIntegration` off, `sandbox` on; the page has no Node access, links open in the default browser, and the window never navigates away from the dashboard.
- Build uses `base: './'` in `vite.config.ts`, so assets load from `file://`.
- Packaging: the app is unsigned (no Apple Developer ID); on first open, right-click UnderDog.app and choose Open.
  The bundle is about 310 MB, almost all of it the Electron runtime; `release/` is git-ignored.
- The app icon is `electron/icon.png` (1024 px, the dog logo on the night purple); it is not under `build/` because the repo ignores every `build/` folder.

## Folder layout

```
frontend/dashboard/
  package.json             scripts: dev, build, test, app, app:start, app:pack, app:dmg; electron-builder config
  vite.config.ts           base './', @bindings alias
  index.html
  .env.example             VITE_STDB_URI, VITE_STDB_DATABASE, VITE_STDB_URI_LOCAL, VITE_GLASSES_PAGE_URL, VITE_GLASSES_WS_URL
  electron/
    main.cjs               desktop window, run-time settings, Server menu
    icon.png               app icon
  scripts/
    app-dev.mjs            npm run app: Vite dev server, then Electron
  public/
    site/block.geojson     the 14 tracked buildings within 180 m of 2520 Rutford Ave (OpenStreetMap, ODbL; built by backend/sim/scripts/build-site.mjs)
    site/context.geojson   the neighborhood around it: 522 buildings, roads, parks, water
    brand/underdog-logo.png   the logo
  src/
    main.tsx               URL params, connection, providers, fonts
    App.tsx                the two pages, actions (reducer calls), map controls, Camera View
    stdb/                  connection (with the ?uri= override), enums, time
    data/                  BoardState, LiveSource, ReplaySource
    replay/                history, fold, player
    model/                 headline, ranking, labels, timers, agents, chains, accounting, map actions
    site/
      geometry.ts          load and parse the site files, meters, point in house, block homes
      houses.ts            each house's state from cells and survivors; place names ("2520 Rutford Ave", "Karl Hoblitzelle Hall", "Building near Drive D")
      route.ts             walking routes along the streets (Dijkstra on the OSM road graph)
    view/
      derive.ts            everything the cards show, from BoardState (pure, unit tested)
    components/
      AppBar.tsx           logo, pages, collapsible System chips, Record run
      SiteMap.tsx          the full-screen SVG map: houses, survivors, rescuers with routes, robots, labels; pan and zoom
      HelpCard.tsx         Who needs help first: count, ranked rows, assign and resolve
      SideCards.tsx        headline, rescuers and robot, houses (with mission approvals), map key
      HousePanel.tsx       one house: state, reports, send robot, mark, add a report
      CardHeader.tsx       card header whose count folds the card
      CameraView.tsx       live robot feeds, the glasses heads-up, the robot bar, and Take over
      DrivePad.tsx         remote driving controls (hold to drive)
      AgentsPage.tsx       hand-off chain, agent cards, database fallback, task board
      Mascot.tsx           the tornado mascot
      TransportBar.tsx     replay controls
    styles/
      underdog.css           imports ../../../design-tokens/tokens.css; every color and font is a token
  tests/
    unit/*.test.ts
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
+---------------------------------------------------------------------------------------------+
| BAR: dog logo UnderDog | UT Dallas, 2520 Rutford Ave | Dashboard | Agents |      System (fold) | Record run |
+---------------------------------------------------------------------------------------------+
| +-------------------+                                                  +------------------+ |
| | WHO NEEDS HELP    |                                                  | 0 critical       | |
| | FIRST         (n) |              FULL-SCREEN MAP                     | unattended > 60 s| |
| | 2 critical        |   (real OSM buildings, house states,             +------------------+ |
| | ranked rows:      |    survivors, rescuers + street routes,          | Rescuers + robot | |
| |  level, address,  |    robots, street names)                         +------------------+ |
| |  score, status    |                                                  | Houses in block  | |
| |  (row opens:      |                                                  +------------------+ |
| |  evidence, assign,|                                                  | Map key          | |
| |  resolve)         |                                                  +------------------+ |
| +-------------------+      [ Status | Camera view | - + Recenter | 50 m ]                     |
+---------------------------------------------------------------------------------------------+
```

- Left card 470 px, right column 360 px (400 and 320 under 1500 px); the map frames the block in the space between them.
- Each card's count (or title) folds the card to its header; a folded count shows as a dark pill.
  The app opens with every card folded (Cayden, 2026-11-08), so the map shows first.
- Clicking a house on the map replaces the rescuers card with the house panel (state, reports, Send robot, Mark searched, Mark partial, Add report).
- Bottom dock: Status toggles the house colors; hovering Status shows the Rescuers and Robots layer toggles; Camera view opens the live robot feeds next to the glasses heads-up, and Take over to drive the robot; zoom buttons and Recenter.
- Keyboard: `A` opens the Agents page, `Esc` returns to the board and closes the house panel or Camera View.
- System chips (SpacetimeDB, robots, glasses, agents) fold into one "System all OK" or "System 1 issue" chip.
  For the judged demo (Cayden, 2026-11-08) the robot, glasses, and agents chips always read "Dog 1 online", "1 glasses", and "3 of 3 agents"; only the SpacetimeDB chip is live, and the cards and map still show the live rows.

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
- Fonts: Satoshi for text (system UI font when offline), Chakra Petch Bold Italic for titles and big numbers, IBM Plex Mono for ids, times, and level pills.
- Sizes after the 2026-11-08 review ("make everything a little smaller"): card text 13 to 16 px, row addresses 16 px, big numbers 22 to 52 px.
- Rule: readable from 5 m on a 1080p projector.

## Views and panels

Note (2026-11-08): the panels below were specified for the first layout.
Their data rules (ranking, labels, banned words, timers, accounting) still hold; where they sit on screen follows "Layout" above.

### Map (`SiteMap.tsx`)

- An SVG in local meters around the site center, drawn from `public/site/context.geojson` (neighborhood) and `public/site/block.geojson` (the 72 block buildings); no tiles, so nothing loads from the network.
- Drag to pan, scroll or pinch to zoom around the cursor, zoom buttons and Recenter in the dock; panning stops at the edge of the OSM data.
- House state comes from `src/site/houses.ts`: the worst open survivor inside the house, else its search cell (searched, partly searched, searching, unaccounted), matched by point in polygon.
- House fills: critical survivor inside (orange), open or people unaccounted (amber), searched and clear (green), searching (lavender), not searched (white); the Status button turns the fills off.
- Survivors: level shape (triangle, square, circle, diamond) with a short tag under it (the house number inside the block, else the street); an IMMEDIATE survivor with no rescuer pulses.
- Rescuers: pink dot with the name; an active assignment draws a dashed walking route along the streets (`src/site/route.ts`), with the walking distance in the label and in the rescuers card.
- Robots: dark tile with a name tag ("Dog 1"); drawn under survivors so a robot at a find never hides the survivor.
- The selected survivor gets a callout with its address and level.
- The Map key card lists every color and shape.

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
VITE_GLASSES_PAGE_URL=http://<laptop LAN IP>:5173/fallback.html
VITE_GLASSES_WS_URL=ws://<laptop LAN IP>:8787/view
```

These are read at build time.
The desktop app overrides the database address at run time (Server menu or `--db`/`--local-uri`), and the glasses addresses with `--glasses-page`/`--glasses-ws`.
In a browser, `?db=local&uri=...`, `?glassesPage=...`, and `?glassesWs=...` do the same.
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
- `site.test.ts`: 2520 Rutford Ave is found from its center and from the person inside it; the 14 tracked buildings come north to south; a house takes its worst open survivor, else its cell; place names ("Building near …", "Open ground near …"); walking routes never cross a house; short map tags; crew names without simulator markers.
- `connection.test.ts`: `?uri=` overrides the build-time address (the desktop app's server switch).

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
- `replay.spec.ts`: run the sim timeline `e2e`, end the run, open `view=replay`; at the end, folded survivor states equal the live tables; at 16x the run plays through with no console errors; a `sim fail robot-offline` during the run shows the robot OFFLINE at the right replay time.

### Manual checks before judging

- Both screens on the real network (hotspot), not localhost.
- Screen A on the projector from 5 m in the hall lighting, in light and dark themes; pick the one that reads better there.
- The vision deficiency emulations above.
- The packaged desktop app opens on the judging laptop, and the Server menu switches between Maincloud and the local server.
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
