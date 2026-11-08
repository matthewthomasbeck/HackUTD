# Agent runner (`backend/agent/`)

One Node.js TypeScript runner for the three Nemotron agents in `docs/AGENT_WORKFLOW.md`: the orchestrator, the auditor, and the comms agent.
Each agent is a configuration (prompt, tools, model, wake rules, fallback) of the same runner, and the agents coordinate only through `agent_task` rows.
The spec is `docs/specs/agent.md`; shared names are in `docs/specs/CONTRACTS.md` (it wins where they differ).

## Setup

Node.js 22 or newer.

```bash
cd backend/agent
npm install
cp .env.example .env      # then paste NVIDIA_API_KEY; never commit .env (the repo is public)
npm run typecheck && npm test
```

### Brev-only deployment (2026-11-08)

Eric's deployment runs both models on Brev. The `NVIDIA_*` environment names are retained for compatibility; the base URL selects the server.
No Build API key is needed for this deployment:

```dotenv
NVIDIA_BASE_URL=http://localhost:18001/v1
NVIDIA_API_KEY=none
NANO_BASE_URL=http://localhost:18000/v1
NANO_API_KEY=none
SUPER_REASONING_EFFORT=none
NANO_THINKING_OFF=1
TOOL_MODE_SUPER=native
TOOL_MODE_NANO=native
```

Forward the two loopback-only model servers before starting the agents:

```bash
ssh -fNT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 18000:127.0.0.1:8000 hackutd-lightning
ssh -fNT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 18001:127.0.0.1:8000 hackutd-super
```

`hackutd-lightning` serves Lightning BF16 using vLLM 0.27.1 on an A100 80 GB.
`hackutd-super` serves NVIDIA's Super VL NVFP4 checkpoint using vLLM 0.32.0 on an RTX PRO 6000 96 GB.
The served model names remain the distinct `MODEL_SUPER` and `MODEL_NANO` names below.
The quoted combined compute rate is $4.32/hour. Lightning can be stopped; this Super instance cannot be paused and must be deleted when no longer needed.

With `low` reasoning, Super sometimes took over 10 s and skipped the inspection step.
`SUPER_REASONING_EFFORT=none` follows the slow-response policy in agent.md 4.3.
The prompt now states that an online robot can queue its next inspection while an existing mission is active, provided there is no proposed or queued mission.

The Brev smoke test passed native tool calls, tool results, reasoning off, and JSON actions on both models.
With reasoning off, observed native tool-call latency was 1.56 s for Super and 1.12 s for Lightning; JSON actions took 1.02 s and 0.58 s respectively.
JSON mode requests `response_format: {"type":"json_object"}` from the server and then applies the normal argument and permission checks.

## Commands

| Command | What it does |
| --- | --- |
| `npm run smoke:llm` | Tool calling and strict JSON on Super and Nano (agent.md 4.3); exits cleanly with a message if `NVIDIA_API_KEY` is missing |
| `npm run scenario -- <name\|all>` | The eight scenarios of agent.md 12.3 against the in-process fake module (no database, no key) |
| `npm test` | vitest: unit tests plus every scenario with MockLLM |
| `npm run typecheck` | `tsc --noEmit` |
| `npm start` | The agents in `AGENTS` against the live module (needs the bindings, see below) |
| `npm run dry` | `DRY_RUN=1 npm start` |
| `npm run smoke:vision` | Placeholder; the vision describer (E10) is not built |

Scenario names: `chain`, `priority`, `kill_orchestrator`, `race`, `auditor_disagrees`, `comms_fallback`, `all_down`, `budget`.
`ENABLE_COMMS_MODEL`, `ENABLE_AUDITOR_MODEL`, `TOOL_MODE`, and `RPM_BUDGET` from the environment apply to scenarios, for example `TOOL_MODE=json npm run scenario -- chain`.

