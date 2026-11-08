# Eric transition validation, 2026-11-08

Pulled `main` from `80eca49` to `3635d22` with a clean fast-forward.
The module, generated bindings, simulator, dashboard and glasses sources are available.
This check used an isolated in-memory SpacetimeDB 2.14.1 server on localhost,
not the team's shared Maincloud database. No model API calls or teammate messages were sent.

## Completed handoff items

- E3 8b: perception registered, called `report_breathing` then `set_critical_score`,
  and verified the SQL readback. Captured actual survivor/detection wire data in
  `backend/perception/tests/fixtures/sql_sample_captured.json` and added a decoder regression check.
- E3 10b: helper typecheck/build passed against the actual generated bindings.
  The live helper delivered a survivor update in under 0.01 s after a score write.
- E6 6: all three agent identities registered with their correct demo roles,
  heartbeats succeeded, and each adapter read active run #1.
- E6 8b: auditor and comms tasks each completed post/claim/log/complete round trips,
  visible through the orchestrator's independent subscription.

The new `npm run smoke:stdb` also exercises Identity encoding for a proposal,
the module-generated review task, review completion, a recipient briefing,
simulated rescuer acknowledgement, and inspect/cancel mission optional arguments.
Its second fresh-database run used run #1, survivor #1, chain #9.
These are deterministic adapter calls, not autonomous model decisions or a glasses display check.

For example, the orchestrator adapter proposes survivor #1 to an actual SDK Identity.
The database inserts the assignment and review task. The auditor adapter observes,
claims and completes that task. The comms adapter posts a briefing, and the
simulated rescuer accepts. The orchestrator's subscription confirms `active`.

## Reproduce

Install each component's dependencies with `npm ci`. Run the server in one terminal:

```bash
spacetime start --in-memory --data-dir /tmp/hackutd-eric-transition-db --listen-addr 127.0.0.1:3918 --non-interactive
```

Use a fresh local database name for each adapter smoke. The smoke rejects remote servers
and refuses a database that already contains a site. It creates temporary agent tokens
and removes them on completion; it leaves the simulated rows for the perception smoke.

```bash
spacetime publish eric-transition -p backend/spacetimedb --server http://127.0.0.1:3918 --yes
cd backend/agent
STDB_URI=http://127.0.0.1:3918 STDB_DATABASE=eric-transition npm run smoke:stdb
cd ../perception
cd stdb-helper && npm ci && npm run typecheck && npm test && cd ..
STDB_URI=http://127.0.0.1:3918 STDB_DATABASE=eric-transition PERCEPTION_PATHS_DATA_DIR=/tmp/hackutd-eric-perception .venv/bin/python scripts/smoke_stdb.py
```

The committed SQL fixture came from the first adapter smoke before the added
proposal/acknowledgement checks, while the survivor was still `unassigned`.
It contains only simulated data. Do not overwrite it with shared deployment or personal data.

## Other checks and fixes

- Agent: 97 tests passed and TypeScript check passed, including the new smoke script.
- Perception: full suite 748 passed, 9 skipped before the new captured-fixture regression;
  the updated database test file then passed all 16 tests. Optional model-dependent
  checks were not forced on. This machine's new core-only test environment is not
  the primary demo environment, so no demo dependency lock is claimed.
- Helper: 3 tests passed. Fixed its test command to use `test/*.test.js`,
  because `node --test test/` failed to resolve the directory with the installed Node.
- Simulator: 20 tests passed. Added the missing direct `@types/node` development
  dependency so a clean install also passes its documented TypeScript check.
- Actual module: `npm test` passed all 68 printed checks on a separate disposable server.
  These include task lease expiry, rescuer disconnect release, both escalation levels,
  no repeated escalation, stale robot handling, repeated watchdog proposals and the
  unproposed-immediate backstop while the orchestrator stays alive.

## Remaining acceptance

Maincloud roles, complete simulator/perception/runtime/dashboard/glasses flow,
two-process worker kill scenarios, real Nemotron with the live database, visible
acknowledgement/replay, score ageing, and the robot upload/capture path remain open.
The module smoke checks verify its own schedules; they do not complete E7's
two-process agent kill demo. Public-data benchmarking, ROI review and the demo
environment lock also remain. Voice, terrain and E10 retain their existing priority.
