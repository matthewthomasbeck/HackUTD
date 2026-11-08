# Local live agent scenario validation

Date: 2026-11-08. Branch: `eric-cv-benchmark`. Tasks: A4 and A5 in
`docs/tasks/eric-remaining.md`.

The primary agent runtimes now run against the actual local SpacetimeDB module and
`backend/sim/` through `npm run scenario -- <name> --live`. These checks use MockLLM
and real worker processes, real subscriptions, reducers and database schedule tables.
They make no NVIDIA requests and do not touch Maincloud or `assess-0hw81`.
The judged demo remains scripted, with only SpacetimeDB live.

## What changed

- `scripts/scenario.ts` routes the supported live names to `scripts/live-scenario.ts`.
  Each invocation requires a fresh, empty local database named `eric-live-<suffix>`.
  Remote servers, shared database names, combined `--real`, and unsupported dry modes
  are refused. The harness never publishes, resets or deletes a database.
- `scripts/live-worker.ts` composes the primary `AgentRuntime`, `LiveConnection`,
  `Budget`, MockLLM, guards and tools in a child OS process. It reports observations
  through IPC. Failure cases use an orchestrator process and a separate shared
  auditor/comms process. No model provider for NVIDIA is constructed.
- The simulator's own session, pool and finding path create the site, run, simulated
  detections, breathing results and scores. Its rescuers remain connected and heartbeat;
  acknowledgement is simulated explicitly. This does not exercise primary perception.
- `DRY_RUN=1` uses the existing in-process shadow for agent writes. The live database
  receives the simulator setup and detection, while proposal, review and briefing remain
  in the worker's shadow. The check verifies matching shadow chain IDs and a review
  verdict, plus zero live assignments, tasks, briefings, agent actions, missions or flags.
  Connections and their database lifecycle handling still occur.
- Watchdog-only comms templates now begin with `RULES FALLBACK:`, within 120 characters.
  Ordinary briefings and the A6 question path retain their behavior.
- Workers stop when the parent disconnects. Normal shutdown bounds its wait and escalates
  to SIGKILL; the global timeout and parent exit handler kill owned workers. Temporary
  tokens are separate from the normal `.tokens` directories and removed on cleanup.

## Results

All commands below ran on SpacetimeDB 2.14.1 on `127.0.0.1:3927`, with the current
module published into separate disposable databases. Each successful invocation exited 0.

| Scenario | Observed result |
| --- | --- |
| `chain --live` | Survivor 1, proposal 1, review 1 and briefing 1 shared one nonzero chain (254 in the initial run, 4243 on the final repeat). Review completed with a verdict; comms briefing reached the proposed simulator rescuer; its simulated acknowledgement changed the survivor to assigned. |
| `DRY_RUN=1 ... chain --live` | The worker's shadow completed proposal, review and briefing with chain 254; the six checked live domain/action tables remained empty. |
| `kill_orchestrator --live` | SIGKILL terminated the orchestrator process before the simulator detection. The module created the proposal, logged `agent_watchdog_fallback` and the exact action reason `orchestrator watchdog fallback`. The remaining comms/auditor process reviewed and sent a `RULES FALLBACK` template. Simulated acknowledgement assigned the survivor. |
| `race --live` | A 26-second mock reply ran in the actual orchestrator process while its subscriptions remained live. The database sweep's unproposed-immediate backstop proposed first, with action reason `unproposed immediate backstop`. Its late proposal was rejected as `already proposed by watchdog`; exactly one proposal existed. The guard wording covers both database fallback paths. |
| `all_down --live` | Both worker processes were SIGKILLed before detection. Database escalation briefings and a watchdog proposal still appeared. After simulated acknowledgement, withholding that rescuer's heartbeat released the assignment; the module proposed a replacement and a second simulated acknowledgement assigned the survivor. |
| `budget --live` | Ten simulator detections arrived within ten seconds. One orchestrator cycle successfully proposed at least two survivors. All ten survivors reached assigned after simulated acknowledgements. Six actual mock model sends occurred, with at most 20 in every rolling minute, no mock 429s, and the first dropped budget request belonged to the auditor, which used its rules verdict. |

Timer attribution: kill checks the module action's exact watchdog reason. Race records
the sweep backstop reason, rather than inferring the source from the shared fallback
event name or guard wording. In the all-down run, no
agent fallback could act because both processes were terminated. Release is a database
heartbeat timeout (15 s, versus the configured 120 s lease); the public release reason
does not distinguish the heartbeat schedule reducer from its periodic sweep backstop.
The replacement proposal is another database schedule action. This is distinct from
an agent's deterministic fallback.

The race fixture raises only that test worker's model-request timeout from the production
15 seconds to 30 seconds, so the injected 26-second reply reaches the guard after the
database fallback fires. It validates the stale proposal race independently of the production
timeout defense. An earlier SIGSTOP/SIGCONT version passed once but failed a repeat:
the paused worker's cached heartbeat was stale at resume, so freshness rejected the
proposal before the watchdog-specific guard. Keeping subscriptions live removes that
unrelated source of rejection; the production runner and limits are unchanged.

The budget case is a deliberately depleted queue fixture: the orchestrator gets 10 RPM,
and the shared auditor/comms worker gets 1 RPM. The fixture consumes that worker's initial
budget grant without sending a model request, then starts the auditor 500 ms before
comms. This makes the deadline/drop order repeatable. It validates actual queue drops,
rules fallback and batching; it does not establish throughput at the normal 20 RPM
production setting. The first burst attempt used 10 RPM for auditor/comms, assigned all
ten survivors and respected the send cap, but did not exhaust its queue, so it correctly
failed the required auditor-fallback assertion. The depleted fixture above then passed.

Primary agent checks after these changes:

- `npm run typecheck`: passed.
- `npx vitest run --exclude '**/codex-reference/**'`: 136 tests across 19 files passed.
- New unit checks cover the watchdog marker and length limit, remote/shared database
  refusal, and refusal of a dry failure scenario.

The owned local server on port 3927 was stopped after validation. No live scenario
workers were left running, and temporary worker/simulator token directories were removed.

## Reproduce

From the repository root, start a separate local server:

```sh
spacetime start --in-memory --data-dir /tmp/hackutd-eric-live-3927 --listen-addr 127.0.0.1:3927 --non-interactive
```

Publish a fresh database for every invocation. Do not reuse one after the harness has
seeded it, including after a failed assertion. For example:

```sh
spacetime publish eric-live-chain-new -p backend/spacetimedb --server http://127.0.0.1:3927 --yes
cd backend/agent
STDB_URI=http://127.0.0.1:3927 STDB_DATABASE=eric-live-chain-new npm run scenario -- chain --live
```

Use a new `eric-live-...` database and substitute `kill_orchestrator`, `race`, `all_down`
or `budget` for the other cases. For the dry variant, use another fresh database and
add `DRY_RUN=1` before `npm run scenario -- chain --live`. The slowest cases wait for
real database timers. The harness bounds an invocation at 120 seconds.

## Limits

This acceptance does not establish Maincloud roles, real Nemotron accuracy, speech,
glasses display, a second dashboard screen, hardware operation, primary breathing
analysis or a Pi upload. The live `chain` here checks A4's survivor/proposal/review/
briefing chain and simulated acknowledgement; it does not reproduce every inspect
mission and family-report beat of the larger original demo script. Other scenario
names remain available against the existing fake module, but are not implemented by
this local live harness. No shared contract changed.