`npm run scenario -- --real` calls the configured model servers against the fake database.
It runs `chain`, `priority`, `auditor_disagrees`, and `kill_orchestrator`; the other scenarios rely on scripted model failures and stay in the mock suite.
The real auditor test seeds a known bad proposal before starting the agents, so it checks disagreement without requiring Super to choose badly.
The real priority test checks the resulting assignments; the intentional wrong-first-attempt guard check stays in the mock test.

## Tool mode decision (E0)

`npm run smoke:llm` prints this table; paste its result here and the decision into `docs/specs/agent.md` 4.3.

| Model | Native tool call (steps 1 and 2) | JSON action (step 4) | Thinking off (step 3) | Latency | Decision |
| --- | --- | --- | --- | --- | --- |
| `nvidia/nemotron-3-super-120b-a12b` | HTTP 404, function not found for our account | HTTP 404 | HTTP 404 | - | not usable |
| `nvidia/nemotron-3-nano-30b-a3b` | HTTP 410, end of life on 2026-09-01 | HTTP 410 | HTTP 410 | - | not usable |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` (orchestrator) | pass | pass | `reasoning_effort: "none"` accepted, reasoning text gone | 0.8 to 2.0 s | `TOOL_MODE_SUPER=native` |
| `nvidia/nemotron-3.5-lightning-30b-a3b` (auditor, comms) | pass | pass only with thinking off (empty reply otherwise) | `enable_thinking: false` accepted, reasoning text gone | 0.1 to 1.3 s | `TOOL_MODE_NANO=native`, `NANO_THINKING_OFF=1` |

Smoke test run on 2026-11-07 against build.nvidia.com; no 429 seen.
The original Super model returned 404 for our key and Nano 30B reached end of life, so `.env.example` and agent.md 4.1 use the two Nemotron 3.5 models above.

Set `TOOL_MODE_SUPER` and `TOOL_MODE_NANO` in `.env` from the result; it is a config change, not a code change.
`NANO_THINKING_OFF=1` sends `chat_template_kwargs: {"enable_thinking": false}` to Nano, only if step 3 shows the hosted API honors it.

## Registration and roles

Each agent connects with its own identity (token in `STDB_TOKEN_DIR/<agent>.token`) and calls `register_participant`:

| Agent | `name` | `role` |
| --- | --- | --- |
| Orchestrator | `orchestrator` | `agent` |
| Comms agent | `comms_agent` | `agent` |
| Auditor | `auditor` | `auditor` |

In demo mode, or before any site exists, the module accepts these roles directly.
Otherwise a coordinator or commander must first call `grant_role(identity, role)` for each identity, with the role from the table; the identity hex is in the startup log line `identity <hex>`.
For example, signed in as a coordinator: `spacetime call <db> grant_role 0x<hex> '{"agent":[]}'` (use `'{"auditor":[]}'` for the auditor).
Until the grant, `register_participant` fails with `role not granted`, and the runner retries after 2, 4, 8, 15, then every 30 s, so no restart is needed.
Heartbeats wait until registration succeeds, and an `agent_heartbeat` rejected with `not registered` starts registration again.

### Environment names

`STDB_URI` and `STDB_DATABASE` follow `docs/specs/CONTRACTS.md`.
The agents use `STDB_TOKEN_DIR` (agent-internal) instead of the contract's `STDB_TOKEN`, because one process holds three identities, one token file each; see the proposed contract change in `docs/specs/agent.md`.
Use an `http://` or `https://` (or `ws://`) URI; the perception service shares the same `STDB_URI` and needs `http(s)://`.

## Switches

From agent.md 3.2: `DRY_RUN`, `LLM_MODE`, `ENABLE_AUDITOR_MODEL`, `ENABLE_COMMS_MODEL`, `ENABLE_QUESTIONS`, `ENABLE_VISION`, `ENABLE_SITREP`, `RPM_BUDGET`, `DEBOUNCE_MS`, `MAX_WAIT_MS`.

### `LLM_MODE=mock` (our addition)

