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

## Tool mode decision (E0)

`npm run smoke:llm` prints this table; paste its result here and the decision into `docs/specs/agent.md` 4.3.

| Model | Native tool call (steps 1 and 2) | JSON action (step 4) | Thinking off (step 3) | Latency | Decision |
| --- | --- | --- | --- | --- | --- |
| `nvidia/nemotron-3-super-120b-a12b` | not run yet | not run yet | not run yet (`reasoning_effort: "none"`) | not run yet | not run yet |
| `nvidia/nemotron-3-nano-30b-a3b` | not run yet | not run yet | not run yet (`enable_thinking: false`) | not run yet | not run yet |

Set `TOOL_MODE_SUPER` and `TOOL_MODE_NANO` in `.env` from the result; it is a config change, not a code change.
`NANO_THINKING_OFF=1` sends `chat_template_kwargs: {"enable_thinking": false}` to Nano, only if step 3 shows the hosted API honors it.

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

- The NVIDIA key: `npm run smoke:llm`, the tool-mode table above, and the real-model runs of `chain` (three times), `TOOL_MODE=json`, and `ENABLE_COMMS_MODEL=1`.
- The generated bindings and the published module: `npm start`, the three identities registering, and checks of every UNCONFIRMED item in the top comment of `src/stdb/connect.ts` (argument key spelling, enum shapes, `Identity.fromString`, optional arguments).
- The simulator (`backend/sim/`): `npm run scenario -- --live` is reserved for it and exits with a message today.

## Extension points

- E8, rescuer questions: `answer_rescuer` tasks are handled in `src/agents/comms.ts` with the "model down" answer template; the model path goes where the comment marks it.
- E10, `describe_still` and `sitrep`: add the tool names to the allow lists in `src/agents/comms.ts` and `src/agents/orchestrator.ts`, their schemas in `src/tools/schemas.ts`, and implementations next to `src/tools/reads.ts`.
