# Cayden: glasses, plus the extra work

Owner of the Even Realities G2 glasses.
PROPOSED owner of the extra work: accounts, design tokens and design control, the SpacetimeDB module and contracts, the dashboard, the simulator, integration lead, slides, the demo video and Devpost, and rehearsals.
Event: HackUTD, Nov 7-8 2026.
Submission and judging times: TBD, not recorded in the docs; confirm with the organizers and write the clock times into the phase table in `docs/TASKS.md`.
Specs: `docs/specs/glasses.md`, `docs/specs/spacetimedb.md`, `docs/specs/dashboard.md`, `docs/specs/demo.md`, `docs/specs/CONTRACTS.md`, `docs/DESIGN.md`, `docs/research/g2-glasses.md`.
Overview and checkpoints: `docs/TASKS.md`.
Total with AI: about 17.5 h (each task 1 to 2 h with coding agents; hardware tasks are bench time, not typing).
This is the largest list; hand the simulator or the dashboard to whoever finishes first.
See "What to hand off if overloaded" near the end.

## How to read this list

Each task has: goal, why it matters, the estimate, inputs, outputs and who uses them, files and commands, a step checklist (10 to 20 minutes per step), "Done when" tests, a prompt for your coding agent, and pitfalls.
Step ids (for example `C1.2`) are for the team chat ("C1.2 done, bindings v1 pushed").
Items marked UNCONFIRMED are not verified by a spec or a test; check them once and fix this file.

### Which document wins

1. `docs/MVP.md` (FINAL scope, sponsor priority, frontend look) and `docs/AGENT_WORKFLOW.md`.
2. `docs/specs/CONTRACTS.md`, FINAL version 8 (one clean document; it changes only by a team decision).
3. `docs/specs/spacetimedb.md` for every reducer argument list (CONTRACTS.md version 8 says so).
4. The other component specs; follow 1 to 3 where they differ.

### Current facts (2026-11-07)

- SpacetimeDB is the whole backend and a sponsor track: Maincloud credit code `HACKUTD2026` (one per GitHub account), `CaseConversionPolicy.None`, views for per-glasses visibility, and a 2 s disconnect grace instead of an instant release.
- Three agents: orchestrator, auditor, comms agent (Eric owns them); they talk only through the `agent_task` board.
- One Agents panel on the dashboard: agent status, task board, action log, and the chain per survivor.
- Gone from scope: the search agent (`robot_agent`), beacon missions, the drone, robot audio (microphone and speaker), outcomes, occupancy estimates, the track and terrain history tables, and the stale-area timer.
- Glasses: map when the target is more than 60 m away, arrow under 40 m, arrived at 5 m; Esri keyless tiles (`esri-dark`); the arrow is north-up.
- The demo is indoors with fixed coordinates from `backend/sim/demo-site.json`; real GPS only in the video.
- Slides, the dashboard, the fallback page, and the video graphics all follow design control in `docs/DESIGN.md`.

### Build status (2026-11-08)

- Module (C1): every reducer and view in `CONTRACTS.md` exists, and the bindings regenerate with no diff.
  `npm test` passes 62 smoke checks, including one that each escalation level fires once per unattended period (a sweep bug that re-fired the commander escalation every 10 s was fixed on 2026-11-08).
  Still open: smoke coverage of `spacetimedb.md` 18.2 scenarios 3, 4, 7, 8, 16, 18, and 20, and the negative cases in 1, 5, 6, and 14.
- Maincloud: database `assess-0hw81`, owned by Cayden's `spacetime login`, published 2026-11-08 from branch `codex/cayden-workstreams-2026-11-07`; scenarios 1 to 5 passed there, then it was republished with `--delete-data=always` and is empty.
- Simulator (C3): `npm test` passes 20 tests; live `timeline` runs are implemented for `e2e`, `judge`, and `video` (the `stress` timeline has not been run: it needs 120 rescuers and status sampling).
  The demo site is 7716 Worthing St, Dallas TX 75252 (house 3), with houses on real OSM building footprints and 15 m cells.
- Glasses service (G2): `npm test` passes 47 tests.
  Checked live against a local server: a proposal reaches the glasses, accept moves the survivor to `assigned`, and closing the glasses socket releases the assignment.
- Glasses plugin (G3): `npm test` passes 26 tests; every check on the real G2 is still HUMAN-ONLY.
- Dashboard (C2): `npm test` passes 30 tests; the Playwright specs are not written.
- Agents and perception (Eric): merged locally from `team/eric` into `integration/eric-agents` with 15 integration fixes; the chain (orchestrator proposes, auditor reviews once, comms agent briefs, an idle robot gets a search mission) ran live against the module with `LLM_MODE=mock`, not yet with a real Nemotron key.
- Robot: the program foundation (state machine, safety gate, threads, mocks) is in `raspberrypi/robot/` (task R1); the bridge to SpacetimeDB and the Pico firmware are not pushed yet, so the sim robot stands in.
- Judged demo (decision 2026-11-08): hard-coded.
  Only SpacetimeDB runs live; the simulator scripts the robot (`sim-dog`), the find, the breathing result and critical score, and any rescuer actions.
  The agents, perception, the real robot, and the real G2 hardware are not live in the judged demo; they are tested separately (agents 109 tests, 8 scenarios, and the Brev validation in `docs/notes/2026-11-08-brev-validation.md`; perception 753 tests).
  The sim has a new command `search <house>` (short `sr`) and a new timeline `timelines/demo.json`; `npm run sim -- timeline demo` was verified live on a local server (found at 0:14 with no fallback).
  The run of show is `docs/specs/demo.md`, "Judged demo (hard-coded, 2026-11-08)".
  The sim crew is minimal (`demo-site.json`, 2026-11-08): two robot dogs (`sim-dog`, `sim-dog-2`), Cayden plus R1 (sim), and `extra_sim_rescuers` 0, so the `scale 300` and `stress` runs would need extra helper rescuers.

### Known mismatches between specs (resolve in C4, announce the result)

No open mismatches remain (2026-11-07).

Resolved by version 8 and 8.1 (no longer open):

- Tokens file: one shared file, `frontend/design-tokens/tokens.css` (CONTRACTS.md "Conventions"); the dashboard imports it.
- Database env vars: `STDB_URI`, `STDB_DATABASE`, `STDB_TOKEN` everywhere; browser apps (dashboard, glasses fallback page) use the Vite-prefixed `VITE_STDB_URI` and `VITE_STDB_DATABASE`.
- Critical count view: the Views table in CONTRACTS.md names it `critical_open`, and `glasses.md` uses that name.
- `start_en_route(assignment_id)`: in the Reducers table and `spacetimedb.md` section 8.6; the glasses service calls it once after acceptance, and position updates do not move a survivor to `en_route`.
- `rescuer_ask(text, audio_url, survivor_id)`: in the Reducers table and `spacetimedb.md` section 8.7 (voice questions are still cut item 3 in `docs/AGENT_WORKFLOW.md`).
- `set_site_timings`: 5 arguments in the Reducers table and `spacetimedb.md` section 8.2; the watchdog and task lease stay module constants.
- Watchdog in demo mode: 15 s in the Timers section of CONTRACTS.md, `spacetimedb.md` section 2.2, and `demo.md`.
- Task event kinds: `agent_task_done` (done or failed) in CONTRACTS.md, `spacetimedb.md`, and `dashboard.md`.
- Review verdict: `agree` or `disagree` in the `agent_task` kinds table; `dashboard.md` shows AGREE or DISAGREE.
- `briefing.kind`: optional in the `briefing` table, `spacetimedb.md` section 4.2, and the `post_briefing` reducer.

### Ports and names