`LLM_MODE=mock` swaps the NVIDIA client for `MockLLM` (`src/llm/mock.ts`), which replays recorded replies from `test/fixtures/`.
It needs no `NVIDIA_API_KEY` and sends nothing to NVIDIA.
`MOCK_FIXTURES` (comma list, default `chain`) picks the fixture files; `common.json` is always added last.
A request with no matching fixture fails as a model error, so that agent's fallback runs (agent.md 12.2).
Fixture format is in the top comment of `src/llm/mock.ts`; two scripted policies in `src/llm/policies.ts` play a rule-following model where a static reply cannot work (many survivors at once).
This switch is agent-internal; CONTRACTS.md 8.1 lists it under "Agent-internal switches".

### `DRY_RUN`

- `DRY_RUN=1`: no reducer reaches the module at all (no claims, no writes, no `log_agent_action`, no heartbeat).
  Write tools answer the model `{ok: true, dry_run: true}`.
  So that one detection still shows a whole chain (wake, proposal, `brief_rescuer`, `review`, briefing) in the console and `logs/trace-<date>.jsonl`, writes play out in an in-process shadow: the fake module over an overlay of the live cache.
  Nothing in SpacetimeDB changes.
  Note: with no orchestrator heartbeat, the real module's watchdog will propose for `immediate` survivors during a long dry run.
- `DRY_RUN=log`: the same, plus `log_agent_action` rows with result `dry_run: not executed`, so the dashboard team can build the Agents panel.
- `LLM_MODE=mock DRY_RUN=1`: full cycles with no model calls and no reducer calls.

Against the in-process fake module (`npm run scenario`, `npm test`) every write goes to the fake module, which is the dry-run shadow, so no real reducer can run whatever `DRY_RUN` says.

## Layout

As agent.md 3.1, plus:

| File | Why |
| --- | --- |
| `src/types.ts` | Contract rows in snake_case, the `TableSource` interface |
| `src/actions.ts` | The reducer calls an agent may make (`Actions`), and the `DRY_RUN` wrapper |
| `src/agent-types.ts` | `AgentConfig`, wakes, cycle context |
| `src/runtime.ts` | Wake rules, debounce and merge, heartbeat policy 8.1, startup scan 8.3 |
| `src/clock.ts` | Real clock, and a virtual clock so a 15 s watchdog test takes milliseconds |
| `src/agents/prompts.ts` | The three system prompts, verbatim from agent.md (a test checks them against the spec) |
| `src/fake/` | `MemoryStore`, `OverlayStore`, the fake module, and the test harness |
| `src/llm/mock.ts`, `src/llm/policies.ts` | `MockLLM` for `LLM_MODE=mock` |
| `scripts/scenarios.ts` | The eight scenarios; `scripts/scenario.ts` is the CLI |

Only `src/stdb/` touches the generated bindings, through a dynamic import, so `npm run typecheck` and `npm test` pass before `backend/spacetimedb-bindings/` exists.
`npm start` without the bindings exits with the `spacetime generate` command to run.

## Still needs

- Local adapter acceptance passed on 2026-11-08: all three identities registered, active run and row values decoded, tasks posted/claimed/completed with matching action logs, plus an Identity-based proposal, review, briefing, simulated acknowledgement and optional mission arguments. Run `npm run smoke:stdb` against an empty disposable local database. The script rejects remote servers and existing sites. See `docs/notes/2026-11-08-eric-transition-validation.md` for setup and evidence. Maincloud service roles still need separate verification.
- The upstream simulator source is now merged into `backend/sim/`. Live integration remains unverified: `npm run scenario -- --live` is still reserved and exits with a message today. See `docs/tasks/eric-remaining.md`.

## Extension points

- E8, rescuer questions: `answer_rescuer` tasks are handled in `src/agents/comms.ts` with the "model down" answer template; the model path goes where the comment marks it.
- E10, `describe_still` and `sitrep`: add the tool names to the allow lists in `src/agents/comms.ts` and `src/agents/orchestrator.ts`, their schemas in `src/tools/schemas.ts`, and implementations next to `src/tools/reads.ts`.
