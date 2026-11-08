# Spec: SpacetimeDB module

Status: follows `docs/specs/CONTRACTS.md` version 8 (FINAL, 2026-11-07).
Component: the SpacetimeDB module, TypeScript, in `backend/spacetimedb/` of the team repo (https://github.com/matthewthomasbeck/HackUTD).
Hosting: Maincloud, with a local server on Laptop A as the fallback.
Client bindings: `backend/spacetimedb-bindings/`.

Read `docs/specs/CONTRACTS.md` first.
This spec follows it for table names, column names, enum values, reducer names, and roles.
This spec is the source for exact reducer argument lists and checks; the contract names every reducer with the same arguments.

The module is the whole backend.
There is no other server, database, queue, or timer worker.
Every rule (who may do what, the survivor state machine, leases, heartbeats, escalation, the agent watchdog, merge of detections, no dead label) lives in reducers.
Every timer is a row in a public schedule table, so the dashboard shows it as a countdown.
This is what the SpacetimeDB track asks for: Spacetime must power the primary functionality (`docs/notes/2026-11-07-spacetime-track.md`), and the Cal Hacks winners showed reducers as the whole backend, schedule tables, rules in reducers, subscriptions, and lease-based job queues (`docs/notes/2026-11-07-spacetime-winners.md`).

No Photon, no calls agent, no `checkin` role, and no `contact` table exist in this module.

## 0. Verified facts and sources

The API details below were checked on 2026-11-07 against SpacetimeDB 2.14.1 (CLI `spacetimedb tool version 2.14.1`, npm package `spacetimedb` 2.14.x).
Two throwaway modules were built with `spacetime build`, published to an in-memory local server, and called with `spacetime call`, `spacetime sql`, `spacetime subscribe`, and the HTTP API.
The second one (for this version of the spec) is in the session scratchpad at `/private/tmp/claude-501/-Users-cayden-Documents-GitHub-hackathons-HackUTD/5e25906d-e2eb-4605-9c80-caa040c44fa3/scratchpad/v6test/src/index.ts`.
Items marked "tested" ran on that server.

| Fact | Status | Source |
| --- | --- | --- |
| Server imports `schema, table, t, SenderError, CaseConversionPolicy` from `spacetimedb/server`; `ScheduleAt, Timestamp` from `spacetimedb` | tested | template rules written by `spacetime init --lang typescript`; https://spacetimedb.com/docs/tables/schedule-tables/ |
| `table({ name, public, indexes }, { columns })`, `schema({ ...tables }, settings)`, `export default` the schema | tested | https://spacetimedb.com/docs/tables/ |
| The exported const name is the reducer name | tested | https://spacetimedb.com/docs/functions/reducers |
| Default case policy renames enum variants on the wire: `SAFE_STOP` becomes `safeStop`, `READY` becomes `ready`, `en_route` becomes `enRoute`; inside the module `tag` stays the source name | tested | local test; `ModuleSettings.CASE_CONVERSION_POLICY` in `spacetimedb/dist/server/schema.d.ts` ("Defaults to `SnakeCase`") |
| `schema({...}, { CASE_CONVERSION_POLICY: CaseConversionPolicy.None })` keeps the contract spellings on the wire, in the CLI, in HTTP calls, and in SQL output (`SAFE_STOP`, `en_route`) | tested | local test |
| Generated TypeScript bindings use camelCase field and table accessors (`rescuerIdentity`, `conn.db.myBriefing`) and PascalCase enum keys (`SafeStop`, `EnRoute`) with either policy; the SQL names stay snake_case | read from the generated files, not run in a client | `spacetime generate --lang typescript` output |
| `t.enum('Name', {...})`, `t.option(x)` values `T or undefined`, `t.array(x)` | tested | https://spacetimedb.com/docs/tables/column-types |
| SQL `WHERE` on an enum column fails ("The literal expression ... cannot be parsed"), in `spacetime sql`, HTTP SQL, and subscriptions, with either case policy | tested | local test |
| SQL `WHERE` on `u64`, `string`, and `bool` columns works | tested | local test |
| `ctx.sender`, `ctx.timestamp`, `ctx.connectionId` (`ConnectionId` or null), `ctx.random()` | tested (`connectionId` non-null for HTTP and WebSocket callers, null in `init`) | https://spacetimedb.com/docs/functions/reducers/reducer-context |
| `Identity.toHexString()` gives 64 hex chars without `0x` | tested | SDK typings `lib/identity.d.ts` |
| `new Timestamp(micros)`, `microsSinceUnixEpoch` (bigint) | tested | SDK typings |
| One-shot schedule row: `scheduled_at: ScheduleAt.time(micros)`, reducer `{ onSchedule: table }`, extra columns allowed on the schedule table | tested (fired on time, extra columns readable) | https://spacetimedb.com/docs/tables/schedule-tables/ |
| A one-shot row is still visible inside its reducer and is deleted after the reducer runs | tested (visible: yes; gone afterwards: yes) | schedule-tables page |
| Updating a schedule row's `scheduled_at` by primary key moves the firing time | tested (3 s timer renewed to 8 s fired at 8 s) | local test |
| Deleting a schedule row cancels it | tested | local test (the docs do not document cancel) |
| Interval rows (`ScheduleAt.interval(micros)`) repeat and are never deleted automatically | tested earlier (2 s sweep); docs | schedule-tables page |
| A schedule table can be `public: true`, and clients can read and subscribe to it | tested (SQL and `spacetime subscribe --anonymous`) | local test |
| Scheduled reducers run with `ctx.sender` equal to the database identity | tested | https://spacetimedb.com/docs/functions/reducers/lifecycle |
| Scheduled reducers are private: a client gets 404 "No such procedure"; the database owner can call them | tested | reducer-context page |
| `export const onConnect = spacetimedb.clientConnected(ctx => ...)` and `export const onDisconnect = spacetimedb.clientDisconnected(ctx => ...)` | tested | https://spacetimedb.com/docs/functions/reducers/lifecycle |
| A WebSocket client runs `clientConnected` on connect and `clientDisconnected` on close, and also when the client process is killed (local, same machine) | tested | local test with `spacetime subscribe` |
| Disconnect timing when the network drops without a TCP close | NOT CONFIRMED; the docs say it runs on "close, timeout, error" | lifecycle page |
| Every HTTP request (reducer call or SQL) runs `clientConnected` and then `clientDisconnected` for that identity | tested | local test |
| A reducer that throws after an insert leaves no row (rollback) | tested (HTTP 530 "boom after insert", table empty) | local test |
| Per-user view: `spacetimedb.view({ name, public: true }, t.array(row), ctx => ...)` keyed on `ctx.sender`; each identity sees only its rows over HTTP SQL and subscriptions | tested (`my_briefing`, `my_assignment`) | https://spacetimedb.com/docs/functions/views |
| Views must use indexed `find`/`filter`, not `iter()` | docs | views page |
| `SELECT * FROM my_view WHERE string_col = '...'` on a view without arguments | tested (works in SQL and subscribe) | local test |
| Row-level security in TypeScript: `spacetimedb.clientVisibilityFilter.sql('SELECT * FROM t WHERE owner = :sender')` | tested (each identity saw only its own rows; the owner saw all) | https://spacetimedb.com/docs/how-to/rls (says "experimental, unstable"; recommends views) |
| HTTP reducer call `POST /v1/database/<db>/call/<reducer>`, JSON array body, `Authorization: Bearer <token>`; 200 ok, 530 with the `SenderError` text, 400 for bad arguments, 404 for unknown or private reducers | tested | https://spacetimedb.com/docs/http/database |
| `POST /v1/identity` returns `{"identity","token"}` | tested | https://spacetimedb.com/docs/http/identity |
| CLI and HTTP argument JSON: enum `{"READY":[]}`, option `{"some":90}` or `{"none":[]}`, identity `"<hex>"` | tested | local test; https://spacetimedb.com/docs/cli-reference |
| JSON form of a `Timestamp` argument (for `observed_at`) | NOT CONFIRMED; test once with `spacetime call` and copy the form the error message asks for | |
| `export *` from reducer files registers them | NOT CONFIRMED; keep every export in `src/index.ts` | |
| A local server identity differs from a Maincloud identity | NOT CONFIRMED, assume yes (tokens are issued per server) | https://spacetimedb.com/docs/core-concepts/authentication |
| Module inbound HTTP routes (`spacetimedb.httpHandler`, `httpRouter`) | in the template rules, not tested; not used | template rules |

## 1. Setup

### 1.1 Install and log in

```bash
curl -sSf https://install.spacetimedb.com | sh
spacetime --version          # expect 2.14.x or newer 2.x
spacetime login              # opens a browser; uses the team member's GitHub-linked account
spacetime login show
```

Do not `cargo install spacetimedb-cli` (an outdated 1.x crate, see `docs/research/platform.md`).
Redeem the hackathon credit (`HACKUTD2026`) on the website from the leaflet QR code; one per GitHub account.
Node.js 22, 24, or 26+ is needed for the Node clients (https://spacetimedb.com/docs/quickstarts/nodejs).

### 1.2 Create the module

```bash
cd backend
spacetime init tmp-init --lang typescript --server-only --non-interactive
mv tmp-init/spacetimedb ./spacetimedb
rm -rf tmp-init
cd spacetimedb && npm install
```

This gives `package.json` (dependency `"spacetimedb": "2.14.*"`), `tsconfig.json`, and `src/index.ts`.
Do not change the tsconfig options marked "required by SpacetimeDB".
Do not commit a `spacetime.json` or `spacetime.local.json`; every command passes the server and module path.

### 1.3 File layout

```
backend/spacetimedb/
  src/
    index.ts        # export { default } from './schema'; every reducer, lifecycle hook, scheduled reducer, view
    schema.ts       # enums, tables, schedule tables, schema({...}, { CASE_CONVERSION_POLICY: None })
    config.ts       # constants (not exported from index.ts)
    lib/auth.ts     # requireRole, requireAgent, requireRobot, isDemo, activeSite
    lib/events.ts   # logEvent, diff, toPayload, activeRunId
    lib/state.ts    # setSurvivorStatus (the state machine), releaseAssignment
    lib/timers.ts   # arm, renew, cancel helpers for every schedule table
    lib/geo.ts      # haversineM, metersToDeg, cellForPoint, siteForPoint
    lib/text.ts     # assertNoDeadLabel, clampLen
  test/
    smoke.sh        # reducer tests against a local in-memory server (section 18)
```

Keep all exported reducers, hooks, and views in `src/index.ts`.
Helpers in `lib/` must not be named exports of `index.ts` (named exports are reserved for registered functions, per the template rules).

### 1.4 Database names and servers

| Target | Server flag | Client URI | Database name |
| --- | --- | --- | --- |
| Maincloud | `--server maincloud` | `https://maincloud.spacetimedb.com` | `hackutd-rubble` (if taken, add a suffix and update every `.env`) |
| Local fallback (Laptop A) | `--server local` (`http://127.0.0.1:3000`) | `ws://<laptop-a-lan-ip>:3000` from other machines | `hackutd-rubble` |
| Tests | `--server http://127.0.0.1:3917` | same | `rubble-test` |

Each client reads `STDB_URI` and `STDB_DATABASE` from its `.env` (browser apps: `VITE_STDB_URI` and `VITE_STDB_DATABASE`, CONTRACTS.md "Conventions"), so switching to the fallback is a change of URI.
Whether the name `hackutd-rubble` is free on Maincloud is not confirmed.

### 1.5 Publish

```bash
spacetime build -p backend/spacetimedb
spacetime publish hackutd-rubble -p backend/spacetimedb --server maincloud --yes

# local fallback: a persistent server on Laptop A, listening on the LAN
spacetime start --listen-addr 0.0.0.0:3000
spacetime publish hackutd-rubble -p backend/spacetimedb --server local --yes

# breaking schema change (new column without .default(), type change)
spacetime publish hackutd-rubble -p backend/spacetimedb --server maincloud --delete-data=always --yes
```

Republishing hot-swaps the module and keeps data.
`init` does not run again on a republish, so `ensureSchedules` also runs in `clientConnected` (section 6).
When adding a column to an existing table without wiping data, give it `.default(value)`.

### 1.6 Generate client bindings

```bash
spacetime generate --lang typescript --out-dir backend/spacetimedb-bindings --module-path backend/spacetimedb
```

Commit the generated folder.
Re-run after every schema or reducer signature change and tell the other component owners.
Scheduled reducers do not appear in the bindings (tested).
Client code uses the generated camelCase names (`conn.db.survivor`, `row.criticalLevel`, `conn.reducers.reportDetection({...})`); SQL strings use the snake_case names.
The generated enum keys are PascalCase (`EnRoute`); whether a client sees `row.status.tag === 'EnRoute'` or `'en_route'` is not confirmed, so each client maps tags through one helper and checks it once against a live row.

Add to `backend/spacetimedb/package.json`:

```json
"scripts": {
  "build": "spacetime build",
  "publish:cloud": "spacetime publish hackutd-rubble -p . --server maincloud --yes",
  "publish:local": "spacetime publish hackutd-rubble -p . --server local --yes",
  "generate": "spacetime generate --lang typescript --out-dir ../spacetimedb-bindings --module-path .",
  "logs:cloud": "spacetime logs hackutd-rubble --server maincloud -f",
  "test": "bash test/smoke.sh"
}
```

### 1.7 Code skeleton (2.14.1 syntax, tested in the scratch module)

```ts
// src/schema.ts
import { schema, table, t, CaseConversionPolicy } from 'spacetimedb/server';

export const Role = t.enum('Role', {
  commander: t.unit(), coordinator: t.unit(), rescuer: t.unit(), robot: t.unit(),
  agent: t.unit(), auditor: t.unit(), perception: t.unit(), sim: t.unit(),
});
export const LeaseKind = t.enum('LeaseKind', {
  proposal: t.unit(), assignment: t.unit(), mission: t.unit(), agent_task: t.unit(),
});

export const assignment = table(
  { name: 'assignment', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    survivor_id: t.u64().index('btree'),
    rescuer_identity: t.identity().index('btree'),
    // ... section 4
  }
);

// one-shot schedule table, public so the dashboard can count down
export const lease_timer = table(
  { name: 'lease_timer', public: true },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
    kind: LeaseKind,
    entity_id: t.u64().index('btree'),
    due_at: t.timestamp(),
  }
);

const spacetimedb = schema(
  { assignment, lease_timer /* , ...every table */ },
  { CASE_CONVERSION_POLICY: CaseConversionPolicy.None }   // keep contract spellings on the wire (tested)
);
export default spacetimedb;
```

```ts
// src/index.ts
import { t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import spacetimedb, { lease_timer } from './schema';
export { default } from './schema';
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

export const init = spacetimedb.init(ctx => { ensureSchedules(ctx); });
export const onConnect = spacetimedb.clientConnected(ctx => { ensureSchedules(ctx); markConnected(ctx); });
export const onDisconnect = spacetimedb.clientDisconnected(ctx => { markDisconnected(ctx); });

// arm a one-shot timer
function armLease(ctx: Ctx, kind: 'proposal' | 'assignment' | 'mission' | 'agent_task', entity_id: bigint, seconds: number) {
  const due = ctx.timestamp.microsSinceUnixEpoch + BigInt(seconds) * 1_000_000n;
  ctx.db.lease_timer.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.time(due), kind: { tag: kind }, entity_id, due_at: new Timestamp(due) });
}
// renew: update scheduled_at and due_at of the existing row (tested); cancel: delete the row (tested)

export const lease_expired = spacetimedb.reducer(
  { onSchedule: lease_timer },
  { arg: lease_timer.rowType },
  (ctx, { arg }) => {
    // always re-check state: renewals and cancels may have raced
    if (arg.kind.tag === 'assignment') { /* release if still active and lease_expires_at <= now */ }
  }
);
```

Rules from the template and the tests:
- Insert auto-increment rows with `id: 0n`; `insert` returns the row with the real id.
- Update by primary key with the full row spread (`{ ...row, field }`).
- `iter()` and `filter()` return iterators; spread to an array before sorting or mutating while looping.
- Never build an `Identity` from a string; compare with `toHexString()` when the input is a string.
- Never use `Date.now()` or `Math.random()`; use `ctx.timestamp` and `ctx.random`.
- Inside a scheduled reducer, re-arm by inserting a new row; do not update the row that is firing (it is deleted after the reducer, and updating it is not tested).

## 2. Configuration

### 2.1 Per-site timings (contract `site` columns)

The module reads timings from the active site (`activeSite(ctx)`: the active run's site, else the lowest site id).

| Column | Normal | Demo (`create_site` with `demo_mode = true`) | Used by |
| --- | --- | --- | --- |
| `mission_lease_s` | 30 | 15 | leased and active missions; renewed by `robot_heartbeat` and `mission_progress` |
| `assignment_lease_s` | 120 | 30 | active assignments; renewed by `rescuer_heartbeat` and `participant_update_position` |
| `proposal_lease_s` | 60 | 30 | proposed assignments the rescuer has not acknowledged |
| `escalate_after_s` | 180 | 45 | escalation level 1 at N, level 2 at 2N |

### 2.2 Module constants (`src/config.ts`)

| Constant | Normal | Demo | Meaning |
| --- | --- | --- | --- |
| `RESCUER_HEARTBEAT_S` | 15 | 15 | no `rescuer_heartbeat` or position for this long releases the rescuer's active assignment (contract) |
| `ROBOT_HEARTBEAT_S` | 5 | 5 | no `robot_heartbeat` for this long marks the robot offline and reopens its cell (contract) |
| `DISCONNECT_GRACE_S` | 2 | 2 | a person with no open connection for this long is treated as disconnected (section 6.2) |
| `ROBOT_DISCONNECT_GRACE_S` | 5 | 5 | the same for a robot identity, so HTTP calls never flap it offline |
| `AGENT_WATCHDOG_S` | 30 | 15 | orchestrator silence before the module's fallback assigns rescuers |
| `AGENT_TASK_LEASE_S` | 30 | 30 | a claimed `agent_task` goes back to `open` after this |
| `AGENT_TASK_MAX_ATTEMPTS` | 3 | 3 | after this many expired claims the task becomes `expired` |
| `SWEEP_INTERVAL_S` | 10 | 10 | safety sweep (contract) |
| `UNATTENDED_HEADLINE_S` | 60 | 60 | dashboard headline threshold (contract) |
| `MERGE_RADIUS_M` | 4.0 | 4.0 | a detection this close to a non-resolved survivor merges into it (contract default) |
| `DUPLICATE_RADIUS_M` | 10.0 | 10.0 | between 4 and 10 m: keep both, set `possible_duplicate_of` |
| `MIN_THERMAL_CONFIDENCE` | 0.30 | 0.30 | below this a detection is stored but creates no survivor |
| `MAX_OPEN_AGENT_PROPOSALS` | 5 | 5 | per agent, missions in `proposed` |
| `MAX_OPEN_TASKS_PER_AGENT` | 50 | 50 | `open` tasks addressed to one agent |
| `BRIEFING_MIN_GAP_US` | 3 s | 3 s | per (`created_by`, `audience`), so an agent loop cannot flood glasses |
| `MAX_GRID_CELLS` | 2500 | 2500 | `create_search_grid` refuses larger grids |
| `FORBIDDEN_PATTERN` | `\b(dead|deceased|deceas\w*|expectant|corpse)\b` and the phrase `body recovery`, case-insensitive | same | rejected in stored free text (section 5.4) |
| `MODULE_ACTOR` | `"module"` | | `created_by`, `from_agent`, or `agent` for rows the module writes itself |

## 3. Enums

Variant names are spelled exactly as in the contract, and with `CaseConversionPolicy.None` they are spelled the same on the wire and in SQL output (tested).
Inside the module, values are `{ tag: 'name' }`.
On the CLI and HTTP API, a value is written `{"name":[]}`.
SQL cannot filter on enum columns (tested), so clients filter enums in their own code.

| Enum (`t.enum` name) | Variants |
| --- | --- |
| `Role` | `commander`, `coordinator`, `rescuer`, `robot`, `agent`, `auditor`, `perception`, `sim` |
| `CellStatus` | `unsearched`, `searching`, `partially_searched`, `searched` |
| `RobotState` | `BOOT`, `INIT`, `READY`, `ACTIVE`, `SAFE_STOP`, `FAULT`, `SHUTDOWN` |
| `DeviceHealth` | `OK`, `DEGRADED`, `FAILED` |
| `MissionKind` | `search_cells`, `inspect`, `return_home`, `hold` |
| `MissionStatus` | `proposed`, `queued`, `leased`, `active`, `done`, `failed`, `cancelled` |
| `DetectionSource` | `thermal`, `camera` |
| `Breathing` | `detected`, `not_detected`, `unknown` |
| `CriticalLevel` | `immediate`, `delayed`, `minor`, `unknown` |
| `SurvivorStatus` | `unassigned`, `assigned`, `en_route`, `reached`, `resolved` |
| `Resolution` | `rescued`, `handed_off`, `false_alarm`, `duplicate` |
| `AssignmentStatus` | `proposed`, `active`, `released`, `completed` |
| `ReleaseCause` | `declined`, `expired`, `heartbeat`, `disconnected`, `reassigned` |
| `BriefingPriority` | `info`, `warning`, `critical` |
| `BriefingKind` | `briefing`, `nav`, `nudge`, `answer`, `escalation` |
| `AuditFlagKind` | `proposal_disagree`, `load_imbalance` |
| `AuditFlagStatus` | `open`, `acted`, `dismissed` |
| `PersonReportKind` | `missing`, `safe` |
| `PersonReportSource` | `family`, `neighbor`, `hotline`, `coordinator` |
| `AgentName` | `orchestrator`, `comms_agent`, `auditor` |
| `TaskPriority` | `critical`, `high`, `normal` |
| `TaskStatus` | `open`, `claimed`, `done`, `failed`, `expired` |
| `TerrainClass` | `flat`, `debris`, `step`, `gap`, `blocked`, `unknown` |
| `TerrainAction` | `continue`, `slow`, `steer`, `stop` |
| `LeaseKind` (module) | `proposal`, `assignment`, `mission`, `agent_task` |
| `HeartbeatKind` (module) | `rescuer`, `robot`, `disconnect_grace` |

There is no dead, deceased, or expectant value anywhere.
`PersonReportSource` has no `text_reply` and no `roster`.

## 4. Tables

Types: `u64` is `t.u64()`, `u32` is `t.u32()`, `f64` is `t.f64()`, `string` is `t.string()`, `bool` is `t.bool()`, `Identity` is `t.identity()`, `Timestamp` is `t.timestamp()`, `opt(X)` is `t.option(X)`, `X[]` is `t.array(X)`.
`id` columns are `t.u64().primaryKey().autoInc()` unless stated.
`0` in a `u64` reference column means "none" (contract).
"Index" means `.index('btree')`.
Every table below is `public: true` unless marked private.

### 4.1 Current-state tables

`participant`
- `identity` Identity primary key, `name` string (index), `role` Role, `lat` opt(f64), `lon` opt(f64), `online` bool, `last_heartbeat` Timestamp, `last_seen` Timestamp.
- For `robot`, `name` equals the `robot_id`.
- For `agent`, `name` is one of `orchestrator`, `comms_agent`; for `auditor`, `name` is `auditor`.

`site`
- `id`, `name`, `center_lat` f64, `center_lon` f64, `radius_m` f64 (default 483), `demo_mode` bool, `require_mission_approval` bool, `mission_lease_s`, `assignment_lease_s`, `proposal_lease_s`, `escalate_after_s` (u32), `created_at`.

`search_cell`
- `id`, `site_id` u64 (index), `lat`, `lon`, `size_m` f64, `label` string, `status` CellStatus, `searched_by` opt(string), `found` u32, `reported_missing` u32, `reported_safe` u32, `unaccounted` u32, `updated_at`.
- The four counts are the per-cell summary the module keeps (section 10); they start at 0.

`robot`
- `robot_id` string primary key, `name`, `lat` opt(f64), `lon` opt(f64), `gps_fix` bool, `indoor_offset_m` opt(f64), `heading_deg` opt(f64), `battery_pct` opt(f64), `state` RobotState, `online` bool, `current_mission_id` opt(u64), `last_heartbeat` Timestamp, `terrain_class` TerrainClass (default `unknown`), `terrain_confidence` f64 (default 0), `terrain_source` string (default `""`), `terrain_action` TerrainAction (default `continue`).
- The four terrain fields hold the latest terrain report only (section 8.3); there is no terrain history table.

`device_status`
- `id`, `robot_id` string (index), `device` string, `status` DeviceHealth, `detail` string, `updated_at`.
- One row per robot and device; upsert by looping over `robot_id` matches.

`mission`
- `id`, `chain_id` u64, `robot_id` string (index; `""` means any robot), `kind` MissionKind, `target_cell_ids` u64[], `target_lat` opt(f64), `target_lon` opt(f64), `status` MissionStatus, `lease_expires_at` opt(Timestamp), `created_by` string, `reason` string, `created_at`, `updated_at`.

`survivor`
- `id`, `site_id` u64 (index), `cell_id` u64 (index, 0 for none), `first_detection_id` u64, `lat`, `lon`, `location_note` string, `house_label` opt(string), `breathing` Breathing, `breathing_rate_bpm` opt(f64), `breathing_confidence` f64, `visibility_pct` opt(f64), `critical_level` CriticalLevel (index), `critical_score` f64, `score_confidence` f64, `score_reasons` string[], `status` SurvivorStatus, `resolution` opt(Resolution), `resolved_by` opt(string), `possible_duplicate_of` u64, `breathing_display_url` opt(string), `escalated_at` opt(Timestamp), `created_at`, `updated_at`.
- Initial values: `breathing` `unknown`, `breathing_confidence` 0, `visibility_pct` none, `critical_level` `unknown`, `critical_score` 0, `score_confidence` 0, `score_reasons` `["awaiting breathing check"]`, `status` `unassigned`, `possible_duplicate_of` 0.
- Never deleted.

`assignment`
- `id`, `chain_id` u64, `survivor_id` u64 (index), `rescuer_identity` Identity (index), `status` AssignmentStatus, `lease_expires_at` Timestamp, `accepted_at` opt(Timestamp), `release_cause` opt(ReleaseCause), `created_by` string, `created_at`, `updated_at`.

`audit_flag`
- `id`, `run_id` u64 (index), `kind` AuditFlagKind, `entity` string, `entity_id` u64 (index), `message` string, `suggested_action` opt(string), `status` AuditFlagStatus, `filed_by` string (always `auditor`), `created_at`, `updated_at`.

`agent_task`
- `id`, `run_id` u64 (index), `chain_id` u64 (index), `from_agent` string, `to_agent` AgentName, `kind` string, `payload_json` string, `priority` TaskPriority, `status` TaskStatus, `claimed_at` opt(Timestamp), `lease_expires_at` opt(Timestamp), `result_json` opt(string), `reason` string, `created_at`, `updated_at`.
- Rows are never deleted; the status changes are also written to `event_log` so replay can rebuild the board.

`run`
- `id`, `site_id`, `name`, `started_at`, `ended_at` opt(Timestamp), `notes`.
- At most one run has `ended_at` none (the active run).

### 4.2 History tables (append-only)

No reducer updates or deletes a row in these tables.
Every row carries `run_id` (`0` if no run was active).
There are no separate track or terrain history tables: `event_log`, with `agent_action` and `detection`, is the record, and replay rebuilds a run from it (section 14).

- `event_log`: `id`, `run_id` (index), `kind` string, `entity` string, `entity_id` u64 (index), `message`, `payload_json`, `created_at`.
- `detection`: `id`, `run_id` (index), `chain_id` u64, `robot_id`, `mission_id` u64, `source` DetectionSource, `survivor_id` u64 (index), `client_ref` string (index), `lat`, `lon`, `gps_fix`, `location_note`, `max_temp_c` opt(f64), `thermal_confidence` f64, `thermal_image_url`, `camera_image_url`, `breathing_clip_url`, `created_at`.
- `briefing`: `id`, `run_id` (index), `chain_id` u64, `audience` string (index), `text`, `priority`, `kind` opt(BriefingKind), `survivor_id` opt(u64), `created_by`, `created_at`.
- `agent_action`: `id`, `run_id` (index), `chain_id` u64 (index), `agent` string, `step` u32, `model` string, `tool`, `args_json`, `result`, `reason`, `created_at`.
- `person_report`: `id`, `run_id` (index), `cell_id` u64 (index), `kind` PersonReportKind, `count` u32, `name_or_unit` opt(string), `note`, `source` PersonReportSource, `reported_by` string, `created_at`.

Large files never go in any table; rows hold media server URLs.
URL columns accept at most 500 characters and must start with `http://` or `https://`.

### 4.3 Schedule tables (public, one row per timer)

Every one-shot timer has a `due_at` Timestamp equal to its `scheduled_at` time, so clients read the due time without decoding `ScheduleAt` (section 7.3).

| Table | Columns besides `scheduled_id` (u64 pk autoInc) and `scheduled_at` | Reducer | Kind of schedule |
| --- | --- | --- | --- |
| `lease_timer` | `kind` LeaseKind, `entity_id` u64 (index), `due_at` | `lease_expired` | one-shot |
| `heartbeat_timer` | `kind` HeartbeatKind, `identity` Identity (index), `robot_id` string, `due_at` | `heartbeat_missed` | one-shot |
| `escalation_timer` | `survivor_id` u64 (index), `level` u32 (1 or 2), `since` Timestamp (start of the unattended period), `due_at` | `escalate` | one-shot |
| `agent_watchdog` | `agent_name` string (index), `last_seen` Timestamp, `due_at` | `watchdog_fired` | one-shot |
| `sweep_timer` (private) | none | `sweep` | interval 10 s |

`sweep_timer` is not in the contract; it is the contract's "slow sweep every 10 s", kept private because it has no countdown.

### 4.4 Private module tables

| Table | Columns | Purpose |
| --- | --- | --- |
| `role_grant` | `identity` Identity pk, `role` Role, `granted_by` string | `grant_role` |
| `presence` | `identity` Identity pk, `open` u32 | open connections per identity (section 6) |
| `task_attempts` | `task_id` u64 pk, `attempts` u32 | agent task lease expiries |
| `survivor_chain` | `survivor_id` u64 pk, `chain_id` u64 | the `survivor_created` event id, used as `chain_id` for module-created tasks |

## 5. Shared rules

### 5.1 Roles

`requireRole(ctx, ...roles)`: the caller must have a `participant` row with one of the roles.
- `commander` passes every check that lists `coordinator`; `coordinator` and `commander` pass every check that lists `rescuer` (contract).
- `sim` passes every check except the human-only ones, but only while `isDemo(ctx)` is true; otherwise `SenderError('sim role only in demo mode')`.
- Human-only reducers: `accept_assignment`, `release_assignment` (as the assignee), `mark_reached`, `resolve_survivor`, `approve_mission`, `cancel_mission`.
  `agent`, `auditor`, `robot`, `perception`, and `sim` are rejected by these, even in demo mode; the sim acts through simulated rescuer identities (section 17).
- `isDemo(ctx)`: true if any `site` has `demo_mode = true`.
- `requireRobot(ctx, robot_id)`: role `robot` and `participant.name === robot_id`, or `sim` in demo mode with a `robot_id` starting with `sim`.

### 5.2 Per-agent write rules

Agents are identified by `participant.name`; `requireAgent(ctx, ...names)` checks role `agent` (or `auditor` for the name `auditor`) and the name.
`register_participant` refuses an agent name that another identity holds while that identity is `online`.

| Agent (`participant.name`) | Role | May call |
| --- | --- | --- |
| `orchestrator` | `agent` | `propose_assignment` (the only agent that may), `create_mission`, `cancel_own_mission`, `post_agent_task`, `claim_agent_task`, `complete_agent_task`, `set_audit_flag_status`, `agent_heartbeat`, `log_agent_action` |
| `comms_agent` | `agent` | `post_briefing`, task calls, `agent_heartbeat`, `log_agent_action` |
| `auditor` | `auditor` | `file_audit_flag`, task calls, `agent_heartbeat`, `log_agent_action` |

No agent may call `resolve_survivor`, `mark_cell`, `mark_reached`, `accept_assignment`, `approve_mission`, `cancel_mission`, or any robot reducer.
Only the orchestrator's `agent_heartbeat` pushes the watchdog back (section 7.2); its other calls do not, so an orchestrator that writes but cannot act still lets the fallback run.

### 5.3 Survivor state machine (`lib/state.ts`)

`setSurvivorStatus(ctx, survivor, to, cause)` is the only code that writes `survivor.status`.
It throws `SenderError('bad transition <from> -> <to>')` for any pair not in this table:

| From | To | Caused by |
| --- | --- | --- |
| `unassigned` | `assigned` | `accept_assignment` |
| `assigned` | `en_route` | `start_en_route`, or the first step of `mark_reached` |
| `en_route` | `reached` | `mark_reached` |
| `reached` | `resolved` | `resolve_survivor` |
| any unresolved status | `resolved` (`false_alarm` or `duplicate` only) | `resolve_survivor` by a coordinator or commander |
| `assigned`, `en_route`, `reached` | `unassigned` | the active assignment is released, expires, loses its heartbeat, or its rescuer disconnects |

- `resolved` is terminal.
- `mark_reached` on an `assigned` survivor applies two logged steps (`assigned` to `en_route`, then `en_route` to `reached`), so no step is skipped in the record.
- Invariant: a survivor is `assigned`, `en_route`, or `reached` if and only if exactly one `active` assignment points at it.
- On every move to `unassigned` with `critical_level = immediate`, arm escalation level 1 (section 7.2); on every move away from `unassigned`, delete the survivor's `escalation_timer` rows.
- Each step writes one `event_log` row (section 5.5).

### 5.4 Text and number checks (`lib/text.ts`)

- `assertNoDeadLabel(text)`: throw `SenderError('forbidden label')` if the text matches `FORBIDDEN_PATTERN`.
  Apply it to `briefing.text`, `score_reasons`, `location_note`, `mission.reason`, assignment `reason`, `resolve_survivor` `note`, `audit_flag.message` and `suggested_action`, `agent_task.reason`, `payload_json`, and `result_json`, `agent_action.reason` and `result`, `person_report.note`, `log_event` `message`, and `run.notes`.
- Lengths: names 1 to 40, `briefing.text` 1 to 120, `location_note` up to 120, `reason` up to 200, `note` and `notes` up to 500, JSON strings up to 4000, `result` up to 2000, `kind` strings `^[a-z_]{1,32}$`, at most 6 score reasons of up to 80 chars.
- Numbers: reject `NaN` and infinities; `lat` in [-90, 90], `lon` in [-180, 180], confidences in [0, 1], `visibility_pct`, `critical_score`, `battery_pct` in [0, 100], `heading_deg` in [0, 360), `rate_bpm` in [0, 80], `radius_m` in [10, 5000], `size_m` in [5, 200], `count` 1 to 500.
- JSON arguments must parse with `JSON.parse` (`SenderError('bad json')`).

### 5.5 Event log (`lib/events.ts`)

`logEvent(ctx, kind, entity, entity_id, message, before, after)` inserts one `event_log` row:
- `run_id` = `activeRunId(ctx)` (the run with `ended_at` none, else `0n`).
- `payload_json` = `{"before":{...},"after":{...}}` with only the changed fields (contract); a created row has `before` `{}` and the full row in `after`; `{}` when nothing changed.
- `toPayload` converts bigint to a decimal string, Timestamp to ISO 8601, Identity to hex, enums to the tag string, `undefined` to `null`.
- `created_at` = `ctx.timestamp`; robot events with `observed_at` add `"observed_at"` to `after`.

Kinds used, exactly the contract list:

| Entity | Kinds |
| --- | --- |
| `survivor` | `survivor_created`, `survivor_merged`, `possible_duplicate`, `possible_duplicate_cleared`, `breathing_reported`, `score_changed`, `en_route`, `survivor_reached`, `survivor_resolved`, `escalation`, `escalation_commander` |
| `assignment` | `assignment_proposed`, `assignment_accepted`, `assignment_released`, `assignment_expired`, `assignment_completed`, `agent_watchdog_fallback` |
| `mission` | `mission_created`, `mission_approved`, `mission_leased`, `mission_done`, `mission_failed`, `mission_cancelled`, `mission_requeued` |
| `robot` | `robot_online`, `robot_offline`, `robot_state`, `device_status`, `terrain` (only when the terrain class changes) |
| `search_cell` | `grid_created` (one row listing all cells), `cell_status`, `cell_reopened`, `person_report`, `unaccounted` |
| `run` | `run_started` (with a snapshot, section 14), `run_ended` |
| `audit_flag` | `audit_flag` |
| `agent_task` | `agent_task_posted`, `agent_task_claimed`, `agent_task_done` (done or failed), `agent_task_expired`, `review_verdict` |
| `participant` | `rescuer_offline` (a disconnect or missed heartbeat), `rescuer_question` |
| `site` | `timings_changed` |
| any | `sim_injection` (sim `log_event`), `note` (coordinator `log_event`) |

Position-only updates and battery changes write no event, and no other table records them, so replay shows state changes but no movement trails (section 14).

### 5.6 Geometry (`lib/geo.ts`)

- `haversineM` with R = 6,371,000 m (https://www.movable-type.co.uk/scripts/latlong.html).
- `metersToDeg(lat, m)`: `dLat = m / 111320`, `dLon = m / (111320 * cos(lat))`.
- `siteForPoint`: the nearest site whose center is within `radius_m`, else the active site, else `SenderError('no site')`.
- `cellForPoint(site_id, lat, lon)`: the cell with the nearest center within `size_m`, or none.

## 6. Lifecycle reducers

### 6.1 `init`, `clientConnected`, `clientDisconnected`

```ts
export const init = spacetimedb.init(ctx => { ensureSchedules(ctx); });
export const onConnect = spacetimedb.clientConnected(ctx => { ensureSchedules(ctx); markConnected(ctx); });
export const onDisconnect = spacetimedb.clientDisconnected(ctx => { markDisconnected(ctx); });
```

`ensureSchedules(ctx)`: insert the `sweep_timer` interval row if missing and the `agent_watchdog` row for `orchestrator` if missing.
It runs in `clientConnected` because `init` does not run on a republish.

`markConnected(ctx)`:
- `presence.open += 1` for `ctx.sender`.
- Delete any `heartbeat_timer` row of kind `disconnect_grace` for this identity (a quick reconnect cancels the release).
- If a `participant` row exists: `online = true`, `last_seen = now`.

`markDisconnected(ctx)`:
- `presence.open -= 1` (not below 0); `last_seen = now`.
- If `open` is now 0 and the participant is a person (`rescuer`, `coordinator`, `commander`) or a `robot`: insert a `heartbeat_timer` row of kind `disconnect_grace`, due in `DISCONNECT_GRACE_S` (people) or `ROBOT_DISCONNECT_GRACE_S` (robots).

### 6.2 Why a 2 s grace instead of acting inside `clientDisconnected`

Tested: every HTTP request runs `clientConnected` and then `clientDisconnected` for its identity, including HTTP SQL.
Releasing assignments inside `clientDisconnected` would release a rescuer's task whenever anything calls the HTTP API with that rescuer's token (the test module did exactly that).
The grace row makes the rule "the identity has had no open connection for 2 s", which a WebSocket close meets almost at once and an HTTP request never meets.
A dropped glasses session therefore releases the assignment after 2 s, the closest safe value to "at once" (contract).

### 6.3 `heartbeat_missed` for kind `disconnect_grace`

When the row fires and `presence.open` for that identity is still 0:
- `participant.online = false`.
- Rescuer, coordinator, or commander: release every `proposed` and `active` assignment of that identity with cause `disconnected` (event `assignment_released`, survivor back to `unassigned`, escalation re-armed for `immediate` survivors), delete their `heartbeat_timer` row of kind `rescuer`, and log `rescuer_offline`.
- Robot: `robot.online = false` (event `robot_offline`), and every `search_cell` with `status = searching` and `searched_by = robot_id` goes back to `unsearched` (event `cell_reopened`).
  Its mission is left to its lease (`lease_timer`), which requeues it.
  A `warning` briefing to `coordinators`: `"dog1 offline"`.

## 7. Timers

### 7.1 Principles

- Every timer is one row in a public schedule table with its `due_at` (contract).
- Arming inserts a row; renewing updates `scheduled_at` and `due_at` of the existing row (tested); cancelling deletes the row (tested).
- Every scheduled reducer re-checks the state before acting, because renewals and cancels may race with firing: for example `lease_expired` releases an assignment only if it is still `active` and its `lease_expires_at <= now`.
- The row's own column (`assignment.lease_expires_at`, `mission.lease_expires_at`, `agent_task.lease_expires_at`, `participant.last_heartbeat`, `robot.last_heartbeat`) is always written in the same reducer as the timer row, so the sweep can repair a missing timer from the data alone.

### 7.2 Every timer

| Timer | Armed by | Renewed by | Cancelled by | When it fires |
| --- | --- | --- | --- | --- |
| `lease_timer` `proposal` | `propose_assignment` (due `proposal_lease_s`) | never | `accept_assignment`, `release_assignment`, release of the survivor's other proposals | proposal `released` with cause `expired` (event `assignment_expired`); survivor stays `unassigned`; escalation keeps running |
| `lease_timer` `assignment` | `accept_assignment` (due `assignment_lease_s`) | `rescuer_heartbeat`, `participant_update_position` | release, `resolve_survivor` | assignment `released` with cause `expired` (event `assignment_expired`), survivor `unassigned` |
| `lease_timer` `mission` | `claim_next_mission` (due `mission_lease_s`) | `robot_heartbeat`, `mission_progress` | `done`, `failed`, `cancelled` | mission back to `queued` (event `mission_requeued`), `robot.current_mission_id` cleared, its `searching` cells back to `unsearched`; `robot_id` reset to `""` if the robot is offline |
| `lease_timer` `agent_task` | `claim_agent_task` (due `AGENT_TASK_LEASE_S`) | never | `complete_agent_task` | task back to `open` (event `agent_task_expired`); after `AGENT_TASK_MAX_ATTEMPTS` expiries, `expired` |
| `heartbeat_timer` `rescuer` | `accept_assignment` (due `RESCUER_HEARTBEAT_S`) | `rescuer_heartbeat`, `participant_update_position` | the rescuer has no `active` assignment left | release that rescuer's active assignments (cause `heartbeat`), event `rescuer_offline` |
| `heartbeat_timer` `robot` | first `robot_heartbeat` (due `ROBOT_HEARTBEAT_S`) | `robot_heartbeat` | never | robot offline and cells reopened, as in 6.3; the next heartbeat brings it back (event `robot_online`) and re-arms |
| `heartbeat_timer` `disconnect_grace` | `clientDisconnected` with no open connection | never | `clientConnected` | section 6.3 |
| `escalation_timer` level 1 | survivor becomes `immediate` while `unassigned`, or goes back to `unassigned` while `immediate` (due `since + escalate_after_s`) | never | survivor leaves `unassigned`, is no longer `immediate`, or is resolved | `critical` briefing (kind `escalation`) to `all`: `"IMMEDIATE survivor <id> (<house_label>) unassigned <N> s"`; `survivor.escalated_at = now`; event `escalation`; arm level 2 at `since + 2 * escalate_after_s` |
| `escalation_timer` level 2 | level 1 firing | never | as level 1 | `critical` briefing to `commander` and to `all` (kind `escalation`); event `escalation_commander` |
| `agent_watchdog` | `ensureSchedules` (due `AGENT_WATCHDOG_S`) | the orchestrator's `agent_heartbeat` only (`last_seen = now`, due `now + AGENT_WATCHDOG_S`) | never | section 7.4 |
| `sweep_timer` | `ensureSchedules` (interval 10 s) | n/a | never | section 7.5 |

The contract describes the rescuer heartbeat timer as firing "when no heartbeat for 15 s" and leases as firing "at expiry"; both rows can exist for the same assignment, and whichever fires first releases it.

### 7.3 How clients read due times for countdowns

- The dashboard subscribes to `SELECT * FROM lease_timer`, `heartbeat_timer`, `escalation_timer`, and `agent_watchdog` (all public, tested readable).
- Each row has `due_at`, so the countdown is `due_at - now`, redrawn every 250 ms from the client clock.
- Row inserts, updates (renewals), and deletes (fired or cancelled) arrive through the subscription, so a renewal jumps the countdown back up live.
- `kind` plus `entity_id`, `identity`, `robot_id`, `survivor_id`, `cell_id`, or `agent_name` links a timer to its row on the board.
- Clock skew: the dashboard computes `offset = row.created_at - local_now` from the newest `event_log` row it receives and adds it to `now`.

### 7.4 Agent watchdog fallback (`watchdog_fired`)

When the row fires:
1. Insert a new `agent_watchdog` row due in `AGENT_WATCHDOG_S` (it keeps firing while the orchestrator is silent).
2. Urgent work = survivors with `critical_level = immediate`, `status = unassigned`, and no `proposed` assignment.
   If there is none, stop.
3. Candidate rescuers = participants with role `rescuer`, `online = true`, `lat` and `lon` set, `last_heartbeat` within `RESCUER_HEARTBEAT_S`, and no `proposed` assignment (a rescuer with active assignments is still a candidate).
4. Order the survivors by `critical_score` descending, then `created_at`, then `id`.
5. For each survivor, pick the candidate with the fewest `active` assignments (free rescuers first), then the smallest `haversineM` to the survivor; ties go to the lower identity hex.
   Remove that rescuer from the candidate list (it now has an open proposal).
6. Create the proposal through the same code path as `propose_assignment` (`created_by = module`, reason `"watchdog: orchestrator silent <N> s, nearest free rescuer <d> m"`).
7. Events `agent_watchdog_fallback` and `assignment_proposed`; one `agent_action` row with `agent = module`, `model = rules`, `tool = propose_assignment`, so the Agents view shows the fallback.
8. A `review` task for the auditor is posted as for the orchestrator (section 8.7), so even fallback proposals are checked.

The fallback is deterministic: same data, same proposals.
With every agent down, survivors still get rescuers proposed, rescuers still acknowledge on the glasses, and the headline stays at 0.

### 7.5 Safety sweep (`sweep`, every 10 s)

The sweep re-checks every condition from the data and repairs missing timers, in case a row was missed:
- assignments `proposed` or `active` with `lease_expires_at <= now`: release now; with no `lease_timer` row: insert one.
- missions `leased` or `active` with `lease_expires_at <= now`: requeue now.
- `agent_task` rows `claimed` with `lease_expires_at <= now`: expire now.
- robots `online` with `last_heartbeat` older than `ROBOT_HEARTBEAT_S`: offline now.
- rescuers with an active assignment and `last_heartbeat` older than `RESCUER_HEARTBEAT_S`: release now.
- `immediate`, `unassigned` survivors with no `escalation_timer` row: insert level 1 (or level 2 if `since + N` has passed) with `since` = the later of the last `score_changed` to immediate and the last move to `unassigned`, read from `event_log` (else `now`).
- `agent_watchdog`: insert if missing.
- The sweep files no audit flags: "too long unattended" belongs to the escalation timer and the watchdog, and only the auditor's reviews file flags.

The sweep and the timers call the same handler functions, which check state first, so a double fire changes nothing.

## 8. Reducers

Every reducer: checks the role first, validates every argument (5.4), changes state, writes the `event_log` rows listed, and arms, renews, or cancels timers.
Arguments here are the contract's argument lists.
Robot reducers take a last argument `observed_at: opt(Timestamp)`; `detection.created_at` and the `after` payload of robot events use it when present, while liveness always uses `ctx.timestamp`.
`observed_at` more than 5 s in the future or older than the active run's start is rejected.

### 8.1 Participants and roles

`register_participant(name: string, role: Role)`
- Allowed if: `role` is `rescuer`; or demo mode; or no `site` row exists yet (bootstrap for the first coordinator, commander, or sim); or `role_grant` holds this identity with this role.
- A sim registered at bootstrap can only create a site with `demo_mode = true`.
- `robot`: `name` matches `^[a-z0-9_-]{1,16}$`.
- `agent`: `name` in `orchestrator`, `comms_agent`; `auditor`: `name` is `auditor`; refuse if another online identity holds the name.
- Upsert the participant (keep `lat`, `lon`), `online = true`, `last_heartbeat = last_seen = now`.
- No event (the participant table is current state).

`grant_role(identity: Identity, role: Role)`
- Caller: coordinator or commander (or anyone at bootstrap, while no site exists).
- Upsert `role_grant`; if the identity has a participant row, set its role.
- Note: identities differ per server, so grants are made again on the local fallback, or the fallback runs in demo mode.

`participant_update_position(lat: f64, lon: f64)`
- Caller: rescuer, coordinator, commander (sim in demo).
- Update `lat`, `lon`, `last_heartbeat`, `last_seen`.
- For each `active` assignment of the caller: renew its `lease_timer` and `lease_expires_at` (the move to `en_route` is `start_en_route`, section 8.6).
- Renew the caller's `heartbeat_timer` `rescuer` row.
- No event.

`rescuer_heartbeat()`
- Caller: rescuer, coordinator, commander.
- `last_heartbeat = now`, `online = true`; renew the caller's active leases and `heartbeat_timer` row.
- No event.
- Expected rate: about every 5 s, forwarded by the glasses service.

### 8.2 Site and cells

`create_site(name: string, center_lat: f64, center_lon: f64, radius_m: f64, demo_mode: bool, require_mission_approval: bool)`
- Caller: coordinator, commander, or sim (sim only with `demo_mode = true`).
- Timings from section 2.1 (demo values when `demo_mode`).

`set_site_timings(site_id: u64, mission_lease_s: u32, assignment_lease_s: u32, proposal_lease_s: u32, escalate_after_s: u32)`
- Caller: coordinator, commander, sim in demo; each value 5 to 3600; used by tests and drills to shorten timers.
- Event `timings_changed`.

`create_search_grid(site_id: u64, size_m: f64)`, `create_search_cell(site_id, lat, lon, size_m, label)`, `label_cell(cell_id, label)`
- Caller: coordinator, commander, sim.
- Grid: square `size_m` cells covering the circle (centers within `radius_m + size_m / 2`), labels like `"C4"`, at most `MAX_GRID_CELLS`, refused if the site already has cells; event `grid_created`.
- Single cell and label: event `cell_status` with the changed fields.

`mark_cell(cell_id: u64, status: CellStatus, observed_at: opt(Timestamp))`
- Caller: robot or coordinator, commander (sim in demo); never an agent.
- A robot may set `searching`, `partially_searched`, or `searched`, and may not move a `searched` cell back; a coordinator may set anything (to order a re-search).
- `partially_searched` is never treated as clear: claim and planning keep it in the queue, and the dashboard shows it as not clear.
- `searched_by` = robot id or the coordinator's name.
- Event `cell_status`.

`report_person(cell_id: u64, kind: PersonReportKind, count: u32, name_or_unit: opt(string), note: string, source: PersonReportSource)`
- Caller: coordinator, commander, sim.
- `source` is `family`, `neighbor`, `hotline`, or `coordinator`; `kind` is `missing` or `safe`.
- Append `person_report` with `reported_by` = caller name; event `person_report`; then update the cell's summary columns (section 10).

### 8.3 Robot

`robot_heartbeat(robot_id: string, state: RobotState, battery_pct: opt(f64), observed_at: opt(Timestamp))`
- Caller: `requireRobot`.
- First heartbeat creates the `robot` row (`name = robot_id`, position none, `online = true`) and arms its `heartbeat_timer`; event `robot_online`.
- Else update `state`, `battery_pct`, `last_heartbeat = now`, `online = true`; renew the `heartbeat_timer` row; events `robot_online` (if it was offline) and `robot_state` (if `state` changed).
- Renew the lease of `current_mission_id` if `leased` or `active`.
- Expected rate: 1 per second.

`robot_report_position(robot_id, lat, lon, gps_fix, indoor_offset_m: opt(f64), heading_deg: opt(f64), observed_at: opt(Timestamp))`
- Caller: `requireRobot`; robot row must exist (`SenderError('heartbeat first')`).
- Update the position fields; no event and no history row (positions are current state only).

`robot_report_device(robot_id, device, status: DeviceHealth, detail, observed_at: opt(Timestamp))`
- Caller: `requireRobot`; `device` `^[a-z0-9_]{1,24}$`.
- Upsert; event `device_status` when `status` changed; on `FAILED`, a `warning` briefing to `coordinators`.

`report_detection(robot_id, mission_id: u64, source: DetectionSource, client_ref: string, lat, lon, gps_fix, location_note, max_temp_c: opt(f64), thermal_confidence: f64, thermal_image_url: opt(string), camera_image_url: opt(string), breathing_clip_url: opt(string), observed_at: opt(Timestamp))`
- Caller: `requireRobot`; `mission_id` is 0 or a mission of this robot; `client_ref` `^[A-Za-z0-9_-]{1,40}$`.
- Decide the survivor first, then insert the `detection` row once with `survivor_id` set (detections are insert-only).
- `thermal_confidence < MIN_THERMAL_CONFIDENCE`: store with `survivor_id = 0`, no survivor, no event.
- Candidates: survivors of `siteForPoint(lat, lon)` that are not `resolved`.
- Merge:
  1. nearest candidate within `MERGE_RADIUS_M`: merge (keep position unless the survivor came from a no-fix detection and this one has a fix; replace `location_note` if non-empty); event `survivor_merged`;
  2. else nearest candidate within `DUPLICATE_RADIUS_M`: new survivor with `possible_duplicate_of` = that id; events `survivor_created` and `possible_duplicate`;
  3. else new survivor; event `survivor_created`.
- A new survivor gets `cell_id` and `house_label` from `cellForPoint(...)` (0 and none if no cell), and that cell's summary is updated (section 10); its `survivor_created` event id goes into `survivor_chain`.
- `detection.chain_id` is the survivor's chain (0 when `survivor_id = 0`).
- Only a person resolves a duplicate (`resolve_survivor` with `duplicate`).

`claim_next_mission(robot_id: string)`
- Caller: `requireRobot`.
- If `current_mission_id` is `leased` or `active`: renew and return (a reconnecting bridge gets its mission back).
- Else pick a `queued` mission with `robot_id` equal to this robot or `""`: missions with a target cell that has people unaccounted for (section 10) first, then lowest `id`.
- Set `leased`, `robot_id`, `lease_expires_at`, arm `lease_timer` `mission`; set `robot.current_mission_id`.
- `search_cells`: each target cell `unsearched` or `partially_searched` becomes `searching` with `searched_by = robot_id`.
- Event `mission_leased`.
- Reducers return nothing; the bridge learns the mission from its subscription.

`mission_progress(mission_id: u64, status: MissionStatus, note: string, observed_at: opt(Timestamp))`
- Caller: `requireRobot(mission.robot_id)`; `status` in `active`, `done`, `failed`; mission `leased` or `active`.
- `active`: set, renew the lease.
- `done` or `failed`: set, lease none, cancel the `lease_timer`, clear `robot.current_mission_id`; target cells still `searching` go back to `unsearched` (no area silently dropped).
- Events: `mission_done` or `mission_failed`, plus `cell_status` for each cell that changed; `active` writes no mission event.

`report_terrain(robot_id, lat, lon, terrain_class, confidence, source, action, image_url: opt(string), observed_at: opt(Timestamp))`
- Caller: `requireRobot`, or perception with `source = "camera_model"`.
- Update the robot's latest terrain fields: `terrain_class`, `terrain_confidence` (from `confidence`), `terrain_source` (from `source`), and `terrain_action` (from `action`).
- If `terrain_class` changed, append one `event_log` row of kind `terrain` (entity `robot`) with the old and new class; a report with the same class writes no event.
- `lat`, `lon`, and `image_url` are validated but not stored (there is no terrain history table).
- The robot sends terrain only on a change or about once a second (contract), so the module needs no rate cap of its own.

### 8.4 Missions (agents and coordinators)

`create_mission(robot_id, kind, target_cell_ids: u64[], target_lat: opt(f64), target_lon: opt(f64), reason, chain_id: u64)`
- Caller: `orchestrator`, coordinator, commander, sim in demo.
- Per kind: `search_cells` 1 to 50 existing ids, at least one not `searched`; `inspect` needs a target point; `return_home` defaults to the site center; `hold` has no target.
- Agents: `proposed` if `site.require_mission_approval`, else `queued`; at most `MAX_OPEN_AGENT_PROPOSALS` in `proposed` per agent.
- Coordinators and sim: `queued`.
- `chain_id` is stored as given (0 for none).
- Event `mission_created`.

`cancel_own_mission(mission_id)`: the creating agent, while `proposed` or `queued`; event `mission_cancelled`.

`approve_mission(mission_id)`: coordinator or commander; `proposed` to `queued`; event `mission_approved`.

`cancel_mission(mission_id)`: coordinator or commander; any non-final mission; lease none and timer cancelled; `searching` targets back to `unsearched`; event `mission_cancelled`.
The bridge sees the change and sends `{"type":"cancel",...}` to the robot.

### 8.5 Perception

`report_breathing(survivor_id, breathing, rate_bpm: opt(f64), confidence, visibility_pct: opt(f64), display_url: opt(string))`
- Caller: perception (sim in demo).
- Any status, never changes it; `rate_bpm` only with `detected`.
- Event `breathing_reported`.
- `not_detected` is shown as "no signs of life detected, low confidence" and is never turned into anything else.

`set_critical_score(survivor_id, level, score, confidence, reasons: string[])`
- Caller: perception (sim in demo).
- If `breathing` is `not_detected` or `unknown`, `level` must not be `minor` (`SenderError('no signs of life must stay high')`), so nobody's priority drops because breathing was not seen.
- Event `score_changed` (old and new level in the message).
- Becoming `immediate` while `unassigned`: arm escalation level 1 with `since = now`; leaving `immediate`: delete its `escalation_timer` rows.

### 8.6 Assignments and the survivor state machine

`propose_assignment(survivor_id, rescuer_identity: Identity, reason)`
- Caller: `orchestrator`, coordinator, commander, sim in demo (and the module's watchdog through the same function).
- Survivor exists, not `resolved`.
- Target participant exists with role `rescuer`, `coordinator`, or `commander`, and is `online`.
- Target has no other open proposal (`SenderError('rescuer has a pending proposal')`); active assignments do not block a proposal (the orchestrator prefers rescuers with fewer, and the auditor's review flags `load_imbalance`).
- Survivor has an `active` assignment: the orchestrator gets `SenderError('already assigned')`; a coordinator releases it first (reassign).
- Survivor has another open proposal: the orchestrator gets `SenderError('proposal pending')`; a coordinator releases it.
- Insert `proposed`, `chain_id` from `survivor_chain`, `lease_expires_at = now + proposal_lease_s`, arm `lease_timer` `proposal`.
- The survivor stays `unassigned` until the rescuer acknowledges (contract), so its escalation keeps running.
- Event `assignment_proposed` (message includes the reason).
- Review: if the caller is the orchestrator or the module, insert an `agent_task` to `auditor`, `kind = review`, `priority` `critical` for an `immediate` survivor else `high`, `chain_id` from `survivor_chain`, `from_agent` = caller name, payload `{"assignment_id","survivor_id","rescuer_identity","distance_m","critical_level","reason"}`; event `agent_task_posted`.
  The review never blocks the assignment.
  Ids in `payload_json` (here `assignment_id` and `survivor_id`, and in every other `agent_task` payload) are u64 values written as decimal strings, for example `"assignment_id":"12"`; `distance_m` is metres to one decimal, or `null` when the rescuer has no position.
- The glasses learn of the proposal from the `my_assignment` view and show the acknowledge prompt; the module posts no briefing.

`accept_assignment(assignment_id)`
- Caller: `ctx.sender` equals `rescuer_identity`; human roles only.
- Assignment `proposed` and not past its lease; survivor `unassigned` (the caller may already hold other `active` assignments).
- Assignment `active`, `accepted_at = now`, lease `now + assignment_lease_s`; cancel the proposal timer, arm the assignment timer, arm or renew the caller's `heartbeat_timer` `rescuer`.
- Survivor `unassigned` to `assigned`; delete its `escalation_timer` rows.
- Release the survivor's other open proposals (cause `reassigned`).
- Event `assignment_accepted`.

`release_assignment(assignment_id)`
- Caller: the assignee, or a coordinator or commander.
- `proposed` (a decline) or `active`: set `released` with cause `declined` (the assignee) or `reassigned` (a coordinator or commander), cancel timers; for `active`, survivor back to `unassigned` (escalation re-armed if `immediate`).
- Event `assignment_released`.

`start_en_route(assignment_id)`
- Caller: `ctx.sender` equals `rescuer_identity`; human roles only.
- Assignment `active`; survivor `assigned` to `en_route`.
- The glasses service calls it once after acceptance; a repeat call on an `en_route` survivor is a no-op.
- Event `en_route`.

`mark_reached(survivor_id)`
- Caller: the rescuer holding the `active` assignment, or a coordinator or commander.
- Survivor `en_route` to `reached`, or `assigned` through `en_route` to `reached` (two logged steps).
- Event `survivor_reached` (and `en_route` for the first step if needed).

`resolve_survivor(survivor_id, resolution: Resolution, note: string)`
- Caller: the rescuer holding the `active` assignment, or a coordinator or commander; every other role is rejected, including `agent`, `auditor`, and `sim`.
- Survivor must be `reached`, except that a coordinator or commander may resolve any unresolved survivor as `false_alarm` or `duplicate` (nobody needs to reach a false alarm); any active or proposed assignment is then `completed` or `released` (cause `reassigned`).
- `duplicate` requires `possible_duplicate_of != 0`.
- Survivor `resolved`, `resolution`, `resolved_by` = caller name; the assignment `completed` (event `assignment_completed`); cancel all its timers.
- `false_alarm` and `duplicate` lower the cell's `found` count (section 10).
- Event `survivor_resolved` (note in the message).
- This is the only code path that writes `resolved`.

`clear_possible_duplicate(survivor_id)`
- Caller: coordinator (and commander, by the role rule in section 5.1); every other role is rejected, including `agent`, `auditor`, and `sim`.
- Survivor exists, is not `resolved`, and has `possible_duplicate_of != 0` (`SenderError('not a possible duplicate')`).
- A coordinator calls it when the two sightings are different people.
- Set `possible_duplicate_of` to 0 and `updated_at = now`; the survivor's status, assignments, and timers do not change.
- Event `possible_duplicate_cleared` (entity `survivor`; `before` and `after` hold the old id and 0).

`rescuer_ask(text: string, audio_url: opt(string), survivor_id: opt(u64))`
- Caller: rescuer, coordinator, commander (human roles only); `text` 1 to 300 characters (it records what a person said, so it is exempt from the death-word check, but the answer briefing is not).
- Event `rescuer_question` (entity `participant`).
- Insert an `agent_task` to `comms_agent`, `kind = answer_rescuer`, `from_agent` = the caller's name, `priority` `critical` if `survivor_id` is an `immediate` survivor else `high`, `chain_id` = the survivor's chain if `survivor_id` is set, else the `rescuer_question` event id, payload as in `glasses.md` section 5.15, `reason = "rescuer voice question"`; event `agent_task_posted`.

### 8.7 Agents

`agent_heartbeat()`
- Caller: any agent or the auditor.
- `last_heartbeat = now`, `online = true`; for the orchestrator, push the `agent_watchdog` row back.

`post_agent_task(to_agent: AgentName, kind: string, payload_json: string, priority: TaskPriority, reason: string, chain_id: u64)`
- Caller: any agent or the auditor (`from_agent` = caller name).
- `to_agent` is not the caller; at most `MAX_OPEN_TASKS_PER_AGENT` open tasks per `to_agent`.
- Insert `open`; event `agent_task_posted`.
- `chain_id` is the id of the event that started the chain (for a survivor, its `survivor_created` event); 0 if none.

`claim_agent_task(task_id)`
- Caller: the agent named in `to_agent` only.
- Task `open`: set `claimed`, `claimed_at`, `lease_expires_at = now + AGENT_TASK_LEASE_S`, arm `lease_timer` `agent_task`; event `agent_task_claimed`.
- Two agents can never hold the same task: reducers are transactions, so the second claim sees `claimed` and fails (`SenderError('taken')`).

`complete_agent_task(task_id, status: TaskStatus, result_json: string)`
- Caller: the addressed agent; task `claimed`; `status` in `done`, `failed`.
- Set status, `result_json`, cancel the lease timer; event `agent_task_done`.
- For `kind = review`: `result_json` must be `{"verdict":"agree"|"disagree","reason":"..."}`, with an optional `"flag_kind"` (`proposal_disagree` for a wrong rescuer, `load_imbalance` for an unfair load).
  Event `review_verdict` with the verdict.
  On `disagree`, the module files an `audit_flag` of that kind (default `proposal_disagree`; entity `assignment`, the reason as the message, `filed_by = auditor`) in the same transaction, which wakes the orchestrator through its subscription; the auditor does not call `file_audit_flag` for reviews.

`log_agent_action(tool, args_json, result, reason, step: u32, model: string, chain_id: u64)`
- Caller: any agent or the auditor; `agent` = caller name.
- Insert `agent_action`; no event.

`file_audit_flag(kind: AuditFlagKind, entity: string, entity_id: u64, message: string, suggested_action: opt(string))`
- Caller: auditor, only for a problem found outside a review; `kind` is `proposal_disagree` or `load_imbalance`; `filed_by = auditor`.
- No-op (no error) if an `open` flag with the same kind, entity, and entity_id exists.
- Event `audit_flag`.

`set_audit_flag_status(flag_id, status: AuditFlagStatus)`
- Caller: orchestrator, coordinator, commander; status `acted` or `dismissed`.
- Event `audit_flag`.

`post_briefing(audience: string, text: string, priority, survivor_id: opt(u64), kind: opt(BriefingKind))`
- Caller: `comms_agent`, coordinator, commander, sim in demo.
- `audience`: `all`, `coordinators`, `commander`, or a 64-character lowercase identity hex of an existing participant.
- At most 120 characters, death-word check, `BRIEFING_MIN_GAP_US` per (`created_by`, `audience`).
- Insert with `run_id`, and `chain_id` from the survivor's chain when `survivor_id` is set (else 0); no event (the table is history).

### 8.8 Runs and notes

`start_run(site_id, name)`: coordinator, commander, sim; no other active run; insert the run, event `run_started` with the snapshot (section 14).

`end_run(run_id, notes)`: coordinator, commander, sim; set `ended_at`, event `run_ended`.

`log_event(kind, message, payload_json)`: sim (`kind = sim_injection` only), coordinator or commander (`kind = note`).

### 8.9 Lifecycle and scheduled reducers (private)

`init`, `onConnect`, `onDisconnect` (section 6), `lease_expired`, `heartbeat_missed`, `escalate`, `watchdog_fired` (section 7), and `sweep` (7.5).

## 9. Assignment and timer flow, end to end

1. Perception scores survivor 7 `immediate`; it is `unassigned`, so `escalation_timer` level 1 is armed (`since = now`).
2. The orchestrator calls `propose_assignment(7, R1, ...)` (R1 may already hold other active assignments): assignment `proposed`, `lease_timer` `proposal` armed, a `review` task posted to the auditor.
3. R1's glasses see the row in `my_assignment` and show the prompt; a ring tap calls `accept_assignment`: assignment `active`, survivor `assigned`, escalation rows deleted, assignment lease and rescuer heartbeat armed.
4. Glasses heartbeats and positions renew both timers; the glasses service calls `start_en_route`, which moves the survivor to `en_route`.
5. If R1's glasses session closes, `clientDisconnected` arms a 2 s grace row; when it fires, the assignment is released, survivor 7 is `unassigned`, escalation is re-armed, and the orchestrator (or the watchdog) proposes someone else.
6. R1 calls `mark_reached` and then `resolve_survivor(7, rescued, ...)`.

## 10. Who was in the building: person reports and accounting

The module stores person reports and keeps the per-cell summary on `search_cell`, so every client shows the same numbers.
There are no occupancy estimates, so a cell with no reports shows only what was found.
For each cell, `recomputeCell(ctx, cell_id)` sets:
- `found` = survivors with this `cell_id` (index lookup) that are not resolved as `false_alarm` or `duplicate`.
- `reported_missing` = the sum of `count` over the cell's `person_report` rows of kind `missing` (index lookup on `cell_id`); `reported_safe` = the same for kind `safe`.
- `unaccounted` = `max(0, reported_missing - found - reported_safe)` (contract).

`report_detection` (new survivor), `resolve_survivor` (`false_alarm` or `duplicate`), and `report_person` call it in the same transaction.
When `unaccounted` goes up, it writes an `unaccounted` event, which wakes the orchestrator to plan a re-search.
A cell is never shown as empty; upper floors the robot cannot reach stay `unsearched` or `partially_searched`.

## 11. Per-glasses visibility

### 11.1 What the current version supports (checked 2026-11-07, 2.14.1)

- Views: supported and recommended by the docs for access control (https://spacetimedb.com/docs/functions/views, https://spacetimedb.com/docs/tables/access-permissions/).
  A per-user view keyed on `ctx.sender` returned different rows for two identities over HTTP SQL (tested), and `spacetime subscribe` accepted a view with a `WHERE` on a string column (tested).
- Row-level security: `spacetimedb.clientVisibilityFilter.sql(...)` worked for an owner-column rule in TypeScript (tested), but the docs call it "an experimental, unstable feature" and say to use views instead (https://spacetimedb.com/docs/how-to/rls).
  RLS rules are SQL, and SQL cannot compare enum columns (tested), so a rule like "coordinators see everything" cannot read `participant.role`.

### 11.2 Design: views

Each glasses session already holds its own connection with the rescuer's identity, so the glasses service subscribes only to these views:

| View | Returns | Built from |
| --- | --- | --- |
| `my_assignment` | the caller's assignments | `assignment.rescuer_identity.filter(ctx.sender)` (tested pattern) |
| `my_briefing` | briefings for `all` plus the caller's hex | two `briefing.audience.filter(...)` calls (tested pattern) |
| `my_survivor` | survivors of the caller's `proposed` and `active` assignments | `assignment.rescuer_identity.filter`, then `survivor.id.find` (same pattern, not run) |
| `critical_open` | survivors with `critical_level = immediate` that are not resolved; the glasses show the row count | anonymous view, `survivor.critical_level.filter({ tag: 'immediate' })` (an enum index filter was tested once in a multi-column index; this single-column use is not run) |

```ts
export const my_assignment = spacetimedb.view(
  { name: 'my_assignment', public: true },
  t.array(assignment.rowType),
  ctx => Array.from(ctx.db.assignment.rescuer_identity.filter(ctx.sender))
);
export const my_briefing = spacetimedb.view(
  { name: 'my_briefing', public: true },
  t.array(briefing.rowType),
  ctx => [...ctx.db.briefing.audience.filter('all'), ...ctx.db.briefing.audience.filter(ctx.sender.toHexString())]
);
```

Views use only indexed lookups, as the docs require.
`my_briefing` grows with the run; the glasses service reads only the newest rows.
Base tables stay public, because the dashboard and the agents need them; the views limit what each glasses session receives, but they are not secrecy against a modified client.
That is acceptable for the demo; no contact data or personal data is stored.

### 11.3 Fallbacks

1. If a view fails to publish or update: the glasses service subscribes to `assignment` and `SELECT * FROM briefing WHERE audience = 'all'` plus `... WHERE audience = '<own hex>'` (string filters, tested) and filters assignments by identity in its own code.
2. If `critical_open` misbehaves: subscribe to `survivor` and count in the service.
3. RLS is not used; if real secrecy is needed later, make base tables private and expose views for every client, including the dashboard.

## 12. HTTP API for the robot (direct path, test first)

The contract keeps the Node.js bridge as the plan; this path is an option to test.

| Item | Value | Status |
| --- | --- | --- |
| Get a token | `curl -X POST <server>/v1/identity` returns `{"identity","token"}`; register once with `register_participant(["dog1",{"robot":[]}])` (needs demo mode or a grant) | tested |
| Call | `POST <server>/v1/database/hackutd-rubble/call/robot_heartbeat`, header `Authorization: Bearer <token>`, `Content-Type: application/json`, body `["dog1",{"READY":[]},{"some":87},{"none":[]}]` | tested shape (with a test reducer) |
| Results | 200 ok; 530 with the `SenderError` text; 400 bad arguments; 404 unknown or private reducer | tested |
| Enum spelling | exactly the contract value (`SAFE_STOP`) because of `CaseConversionPolicy.None` | tested |
| Lifecycle | each request runs `clientConnected` and `clientDisconnected`; `ROBOT_DISCONNECT_GRACE_S` (5 s) keeps a robot calling at 1 Hz online | tested (lifecycle), grace logic not yet run |
| Missions | no subscription over HTTP; poll `POST /v1/database/<db>/sql` with `SELECT * FROM mission WHERE robot_id = 'dog1'` once per second; the JSON shape is `[{"schema":{"elements":[...]},"rows":[[...]]}]` | tested (SQL shape) |
| `observed_at` | JSON form of a `Timestamp` argument | NOT CONFIRMED |
| Tokens | per server; keep the Maincloud and local tokens apart | assumed |

Test steps: publish to the local test server, get a token, register `dog1`, send `robot_heartbeat` with `curl` from the Pi, then from the C++ program with libcurl, measure the round trip on the venue Wi-Fi, and only then decide.
If the round trip is over about 200 ms or calls fail, keep the bridge.

## 13. Headline metric: "Critical survivors unattended over 60 s"

Definition: a survivor is unattended while it is `immediate` and `unassigned` (a pending proposal does not count as attended, since nobody has acknowledged it).
Every such survivor has exactly one `escalation_timer` row (level 1 or 2), and its `since` column is the start of the unattended period (the later of becoming `immediate` and becoming `unassigned`); the sweep repairs missing rows.
The dashboard subscribes to `escalation_timer` and shows the count of rows with `now - since > 60 s`, redrawn every second.
Target: 0.
This works with every agent down, because escalation rows and the watchdog live in the module.

## 14. Recording and replay

- History tables (append-only): `event_log`, `detection`, `briefing`, `agent_action`, `person_report`, all with `run_id`.
- There are no separate track, terrain, or outcome tables.
- `agent_task` and `audit_flag` rows are updated in place, and each status change is also an `event_log` row, so replay rebuilds the board.
- `run_started` payload: `{"before":{},"after":{"run":{...},"snapshot":{"survivor":[...],"mission":[...],"assignment":[...],"robot":[...],"search_cell":[...],"device_status":[...],"agent_task":[...],"audit_flag":[...]}}}`.
  With 2500 cells this is a large string; the demo grid is far smaller.
- Replay (owned by `dashboard.md`): start from the snapshot, apply `event_log` rows with `created_at <= T` ordered by `(created_at, id)` (each `after` merges into the entity map), and read the agent hand-offs from `agent_action` and the finds from `detection` by `created_at`.
- Replay therefore shows survivors, assignments, agents, and robot state changes (including `terrain` class changes), but not smooth movement trails, because positions are never logged.

## 15. Invariants checklist

Each item has a test in section 18.

- [ ] No reducer deletes a `survivor`, and no reducer updates or deletes a history row.
- [ ] Only `setSurvivorStatus` writes `survivor.status`, and only the transitions in 5.3 succeed.
- [ ] Only `resolve_survivor` writes `resolved`, only from `reached`, and only for the assigned rescuer, a coordinator, or the commander.
- [ ] Agents, the auditor, the robot, perception, and the sim identity are rejected by every human-only reducer, even in demo mode.
- [ ] Only the orchestrator (among agents) can propose assignments; every orchestrator or watchdog proposal creates exactly one `review` task.
- [ ] No enum has a dead, deceased, or expectant value; every stored free text passes the death-word check.
- [ ] A survivor whose breathing is `not_detected` or `unknown` cannot be scored `minor`.
- [ ] A survivor is `assigned`, `en_route`, or `reached` if and only if exactly one `active` assignment points at it.
- [ ] A survivor has at most one open proposal, and a rescuer has at most one open proposal.
- [ ] Every `immediate`, `unassigned` survivor has exactly one `escalation_timer` row within one sweep.
- [ ] Every `proposed` or `active` assignment, `leased` or `active` mission, and `claimed` task has a `lease_timer` row within one sweep.
- [ ] A rescuer whose glasses close loses the active assignment within `DISCONNECT_GRACE_S` plus 1 s; an HTTP call never releases anything.
- [ ] A robot that stops heartbeating is offline within 5 s, and its `searching` cells are `unsearched` at the same moment.
- [ ] A `partially_searched` cell is never treated as clear.
- [ ] With the orchestrator silent for `AGENT_WATCHDOG_S`, every unassigned `immediate` survivor gets a proposal for the nearest free rescuer, deterministically.
- [ ] Agent missions start `proposed` when approval is required.
- [ ] Two claims of one agent task: exactly one succeeds.
- [ ] At most one run is active; the sim can do nothing outside demo mode.
- [ ] No table holds media bytes.
- [ ] A robot can only write for its own `robot_id`.

## 16. Subscriptions per client

SQL filters only on `u64`, `string`, or `bool` columns (enum filters fail, tested).

| Client | Identity and role | Subscriptions |
| --- | --- | --- |
| Robot bridge | own token, `robot`, name `dog1` | `SELECT * FROM robot WHERE robot_id = 'dog1'`; `SELECT * FROM mission WHERE robot_id = 'dog1'` and `... WHERE robot_id = ''`; `SELECT * FROM detection WHERE robot_id = 'dog1'` (to learn `survivor_id` by `client_ref`); `SELECT * FROM site` |
| Orchestrator | `agent`, `orchestrator` | `survivor`, `search_cell`, `robot`, `device_status`, `mission`, `detection`, `assignment`, `participant`, `site`, `run`, `person_report`, `audit_flag`; `SELECT * FROM agent_task WHERE from_agent = 'orchestrator'` (results) and the `to_agent` tasks filtered in code; `SELECT * FROM event_log WHERE run_id = <active>` |
| Comms agent | `agent` | the tables they read (`agent.md`) plus `agent_task` filtered in code by `to_agent` |
| Auditor | `auditor` | every current-state table and `agent_task` |
| Dashboard | coordinator or commander token per browser | every current-state table, every public schedule table (countdowns), `agent_task`, `audit_flag`, `briefing`, `agent_action`, `SELECT * FROM event_log WHERE run_id = <active>` (the robot's latest terrain is on its `robot` row); replay queries by `run_id` |
| Glasses service | one connection per session, the rescuer's own token | `my_assignment`, `my_briefing`, `my_survivor`, `critical_open`, `site`, `robot` (section 11) |
| Perception | `perception` | `survivor`, `detection` |
| Simulator | `sim`, plus one rescuer token per simulated rescuer | everything |

`to_agent` is an enum, so agents filter it in code.
Keep each token in that component's `.env` (`STDB_TOKEN_CLOUD`, `STDB_TOKEN_LOCAL`), git-ignored.

## 17. Demo mode

Demo mode is on while any `site` has `demo_mode = true`, created by the sim with coordinates from `backend/sim/` config and the demo timings of section 2.1.
In demo mode the sim may call every reducer that lists coordinator, robot (for `robot_id` values starting with `sim`), perception, or agent.
It may not call the human-only reducers as the sim identity; it creates one identity per simulated rescuer (`POST /v1/identity`), registers each as `rescuer`, and acts through them, so the rescue rules run the same code path.
It may not create a non-demo site or turn off a real site's demo flag.

## 18. Test plan

### 18.1 Build and type check

```bash
cd backend/spacetimedb && npx tsc --noEmit -p . && spacetime build
```

### 18.2 Smoke test script (`test/smoke.sh`)

Runs against an in-memory local server; uses one HTTP token per role; the CLI identity is the owner and can call scheduled reducers.

```bash
#!/usr/bin/env bash
set -euo pipefail
S=http://127.0.0.1:3917; DB=rubble-test; HERE=$(cd "$(dirname "$0")/.." && pwd)
spacetime start --in-memory --listen-addr 127.0.0.1:3917 > /tmp/stdb-test.log 2>&1 &
SRV=$!; trap 'kill $SRV' EXIT
until curl -s -o /dev/null $S/v1/ping; do sleep 0.5; done
spacetime publish $DB -p "$HERE" --server $S --yes

newid() { curl -s -X POST $S/v1/identity; }   # keep identity and token from ONE call
call() { curl -s -o /tmp/body -w '%{http_code}' -X POST "$S/v1/database/$DB/call/$2" \
  -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
ok()   { [ "$(call "$@")" = 200 ] || { echo "FAIL ok $2: $(cat /tmp/body)"; exit 1; }; }
fail() { [ "$(call "$@")" != 200 ] || { echo "FAIL expected error $2"; exit 1; }; }
sql()  { curl -s -X POST "$S/v1/database/$DB/sql" -H "Authorization: Bearer $1" -d "$2"; }  # [{"schema":..,"rows":[[..]]}]
```

Use `set_site_timings` to shorten timers to 5 s in tests; without it, the demo timings make the script take about 4 minutes.

Scenarios, in order:

1. Bootstrap and roles: sim registers at bootstrap; `create_site(..., false, ...)` by sim fails; with `true` ok; grid ok; register robot `dog1`, `orchestrator`, `comms_agent`, `auditor`, perception, coordinator, commander, rescuers R1 and R2; a second online `orchestrator` fails.
2. Enum spelling: `robot_heartbeat` with `{"SAFE_STOP":[]}` ok and `{"safeStop":[]}` fails (case policy check).
3. Robot path: heartbeat creates the row and a `heartbeat_timer` row; wrong role and wrong name fail; `report_terrain` with `debris` twice sets the robot's terrain fields and writes one `terrain` event, then `flat` writes a second.
4. Detection: P merges at P + 2 m; P + 7 m creates a survivor with `possible_duplicate_of`; P + 20 m creates a new one; low confidence stores a detection with `survivor_id = 0`.
   `clear_possible_duplicate` on the P + 7 m survivor by an agent fails; by the coordinator it sets `possible_duplicate_of` to 0 and writes one `possible_duplicate_cleared` event; a second call fails, and `resolve_survivor` as `duplicate` on it now fails.
5. Perception and death words: `not_detected` plus `minor` fails; reason "likely dead" fails; `immediate` ok and an `escalation_timer` row appears.
6. State machine: `resolve_survivor` on `unassigned` fails; `mark_reached` without an assignment fails; full path propose, accept, position (`en_route`), reached, resolved ok; another resolve fails.
7. Proposal and review: orchestrator proposes: assignment `proposed`, survivor still `unassigned`, one `review` task to `auditor` with a `chain_id`; `comms_agent` proposing fails; auditor completes with `disagree`: one `proposal_disagree` flag with `filed_by = auditor`, and with `flag_kind = load_imbalance`, one `load_imbalance` flag instead; proposal not accepted in time: `released` (cause `expired`), event `assignment_expired`; R2 holding one active assignment can still be proposed.
8. Assignment lease and heartbeat: R1 accepts, sends heartbeats every 2 s (still active), stops: released at the heartbeat timeout, survivor `unassigned`, escalation re-armed.
9. Disconnect: R1 makes 10 HTTP calls in a row while holding an active assignment: still active (HTTP churn ignored).
   Then the owner identity registers as a rescuer, accepts an assignment, holds `spacetime subscribe` open, and kills it: released within 3 s, event `rescuer_offline`.
10. Robot offline: robot leases a mission, cells `searching`; stop heartbeats: offline within 5 s, cells `unsearched` with `cell_reopened`; the mission requeues at its lease.
11. Partially searched: robot marks a cell `partially_searched`; `claim_next_mission` leases a mission containing it again.
12. Escalation: an `immediate` survivor left unassigned gets a `critical` briefing to `all` at N and to `commander` at 2N; accepting an assignment deletes the rows.
13. Watchdog: no orchestrator calls for `AGENT_WATCHDOG_S`; two unassigned `immediate` survivors and two free rescuers at known distances: each gets the nearest, events `agent_watchdog_fallback`, `agent_action` rows with `model = rules`; run twice from the same state: same result.
14. Agent tasks: post, two claims (one fails), lease expiry back to `open`, third expiry `expired`; a non-addressed agent claim fails.
15. Person reports: a `missing` report of 2 from `family` and one found: `unaccounted` event with count 1; a `safe` report of 1 brings it to 0.
16. Sweep repair: the owner deletes a `lease_timer` row; within 10 s the sweep re-creates it or releases the expired assignment.
17. Views: R1 and R2 each see only their own rows in `my_assignment` and `my_briefing` over HTTP SQL.
18. Runs: `start_run` writes the snapshot in `run_started`; `end_run` sets `ended_at`; a second `start_run` while one is active fails.
19. Append-only: counts of history tables and `survivor` only grow.
20. Non-demo mode (fresh publish): the sim cannot act; a new identity cannot register as `agent` without a grant.

### 18.3 Maincloud check

After publishing to Maincloud, run scenarios 1 to 5 with throwaway tokens, then republish with `--delete-data=always` before judging.
Follow logs with `spacetime logs hackutd-rubble --server maincloud -f`.

## 19. Showcase for SpacetimeDB judges

1. The module is the whole backend: one TypeScript module, N tables, M reducers, 5 schedule tables, 4 views, no other server (count with `spacetime describe hackutd-rubble --json`).
2. Every timer on screen: the dashboard's countdowns are rows in schedule tables; a renewal jumps a countdown back live.
3. Rules in reducers: the agent tries `resolve_survivor` and the module refuses; the survivor state machine rejects a skipped step.
4. Lease-based job queues: the robot's missions and the agents' `agent_task` board; kill an agent mid-task and its task returns to `open` at the lease.
5. Lifecycle: close a rescuer's glasses session and their survivor is back on the board in about 2 s.
6. Watchdog: stop every agent; the module proposes the nearest free rescuer, and the headline stays at 0.
7. Live subscriptions and per-rescuer views: two laptops and the glasses update together; each glasses session sees only its own task.
8. Replay from `event_log` (survivors, assignments, agents, and robot state, without movement trails), and honest data: "no signs of life detected, low confidence", never a dead label.

Give measured seconds (lease expiry, disconnect release, watchdog fallback), as skyFall did.

## 20. Build order

About 16 hours are left; the module needs about 12.
The order follows "Priority by sponsor track" in `docs/MVP.md`: the SpacetimeDB guarantees first (survivor states, leases, escalation, watchdog), then the agent hand-off board, then the robot's find and breathing path, then the glasses views.
Steps 1 and 2 come first because every other component waits on the bindings.
Step 5 is the smallest robot path that creates survivors, so the assignment rules can be tested before the rest of the robot reducers exist.
Steps marked "cut" can be dropped if time runs short.

| Step | Work | Hours |
| --- | --- | --- |
| 1 | Init, case policy, publish an empty module to local and Maincloud, generate bindings, push | 0.5 |
| 2 | `schema.ts`: every enum, table, schedule table, private table; publish; generate bindings; tell other teams | 1.0 |
| 3 | `lib/`: auth (roles, per-agent rules), events (diff payload), text, geo, `setSurvivorStatus`, timer helpers | 1.25 |
| 4 | Lifecycle reducers with presence and disconnect grace; `register_participant`, `grant_role`, site and grid reducers | 1.0 |
| 5 | Survivors: `robot_heartbeat` with its timer, `report_detection` with merge and duplicates, `report_breathing`, `set_critical_score` | 0.75 |
| 6 | Assignments: propose (with review task), accept, release, reached, resolve, heartbeats, leases, escalation levels 1 and 2 | 1.5 |
| 7 | Agents: `agent_task` reducers and leases, audit flags with `proposal_disagree`, `log_agent_action`, `post_briefing`, watchdog fallback | 1.25 |
| 8 | Sweep with repairs; runs and the `run_started` snapshot | 0.5 |
| 9 | Rest of the robot path: position, device, `report_terrain` (latest fields and `terrain` event); missions (create, approve, cancel, claim with unaccounted-first order, progress, mission leases) | 1.0 |
| 10 | Views (`my_assignment`, `my_briefing`, `my_survivor`, `critical_open`) | 0.5 |
| 11 | `report_person`, the cell summary columns, and the `unaccounted` event (cut: keep the reducer and columns, drop the event) | 0.25 |
| 12 | `test/smoke.sh` scenarios, fix bugs | 1.5 |
| 13 | HTTP robot path test on the Pi (cut: keep the bridge) | 0.25 |
| 14 | Maincloud deploy, local fallback rehearsal on Laptop A, final `--delete-data` publish | 0.5 |

Total about 11.75 hours.

## 21. Proposed contract changes

Proposed contract changes: none open (merged into CONTRACTS.md version 8).