| Thing | Value |
| --- | --- |
| Maincloud database | `assess-0hw81` at `https://maincloud.spacetimedb.com` (published and checked 2026-11-08; dashboard https://spacetimedb.com/assess-0hw81) |
| Local fallback server | `spacetime start --listen-addr 0.0.0.0:3000` on Laptop A, clients use `ws://<laptop-a-ip>:3000` |
| Test server | `http://127.0.0.1:3917`, database `rubble-test` |
| Glasses service | `0.0.0.0:8787` (`/glasses`, `/view`, `/phone`, `/healthz`) |
| Glasses plugin dev server | Vite on `0.0.0.0:5173` (also serves `fallback.html`, `phone.html`); phone HTTPS mode on 5174 |
| Even Hub simulator automation | `--automation-port 9898` |
| Dashboard | Vite on `0.0.0.0:5180` |
| Perception and media server | `http://localhost:8080` (Eric) |

## Suggested order

The order follows "Priority by sponsor track" in `docs/MVP.md`: the module and its guarantees first, then the agent hand-off chain (Eric, shown on your dashboard), then the robot's find, then the glasses.

1. Start here (C0, the C1 skeleton, D1 started).
2. C1 to checkpoint 1 (full module and bindings).
3. C3 setup and scale (data on the board for Eric and for your own UI work).
4. C2 live board and Agents panel.
5. G1, then G2, then G3.
6. C4 checkpoints 2 to 4.
7. C5, C6, C7.

## Start here: the first hour

Goal: by minute 60, every teammate can pull bindings for a published module and start writing against it.

| Minute | You | Your coding agent |
| --- | --- | --- |
| 0 to 15 | C0.1 and C0.2: SpacetimeDB login and credit, Even app developer section | C0.3: repo folders and `.gitignore` |
| 15 to 40 | D1.1 and D1.2: Figma variables (light, dark, status, agents, glasses green) | C1.1 and C1.2: init, case policy, enums, the 10 core tables, publish locally |
| 40 to 50 | Review `schema.ts` against `spacetimedb.md` section 4 (names, types, indexes) | publish to Maincloud, generate bindings, commit |
| 50 to 60 | Push, post the announcement below, confirm Eric, Camille, and Matthew can pull | start C1.3 (remaining tables) |

- [ ] S1 (15 min) Accounts done: `spacetime login show` prints your identity, `HACKUTD2026` redeemed, "Scan QR" visible in the Even app.
- [x] S2 (10 min) Agent has created the folders from `CONTRACTS.md` "Components and where their code lives" and pushed.
- [x] S3 (25 min) Skeleton published locally and to Maincloud with every enum from `spacetimedb.md` section 3 and these core tables: `participant`, `site`, `search_cell`, `robot`, `detection`, `survivor`, `assignment`, `briefing`, `agent_task`, `event_log`, plus `register_participant`.
- [ ] S4 (10 min) Bindings in `backend/spacetimedb-bindings/` committed and pushed; announcement posted.

Status (2026-11-08): the full module is published to Maincloud as `assess-0hw81`, and the bindings are on the team `main`.
S1 waits on two human checks (the `HACKUTD2026` credit and "Scan QR" in the Even app), and S4 waits on posting the announcement below.

Announcement to paste in the team chat (fill the laptop IP):

```text
SpacetimeDB module is up on Maincloud: every table, reducer, and view in CONTRACTS.md.
Maincloud: STDB_URI=https://maincloud.spacetimedb.com, STDB_DATABASE=assess-0hw81 (dashboard https://spacetimedb.com/assess-0hw81).
Local fallback: ws://<laptop-a-ip>:3000, same database name.
Bindings: backend/spacetimedb-bindings/ on main. Import from there; do not run spacetime generate yourself.
The database is empty after the last --delete-data publish; run npm run sim -- setup in backend/sim to create the demo site.
Enum values on the wire are spelled exactly as in CONTRACTS.md (CaseConversionPolicy.None). In the TS bindings, fields are camelCase and enum keys PascalCase; map tags in one helper and check it once against a live row.
SQL cannot filter on enum columns; filter enums in your code.
Expect another --delete-data wipe before judging. Keep tokens in your .env, never in git (the repo is public).
```

## Hand-offs by checkpoint

What everyone waits on from Cayden, and what Cayden waits on in return.

| Checkpoint | Cayden delivers | Who waits | Cayden needs back |
| --- | --- | --- | --- |
| 0. Setup | Published skeleton and bindings v1 (S3, S4); database name and both URIs; `frontend/design-tokens/tokens.css` and the Figma link (D1) | everyone; tokens matter to Cayden's own UIs and the slides | Eric: Nemotron tool-call smoke test result (or the JSON fallback chosen) |
| 1. Module and mocks | Full module (C1): robot reducers for Camille's bridge (`robot_heartbeat`, `robot_report_position`, `report_detection`, `claim_next_mission`, `mission_progress`, `report_terrain`, `mark_cell`); perception reducers for Eric (`report_breathing`, `set_critical_score`); agent reducers for Eric (`post_agent_task`, `claim_agent_task`, `complete_agent_task`, `agent_heartbeat`, `log_agent_action`, `propose_assignment`, `file_audit_flag`, `post_briefing`); the four views; `backend/sim/demo-site.json` (C3.1, the bridge reads `demo_anchor`) | Camille, Eric | Camille: bridge heartbeat from the laptop mock reaches the module |
| 2. Whole flow, no robot | Simulator `setup`, `scale`, `rescuers`, `spawn`, failures (C3); dashboard live board and Agents panel (C2); fallback glasses page (G1) | Eric (agents need survivors and rescuers to act on), the team (to see the flow) | Eric: perception scores a sim detection; orchestrator proposes; auditor reviews; comms briefs |
| 3. Robot on the board | Dashboard robot health and map marker; mission approval on the dashboard; checkpoint run lead (C4) | Camille, Matthew | Camille and Matthew: real robot heartbeats, a scripted path, a real breathing clip |
| 4. End to end | Real G2 plugin (G3) and glasses service (G2) against live data; replay working; measured seconds for the slides | everyone | everyone: their part running at the same time |
| 5. Demo ready | Slides (C5), video and Devpost (C6), rehearsal runs (C7), `demo.json` timeline for judging (`judge.json` superseded for judging on 2026-11-08) | everyone | Matthew: outdoor and robot footage (his M8); every owner: one fallback each tried in rehearsal |

## Phase 0: setup

### C0. Accounts and repo

Goal: every account in `docs/TASKS.md` that Cayden owns works, and the team repo has the folders from `CONTRACTS.md`.
Why it matters: checkpoint 0; the SpacetimeDB track needs Maincloud and a public GitHub repo, and the glasses need Even Hub developer mode.
Estimate with AI: 0.5 h.

Inputs and dependencies:
- A GitHub account (the SpacetimeDB credit is one per GitHub account), the leaflet QR code with `HACKUTD2026`, your Even Realities app account, team repo access (https://github.com/matthewthomasbeck/HackUTD, public).

Outputs and who uses them:
- SpacetimeDB login (C1 publishes with it).
- Even app developer section with "Scan QR" (G3).
- A Figma file, empty for now (D1, C2, C5).
- Repo folders and `.gitignore` (everyone).

Folders (from `CONTRACTS.md` and `docs/DESIGN.md`): `backend/spacetimedb/`, `backend/spacetimedb-bindings/`, `backend/glasses-service/`, `backend/sim/`, `frontend/glasses/`, `frontend/dashboard/`, `frontend/design-tokens/`.

Commands:

```bash
curl -sSf https://install.spacetimedb.com | sh
spacetime --version          # expect 2.14.x or newer 2.x
spacetime login              # opens a browser; GitHub-linked account
spacetime login show
node --version               # 22.13 or later (Even Hub CLI and SpacetimeDB Node clients)
```

Steps:
- [ ] C0.1 (10 min) Install the SpacetimeDB CLI, check the version, `spacetime login`, and redeem `HACKUTD2026` on the website from the leaflet QR code.
- [ ] C0.2 (10 min) Update the Even app to 2.2.10 or later, take any glasses firmware update, sign in at https://hub.evenrealities.com with the same account, force-quit and reopen the app, and confirm "Scan QR" appears.
  Write down whether the phone is iOS or Android (open question in `glasses.md` section 10).
- [x] C0.3 (10 min) Let the agent create the folders (with `.gitkeep`) and the `.gitignore` entries, then create the Figma file and post its link.

Done when: every account in `docs/TASKS.md` works for its owner.
- `spacetime login show` prints your identity, and the Maincloud credit shows on the website.
- The Even app shows the developer section with "Scan QR".
- The folder commit is on `main` and teammates can pull it.

Prompt for your coding agent:

```text
In the team repo (https://github.com/matthewthomasbeck/HackUTD), create these empty folders with a .gitkeep each: backend/spacetimedb/, backend/spacetimedb-bindings/, backend/glasses-service/, backend/sim/, frontend/glasses/, frontend/dashboard/, frontend/design-tokens/.
Do not touch the existing folders raspberrypi/, pico/, 3d_parts/, images/.
Add to the root .gitignore: .env, .env.local, **/.tokens/, backend/glasses-service/tiles/, node_modules/, dist/, spacetime.json, spacetime.local.json.
The repo is public, so never commit keys or tokens.
Do not sign in to any account, and do not run spacetime login or evenhub login; Cayden does all account steps.
Commit with the message "Add folders for module, bindings, glasses, sim, dashboard, design tokens" and push to a branch, then show me the diff.
```

Pitfalls and fixes:
- `cargo install spacetimedb-cli` installs an outdated 1.x crate; use the install script only.
- The credit is one per GitHub account; if your account already used it, redeem on a teammate's account and publish from there, or ask the SpacetimeDB mentors.
- Agents must never sign in to Even Hub, SpacetimeDB, or Figma for you.
- If "Scan QR" does not appear, force-quit the Even app again; there is no developer toggle.

### D1. Design tokens first (design control)

Goal: palette, type, spacing, and status colors (critical, delayed, unknown, resolved) as Figma variables, exported to one CSS variables file used by the dashboard, the glasses fallback page, and the slides.
Why it matters: design control rule 2 ("tokens before styling") in `docs/DESIGN.md`; one look across the product, the video, and the deck, which the Cal Hacks winners had ("one distinctive identity").
Estimate with AI: 1 h.

Inputs and dependencies:
- `docs/DESIGN.md` "Starting tokens".
- `docs/specs/dashboard.md` "Colors, shapes, and fonts (color-blind safe)" for the light and dark hex values (Okabe-Ito).
- `docs/specs/glasses.md` section 6 for the glasses green tint `rgb(0.25v, v, 0.45v)`.
- Structure reference only: `../Stochastic/docs/design/README.md` (one tint per agent, Components page, versioned UI pages).

Outputs and who uses them:
- Figma file with a Variables collection (modes light and dark), a Components page, and empty frames: dashboard 1920x1080, Agents panel 1920x1080, the seven glasses layouts at 576x288, slides 1920x1080 (C2, G1, C5).
- `frontend/design-tokens/tokens.css` (C2 dashboard, G1 fallback page, C5 slides).
- The Figma link in `docs/DESIGN.md` where it says "Link it here once it exists: `TBD`".

Starting values (token names below are proposed here; only `--crit-*` come from a spec):

| Token | Light | Dark | Source |
| --- | --- | --- | --- |
| `--crit-immediate` | `#D55E00` | `#E66100` | `dashboard.md` |
| `--crit-delayed` | `#F0E442` with a `#5C5300` outline | `#F0E442` | `dashboard.md` |
| `--crit-minor` | `#0072B2` | `#56B4E9` | `dashboard.md` |
| `--crit-unknown` | `#6B7280` | `#A7B0BA` | `dashboard.md` |
| `--status-resolved` | muted green, TBD (the searched green `#009E73` is one option) | TBD | `DESIGN.md` |
| `--bg`, `--panel`, `--text`, `--text-muted`, `--border` | `#F7F8FA`, `#FFFFFF`, `#111827`, `#4B5563`, `#D1D5DB` | `#0B0F14`, `#121821`, `#E8EDF2`, `#9AA6B2`, `#2A3441` | `dashboard.md` |
| `--robot`, `--rescuer` | `#111827`, `#CC79A7` | `#FFFFFF`, `#CC79A7` | `dashboard.md` |
| `--cell-searched`, `--cell-partial` | `#009E73`, `#E69F00` | same | `dashboard.md` |
| `--agent-orchestrator`, `--agent-auditor`, `--agent-comms` | TBD, one tint each, distinct from the `--crit-*` colors | TBD | `DESIGN.md` |
| `--glasses-green` | approximate G2 green, adjust by eye against a photo of the lens | same | `glasses.md` section 6 |
| `--font-ui` | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | same | `dashboard.md` (no web font download) |
| `--font-mono` | a system monospace stack, TBD | same | `DESIGN.md` ("one mono for numbers and ids") |
| Type sizes | 18 px minimum, 22 px list rows, 28 px screen label, 32 px headline, 44 px big numbers, 64 px commander headline | same | `dashboard.md` |
| Spacing and radii | TBD scale (for example 4, 8, 12, 16, 24, 32 px); 12 px corners for evidence cards | same | `DESIGN.md` references |

Steps:
- [x] D1.1 (15 min) Create the Variables collection with modes light and dark, and enter the color values above.
- [x] D1.2 (15 min) Add type, spacing, radius, agent tint, and glasses green variables; check every text and badge pair for 4.5:1 contrast (3:1 for bold 18.66 px or larger); white on `#D55E00` passes only as bold 18.66 px or larger.
- [x] D1.3 (15 min) Export to `frontend/design-tokens/tokens.css`: light values on `:root`, dark values on `[data-theme="dark"]`, and an explicit `body` background in both.
  Your agent can read the variables with the Figma MCP `get_variable_defs`, or you paste them; Figma has no built-in CSS export that this list relies on (UNCONFIRMED which export path is fastest).
- [x] D1.4 (15 min) Add stub components (survivor card, status chip, agent chip, countdown, map marker, task-board row, button) and the empty frames; link the file in `docs/DESIGN.md`; post the link.

Done when: the tokens file is in `frontend/design-tokens/` and `docs/DESIGN.md` links the Figma file.
- Every color pair in the file passes the contrast rule above.
- Every status token has a matching text label in the component stubs (rule 6, "status is never color only").

Prompt for your coding agent:

```text
Create frontend/design-tokens/tokens.css for the HackUTD rubble search project.
Read docs/DESIGN.md ("Design control: the rules" and "Starting tokens") and docs/specs/dashboard.md ("Colors, shapes, and fonts (color-blind safe)" and "Light theme, with a dark option").
Put light values on :root and dark values on [data-theme="dark"], and set an explicit body background and color-scheme in both.
Use these variable names: --crit-immediate, --crit-delayed, --crit-delayed-outline, --crit-minor, --crit-unknown, --status-resolved, --bg, --panel, --text, --text-muted, --border, --robot, --rescuer, --cell-searched, --cell-partial, --agent-orchestrator, --agent-auditor, --agent-comms, --glasses-green, --font-ui, --font-mono, --fs-min, --fs-row, --fs-label, --fs-headline, --fs-big, --fs-commander, plus a --space-* and --radius-* scale.
Take hex values only from dashboard.md; where this prompt says TBD (resolved, agent tints, mono font), insert the values I paste below, or leave a clearly marked TODO comment.
No web fonts.
Then write a tiny script frontend/design-tokens/check-contrast.mjs that computes WCAG 2.2 contrast for each text and background pair listed in dashboard.md and prints pass or fail.
Do not edit any other file.
```

Pitfalls and fixes:
- `docs/DESIGN.md` allows the design owner to change the tokens once; after that, a token change is a team decision, because three surfaces depend on it.
- The lens itself has no colors: the G2 shows 16 levels of green, and black is see-through; `--glasses-green` is only for the fallback page, the video, and the slides.
- Projector light washes out dark themes; the dashboard defaults to light.

## Phase 1: build

### C1. SpacetimeDB module (first, unblocks everyone)

Goal: core tables and reducers first (participant, site, search_cell, robot, detection, survivor, assignment, briefing, agent_task, event_log), then schedule tables (leases, heartbeats, escalation, watchdog), lifecycle reducers, and the rest of `CONTRACTS.md`; published locally and to Maincloud, with bindings in `backend/spacetimedb-bindings/`.
Why it matters: priority 1 for State Farm ("no one overlooked") and SpacetimeDB ("it is the backend"); demo beats 7 and 8 (two screens in sync, disconnect release, watchdog); the SpacetimeDB track requires that Spacetime powers the primary functionality.
Estimate with AI: 2 h.

Inputs and dependencies:
- C0 login and credit.
- `docs/specs/spacetimedb.md` sections 1 to 21 and `CONTRACTS.md` (FINAL, version 8).
- The tested scratch module from the spec (`spacetimedb.md` section 0 names its path in the session scratchpad); use it as a syntax reference if it still exists.

Outputs and who uses them:
- Bindings v1 (skeleton, S3) for everyone; then "bindings vN" after each schema or signature change, announced in the chat.
- Robot reducers (Camille's bridge), perception reducers and agent reducers (Eric), views `my_assignment`, `my_briefing`, `my_survivor`, `critical_open` (G2), public schedule tables with `due_at` (C2 countdowns), `run_started` snapshot (C2 replay), demo mode rules (C3).

Files (`spacetimedb.md` section 1.3):

```
backend/spacetimedb/
  src/index.ts        every exported reducer, lifecycle hook, scheduled reducer, and view
  src/schema.ts       enums, tables, schedule tables, schema({...}, { CASE_CONVERSION_POLICY: CaseConversionPolicy.None })
  src/config.ts       constants (section 2.2), not exported from index.ts
  src/lib/auth.ts, events.ts, state.ts, timers.ts, geo.ts, text.ts
  test/smoke.sh       section 18.2
```

Commands (from `spacetimedb.md` sections 1.2 to 1.6, run from the repo root unless noted):

```bash
# create (once)
cd backend && spacetime init tmp-init --lang typescript --server-only --non-interactive
mv tmp-init/spacetimedb ./spacetimedb && rm -rf tmp-init && cd spacetimedb && npm install

# build and type check
cd backend/spacetimedb && npx tsc --noEmit -p . && spacetime build

# local fallback server on Laptop A, then publish
spacetime start --listen-addr 0.0.0.0:3000
spacetime publish assess-0hw81 -p backend/spacetimedb --server local --yes

# Maincloud
spacetime publish assess-0hw81 -p backend/spacetimedb --server maincloud --yes

# breaking schema change (new column without .default(), type change)
spacetime publish assess-0hw81 -p backend/spacetimedb --server maincloud --delete-data=always --yes

# bindings (commit the output)
spacetime generate --lang typescript --out-dir backend/spacetimedb-bindings --module-path backend/spacetimedb

# logs, quick checks
spacetime logs assess-0hw81 --server maincloud -f
spacetime describe assess-0hw81 --json
spacetime sql assess-0hw81 "SELECT * FROM survivor" --server local

# smoke tests (in-memory server on 3917)
cd backend/spacetimedb && npm test
```

Config: per-site timings in `spacetimedb.md` section 2.1 (demo: mission lease 15 s, assignment 30 s, proposal 30 s, escalation 45 s); constants in section 2.2 (`RESCUER_HEARTBEAT_S` 15, `ROBOT_HEARTBEAT_S` 5, `DISCONNECT_GRACE_S` 2, `ROBOT_DISCONNECT_GRACE_S` 5, `AGENT_WATCHDOG_S` 30 or 15 in demo, `MERGE_RADIUS_M` 4, `DUPLICATE_RADIUS_M` 10, and the rest).

Steps:
- [x] C1.1 (15 min) Init the module (section 1.2), add the `package.json` scripts (section 1.6), set `CaseConversionPolicy.None`, publish an empty module locally and to Maincloud.
- [x] C1.2 (20 min) `schema.ts`: every enum (section 3) and the 10 core tables with their full columns and indexes (sections 4.1 and 4.2); add `register_participant` (section 8.1); publish both, generate bindings, push, post the announcement (S3, S4).
- [x] C1.3 (15 min) The remaining tables: `device_status`, `mission`, `run`, `audit_flag`, `agent_action`, `person_report`, the public schedule tables with `due_at` (section 4.3), the private tables (section 4.4); publish, regenerate, post "bindings v2".
- [x] C1.4 (15 min) `lib/`: roles and per-agent rules (5.1, 5.2), the survivor state machine (5.3), text and number checks with the death-word pattern (5.4), event log diff payloads (5.5), geometry (5.6), timer helpers (7.1).
  Review the transition table in 5.3 yourself; it is the "no one overlooked" core.
- [x] C1.5 (20 min) Lifecycle reducers with presence and the 2 s grace (section 6); participants, roles, site, cells (8.1, 8.2); robot path (8.3); perception (8.5); publish, post "bindings v3, robot and perception reducers ready" for Camille and Eric.
- [x] C1.6 (20 min) Assignments and the state machine (8.6), every timer (7.2), escalation levels 1 and 2, the watchdog fallback (7.4), the sweep (7.5).
- [x] C1.7 (15 min) Agent reducers (8.7), runs with the `run_started` snapshot (8.8, 14), the four views (11.2), `report_person` and the `unaccounted` event (10); publish, post "bindings v4, agent board and views ready".
- [ ] C1.8 (20 min) `test/smoke.sh` scenarios 1 to 20 (18.2); fix failures; Maincloud check (18.3); record the counts from `spacetime describe` for slide 8.

Status (2026-11-08): C1.1 to C1.7 are done, and the Maincloud check (scenarios 1 to 5, then `--delete-data=always`) passed.
C1.8 stays open: `npm test` passes 62 checks, but scenarios 3, 4, 7, 8, 16, 18, and 20 are missing or partial, the negative cases in 1, 5, 6, and 14 are missing or partial, and the `spacetime describe` counts for slide 8 are not recorded yet.

Done when: a skeleton with the core tables is published and announced (early), then the full test plan in `specs/spacetimedb.md` passes.
- `npx tsc --noEmit -p .` and `spacetime build` succeed with no errors.
- `npm test` runs all 20 smoke scenarios with no `FAIL` line, including: `{"SAFE_STOP":[]}` accepted and `{"safeStop":[]}` rejected (scenario 2), 10 HTTP calls do not release an assignment and a killed `spacetime subscribe` releases it within 3 s (scenario 9), the watchdog gives the same proposals twice from the same state (scenario 13), and R1 and R2 each see only their own rows in `my_assignment` (scenario 17).
- Scenarios 1 to 5 pass on Maincloud with throwaway tokens, and the module is republished with `--delete-data=always` before judging.
- Every invariant in section 15 has a passing scenario.

Prompt for your coding agent (skeleton, C1.1 and C1.2):

```text
Build the SpacetimeDB module skeleton for the HackUTD rubble search project in backend/spacetimedb/ (TypeScript, SpacetimeDB 2.14.x).
Read docs/specs/spacetimedb.md sections 0, 1, 3, 4.1, 4.2, and 8.1, and docs/specs/CONTRACTS.md (FINAL, version 8).
Scope cuts that are final: no search agent (robot_agent), no beacon missions, no drone fields, no robot audio, no outcome table, no occupancy estimates, no robot_track, participant_track, or terrain_observation tables, no stale_cell_timer.
Steps: run the init commands in section 1.2; add the package.json scripts in section 1.6; in src/schema.ts define every enum in section 3 and these tables with every column and index in section 4: participant, site, search_cell, robot, detection, survivor, assignment, briefing, agent_task, event_log; pass { CASE_CONVERSION_POLICY: CaseConversionPolicy.None } to schema(); in src/index.ts export default the schema, add init, onConnect, onDisconnect stubs, and register_participant exactly as section 8.1 describes.
Follow the rules in section 1.7: id: 0n for autoInc inserts, ctx.timestamp and ctx.random only (never Date.now or Math.random), every export lives in src/index.ts.
Then run npx tsc --noEmit -p . and spacetime build, publish to the local server (spacetime publish assess-0hw81 -p backend/spacetimedb --server local --yes), and generate bindings into backend/spacetimedb-bindings with the command in section 1.6.
Do not publish to Maincloud and do not log in; I do that.
Do not edit CONTRACTS.md; if a name in a spec seems wrong, list it for me instead.
Show me schema.ts and the generated table list when done.
```

Prompt for your coding agent (the rest, C1.3 to C1.8):

```text
Continue the SpacetimeDB module in backend/spacetimedb/.
Read docs/specs/spacetimedb.md sections 2 to 18 and docs/specs/CONTRACTS.md (FINAL, version 8).
Work in this order and stop after each numbered item so I can publish and announce bindings: 1) remaining tables, schedule tables (section 4.3, public, with due_at), private tables (4.4); 2) lib/ helpers (section 5) and timer helpers (7.1); 3) lifecycle reducers with presence and DISCONNECT_GRACE_S (section 6), reducers in 8.1, 8.2, 8.3, 8.5; 4) assignments and timers (8.6, 7.2), escalation, watchdog_fired (7.4), sweep (7.5); 5) agent reducers (8.7), runs and the run_started snapshot (8.8, 14), views my_assignment, my_briefing, my_survivor, critical_open (11.2), report_person and accounting (10); 6) test/smoke.sh with all 20 scenarios in 18.2, using set_site_timings to shorten timers.
Use the reducer argument lists in spacetimedb.md exactly (it wins over other specs); use the event kind names in the event_log table of CONTRACTS.md (for example agent_task_done).
Every scheduled reducer must re-check state before acting; only setSurvivorStatus writes survivor.status; the death-word check applies to every stored free text listed in 5.4.
Build start_en_route (8.6) with the assignments; build rescuer_ask (8.7) last, since voice questions are cut item 3 in docs/AGENT_WORKFLOW.md.
After each item run npx tsc --noEmit -p . and spacetime build, publish locally, and regenerate bindings.
Finish by running npm test and pasting any FAIL lines with your fix.
```

Pitfalls and fixes:
- Default case policy renames enums on the wire (`SAFE_STOP` becomes `safeStop`); always pass `CaseConversionPolicy.None`.
- SQL `WHERE` on an enum column fails; filter on `u64`, `string`, or `bool` only, and enums in client code.
- `init` does not run on a republish, so `ensureSchedules` must also run in `clientConnected` (section 6.1), or the sweep and watchdog rows never exist on Maincloud.
- A new column on an existing table needs `.default(value)`, or the publish needs `--delete-data=always`; warn the team before a wipe.
- Every HTTP call (including `spacetime sql` over HTTP) runs `clientConnected` and `clientDisconnected`; never release inside `clientDisconnected`, use the 2 s grace row.
- Scheduled reducers do not appear in the bindings, and clients get 404 for them; only the owner identity can call them in tests.
- Views must use indexed `find` or `filter`, never `iter()`.
- Tokens are per server (assumed); a grant made on Maincloud does not exist on the local fallback, so run the fallback in demo mode.
- `export *` from reducer files is UNCONFIRMED; keep every export in `src/index.ts`.
- The JSON form of a `Timestamp` argument (`observed_at`) is UNCONFIRMED; test once with `spacetime call` and tell Camille the exact form.

### G1. Glasses fallback page

Goal: the 576x288 green view in a browser: map, arrow, arrived, idle (plus ack and released), drawn from the glasses service's messages.
Why it matters: the MVP fallback if the G2 fails, the projector view of what the rescuer sees, and the recording source for the video overlay; demo beat 6.
Estimate with AI: 1.5 h.

Inputs and dependencies:
- `glasses.md` sections 3.8 (the `page` container schema), 4 (all layouts), 5.6 to 5.10 (target, geometry, view selection, demo walker, arrows), 6 (fallback page).
- `--glasses-green` from D1.
- No SpacetimeDB needed: this task builds the pure logic and a fake data source in the service, so it works before the bindings have views.

Outputs and who uses them:
- `frontend/glasses/fallback.html` (normal, record, and primary modes): C6 records it, C7 uses it as the backup, the judges see it on a small screen.
- `backend/glasses-service/src/{protocol,geo,select,layouts}.ts` with unit tests, and the arrow PNGs: G2 and G3 reuse them.

Files (`glasses.md` sections 3.1 and 5.2): `frontend/glasses/{app.json,index.html,fallback.html,phone.html,vite.config.ts,.env.example}`, `frontend/glasses/src/fallback/*.ts`, `backend/glasses-service/src/{index,config,protocol,session,select,geo,layouts,demo}.ts`, `backend/glasses-service/src/render/arrows.ts`, `backend/glasses-service/test/*.test.ts`.

Commands:

```bash
# scaffold (glasses.md 2.4)
npx degit even-realities/evenhub-templates/minimal frontend/glasses
cd frontend/glasses && npm install @evenrealities/even_hub_sdk@0.0.16
npm install -D @evenrealities/evenhub-cli@0.2.0 @evenrealities/evenhub-simulator@0.9.5 typescript vite vitest
cd ../../backend/glasses-service && npm init -y
npm install spacetimedb@2.14.1 ws@8.22.1 @napi-rs/canvas@1.1.0 dotenv
npm install -D typescript tsx vitest @types/ws @types/node

# run
cd backend/glasses-service && FAKE_DB=1 npm run dev    # FAKE_DB is our flag name for the fake source (not in the spec)
cd frontend/glasses && npm run dev
open "http://localhost:5173/fallback.html?rescuer=alex&ws=ws://localhost:8787/view"
```

Config: `frontend/glasses/.env` `VITE_GLASSES_WS_URL=ws://<ip>:8787/glasses`; service `.env` from `glasses.md` 5.3 with `TILE_SOURCE=none` for this task.

Steps:
- [x] G1.1 (15 min) Scaffold the plugin from the minimal template and the service package (commands above); multi-page `vite.config.ts` (`glasses.md` 3.1).
- [x] G1.2 (20 min) `protocol.ts`, `geo.ts` (5.7), and `select.ts` (5.6, 5.8) with unit tests: 39, 41, 59, 61 m in and out; arrived at 5 m and back at 8.1 m; octant 22.4 is N and 22.6 is NE.
- [x] G1.3 (20 min) `layouts.ts`: all seven layouts with the exact ids, sizes, and z values from section 4, `validateLayout()`, `toAscii()`, and `layouts.test.ts` (no banned words, every layout valid).
- [x] G1.4 (15 min) Service WebSocket server for `/view` and `/glasses` with a fake data source (a site, 3 survivors, one assignment) and the demo walker (5.9: `W`, arrow keys, `R`, 3 m/s).
- [x] G1.5 (20 min) `fallback.html`: container map from `page` messages, 576x288 canvas, green tint, 13 px per character and 27 px lines, brightness levels, normal mode at 2x with the side panel and buttons, record mode, `primary=1` heartbeats (section 6).
- [x] G1.6 (10 min) Arrow PNGs (5.10) and the `none` map (black with a 100 m grid) so every view draws.
- [ ] G1.7 (10 min) Design-control screenshot check (below).

Status (2026-11-08): G1.1 to G1.6 are done; the screenshot check against the Figma frames is open.

Done when: it shows a simulated assignment and switches map to arrow at 40 m and back at 60 m.
- `npx vitest run` in `backend/glasses-service` passes `geo`, `select`, and `layouts` tests.
- Pressing `W` walks the rescuer in: the page goes map, then arrow below 40 m, then arrived at 5 m; walking back out with the arrow keys returns to map only above 60 m.
- `&record=1` shows only the canvas on pure black, with no panel and no cursor.
- Screenshot check: a 1152x576 screenshot of each of the seven layouts sits next to its Figma frame; text fits without cut words, ids 1 and 8 are where section 4 puts them, no text overlaps an image, and the status line always has a word, not only brightness.

Prompt for your coding agent:

```text
Build the glasses fallback page and the glasses service's pure logic for the HackUTD rubble search project.
Read docs/specs/glasses.md sections 2.4, 3.1, 3.8, 4 (all of it), 5.2, 5.6, 5.7, 5.8, 5.9, 5.10, 5.12, 6, and 8.1, and docs/specs/CONTRACTS.md "Glasses protocol".
Final scope: no beacon target, no outcome recording; the arrow is north-up; map above 60 m, arrow below 40 m, arrived at 5 m, leave arrived above 8 m.
1) Scaffold frontend/glasses from even-realities/evenhub-templates/minimal (MIT) and backend/glasses-service with the exact versions in 2.4. Do not copy code from bluebook or tesla-even-g2.
2) Write backend/glasses-service/src/protocol.ts, geo.ts, select.ts, layouts.ts (seven layouts, validateLayout, toAscii) with vitest tests from section 8.1 for geo, select, and layouts.
3) Add a WebSocket server on 0.0.0.0:8787 with /view and /glasses, a fake data source behind FAKE_DB=1 (one site from backend/sim/demo-site.json if it exists, else center 32.9857, -96.7502, three survivors, one active assignment), and the demo walker in 5.9.
4) Write frontend/glasses/fallback.html and src/fallback/*.ts exactly as section 6 says, using var(--glasses-green) from frontend/design-tokens/tokens.css for the tint.
5) Render the 8 arrow PNGs (5.10) with @napi-rs/canvas, and TILE_SOURCE=none maps.
No string anywhere may contain dead, deceased, or expectant.
Run the tests and give me the two commands to start the service and the page.
```

Pitfalls and fixes:
- The firmware font width (13 px per character) is UNCONFIRMED until G3; keep it in one constant (`CHARS_PER_PX`) so the fallback page and the service change together.
- `primary=1` makes a closed tab release the assignment like a dropped glasses session; never leave a primary tab open on the projector, use mirror mode there.
- Do not overlap text and images; it is unknown whether black image pixels hide text on the lens.
- Plain `http://` on a LAN IP gets no browser geolocation; that only matters for the phone page (G2).

### G2. Glasses service

Goal: one SpacetimeDB connection per glasses session (so a dropped session releases assignments at once), heartbeat forwarding, acknowledgement, view selection, map and arrow rendering, briefings from the comms agent.
Why it matters: priority 4 (count, acknowledge, arrow) and priority 5 (disconnect release) in `docs/MVP.md`; demo beats 6 and 8; SpacetimeDB showcase item 5 ("close a rescuer's glasses session and their survivor is back on the board in about 2 s").
Estimate with AI: 2 h.

Inputs and dependencies:
- G1 (logic, layouts, fallback page).
- C1.7 bindings with the views; until then, the fallback subscriptions in `spacetimedb.md` 11.3.
- `backend/sim/demo-site.json` (C3.1) for the demo start point.
- Briefings from Eric's comms agent (templates first); without them the `brief` line stays empty and everything else works.

Outputs and who uses them:
- The running service on 8787 with `/glasses`, `/view`, `/phone`, `/healthz`, `/rescuer/<name>/action`, `/demo/<name>/*` (`glasses.md` 5.13): G3 plugin, the fallback page, C3 `walk`, the demo.
- Cayden's rescuer participant and live position on the dashboard (C2).
- `rescuers.json` and `.tokens/` (git-ignored) per rescuer.

Files: `backend/glasses-service/src/{db,session,http,demo}.ts`, `src/render/map.ts`, `src/tiles/{source,cache,prefetch}.ts`, `rescuers.json`, `.env.example`; `frontend/glasses/phone.html` and `src/phone/*.ts`.

Config (`glasses.md` 5.3):

```
PORT=8787
STDB_URI=https://maincloud.spacetimedb.com   # or ws://<laptop-a-ip>:3000 for the local fallback
STDB_DATABASE=assess-0hw81
TILE_SOURCE=esri-dark
PERCEPTION_URL=http://localhost:8080
PRIMARY_GRACE_MS=0
DEMO_SPEED_MPS=3
DEMO_START_BEARING_DEG=225
DEMO_START_DISTANCE_M=250
```

Commands:

```bash
cd backend/glasses-service
npm run tiles                      # prefetch at most 9 tiles for the site, needs internet, cache is git-ignored
npm run dev                        # tsx watch src/index.ts on 0.0.0.0:8787
curl -s http://localhost:8787/healthz
curl -s -X POST http://localhost:8787/demo/alex/walk
curl -s -X POST http://localhost:8787/rescuer/alex/action -H 'Content-Type: application/json' -d '{"action":"accept","assignment_id":1}'
npx vitest run
```

Steps:
- [x] G2.1 (15 min) `db.ts`: one `DbConnection` per session with that rescuer's saved token, `registerParticipant` as `rescuer` on first connect, open on the first primary socket, `conn.disconnect()` when the last primary socket closes (5.4).
- [x] G2.2 (15 min) Subscriptions: `my_assignment`, `my_briefing`, `my_survivor`, `critical_open`, `site`, `robot`, `survivor`; the fallback queries from `spacetimedb.md` 11.3; one enum tag helper checked once against a live row.
- [x] G2.3 (15 min) Heartbeats (forward plugin `heartbeat` as `rescuerHeartbeat()`, at most every 4 s, primary socket only) and positions (`participantUpdatePosition` on 2 m moves, every 2 to 5 s; demo walker through the same path).
- [x] G2.4 (15 min) `ack` calls `acceptAssignment` only for this rescuer's own `proposed` row; ack view countdown from `lease_expires_at`; released view with the four reason texts (4.7, 4.8); `SenderError` text on id 8 for 5 s, never retried.
- [x] G2.5 (20 min) Map: `esri-dark` tiles, `npm run tiles`, tone map, markers, `map_top` and `map_bot` split, sha1 diff, at most one redraw per 2 s (5.11).
- [x] G2.6 (15 min) Count line from `critical_open`, target and detail lines, briefing line with `!! ` and `! ` prefixes, escalation levels 1 and 2 (5.12).
- [x] G2.7 (15 min) HTTP endpoints with CORS (5.13) and the phone page buttons: Accept, Decline, Release, Mark reached, Resolve (confirm dialog with the four resolutions), Ask (hidden until voice questions exist).
- [ ] G2.8 (15 min) `session.test.ts` and `escalation.test.ts` (8.1), then the release checks below with the fallback page in `primary=1` mode.

Status (2026-11-08): G2.1 to G2.7 are done, and both test files pass.
Fixed on 2026-11-08: real-database subscriptions no longer crash (the SDK compat shim is gone), live row changes reach the glasses with one update per transaction, identical page and image messages are not resent, and the default rescuer is `cayden`.
Checked live against a local server: a proposal reaches the glasses, accept moves the survivor to `assigned`, and closing the glasses socket releases the assignment.
Still open in G2.8: the heartbeat-block release (about 15 s), the `/view` no-connection check, and the screenshot check.

Done when: a ring tap (or a click on the fallback page) acknowledges an assignment and the dashboard shows it.
- With `primary=1`, a coordinator `propose_assignment` from the dashboard shows the ack view with a countdown; a click accepts it and the dashboard shows `ASSIGNED to <name>, acknowledged`.
- Closing the primary tab: the dashboard shows the assignment `released` with cause "glasses disconnected" within about 3 s (2 s grace plus 1 s).
- Blocking heartbeats with the socket open: released after about 15 s.
- A `/view` tab without `primary=1` never opens a SpacetimeDB connection (check `/healthz` and the dashboard presence).
- The map shows live markers from `esri-dark`, and `(c) Esri, OSM` on id 7.
- Screenshot check: the fallback page for map, ack, and released views next to their Figma frames, as in G1.

Prompt for your coding agent:

```text
Connect the glasses service in backend/glasses-service/ to SpacetimeDB.
Read docs/specs/glasses.md sections 4.6 to 4.8, 5.1, 5.3, 5.4 (with 5.4.1 and 5.4.2), 5.5, 5.11 to 5.14, 6 (phone page), and 8.1; docs/specs/spacetimedb.md sections 8.6, 11, and 16; and CONTRACTS.md (FINAL, version 8) "Glasses protocol" and "Views".
Use the bindings in backend/spacetimedb-bindings/ only; check the exact camelCase names there.
The critical count view is named critical_open.
Disconnect release is a 2 s grace in the module, so expect about 2 s, not instant.
1) db.ts: one DbConnection per session with that rescuer's token in .tokens/, registerParticipant as rescuer if missing, open on the first primary socket and disconnect when the last primary socket closes.
2) Subscribe to my_assignment, my_briefing, my_survivor, critical_open, site, robot, survivor; if a view fails, use the fallbacks in spacetimedb.md 11.3.
3) Forward heartbeats (at most one per 4 s, primary only, never invented), positions per 5.1, ack only for own proposed rows, SenderError text on id 8.
4) Map rendering per 5.11 with TILE_SOURCE=esri-dark and npm run tiles; do not sign up for any key.
5) HTTP endpoints per 5.13 with Access-Control-Allow-Origin: * and OPTIONS; phone.html buttons per section 6 (no Ask button yet).
6) Tests session.test.ts and escalation.test.ts from 8.1 with a fake connection.
Skip voice questions (5.15) and rescuer_ask; they are cut until after checkpoint 4.
Keep the plugin free of product logic.
```

Pitfalls and fixes:
- Never invent heartbeats in the service; the module's 15 s `heartbeat_timer` is the proof that the glasses are really there.
- One token per server: a Maincloud token is not valid on the local fallback (assumed); keep them apart in `.tokens/` and expect a fresh identity after switching.
- Esri's terms for keyless use are UNCONFIRMED; Cayden decides, and `TILE_SOURCE=none` is the fallback.
- CARTO tiles without a key return "API KEY REQUIRED"; do not use them without a key.
- The phone page needs HTTPS for geolocation (`vite --mode phone` on 5174 with `@vitejs/plugin-basic-ssl`, UNCONFIRMED on the actual phone); in demo mode, phone fixes are ignored anyway.

### G3. Even Hub plugin on the real G2

Goal: developer mode, QR sideload over the team hotspot, render `page`, `text`, and `image` messages, ring input, double tap exits.
Why it matters: the real glasses are the live wow moment of the demo (beats 5, 6, and 8); NVIDIA sees the comms agent's output on a lens, State Farm sees a rescuer guided to the most critical person.
Estimate with AI: 2 h.

Inputs and dependencies:
- C0.2 developer section, G1 scaffold, G2 service.
- Glasses charged, R1 ring paired, phone with the Even app open and unlocked, a hotspot both phone and laptop join.

Outputs and who uses them:
- The plugin in `frontend/glasses/` loaded by QR (C7 rehearsals, the demo).
- Measured on-lens facts written back into `glasses.md` (character width, dim level readability, ring source values, image update time).

Files (`glasses.md` 3.1): `frontend/glasses/src/{main,bridge,queue,socket,input,location,heartbeat,protocol}.ts`, `app.json`, `test/{queue,input}.test.ts`.

Commands:

```bash
ipconfig getifaddr en0                                    # laptop IP on the hotspot
cd frontend/glasses && npm run dev                        # vite on 0.0.0.0:5173, hmr.host = laptop IP
evenhub-simulator --automation-port 9898 http://localhost:5173
curl -s http://localhost:9898/api/ping
curl -s http://localhost:9898/api/screenshot/glasses -o sim.png   # 576x288 RGBA, lit pixels have alpha above 0
curl -s -X POST http://localhost:9898/api/input -H 'Content-Type: application/json' -d '{"action":"click"}'
# other actions: up, down, double_click, long_press, long_press_release, context_menu
evenhub qr --url "http://<laptop-ip>:5173"                # scan in the Even app developer section
```

Config:
- `frontend/glasses/.env`: `VITE_GLASSES_WS_URL=ws://<laptop-ip>:8787/glasses`.
- `app.json` (3.7): `network` whitelist with both `http://<laptop-ip>:8787` and `ws://<laptop-ip>:8787`, `location`, `g2-microphone`; replace the example IP `172.20.10.2`.
- macOS firewall: allow incoming connections for `node` (ports 5173 and 8787).

Steps:
- [ ] G3.1 (15 min) `bridge.ts` boot sequence (3.3): startup page with text ids 1 and 8 exactly once, serial from `getDeviceInfo()` (`"sim"` if null), then check it in the simulator with a screenshot.
- [x] G3.2 (20 min) `queue.ts` (3.4) and `input.ts` (3.5) with their tests: a missing `eventType` is a tap, double tap calls `shutDownPageContainer(1)`, images at least 110 ms apart, a page clears pending writes.
- [x] G3.3 (15 min) `socket.ts` (backoff 500 ms to 10 s, `LINK LOST - retrying` on id 8), `heartbeat.ts` (every 5 s), `app.json`.
- [ ] G3.4 (15 min) Simulator checks from `glasses.md` 8.2 steps 2 to 6 with the automation API (wait about 4 s after start before sending input).
- [ ] G3.5 (15 min) Network: hotspot, laptop IP into `.env` and `app.json`, firewall, then from the phone browser load `http://<ip>:5173` and `http://<ip>:8787/healthz`.
- [ ] G3.6 (15 min) `evenhub qr --url ...`, scan, and confirm `RUBBLE SEARCH connecting...` and then the idle view on the lens.
- [ ] G3.7 (20 min) Real lens pass (8.4 steps 2 to 5 and 7): fix `CHARS_PER_PX`, check dim levels 1 and 2, ring taps log source `ring`, temple taps `left` or `right`, map image update well under 1 s, lock the phone 10 s and recover.
- [ ] G3.8 (15 min) Run the sim with a proposal for Cayden: count, ack, arrow, released after closing the app; photo the lens next to each Figma frame.

Status (2026-11-08): the plugin code for G3.1 to G3.3 exists, and the `queue` and `input` tests pass.
G3.1 and G3.4 still need the Even Hub simulator run, and G3.5 to G3.8 are HUMAN-ONLY (phone, hotspot, and the real G2).

Done when: the real glasses show the live count and the arrow during a simulator run.
- A ring tap on a proposal accepts it, and the service log shows source `ring`.
- Closing the Even app releases the assignment on the dashboard within about 3 s.
- `vitest` passes `queue` and `input` tests.
- Screenshot check: photos of the lens (or `GET /api/screenshot/glasses` from the simulator) for idle, map, arrow, ack, and released match their frames: no wrapped or cut lines, status line readable, nothing overlapping.

Prompt for your coding agent:

```text
Build the Even Hub plugin in frontend/glasses/ for the G2 glasses (SDK @evenrealities/even_hub_sdk 0.0.16).
Read docs/specs/glasses.md sections 2.1 to 2.5, 3.1 to 3.8, 4.1, and 8.1 (queue and input tests), and CONTRACTS.md "Glasses protocol".
The plugin is a thin client: no product logic; it renders page, text, and image messages, sends input, heartbeat every 5 s, ack while the page carries ack_assignment_id, and position.
Use only the SDK calls listed in section 3.2; check each against node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts and tell me if one differs.
Implement main.ts (boot 3.3), bridge.ts, queue.ts (3.4), input.ts (3.5, double tap always exits with shutDownPageContainer(1)), socket.ts (3.6), heartbeat.ts, location.ts (3.2, tolerate no location), app.json (3.7) with the whitelist IP taken from VITE_GLASSES_WS_URL.
Do not implement mic.ts yet (voice questions are cut until after checkpoint 4).
Write queue.test.ts and input.test.ts with a fake bridge.
Never run evenhub login and never sign in to anything.
Then give me the exact commands to run the simulator with --automation-port 9898 and the curl calls to screenshot and send a click.
```

Pitfalls and fixes:
- Venue Wi-Fi isolates clients; use the phone hotspot or the travel router, never venue Wi-Fi.
- The Even app must stay open, in front, on an unlocked phone; if it backgrounds, the WebView is suspended and you may need to rescan the QR.
- `server.hmr.host` must be the laptop IP, or hot reload tries `localhost` on the phone.
- Whether `ws://` origins belong in the whitelist, and whether a QR dev session enforces permissions, are UNCONFIRMED; keep both `http://` and `ws://` entries, and a whitelist change needs a repack for packed builds.
- `CLICK_EVENT` is 0 and dropped on the wire; resolve the default inside each envelope, not with `?? CLICK`.
- Long press may be taken by the OS menu; never make it the only way to do anything.
- The simulator accepts layouts the glasses reject (image size, count); `validateLayout()` is the guard.
- The hotspot IP can change when the phone restarts; recheck `ipconfig getifaddr en0` before every session and update `.env` and `app.json`.

### C2. Dashboard

Goal: pipeline canvas and map, ranked survivors, the headline "Critical survivors unattended over 60 s: 0", schedule-table countdowns, one Agents panel (agent status, task board, action log, and the chain per survivor), replay; built only from the design tokens and components (design control).
Why it matters: the screen the judges watch for all three tracks; demo beats 4, 5, 7, 8, and 9; the Agents panel is the NVIDIA screen, the two screens in sync are the SpacetimeDB moment, the headline is the State Farm promise.
Estimate with AI: 2 h.

Inputs and dependencies:
- C1 bindings (v1 is enough to start; views and schedule tables by v4).
- D1 tokens and the dashboard and Agents panel frames.
- C3 `setup` and `scale` for real data, or contract-shaped fixtures before that (`dashboard.md` build order note).
- Eric's agent names (`orchestrator`, `comms_agent`, `auditor`) and `DRY_RUN=log` for building the Agents panel.

Outputs and who uses them:
- `frontend/dashboard/` on 5180: Screen A `http://<laptop-a-ip>:5180/?screen=A`, Screen B `?screen=B`, Agents full screen `?view=agents`, replay `?view=replay&run=<id>`, video close-ups `&focus=chain` and others.
- `src/model/headline.ts`, imported by the sim's `status` (C3).
- Screenshots for the slides (C5).

Files: `dashboard.md` "Folder layout" (all of it); `vite.config.ts` with `resolve.alias` `@bindings` to `../../backend/spacetimedb-bindings`, `resolve.dedupe: ['spacetimedb']`, `server.fs.allow` including the bindings folder.

Config (`.env.example`):

```
VITE_STDB_URI=https://maincloud.spacetimedb.com
VITE_STDB_DATABASE=assess-0hw81
VITE_STDB_URI_LOCAL=ws://<laptop A LAN IP>:3000
VITE_TILE_SOURCE=esri-light
VITE_CARTO_KEY=
```

Commands:

```bash
cd frontend/dashboard
npm run dev                         # vite --port 5180 --host
npx vitest run                      # unit tests
npx playwright test                 # e2e, two browser contexts, local server
open "http://localhost:5180/?screen=A"
open "http://localhost:5180/?screen=B&db=local"
```

Steps:
- [x] C2.1 (15 min) Scaffold with the React version the SpacetimeDB React quickstart pins, the bindings alias and dedupe, import `frontend/design-tokens/tokens.css`, `stdb/connection.ts` with the token key `stdb_token_<db>_<screen>` in try/catch, `register_participant` as `coordinator-<screen>`.
- [x] C2.2 (15 min) `LiveSource`, `useBoard`, `BoardState`; `stdb/enums.ts` (the only file that reads `.tag`, checked against a live row) and `stdb/time.ts`.
- [x] C2.3 (15 min) `model/` pure functions with unit tests: `headline`, `ranking`, `labels`, `timers`, `accounting`, `agents`, `chains`.
- [x] C2.4 (20 min) Top bar (site, DEMO MODE, SCREEN label, REC, headline, presence), ranked survivor list, survivor detail with media and the resolve dialog.
- [x] C2.5 (20 min) Agents panel: agent cards with status words, task board columns, action log bursts, chain per survivor with the auditor verdict and the "RULES FALLBACK" and "MODULE" chips; `A` opens it full screen.
- [x] C2.6 (15 min) Leaflet map (`esri-light`, attribution, cells with partial never "clear", survivor shapes, robot chevron with terrain glyph, rescuer diamonds, legend); Timers tab with "SCHEDULE TABLE" chips; Assignments tab with release causes.
- [x] C2.7 (15 min) Pipeline band (seven plain cards in `PipelineBand.tsx`; React Flow is not used), Buildings panel with the person report form, transport bar live mode, Start run, End run, Sync test.
- [ ] C2.8 (15 min) Replay (fold `event_log` from the `run_started` snapshot) or hand it off; `sync.spec.ts` and `disconnect.spec.ts`; the screenshot check.

Status (2026-11-07): C2.6 and C2.7 implementation and unit coverage are complete, and C2.8 replay has been implemented.
The two-screen sync and disconnect Playwright checks still need a clean seeded local database.
Priority, Stats, Map empty state, and Replay layouts were reviewed at 1920x1080.

Status (2026-11-08): `npm test` passes 30 tests, and the Start run name now fits the module's 40-character limit.
C2.8 stays open: `sync.spec.ts` and `disconnect.spec.ts` are not written, and the screenshot check is not done.
Panels from `dashboard.md` that do not exist yet: robot health tab, audit flags panel, critical briefing banner, duplicates side by side with clear, commander view, and the runs sidebar.
Another session is redesigning the dashboard UI, so this list says what is missing, not how it should look.

Done when: two browser windows update at the same moment during a simulator run, and the screenshot check in `docs/DESIGN.md` passes.
- `sync.spec.ts`: Screen A clicks "Approve" and Screen B shows `queued` within 1 s.
- `disconnect.spec.ts`: `fail rescuer-drop` shows "RELEASED" with cause "glasses disconnected" on both screens within about 3 s.
- `headline.test.ts`: a proposed but unacknowledged assignment still counts as unattended; 59 s is not counted, 61 s is.
- After `scale 300`, the page text has no banned word, and every `not_detected` row reads "No signs of life detected, low confidence".
- No raw colors outside the tokens: `grep -rnE '#[0-9a-fA-F]{3,8}\b' frontend/dashboard/src` prints nothing.
- Screenshot check: 1920x1080 screenshots of the live board and the Agents panel full screen, next to their frames; fix spacing, alignment, overflow, contrast, and empty and loading states; every level has a word and a shape; readable from 5 m on the projector; Chrome "Emulate vision deficiencies" still reads in grayscale.

Prompt for your coding agent:

```text
Build the coordinator dashboard in frontend/dashboard/ (React + Vite + TypeScript, spacetimedb 2.14.x with spacetimedb/react).
Read docs/specs/dashboard.md in full, docs/DESIGN.md "Design control: the rules", docs/MVP.md "Frontend look", and docs/specs/CONTRACTS.md (FINAL, version 8).
Final scope: three agents (orchestrator, auditor, comms_agent), one Agents panel, no search agent, no occupancy estimates, no outcomes or analysis view, no track tables, no stale-area timer, no beacon missions.
Styling comes only from frontend/design-tokens/tokens.css (import it; no raw hex, font, or spacing values anywhere else).
Use the bindings through the @bindings alias with resolve.dedupe ['spacetimedb'] and server.fs.allow as in "Importing the shared bindings".
The schedule tables lease_timer, heartbeat_timer, escalation_timer, agent_watchdog are public with a due_at column (spacetimedb.md section 7.3); read countdowns from them and label those rows SCHEDULE TABLE.
Use the event kind names in the event_log table of CONTRACTS.md (agent_task_done); the auditor verdict in result_json is agree or disagree, shown as AGREE or DISAGREE.
Work in this order and stop after each so I can check: build steps 1 to 5 of "Build order and estimates", then 6 to 9, then 11 (replay).
Every component reads useBoard(), never a table hook directly; only src/stdb/enums.ts reads .tag.
Write the unit tests in "Unit tests (Vitest)" for each model file, and the Playwright sync.spec.ts and disconnect.spec.ts against a local server.
Check each SDK name in "SpacetimeDB client API used" against the installed typings and tell me any that differ (useTable callbacks are UNCONFIRMED).
```

Pitfalls and fixes:
- The bindings live outside the Vite root; without `dedupe` two copies of `spacetimedb` load and the provider breaks.
- Serve the dashboard over HTTP; the media server URLs are plain HTTP and an HTTPS page blocks them as mixed content.
- Two tabs on one laptop need different `?screen=` values, or they share one identity.
- Countdowns compare the local clock with server times; turn on automatic time sync on both laptops.
- A burst of 300 inserts from the sim can freeze the map; update markers in place and batch with `requestAnimationFrame`.
- `register_participant` as `coordinator` needs demo mode or a `grant_role`; on a fresh Maincloud publish, create the demo site first (C3 `setup`).

### C3. Simulator

Goal: demo config with fixed coordinates, scale data (hundreds of survivors), fake robot and rescuers, failure injection, reset, timeline mode.
Why it matters: checkpoint 2 (whole flow with no robot), the State Farm "at scale" beat (300 survivors, headline at 0), the SpacetimeDB failure beats (rescuer drop, heartbeat, robot offline, watchdog), and repeatable takes for the video.
Estimate with AI: 1.5 h.

Inputs and dependencies:
- C1 bindings (robot, perception, assignment, and person report reducers; demo mode rules in `spacetimedb.md` section 17).
- The glasses service demo walker for `walk` (G2).
- `frontend/dashboard/src/model/headline.ts` for `status` (C2.3); until it exists, a copy of the rule from `dashboard.md` "The headline".

Outputs and who uses them:
- `backend/sim/demo-site.json`, committed first: Camille's bridge reads `demo_anchor` (`DEMO_SITE_CONFIG`), the glasses service reads the rescuer start, the dashboard e2e tests read the houses.
- Sim identities and data on the board: Eric's agents, C2, G2.
- Timelines `judge.json`, `video.json`, `e2e.json`, `stress.json`: C6, C7, the C2 e2e tests.
- Timeline `demo.json` (added 2026-11-08): the judged hard-coded demo, used by C7 and on demo day; `judge.json` is superseded for judging and stays as rehearsal and video material.

Files (`demo.md` "Stack and layout"): `backend/sim/{package.json,.env.example,demo-site.json}`, `timelines/*.json`, `assets/rehearsal/`, `assets/sim-thermal/`, `.tokens/` (git-ignored), `src/{cli,config,geo,rng,pool,guard,inject,setup,run,scale,simrobot,rescuers,failures,timeline,status}.ts`, `tests/`.

Config (`.env.example`): `STDB_URI`, `STDB_DATABASE` (`assess-0hw81`), optional `STDB_TOKEN`, `MODULE_PATH`, `MEDIA_BASE`, `PERCEPTION_BASE`, `GLASSES_BASE`.

Commands:

```bash
cd backend/sim
npm run sim -- coords
npm run sim -- setup
npm run sim -- console           # long-running; then type: rs, s 300, rc, rb, h, sp immediate house 8, f4 r2, ok, ?
npm run sim -- timeline demo     # the judged demo (hard-coded, 2026-11-08): sim-dog searches house 3 and finds the hidden person
npm run sim -- search house 3    # short: sr; queue a sim-dog search mission for one house
npm run sim -- timeline judge    # the original longer demo story (rehearsal and video material since 2026-11-08)
npm run sim -- timeline judge --dry
npm run reset                    # republish with --delete-data=always, then setup (never on Maincloud during judging)
npx vitest run
```

Steps:
- [x] C3.1 (15 min) `demo-site.json` exactly as `demo.md` Part 1, `config.ts`, `geo.ts`, `rng.ts`, `coords`; commit and post it for Camille.
  Move the center to a residential block near the venue on the dashboard map, then rerun `coords`.
- [x] C3.2 (15 min) `pool.ts` (one connection and saved token per identity), `guard.ts` (exit code 2 outside demo mode), `inject.ts` (`log_event` `sim_injection` with `{"command","target"}`), `setup.ts`, `run.ts`.
- [x] C3.3 (15 min) `scale.ts`: seeded points at least 12 m apart in scale lots, detections from fleet robots, breathing and scores (below 90), 15 per second, partial cells, 3 duplicate pairs.
- [x] C3.4 (15 min) `rescuers.ts`: heartbeats every 5 s, positions every 1 s, accept after 2 to 4 s, walk, reached within 5 m, resolve after 8 s; never drives Cayden.
- [x] C3.5 (15 min) `simrobot.ts`: claim missions, search cells, terrain reports, `hidden` survivors, house 4 `partially_searched`, `spawn`, `robot replay house3`.
- [x] C3.6 (15 min) `failures.ts` (`robot-offline`, `rescuer-silent`, `rescuer-drop`, `device`), `recover`, `imbalance`, `report`, `walk`, `status`, the console, `timeline.ts` with the four timelines, and `reset`.

Status (2026-11-08): C3.1 to C3.6 are done, and `npm test` passes 20 tests.
One command dispatcher (`src/dispatch.ts`) serves the console, one-shot commands (`npm run sim -- <command>`), and timelines; `npm run sim -- help` prints the full list.
The sim robot claims missions with `claim_next_mission`, walks, reports terrain, marks cells (house 4 `partially_searched`), and finds the `hidden` survivors; `robot replay house3` (`rr`), `imbalance`, and `dupes` work.
Live `timeline` runs are implemented for `e2e`, `judge`, and `video`; `stress` has not been run (it needs 120 rescuers and status sampling).
Added 2026-11-08: `search <house>` (`sr`) and `timelines/demo.json` for the hard-coded judged demo; `timeline demo` was verified live on a local server (found at 0:14 with no fallback).
The site is "Tornado response, Dallas TX", centered on 7716 Worthing St, Dallas TX 75252 (32.9968745, -96.7704708), which is house 3.

Done when: one command runs the whole demo story with no hardware.
- `npm run sim -- timeline judge`, with no robot, no glasses, and the agents stopped, reaches the end; every `await` either passes or runs its `else` fallback.
- `setup` then `scale 50`: 50 survivors, every house and lot has a cell.
- `f4 r2`: that assignment is `released` within about 3 s; `f2`: within 15 s plus 3 s; `f1`: robot offline within 7 s and its cell reopened.
- With no agents running, `sp immediate house 8` gets a proposal within the watchdog time (15 s in demo) plus 3 s, with an `agent_watchdog_fallback` event.
- `stress` timeline: the headline is never above 0 for more than one sample.
- `scale.test.ts`: seed 7 gives the same 300 points every run.

Prompt for your coding agent:

```text
Build the demo simulator in backend/sim/ (Node.js 22+, TypeScript with tsx, spacetimedb 2.14.x, bindings from backend/spacetimedb-bindings/).
Read docs/specs/demo.md Parts 1 and 2 in full, docs/specs/spacetimedb.md sections 8 and 17 (reducer argument lists; spacetimedb.md wins), and docs/specs/CONTRACTS.md (FINAL, version 8).
Final scope: no beacon missions, no occupancy estimates, no outcomes, no track tables, no stale-area timer, no search agent; the sim never fakes an agent decision and never connects as Cayden.
Every simulated actor is its own identity and connection (pool.ts), with tokens saved in .tokens/ (git-ignored).
Every story-changing command writes log_event(kind = sim_injection, payload_json = {"command":"...","target":"..."}) first.
Simulated names say so: robots sim-dog, sim-dog-2 and up; rescuers end in "(sim)".
Start with demo-site.json copied exactly from Part 1 and the coords command, and stop so I can commit it.
Then build pool, guard, inject, setup, run, scale, rescuers, simrobot, failures, status, console, timeline, and reset in that order, with the tests in "Tests".
The watchdog delay in demo mode is the module's AGENT_WATCHDOG_S (15 s); use it in the timeline waits.
If the module refuses a rescuer more than one active assignment, make imbalance print "imbalance not possible with this module".
Import the headline function from frontend/dashboard/src/model/headline.ts if it exists, else write the same rule in src/status.ts and leave a TODO.
```

Pitfalls and fixes:
- Reducers return no value; find a new survivor by its rounded position or the detection's `survivor_id` from the subscription.
- 300 survivors must not cause 300 Nemotron calls; tell Eric before the first `scale` so the orchestrator uses its deterministic path for the burst.
- `reset` deletes every recorded run; screen-record any replay worth keeping first.
- Never `reset` Maincloud during judging; between judges, end the run and start a new one.
- The demo center is 7716 Worthing St, Dallas TX (32.9968745, -96.7704708), and every house sits on a real building footprint (see `docs/specs/demo.md`).

## Phase 2: integrate

### C4. Integration lead

Goal: run checkpoints 2 to 4 in `docs/TASKS.md`; keep `CONTRACTS.md` current; merge proposed contract changes with the team.
Why it matters: every sponsor beat crosses at least three owners' code; the measured seconds from these runs are the numbers on the results slide (and the SpacetimeDB showcase asks for measured seconds).
Estimate with AI: 1 h.

Inputs and dependencies:
- C1, C2, C3, G2 working; Eric's perception and agents; Camille's bridge; Matthew's robot.
- The "Known mismatches" table at the top of this file and every spec's "Proposed contract changes" section.

Outputs and who uses them:
- An updated `CONTRACTS.md` (version 9 or later, changed in its body by team decision) with the agreed mismatches resolved, announced in the chat (everyone).
- A short checkpoint log in the team chat: pass or fail per checkpoint, with the blocker and its owner.
- Measured seconds: disconnect release, heartbeat release, lease expiry, watchdog fallback, detection to acknowledgement (C5 slide 9).

Commands (measure from the record, not by stopwatch):

```bash
spacetime sql assess-0hw81 "SELECT * FROM run" --server maincloud
spacetime sql assess-0hw81 "SELECT * FROM event_log WHERE run_id = <id>" --server maincloud
spacetime sql assess-0hw81 "SELECT * FROM agent_action WHERE run_id = <id>" --server maincloud
npm run sim -- status
```

Steps:
- [ ] C4.1 (15 min) Settle the "Known mismatches" with Eric and Camille in one short call; write each agreed change into the body of `CONTRACTS.md` (the section it belongs to), raise the version number in its status line, add one line to its History section, and post it.
- [ ] C4.2 (15 min) Checkpoint 2: the sim creates a detection, perception scores it, the orchestrator proposes, the auditor reviews, the comms agent briefs, and the fallback page and the dashboard show it live.

Status (2026-11-08): most of checkpoint 2 has run, but not as one recorded run.
On the local branch `integration/eric-agents` (Eric's `team/eric` plus 15 integration fixes), the orchestrator proposed, the auditor reviewed once per proposal, the comms agent briefed, and an idle robot got a search mission, all live against the module with `LLM_MODE=mock`.
Not yet checked: perception scoring a sim detection in that same run, a real Nemotron key, and one recorded run with the run id posted in the chat.
- [ ] C4.3 (15 min) Checkpoint 3: Camille's bridge on mocks, then the real robot: `robot` row online, a mission claimed and done, a real detection and a breathing result.
- [ ] C4.4 (15 min) Checkpoint 4: the real robot finds a teammate in dim light, the agents and the real G2 react, replay works; pull the measured seconds from `event_log`.

Done when: checkpoint 4 passes.
- Checkpoints 2 and 3 are also marked passed in the team chat, each with its run id.
- The measured seconds are written down with their run id, ready for slide 9.

Prompt for your coding agent:

```text
Write backend/sim/src/measure.ts (and an npm script "measure") that connects to SpacetimeDB with the sim's token and, for one run_id given on the command line, prints measured durations from the event_log, agent_action, and detection tables.
Read docs/specs/spacetimedb.md sections 5.5 and 14 for the event kinds and payload_json shape, and the event_log table in docs/specs/CONTRACTS.md (FINAL, version 8).
Report, each as count, median, and max in seconds: detection created to assignment_accepted for the same survivor; assignment_proposed to assignment_accepted; client disconnect (rescuer_offline) to assignment_released; last orchestrator agent_action to agent_watchdog_fallback; review task posted to agent_task_done for kind review.
Print a short table I can paste into the slides, and say which numbers had zero samples.
Use only reducer and table names from the bindings; do not write to the database.
```

Pitfalls and fixes:
- Do not change `CONTRACTS.md` alone; it changes only by a team decision, and component specs never edit it.
- Pull the measured numbers from `event_log` timestamps, so the slide matches the replay.
- Switching to the local fallback server loses the board state; practice it once between runs, never during a judge group.

## Phase 3: demo and pitch

### C5. Slides

Goal: built from the design file and tokens, following the outline in `docs/DESIGN.md`; every number sourced or measured, placeholders marked until filled.
Why it matters: judges score the story as much as the code; the outline maps each slide to a track, and the two-minute pitch must hit every track in order.
Estimate with AI: 1.5 h.

Inputs and dependencies:
- D1 tokens and the slides frames; C2 screenshots; C4 measured seconds; Matthew's robot photo; sourced disaster facts (TBD, slide 2 and 3).
- Tool: Figma Slides (same file as the tokens) or Canva; pick one and keep the deck in one place.

Outputs and who uses them:
- The deck (the presenter), its PDF export (backup on two laptops and a phone), and screenshots reused in Devpost (C6).

Commands (screenshots at 1920x1080 for the deck, from a scripted run so they are repeatable):

```bash
npm run sim -- timeline video
open "http://localhost:5180/?screen=A&focus=canvas"
open "http://localhost:5180/?view=agents&survivor=<id>&focus=chain"
open "http://localhost:5180/?screen=A&focus=buildings"
open "http://localhost:5173/fallback.html?rescuer=cayden&ws=ws://localhost:8787/view&record=1"
```

Steps:
- [ ] C5.1 (15 min) Pick Figma Slides or Canva, create 11 slide frames from the tokens (two colors plus the status set, two typefaces), and put the outline titles on them.
- [ ] C5.2 (15 min) Capture the screenshots listed in the slides section below from a `video` timeline run, at 1920x1080, light theme.
- [ ] C5.3 (20 min) Fill slides 4 to 8 (what we built, live demo hand-off, agents, no one overlooked, SpacetimeDB) with one sentence each and the screenshots as evidence cards (12 px corners, light stroke, soft shadow).
- [ ] C5.4 (15 min) Fill slides 9 to 11 from measured numbers only (C4); mark anything not measured `--` or `TBD`.
- [ ] C5.5 (15 min) Slides 1 to 3: title with the robot photo, the sourced story, the sourced gap number; record each source in the speaker notes.
- [ ] C5.6 (10 min) Screenshot check against the frames, team review, PDF export to two laptops and a phone.

Done when: the deck is final, reviewed by the team, and exported to PDF as a backup.
- No number on any slide lacks a source or a run id in the speaker notes, and no placeholder is left unmarked.
- Every slide has at most one sentence of text plus one visual.
- Screenshot check: each slide next to its frame; same tokens and type as the dashboard, no stock disaster photos unless openly licensed and credited, readable from the back of the room.

Prompt for your coding agent:

```text
Write a Playwright script frontend/dashboard/tests/capture-slides.spec.ts that captures 1920x1080 PNG screenshots for the pitch deck into docs/slides-assets/ (create the folder) while a sim timeline runs against the local server.
Read docs/DESIGN.md "Slides" and "Outline", and docs/specs/dashboard.md "Connection, identity, and role" for the URL parameters (screen, view, survivor, focus, theme).
Capture, in light theme: the live board (screen=A); the pipeline canvas (focus=canvas); the Agents panel full screen with one survivor's chain (view=agents&survivor=<id>&focus=chain); the Timers tab; the Buildings panel with "1 UNACCOUNTED" (focus=buildings); the headline at 0 after scale 300; replay at the end of the run (view=replay&run=<id>).
Also capture the glasses fallback page in record mode at 1152x576 for the map, arrow, ack, and released views.
Take the survivor and run ids from command-line arguments.
Do not change any app code; only add the test file and the output folder.
```

Pitfalls and fixes:
- The DESIGN.md pitch is two minutes while the `demo.md` booth script runs about 4 minutes 20 seconds; ask the organizers how long each judge slot is (UNCONFIRMED) and pick which one leads.
- Slides 2 and 3 need real, sourced facts (a sourced tornado or collapse event, and sourced numbers about finding trapped people in time); do not invent them, and leave `TBD` until sourced.
- Results are measured numbers only; "thermal range" waits for Matthew and Eric's range test (their M6).

### C6. Demo video and Devpost

Goal: outdoor GPS scenario and robot footage (with Matthew), glasses overlay recorded from the fallback page and blended with Screen, 2 to 3 minute cut; Devpost with tracks NVIDIA, State Farm, SpacetimeDB, the public repo link, the video, what we built, and what is unconfirmed.
Update 2026-11-08: the judged demo is hard-coded, so the Devpost "Live and simulated in the demo" section says only SpacetimeDB ran live and the simulator scripted the robot, the find, the breathing result, the score, and rescuer actions (`docs/devpost-draft.md`).
The video may still use the longer `video` timeline as material, but any shot of the agents, perception, the real robot, or the real G2 must be labelled as a separate test, not the judged demo.
Why it matters: the backup if the live demo fails, the only place real GPS and outdoor driving appear, and the submission itself; the SpacetimeDB track requires public source on GitHub.
Estimate with AI: 1.5 h.

Inputs and dependencies:
- Matthew's outdoor test and robot footage (his M8), the `video` timeline (C3), the fallback page record mode (G1), the dashboard focus URLs (C2), the slides' screenshots (C5).
- The Devpost submission deadline (TBD) and the HackUTD video length limit (UNCONFIRMED; check the Devpost rules before editing).

Outputs and who uses them:
- A 2 to 3 minute video uploaded where Devpost can play it, a local copy on two laptops and a phone (C7 and demo day backup).
- The Devpost entry (judges).

Shots (`demo.md` Part 4): 1 wide pile shot and lights dimming; 2 robot crossing the rubble at robot height; 3 Screen A and Screen B at "Approve"; 4 survivor detail with thermal, camera, breathing, score; 5 the chain in the Agents panel; 6 over-the-shoulder walk and ring tap (for the overlay); 7 both screens as the glasses drop; 8 Buildings with "1 UNACCOUNTED"; 9 agents stopped and the watchdog assigning; 10 replay at 16x; 11 outdoor real GPS with live markers.

Commands:

```bash
npm run sim -- timeline video
open "http://localhost:5173/fallback.html?rescuer=cayden&ws=ws://localhost:8787/view&record=1"   # window 1152x576
# Screen blend of the glasses overlay (UNCONFIRMED, test once; both inputs same frame rate, footage 1920x1080)
ffmpeg -i footage.mp4 -i hud.mp4 -filter_complex "[0:v]format=gbrp[bg];[1:v]scale=960:480,pad=1920:1080:480:60:black,format=gbrp[hud];[bg][hud]blend=all_mode=screen,format=yuv420p" -c:a copy out.mp4
```

Steps:
- [ ] C6.1 (15 min) With Matthew: outdoor run with `site.demo_mode` false on an open lot, 2 minutes of walking; confirm the arrow points the right way and positions reach the dashboard; record shots 11 and 6 (no strangers' faces, house numbers, or plates).
- [ ] C6.2 (20 min) Indoor shots 1 to 5 and 7 to 10 from one `video` timeline run, with OBS or QuickTime capturing both screens; keep "DEMO MODE" and the map attribution visible.
- [ ] C6.3 (15 min) Record the fallback page in record mode during the walk, and blend it over shot 6 with Screen or Add; caption it "glasses view" the first time.
- [ ] C6.4 (20 min) Cut to 2 to 3 minutes following the pitch beats; lower-thirds in the tokens and type; full map attribution in the credits.
- [ ] C6.5 (20 min) Devpost: name, one sentence, what we built, how it works per track, what is live and what is simulated (hard-coded demo since 2026-11-08: only SpacetimeDB live), what is unconfirmed, the public repo link, the video, the screenshots; tracks NVIDIA, State Farm, SpacetimeDB.
- [ ] C6.6 (10 min) Submit well before the deadline; open the public page logged out and play the video.

Done when: submitted before the deadline, with the video playing from the Devpost page.
- The repo is public and has no `.env`, token, or key in its history (`git log -p | grep -i -E 'token|api_key|nvapi'` shows nothing secret).
- Screenshot check: the video's lower-thirds and captions match the slide frames (tokens and type).

Prompt for your coding agent:

```text
Draft the Devpost write-up for our HackUTD 2026 project as docs/devpost-draft.md (I will paste it into Devpost; it is not committed if I say so).
Read docs/MVP.md, docs/AGENT_WORKFLOW.md, docs/specs/demo.md "Honesty rules for the demo", and docs/specs/spacetimedb.md section 19.
Sections: Inspiration, What it does, How we built it (one paragraph each for SpacetimeDB, the Nemotron agents, the robot and perception, the G2 glasses), Challenges, Accomplishments, What we learned, What's next, Built with.
Say plainly what was live and what was simulated (the hundreds of extra survivors, the extra rescuers, injected failures), and list what is unconfirmed.
Use only numbers I give you from the measure script, and write TBD where I have none.
Never describe anyone as dead; use "no signs of life detected, low confidence".
Keep each section short; one sentence per line.
```

Pitfalls and fixes:
- Devpost uploads and video processing take time; submit a complete draft early and update it, rather than submitting at the deadline.
- If the ffmpeg blend fails, use the editor's Screen blend mode (Premiere, DaVinci Resolve, CapCut); the result is the same.
- The SpacetimeDB prize needs public source; confirm the team repo is public on the day you submit.

### C7. Rehearsals

Goal: two full runs of `specs/demo.md`, trying every fallback once; a 2-minute pitch with the timing in `docs/DESIGN.md`.
Update 2026-11-08: the judged demo is hard-coded, so rehearse `npm run sim -- timeline demo` (`docs/specs/demo.md`, "Judged demo (hard-coded, 2026-11-08)").
Steps C7.1 to C7.3 below were written for the original `judge.json` story, which is superseded for judging; C7.0 replaces them for the judged run.
Why it matters: checkpoint 5; every beat crosses hardware, models, and networks, and the fallbacks only work if they were tried once.
Estimate with AI: 1 h.

Inputs and dependencies:
- Checkpoint 4 passed, the deck (C5), the `judge.json` timeline (C3), every teammate at the booth setup.
- Schedule at least 6 hours before judging (`demo.md` build order note).

Outputs and who uses them:
- Beat timings per run and a list of fixes with owners (the team).
- A confirmed role per person: presenter, sim operator, robot handler, Cayden on the glasses.

Steps:
- [ ] C7.0 (15 min, added 2026-11-08) Judged run twice: republish Maincloud clean (`spacetime publish assess-0hw81 -p backend/spacetimedb --server maincloud --delete-data=always --yes`), `npm run sim -- setup`, then `npm run sim -- timeline demo`; confirm the find shows on the dashboard and the glasses view (on the G2 or the fallback page); try the `robot replay house3` fallback and the local server once each.
- [ ] C7.1 (15 min) Run 1 of the `demo.md` script with `npm run sim -- timeline judge`; time each beat against the script table (original plan, superseded for judging on 2026-11-08).
- [ ] C7.2 (15 min) Fallback drill: `rr` (robot replay), `?db=local` on both screens, fallback glasses page, `f4` on a sim rescuer, the escalation banner instead of the watchdog, `rp` instead of the form.
- [ ] C7.3 (15 min) Run 2 with the fixes; close the Even app three times and time the release each time.
- [ ] C7.4 (15 min) The 2-minute pitch twice with the slide timing; cut beats in the `demo.md` order if over time.

Done when: both rehearsals finish on time with no blocker.
- Every fallback in the "Risky steps and their fallbacks" table of `demo.md` has been tried once.
- The pitch lands within 2:00 on both tries.

Prompt for your coding agent:

```text
Add a "preflight" command to backend/sim/src/cli.ts that checks the booth before each judge group and prints PASS or FAIL per line.
Read docs/specs/demo.md "Before each judge group (5 minutes)" and "Risky steps and their fallbacks", and docs/specs/glasses.md section 5.13 (/healthz).
Check: the newest site has demo_mode true; robot dog1 online with a heartbeat under 5 s old; participants orchestrator, comms_agent, auditor online; a perception participant online; GET $GLASSES_BASE/healthz returns ok with db connected; the previous run is ended; the headline is 0; the local fallback server answers at the URI in STDB_URI_LOCAL if set.
Read only; never write to the database.
Print the elapsed time of each check and finish with one summary line.
```

Pitfalls and fixes:
- Rehearse on the hotspot, not on venue Wi-Fi, so the rehearsal matches the demo.
- Rehearse at the booth's real light level, because the breathing check needs some visible light.
- Between judge groups, end the run and start a new one; do not reset.

## Slides

Tool: Figma Slides or Canva, one place only.
Rules from `docs/DESIGN.md`: one idea per slide, at most one sentence plus a visual, real screenshots, large numbers, the product's tokens, no unlicensed disaster photos.

- [ ] 1. Title: name, one-line promise, the robot photo.
  Needs: a photo of the robot on the mock rubble (Matthew).
  For: everyone.
- [ ] 2. The worst day: a real disaster and a real person's story, with sources.
  Needs: a sourced tornado or collapse event (TBD).
  For: State Farm.
- [ ] 3. The gap: two or three sourced numbers about finding trapped people in time.
  Needs: sourced numbers (TBD).
  For: State Farm.
- [ ] 4. What we built: one sentence and one diagram (robot, board, agents, glasses).
  Needs: a diagram drawn from the tokens; the live board screenshot as a thumbnail.
  For: everyone.
- [ ] 5. Live demo: one slide that hands over to the live demo or the video.
  Needs: the glasses fallback screenshot (map view) and the "DEMO MODE" badge visible.
  For: everyone.
- [ ] 6. Agents that plan and act: the hand-off chain for one survivor (`chain_id`), with the auditor's verdict.
  Needs: the Agents panel full screen with one chain (`?view=agents&survivor=<id>&focus=chain`); median verdict time from C4.
  For: NVIDIA.
- [ ] 7. No one overlooked: the database guarantees, and "Critical survivors unattended over 60 s: 0" with hundreds of simulated survivors.
  Needs: the headline at 0 after `scale 300`, and the measured disconnect release and watchdog seconds.
  For: State Farm.
- [ ] 8. Built on SpacetimeDB: reducers as the whole backend, schedule tables as countdowns, lifecycle reducers, two screens in sync.
  Needs: table, reducer, schedule table, and view counts from `spacetime describe assess-0hw81 --json`; the Timers tab screenshot; a photo of both screens.
  For: SpacetimeDB.
- [ ] 9. Results: measured numbers only.
  Needs: time from find to acknowledgement (C4 measure), breathing accuracy on our clips (Eric), thermal range (Matthew and Eric's range test); `TBD` until measured.
  For: everyone.
- [ ] 10. Safety and honesty: never labels anyone dead, shows confidence, the robot cannot see through walls, privacy.
  Needs: a survivor row reading "No signs of life detected, low confidence"; a "PARTIAL, still in queue" cell.
  For: everyone.
- [ ] 11. Team and next steps: four people and roles, what a real pilot would need.
  Needs: names and roles from `docs/TASKS.md`; Camille's last name (TBD).
  For: everyone.

Two-minute pitch (draft timing from `docs/DESIGN.md`):

| Time | Beat | Slides |
| --- | --- | --- |
| 0:00 | The story in two sentences | 1, 2 |
| 0:15 | The gap in one number | 3 |
| 0:25 | The robot finds a person (live or video) | 4, 5 |
| 0:55 | The agents hand off, and the glasses guide the rescuer | 6 |
| 1:20 | Stop the agents: the database still assigns, and unattended stays at 0 | 7, 8 |
| 1:40 | Results and honesty in one line, then the ask | 9, 10, 11 |

## What to hand off if overloaded

Hand off whole tasks, with this file's steps and prompt, and say so in the team chat.
Matthew is the first choice once his hardware tasks (M1 to M7) are done, because his outdoor footage task (M8) already overlaps C6.

| Hand off | To | When | What they need from you |
| --- | --- | --- | --- |
| C3 simulator (or C3.3 to C3.6 after you commit `demo-site.json`) | Matthew, or whoever finishes first | as soon as C1.5 is published | bindings v3 or later, the C3 prompt, the `.env` values |
| C6 demo video (shoot and edit) | Matthew | after his M8 outdoor test | the shot list, the `video` timeline, the fallback page record URL, the ffmpeg command |
| C5 slides assets (screenshots, robot photo, diagram) | Matthew | after checkpoint 4 | the slides checklist above, the C5 capture prompt, the Figma or Canva link |
| C2 replay (dashboard build step 11) or the commander view | whoever finishes first | once `BoardState` and `useBoard` exist | `dashboard.md` steps 10 and 11 |
| C2 whole dashboard | whoever finishes first | if C1 is not done by checkpoint 1 | the C2 prompt and the Figma frames |

Never hand off: C1 (the contracts and the module are yours to keep consistent), the real G2 (your glasses and account), and C4 (one integration lead).

Cut order for your own glasses work if time runs short (`glasses.md` section 9): phone page geolocation (use demo mode), voice questions, the robot target toggle, browse, map tiles (`TILE_SOURCE=none`).
Never cut the fallback page, the heartbeat, the acknowledge view, or the released view.

## Demo day checklist

Decision 2026-11-08: the judged demo is hard-coded (`docs/specs/demo.md`, "Judged demo (hard-coded, 2026-11-08)", has its own booth checklist).
The booth items below that need `dog1`, the agents, perception, the Even app, the ring, or the demo walker are for the original live plan and are not needed for the judged run.

Night before or first thing:
- [ ] Module republished to Maincloud clean: `spacetime publish assess-0hw81 -p backend/spacetimedb --server maincloud --delete-data=always --yes` (repo root), then `npm run sim -- setup` from `backend/sim/`; bindings on `main` match the published module.
- [ ] `npm run sim -- timeline demo --dry` prints the judged steps, and one full `timeline demo` run on the local server finds the person in house 3.
- [ ] Local SpacetimeDB fallback on Laptop A: `spacetime start --listen-addr 0.0.0.0:3000`, module published there, `?db=local` tested on both screens once.
- [ ] Map tiles prefetched for the site (`npm run tiles` in the glasses service) and the dashboard area loaded once on the hotspot.
- [ ] Video backup on two laptops and a phone; deck PDF on two laptops and a phone.
- [ ] Devpost submitted before the deadline (TBD), and the video plays from the public Devpost page.

At the booth:
- [ ] Hotspot or travel router up; Laptop A, Laptop B, the robot, and the phone on it (never venue Wi-Fi).
- [ ] Laptop IP checked with `ipconfig getifaddr en0`; it matches `frontend/glasses/.env`, `app.json`, and `VITE_STDB_URI_LOCAL`.
- [ ] macOS firewall allows `node` on 5173, 8787, 5180, and 3000.
- [ ] Automatic time sync on, on both laptops.
- [ ] Two screens: Screen A on the projector (`?screen=A`), Screen B facing the judges (`http://<laptop-a-ip>:5180/?screen=B`), presence shows both.
- [ ] Glasses charged, R1 ring charged and paired, phone charged and plugged in if possible, Even app open, unlocked, in front, plugin loaded by QR.
- [ ] Fallback glasses page open in mirror mode on a small screen toward the judges; a second tab ready with `&primary=1` if the glasses fail.
- [ ] Judged demo: `status` shows the site in demo mode and no active run; dashboard and glasses view live on the same database; the presenter knows the line "only SpacetimeDB is live; the simulator scripts the robot and the find".
- [ ] (Original plan) `npm run sim -- preflight` (C7 prompt) or `status`: `dog1` online, agents online, perception online, glasses connected, headline 0.
- [ ] Previous run ended, new run ready; then `npm run sim -- timeline demo` for each judge group.
- [ ] (Original plan) Glasses demo walker reset (`R`); `rc`, `h`, `rb` running in the sim console.
- [ ] (Original plan) Teammate in the pile, booth lights at the rehearsed level, robot at the house 3 front door mark.
- [ ] If the network dies: play the video and use the PDF deck.
