# Spec: Nemotron agents (`backend/agent/`)

Status: PROPOSED, 2026-11-07; follows `docs/specs/CONTRACTS.md` version 8.1.
Owner: whoever builds the agents.
Time left at writing: about 16 hours to the HackUTD deadline (Nov 7-8, 2026).

Read `docs/specs/CONTRACTS.md` first.
It wins wherever this spec differs.
This spec uses its table, column, reducer, role, and enum names exactly.
The earlier single-agent version of this spec (one "coordination agent" with weather and walking-route tools) is replaced by this document.

Also read `docs/AGENT_WORKFLOW.md` (the decided agent set and cut order) and `docs/research/agents.md` (why this set).

Sources are numbered [N1] and up, listed at the end.
Items marked UNCONFIRMED must be checked by the smoke tests in section 4 before anyone builds on them.

## 1. Summary

- One Node.js TypeScript program, the agent runner, in `backend/agent/`.
- The runner is a SpacetimeDB client that uses the generated bindings in `backend/spacetimedb-bindings/`, and a client of NVIDIA's hosted OpenAI-compatible API.
- Each agent is a configuration of the runner: a system prompt, an allowed tool list with JSON schemas, a model, wake rules, and a deterministic fallback.
- Three agents:

| Agent | `participant.name` | Role | Model | Status |
| --- | --- | --- | --- | --- |
| Orchestrator | `orchestrator` | `agent` | Nemotron 3.5 Super VL | Must have, never cut, built first |
| Auditor | `auditor` | `auditor` | Nemotron 3.5 Lightning | Must have, built first |
| Comms agent | `comms_agent` | `agent` | Nemotron 3.5 Lightning | Must have; templates first, its model is added once the core demo runs end to end |

- The orchestrator plans the search and calls `create_mission` and `cancel_own_mission` directly; there is no separate search agent.
- Two could-have extras: a vision describer tool (`describe_still`, used by the comms agent) and a `sitrep` task (a short situation summary the orchestrator asks the comms agent to post).
- Agents coordinate only through `agent_task` rows (post, claim with a lease, complete).
  No agent calls another agent directly.
- Every task and every logged action carries a `chain_id`, so the dashboard can follow one survivor from detection to acknowledgement.
- Every tool call is logged to `agent_action` with `agent`, `model`, and `reason`.
- The database keeps every guarantee (survivor states, leases, heartbeats, escalation, watchdog) with every agent down.
  The agents improve decisions and communication; they never hold a promise the database depends on.

## 2. Rules every agent follows

These rules are in every system prompt, enforced by the runner's guards, and enforced again by the module's reducers.

- G1 Never resolve a survivor.
  `resolve_survivor` is not a tool; the module rejects it for roles `agent` and `auditor`.
- G2 Never label anyone dead.
  All free text (briefings, reasons, task payloads, `result_json`, flag messages) is rejected if it matches
  `/\b(dead|deceased|died|death|expectant|fatal|corpse|body recovery|no pulse|lifeless)\b/i`.
  Briefings are also rejected if they match `/\brescued\b/i` or `/\bsafe now\b/i` (only a person resolves a survivor).
  For `breathing: not_detected`, the only allowed wording is "no signs of life detected, low confidence" or "breathing not seen".
- G3 Never lower anyone's priority because breathing was not seen.
  `not_detected` and `unknown` breathing always sort in tier 0 (section 7.1), whatever `critical_level` says.
  No agent writes `critical_level` or `critical_score` (perception owns them).
- G4 Never drive the robot.
  Agents only create missions; the robot's state machine and safety gate accept or reject them (`docs/ROBOT.md`).
  No agent marks a cell searched (`mark_cell` is robot and coordinator only).
- G5 Briefings are at most 120 characters, plain ASCII, one line.
  Longer text is rejected with its length in the error so the model can shorten it.
- G6 Only the orchestrator proposes assignments (`propose_assignment`).
- G7 Agents act only on the active run (section 6.3).
- G8 External web requests (NVIDIA only, plus the optional vision call) carry no personal information: no rescuer names, identities, phone numbers, or emails.
  Rescuers appear to models only by callsign (for example "Rescuer A").
  Resolved 2026-11-08: the tools and task payloads below keep identity hex inside the runner and the module, but a model never sees it.
  Before each model request the loop replaces every participant's identity hex with the rescuer's callsign (or the person's role), and the model-facing `rescuer_identity` and `audience` fields take a callsign.
  Before dispatch the loop maps a callsign back to the identity hex, so ajv still checks the hex pattern and the guards and reducers are unchanged.
  The callsign map is per agent process, so a callsign is resolved by the same agent that showed it.
  Rescuer questions and board notes can contain contact details outside the participant table. Before every model request, the same filter masks email addresses and conventional 10 to 15 digit phone numbers, including common spaced, dashed and dotted forms.

## 3. Folder, dependencies, configuration

### 3.1 Folder

```
backend/agent/
  package.json
  tsconfig.json
  .env.example              committed
  .env                      git-ignored
  .tokens/                  git-ignored, one saved SpacetimeDB token per agent
  src/
    index.ts                start the agents named in AGENTS, wire wake rules
    config.ts               reads .env, exports a typed Config
    stdb/connect.ts         one DbConnection per agent identity
    stdb/convert.ts         camelCase rows to snake_case, bigint, Identity, Timestamp, enums
    world.ts                WorldView: typed reads over the cache, active run filter
    chain.ts                find or carry the chain_id for a survivor, task, or question
    board.ts                agent_task: claim, lease deadline, complete
    llm/client.ts           OpenAI client with NVIDIA base URL
    llm/budget.ts           one shared priority queue, 20 requests per minute
    llm/parse.ts            strict JSON fallback parser
    loop.ts                 one agent cycle: model, tool calls, step limit
    agents/orchestrator.ts  prompt, tools, wake rules, fallback
    agents/comms.ts
    agents/auditor.ts
    tools/schemas.ts        JSON schemas, one source for native and JSON modes
    tools/reads.ts          read tools over WorldView
    tools/writes.ts         reducer tools
    tools/vision.ts         describe_still (could have)
    tools/sitrep.ts         sitrep (could have)
    tools/dispatch.ts       validate, guard, execute, log
    guards.ts               G1 to G8 and the per-tool checks
    priority.ts             survivor tiers and ordering
    templates.ts            template briefings (comms fallback)
    rules.ts                deterministic fallbacks: auditor verdicts, search continue rule
    geo.ts                  haversine distance, bearing, 8 compass words
    log.ts                  console and JSONL trace
  scripts/
    smoke-llm.ts            tool calling and strict JSON on the hosted models
    smoke-vision.ts         one still to the vision model (could have)
    scenario.ts             scripted scenarios with the demo simulator
  test/
    *.test.ts               vitest
    fixtures/               recorded model replies for MockLLM
```

- Node.js 22 or newer [N8].
- Runtime dependencies: `spacetimedb` (official SDK [N8]), `openai` (official OpenAI Node client with a custom `baseURL`), `ajv`, `dotenv`.
- Dev dependencies: `typescript`, `tsx`, `vitest`.
- Pin the versions that `npm install` resolves on the day, in `package-lock.json`.
- Only `src/stdb/` and `world.ts` import the generated bindings from `backend/spacetimedb-bindings/`, so a binding change touches those files only.

Scripts:

| Script | Command |
| --- | --- |
| `start` | `tsx src/index.ts` |
| `dry` | `DRY_RUN=1 tsx src/index.ts` |
| `smoke:llm` | `tsx scripts/smoke-llm.ts` |
| `smoke:vision` | `tsx scripts/smoke-vision.ts` |
| `scenario` | `tsx scripts/scenario.ts` |
| `test` | `vitest run` |
| `typecheck` | `tsc --noEmit` |

### 3.2 `.env.example`

```
# NVIDIA (key from build.nvidia.com; one teammate gets it by hand)
NVIDIA_API_KEY=
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
MODEL_SUPER=nvidia/nemotron-3.5-super-vl-120b-a12b
MODEL_NANO=nvidia/nemotron-3.5-lightning-30b-a3b
MODEL_VISION=nvidia/nemotron-nano-12b-v2-vl
SUPER_REASONING_EFFORT=low    # none | low | high; use none when Super replies exceed about 10 s
TOOL_MODE=native              # native | json, chosen by smoke:llm, per model below overrides
TOOL_MODE_SUPER=
TOOL_MODE_NANO=
RPM_BUDGET=20                 # shared by every agent in this process

# Which agents this process runs (comma list or "all")
AGENTS=all                    # orchestrator,comms_agent,auditor

# SpacetimeDB
STDB_URI=ws://localhost:3000  # or the Maincloud URI
STDB_DATABASE=
STDB_TOKEN_DIR=.tokens

# Behavior
DRY_RUN=0                     # 0 | 1 | log (section 12.2)
LLM_MODE=nvidia               # nvidia | mock (section 12.2); mock replays test/fixtures/, no API calls
ENABLE_VISION=0
ENABLE_SITREP=0
ENABLE_QUESTIONS=1
ENABLE_AUDITOR_MODEL=1        # 0 uses rules verdicts
ENABLE_COMMS_MODEL=1          # 0 uses template briefings
DEBOUNCE_MS=1500
MAX_WAIT_MS=4000
```

The agents never sign up for anything.
Getting the key is a manual step for one teammate: "Get API Key" on a model page at build.nvidia.com [N6].

### 3.3 Processes and identities

- Default: one process with `AGENTS=all`, which opens three SpacetimeDB connections, one per agent, each with its own identity and token file (`.tokens/<name>.token`).
  One connection per agent follows the lesson in [S3] that one shared connection became a bottleneck.
- All agents in one process share one request budget (section 5.3).
- For the "kill the orchestrator" test and demo beat, run two processes: `AGENTS=orchestrator RPM_BUDGET=10` and `AGENTS=comms_agent,auditor RPM_BUDGET=10`.
  The two budgets add up to 20, so the shared limit still holds.
- On first connect, each agent calls `register_participant(name, role)` with its name from the table in section 1.
  Roles other than `rescuer` need demo mode or a prior `grant_role` by a coordinator (contract).
- The orchestrator's connection is the only one that calls `agent_heartbeat` for the watchdog (section 8); the others call it every 10 s so the dashboard shows them alive.

## 4. Model access

### 4.1 Facts (checked 2026-11-07; model ids changed after the smoke test, see 4.3)

| Item | Value | Source |
| --- | --- | --- |
| Base URL and endpoint | `https://integrate.api.nvidia.com/v1`, `POST /chat/completions`, bearer token | [N1][N2] |
| Orchestrator model | `nvidia/nemotron-3.5-super-vl-120b-a12b`; the first choice `nvidia/nemotron-3-super-120b-a12b` returns HTTP 404 for our key | smoke test 2026-11-07, [N1] |
| Comms and auditor model | `nvidia/nemotron-3.5-lightning-30b-a3b`; the first choice `nvidia/nemotron-3-nano-30b-a3b` returns HTTP 410 (end of life 2026-09-01) | smoke test 2026-11-07, [N2] |
| Vision model (could have) | `nvidia/nemotron-nano-12b-v2-vl`, same endpoint; images go in a `user` message as `{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}` or a public URL; `max_tokens` 1 to 8192 | [V1] |
| `stream` | defaults to `true`; always send `stream: false` | [N1][N2] |
| `reasoning_effort` | Super only: `none`, `low`, `high`, default `high`; send `low` for the orchestrator | [N1] |
| Nano thinking off | `chat_template_kwargs: {"enable_thinking": false}`; confirmed on Lightning by the smoke test (reasoning text gone), and needed for its JSON mode | [N2], smoke test |
| `temperature`, `top_p` | Nano card recommends 0.6 and 0.95 for tool calling; use those for all text models | [N3] |
| `tools`, `tool_choice` | Confirmed on both models by the smoke test (native tool call and tool result both pass) | smoke test 2026-11-07 |
| Tool format | OpenAI style; results return as `role: "tool"` messages with `tool_call_id`; NIM can put a tool call in `content` when its parser fails | [N4] |
| Rate limit | About 40 requests per minute from forum reports, UNCONFIRMED; our own cap is 20 | [N7] |
| HTTP 202 | Result pending; treated as a retryable failure | [N1] |

Inference: the build.nvidia.com deploy page for the vision model did not render for an automated fetch on 2026-11-07, but the API reference page gave the model id and image format [V1]; confirm it with `smoke:vision` before building on it.

### 4.2 Client and request

```ts
import OpenAI from "openai";
export const client = new OpenAI({
  apiKey: cfg.NVIDIA_API_KEY,
  baseURL: cfg.NVIDIA_BASE_URL,
  timeout: agent.timeoutMs,   // per agent, section 4.4
  maxRetries: 0,              // retries go through the budget queue
});

const body: any = {
  model: agent.model,
  messages,
  temperature: 0.6,
  top_p: 0.95,
  max_tokens: agent.maxTokens,
  stream: false,
  ...(toolMode === "native" ? { tools: agent.toolDefs, tool_choice: "auto" } : {}),
  ...(agent.model === cfg.MODEL_SUPER ? { reasoning_effort: cfg.SUPER_REASONING_EFFORT } : {}),
  ...(agent.model === cfg.MODEL_NANO && cfg.NANO_THINKING_OFF ? { chat_template_kwargs: { enable_thinking: false } } : {}),
};
```

Response handling:

- Missing or empty `choices` (for example a 202) is a failure.
- Strip any `<think>...</think>` block from `content`; keep the first 300 characters of any `reasoning_content` in the trace file only.
- If `tool_calls` is empty but `content` holds a JSON tool call, parse it with `parse.ts` and run it [N4].

### 4.3 First smoke test (`npm run smoke:llm`), before anything else

Needs only the API key, no SpacetimeDB.
For each of Super and Nano:

1. Send one request with one tool, `compute_bearing` (`{from_lat, from_lon, to_lat, to_lon, reason}`), and the message "Use compute_bearing from 32.9857,-96.7502 to 32.9861,-96.7497 and tell me the result."
   Pass if `tool_calls[0].function.name === "compute_bearing"` and the arguments parse with four numbers.
2. Send the tool result back as a `role: "tool"` message.
   Pass if the reply has no tool calls and mentions meters.
3. Send `reasoning_effort: "none"` (Super) or `chat_template_kwargs` (Nano) once, and record whether it is accepted and whether reasoning text disappears.
4. Repeat step 1 with `TOOL_MODE=json` (no `tools` field, catalog in the prompt) and check that `parse.ts` extracts the action.
5. Print HTTP status and latency of every call.

A `curl` equivalent sits in the top comment of `smoke-llm.ts` so anyone can test the key in one line.

| Result | Action |
| --- | --- |
| Native tool calls work | `TOOL_MODE_<model>=native` |
| A 400 that mentions `tools` or extra properties, or no tool call returned | `TOOL_MODE_<model>=json` |
| Super replies take more than about 10 s | Orchestrator keeps Super with `reasoning_effort: "none"`; if still slow, the team decides whether to use Nano, and says so honestly |
| Both models fail | All agents run on fallbacks (section 9); the database watchdog assigns |

Result (2026-11-07, Eric's key, full table in `backend/agent/README.md`):

| Model | Native (steps 1, 2) | JSON (step 4) | Thinking off (step 3) | Latency | Decision |
| --- | --- | --- | --- | --- | --- |
| `nvidia/nemotron-3-super-120b-a12b` | HTTP 404 | HTTP 404 | HTTP 404 | - | not usable |
| `nvidia/nemotron-3-nano-30b-a3b` | HTTP 410, end of life | HTTP 410 | HTTP 410 | - | not usable |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` | pass | pass | `reasoning_effort: "none"` accepted | 0.8 to 2.0 s | `TOOL_MODE_SUPER=native` |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | pass | pass only with thinking off | `enable_thinking: false` accepted | 0.1 to 1.3 s | `TOOL_MODE_NANO=native`, `NANO_THINKING_OFF=1` |

No 429 was seen. The env names `MODEL_SUPER` and `MODEL_NANO` stay; they now hold the two Nemotron 3.5 models.

Brev-only validation (2026-11-08): Super VL NVFP4 on an RTX PRO 6000 96 GB and Lightning BF16 on an A100 80 GB both pass all four smoke steps.
The served model ids stay the same. `NVIDIA_BASE_URL` selects the Super server at `http://localhost:18001/v1`; `NANO_BASE_URL` selects Lightning at `http://localhost:18000/v1`. Both keys are the placeholder `none`, so no Build API key is used.
Use `SUPER_REASONING_EFFORT=none` for this deployment: with `low`, Super sometimes took over 10 s. Native tool calls with reasoning off took 1.56 s (Super) and 1.12 s (Lightning); JSON actions took 1.02 s and 0.58 s. Runtime and tunnel instructions are in `backend/agent/README.md`.

### 4.4 Strict JSON fallback (`TOOL_MODE=json`)

JSON-mode requests send `response_format: {"type":"json_object"}` so the serving engine constrains output to valid JSON. The runner still parses the action shape and validates every tool's arguments and guards.

The system prompt gets one more section with every allowed tool's name, description, and JSON schema, and these rules:

```
Reply with exactly one JSON object and nothing else, in one of two shapes:
{"actions":[{"tool":"<tool name>","args":{...}}]}
{"done":true,"summary":"<one line>"}
At most 3 actions per reply. Every args object must include "reason".
```

The runner executes the actions in order and returns one user message `TOOL_RESULTS [{"tool":...,"ok":...,"result":...}]`.
`parse.ts` removes `<think>` blocks and code fences, takes the first balanced `{...}`, and also accepts `{"name":...,"arguments":...}` [N4].
On a parse failure it sends one correction ("Reply with one JSON object only.") counted as a step; a second failure ends the cycle and the agent's fallback runs.

### 4.5 Timeouts and step limits

| Agent | Timeout per request | Max model requests per cycle | Max tool calls per cycle | `max_tokens` |
| --- | --- | --- | --- | --- |
| Orchestrator | 15 s | 4 | 8 | 1536 |
| Comms agent | 6 s | 2 | 3 | 512 |
| Auditor | 10 s | 2 | 3 | 512 |
| Vision tool | 8 s | 1 | - | 256 |

Each agent cycle also has a deadline: the claimed task's lease minus 5 s.
Past the deadline the cycle stops and the agent's fallback completes the task.

## 5. The shared runner

### 5.1 An agent is a configuration

```ts
interface AgentConfig {
  name: "orchestrator" | "comms_agent" | "auditor";
  role: "agent" | "auditor";
  model: string;                        // MODEL_SUPER or MODEL_NANO
  systemPrompt: string;                 // full text in section 7
  tools: ToolName[];                    // allow list, section 6
  wakeRules: WakeRule[];                // section 5.4
  timeoutMs: number; maxSteps: number; maxToolCalls: number; maxTokens: number;
  buildWakePacket(w: WorldView, wake: Wake): string;   // the user message
  fallback(w: WorldView, wake: Wake): Promise<FallbackResult>;  // section 9
}
```

Adding an agent is one file in `src/agents/` plus its name in the contract.

### 5.2 One cycle (`loop.ts`)

1. A wake arrives (a task addressed to the agent, or a table row matching a wake rule).
   Wakes for the same agent are debounced (`DEBOUNCE_MS`, at most `MAX_WAIT_MS`) and merged, except a `critical` task, which starts at once.
2. If the wake is a task, call `claim_agent_task(task_id)`.
   If the claim fails (another instance claimed it), drop the wake.
3. Resolve the `chain_id` (section 5.5).
4. Build the messages: the agent's system prompt and one user message, the wake packet, which already holds the rows the agent needs (so most cycles need no read tools and only one or two requests).
5. Ask the budget queue (5.3) for a slot, send the request, and run each returned tool call through `dispatch.ts` in order.
6. Repeat until the model replies with no tool calls (`{"done":true}` in JSON mode), or a limit or the deadline is hit.
7. Complete the task with `complete_agent_task(task_id, "done", result_json)`, or let the fallback complete it (section 9).
8. Log a `cycle_summary` action with the model's one-line summary.

Every cycle starts a fresh conversation, so context stays small.
Memory between cycles is the database plus a small in-process map (briefings sent, nudges sent, proposals made).

### 5.3 One shared request budget (`llm/budget.ts`)

- A token bucket of `RPM_BUDGET` (default 20) requests per minute covers every model request from every agent in the process, including retries and vision calls.
  20 is about half the forum-reported 40 per minute [N7].
- Requests wait in one priority queue, ordered by:
  1. The wake's priority: `critical`, then `high`, then `normal` (from `agent_task.priority`; table-row wakes use the rule's priority).
  2. Within a priority, agent order: orchestrator, comms agent, auditor.
  3. Then oldest first.
- A queued request older than its agent's deadline is dropped from the queue, and the fallback runs.
  The auditor is therefore the first to fall back under load, which is safe because reviews never block anything.
- On HTTP 429: back off 2, 4, then 8 s with up to 1 s jitter, at most 3 retries, inside the queue.
- On a timeout, 5xx, 202, or empty `choices`: retry once; after two failures in a row the agent marks its model "down" for 60 s and uses its fallback; every switch is logged (`tool: "model_down"` or `"model_up"`).
- The simulator's high-volume mode must not cause one model call per survivor: the orchestrator cycle covers all pending survivors in one wake packet.

### 5.4 Wake rules

Every agent subscribes to the tables it reads (section 6.2) and wakes only on matching rows.
No agent polls.
The only local timers are per-row timeouts set when a row arrives (for example "nudge if this proposal is still `proposed` in 15 s").

| Agent | Wakes on | Priority |
| --- | --- | --- |
| Orchestrator | `survivor` insert, or update of `critical_level`, `critical_score`, `breathing`, `status` back to `unassigned` | `critical` if tier 0, else `high` |
| Orchestrator | `audit_flag` insert with kind `proposal_disagree` or `load_imbalance` (always filed by the auditor) | `high` |
| Orchestrator | `assignment` update to `released` or `completed` (a rescuer is free) | `high` |
| Orchestrator | `person_report` insert, `search_cell` update to `partially_searched`, `event_log` kind `cell_reopened` | `normal` |
| Orchestrator | an `agent_task` it posted becomes `failed` or `expired` | `high` |
| Orchestrator | `mission` it created becomes `done` or `failed`; `robot` becomes idle (online, `READY`, no open mission) | `normal` |
| Orchestrator | `detection` insert with `thermal_confidence` between 0.3 and 0.6 (weak), for an inspect decision | `normal` |
| Comms agent | `agent_task` with `to_agent = "comms_agent"` (`brief_rescuer`, `answer_rescuer`, `sitrep`) | the task's |
| Comms agent | `assignment` update to `active` (accepted): navigation hint | `high` |
| Comms agent | local timeout: an `assignment` still `proposed` at half of `site.proposal_lease_s`: nudge (template, no model) | `high` |
| Comms agent | local timeout: a new `proposed` assignment with no `brief_rescuer` task 5 s after it appears (a watchdog proposal): template briefing | `critical` |
| Auditor | `agent_task` with `to_agent = "auditor"` (`review`, posted by the module inside `propose_assignment`) | the task's |

Only rows of the active run count.
A table callback and the matching `event_log` row are merged by key (`kind:entity:id`), so one change is one wake.
Rows written by the agent itself never wake it.

### 5.5 `chain_id`

The contract defines `chain_id` as the first event of the chain.
This spec uses the `event_log.id` of that first event:

- Survivor chains: the `event_log` row with `kind = "survivor_created"`, `entity = "survivor"`, `entity_id = <survivor id>`.
  `chain.ts` looks it up in the cache; a merged detection keeps the existing survivor's chain.
- A task carries its `chain_id`; an agent woken by a task uses that task's `chain_id` for every action and every task it posts.
- A wake from a table row that is not about a survivor (a robot idle, a reopened cell) uses the `event_log.id` of that row's event if one exists, otherwise `0`.
- Rescuer questions: the module posts the `answer_rescuer` task inside `rescuer_ask` and sets its `chain_id`; the comms agent uses that task's `chain_id`.

The runner passes `chain_id` as the last argument of `post_agent_task` and of `log_agent_action`.

### 5.6 Task board (`board.ts`)

| Step | Reducer | Rule |
| --- | --- | --- |
| Post | `post_agent_task(to_agent, kind, payload_json, priority, reason, chain_id)` | Only kinds in the table below; payloads validated with `ajv`; G2 applies to all text |
| Claim | `claim_agent_task(task_id)` | Only the addressed agent; the module sets `status = "claimed"`, `claimed_at`, and `lease_expires_at` |
| Complete | `complete_agent_task(task_id, status, result_json)` | `status` is `done` or `failed`; `result_json` at most 2,000 characters |

The lease is `AGENT_TASK_LEASE_S` (30 s).
If the lease runs out, the module puts the task back to `open` and the agent may claim it again; after `AGENT_TASK_MAX_ATTEMPTS` (3) expiries the task becomes `expired` (contract).
A task still `open` 120 s after `created_at` is stale: its addressed agent completes it with its fallback and `result_json.stale = true`.

Task kinds:

| Kind | From | To | Payload | `result_json` |
| --- | --- | --- | --- | --- |
| `brief_rescuer` | orchestrator | `comms_agent` | `{chain_id, assignment_id, survivor_id, rescuer_identity, why}` | `{briefing_id, text, fallback}` |
| `review` | the module, inside `propose_assignment`, for every orchestrator or watchdog proposal (`from_agent` = `orchestrator` or `module`) | `auditor` | `{assignment_id, survivor_id, rescuer_identity, distance_m, critical_level, reason}` (`spacetimedb.md`) | `{verdict, reason, flag_kind?, suggested_action, fallback}` |
| `answer_rescuer` | the module, inside `rescuer_ask(text, audio_url, survivor_id)` (`from_agent` = the rescuer's name) | `comms_agent` | `{rescuer_identity, rescuer_name, text, audio_url, survivor_id, lat, lon, asked_at}` (`glasses.md` section 5.15) | `{briefing_id, text, fallback}` |
| `sitrep` (could have) | orchestrator | `comms_agent` | `{audience, counts}` (section 7.5) | `{briefing_id, text, fallback}` |

`verdict` is `agree` or `disagree`; `flag_kind` (`proposal_disagree` or `load_imbalance`, default `proposal_disagree`) is set only with `disagree`.
On `disagree`, the module files the `audit_flag` itself inside `complete_agent_task`.
There is no `plan_search` task: the orchestrator creates missions itself (section 7.2).

### 5.7 Logging every call (`dispatch.ts`)

For every tool call, in order:

1. Parse and validate the arguments with `ajv`; on failure the result is `{ok:false, error:"invalid arguments: ..."}`.
2. Check that the tool is in this agent's allow list; otherwise `{ok:false, error:"unknown tool"}`.
3. Run the tool's guard against fresh `WorldView` data (section 7.2).
4. Execute (a cache read, a computation, a reducer call, or an HTTP call).
5. Call `log_agent_action(tool, args_json, result, reason, step, model, chain_id)` from the agent's own connection.
   The module fills `agent` from the caller's `participant.name` and `run_id` from the active run.
   `step` is the request number within the cycle; `model` is the model id, or `rules` for any deterministic path (templates, rules verdicts, fallbacks).
   `args_json` at most 1,000 characters, `result` at most 300 (`ok: <summary>` or `error: <message>`), `reason` the model's reason, at most 140.
   The module rejects `args_json` that is not JSON, so a long value is shortened inside (long strings and arrays cut) and never cut as text; an empty reason is logged as `(no reason given)`, and a forbidden word that a rejected call quotes is logged as `[word removed]`.
   Found in the 2026-11-08 rehearsal: cutting the text of a `cycle_summary` with many merged wakes gave `bad json in args_json`.
6. Append a full line to `logs/trace-<date>.jsonl` (agent, model, step, chain id, full args, full result, latency).

If `log_agent_action` fails, write the error to the console and trace and continue; never loop on logging.
Rejected calls are logged too, so judges can see a guard stopping a bad call.

## 6. SpacetimeDB client

### 6.1 Connect

```ts
const conn = DbConnection.builder()
  .withUri(cfg.STDB_URI)
  .withDatabaseName(cfg.STDB_DATABASE)
  .withToken(loadToken(agent.name))
  .onConnect((ctx, identity, token) => saveToken(agent.name, token))
  .build();
```

Builder names are from the TypeScript client docs [N8].
Reconnect with backoff (1, 2, 4, 8, then every 10 s); no cycles while disconnected.
Set `ready` in the subscription's `onApplied` callback and ignore row callbacks before it.

### 6.2 Subscriptions per agent

| Agent | Subscribes to |
| --- | --- |
| All | `participant`, `site`, `run`, `agent_task`, `survivor`, `assignment`, `event_log` (active run) |
| Orchestrator | plus `search_cell`, `robot`, `device_status`, `mission`, `detection`, `audit_flag`, `person_report` |
| Comms agent | plus `search_cell`, `detection`, `briefing` (to avoid repeats), `robot` (for its latest terrain fields) |
| Auditor | plus `search_cell`, `robot`, `audit_flag`, `agent_action` (to read the orchestrator's reasons) |

Terrain is read from the robot's latest terrain fields on its `robot` row (`terrain_class`, `terrain_confidence`, `terrain_source`, `terrain_action`); there is no terrain history table.

### 6.3 Binding details

Confirm each against the generated bindings.

- Generated accessors and fields are camelCase (`conn.db.searchCell`, `row.criticalLevel`) [N8]; `stdb/convert.ts` turns rows into snake_case plain objects, so tools, prompts, and logs use contract names.
- `u64` ids arrive as `bigint`; tool JSON uses numbers (ids stay below 2^53), and the writer converts back with `BigInt(n)`.
- Enums are tagged enums; `convert.ts` maps them to and from the contract strings.
- `Identity` values are hex strings in tools (`toHexString()` [N8]); converting a hex string back to an `Identity` for `propose_assignment` is UNCONFIRMED (check the bindings for a `fromString` helper).
- `Timestamp` becomes ISO 8601 UTC for tools and milliseconds for comparisons.
- Reducer calls reject on failure [N8]; the error message goes back to the model as the tool result.
- Reducers return no values, so after `propose_assignment` resolves, `dispatch.ts` finds the new assignment in the cache by `survivor_id`, `status = "proposed"`, and `created_by = "orchestrator"`.
  UNCONFIRMED: that the cache already holds the row when the call resolves; if not, wait for the `assignment` insert callback, at most 2 s.

### 6.4 Active run

- The active run is the `run` row with no `ended_at` (newest `started_at` if several, with one console warning).
- With no active run, no agent runs cycles; they wait for a `run` insert.
- Tables with `run_id` are filtered by it; survivors and cells by `site_id` of the run and survivors by `created_at >= run.started_at`; assignments through their survivor.
- `world.ts` applies these filters in one place.

## 7. Agents

### 7.1 Shared definitions

Survivor tiers (`priority.ts`):

1. Tier 0: `critical_level` is `immediate` or `unknown`, or `breathing` is `not_detected` or `unknown`, whatever the level says (G3).
2. Tier 1: `delayed`.
3. Tier 2: `minor` (perception never assigns it; if one appears, sort it with tier 1 and log a warning).

Within a tier: higher `critical_score` first, then older `created_at` first.
Perception's score already rises with waiting time, so agents do not add their own.

- Rescuer fresh: online, `last_heartbeat` within 15 s, and `lat`, `lon` set.
- Rescuer available: fresh and no `proposed` assignment.
  A rescuer may hold several `active` assignments and can still be proposed; the orchestrator prefers rescuers with fewer active assignments (contract).
- Rescuer free: available and no `active` assignment.
- Robot idle: `online`, `state = "READY"`, `current_mission_id` 0, no mission in `proposed`, `queued`, or `leased`.

Shared read tools (cache only, no network), available to the agents listed in each agent's tool table:

`get_board`

```json
{"type":"object","properties":{"reason":{"type":"string","minLength":3,"maxLength":140}},"required":["reason"],"additionalProperties":false}
```

Returns counts by tier and status, the top 5 survivors, rescuers with availability, cells by status, robots, and open audit flags.

`get_survivor`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "survivor_id":{"type":"integer","minimum":1}
},"required":["reason","survivor_id"],"additionalProperties":false}
```

Returns the survivor row, its tier and rank, its detections (with `location_note`), its cell (with the `found`, `reported_missing`, `reported_safe`, and `unaccounted` columns the module keeps on `search_cell`; `world.ts` reads them and does not compute them), its assignments, and a `display` string such as "IMMEDIATE, no signs of life detected, low confidence, needs human check".

`list_rescuers`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "near_survivor_id":{"type":"integer","minimum":1},
  "only_available":{"type":"boolean","default":true}
},"required":["reason"],"additionalProperties":false}
```

Each row: `identity` (hex), `callsign`, `fresh`, `available`, `free`, `active_assignments`, and with `near_survivor_id`, `distance_m`, `bearing_deg`, `compass` (8 words, matching the glasses arrows; haversine with R = 6,371,000 m [N11]).

`list_cells`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "statuses":{"type":"array","items":{"enum":["unsearched","searching","partially_searched","searched"]},"uniqueItems":true},
  "near_robot_id":{"type":"string","minLength":1,"maxLength":32},
  "include_targeted":{"type":"boolean","default":false},
  "limit":{"type":"integer","minimum":1,"maximum":30,"default":10}
},"required":["reason"],"additionalProperties":false}
```

Default statuses: `unsearched` and `partially_searched`.
Sorted with cells that have people unaccounted for first, then unsearched and partially searched cells, then distance from the robot or the site center.
Each row: `id, label, status, found, reported_missing, reported_safe, unaccounted, distance_m, targeted_by_mission_id`.

`get_robot`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "robot_id":{"type":"string","minLength":1,"maxLength":32}
},"required":["reason","robot_id"],"additionalProperties":false}
```

Returns the `robot` row (including its latest terrain fields), `idle`, seconds since heartbeat, devices, and current and open missions.

### 7.2 Orchestrator

- Model: `nvidia/nemotron-3.5-super-vl-120b-a12b`, `reasoning_effort: "low"`.
- Owns triage, rescuer assignments, the search plan and robot missions, and delegation.
- Plans the search itself: it reads telemetry, terrain, and detections, and decides inspect or continue.
- Missions start `proposed` when `site.require_mission_approval` is true, otherwise `queued` (contract); the robot's state machine and safety gate decide motion (G4).
- May write: `propose_assignment`, `create_mission`, `cancel_own_mission`, `post_agent_task`, `set_audit_flag_status`.

Tools:

| Tool | Kind | Guard (checked on fresh data) |
| --- | --- | --- |
| `get_board`, `get_survivor`, `list_rescuers`, `list_cells`, `get_robot` | read | ids exist in the active run |
| `propose_assignment` | reducer | survivor `unassigned` with no `proposed` or `active` assignment; rescuer available; if a fresh rescuer with fewer active assignments is about as close, the reason must say why; no `unassigned` survivor in a strictly higher tier without a proposal (the error names it), except one with no eligible rescuer or whose own proposal was rejected in the last 60 s (logged once, so one stuck survivor never blocks the rest of the board); rescuer not the one whose proposal for this survivor lapsed in the last 5 min unless no other is available; if another available rescuer is over 50% closer, the reason must say why |
| `delegate` | `post_agent_task` | `to_agent` and `kind` must be `comms_agent`/`brief_rescuer`; one open `brief_rescuer` per assignment |
| `set_flag_status` | `set_audit_flag_status` | flag exists and is `open` |
| `create_mission` | reducer | robot exists and is online; per-kind fields present; `search_cells` targets are not `searched`, belong to the run's site, and are not in another open mission; the robot has no other `proposed` or `queued` mission unless this one replaces it; target within `site.radius_m` plus 50 m of the site center; `hold` and `return_home` only if battery under 20% or a device is `FAILED` (the reason names it) |
| `cancel_own_mission` | reducer | the mission was created by `orchestrator` and is `proposed` or `queued` |
| `sitrep` | `post_agent_task` (`sitrep` to `comms_agent`), could have, section 7.5 | at most once per 2 minutes |

Search decisions:

| Decision | When | Mission |
| --- | --- | --- |
| Continue | the robot is idle and unsearched or partly searched cells remain | `search_cells` with 1 to 3 cells, cells with people unaccounted for first, then unsearched and partially searched cells |
| Inspect | a weak detection (`thermal_confidence` 0.3 to 0.6), or a cell with people unaccounted for | `inspect` at the detection or cell position |

`propose_assignment`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "survivor_id":{"type":"integer","minimum":1},
  "rescuer_identity":{"type":"string","pattern":"^[0-9a-fA-F]{64}$"}
},"required":["reason","survivor_id","rescuer_identity"],"additionalProperties":false}
```

The 64-character pattern assumes a 256-bit identity; UNCONFIRMED, check one real identity string.
The module posts the `review` task to the auditor inside `propose_assignment` (`from_agent = orchestrator`, the survivor's `chain_id`); the runner does not.
After a successful call, `dispatch.ts` posts a `brief_rescuer` task to the comms agent if the model did not post one in the same cycle.

`delegate`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "to_agent":{"enum":["comms_agent"]},
  "kind":{"enum":["brief_rescuer"]},
  "priority":{"enum":["critical","high","normal"]},
  "assignment_id":{"type":"integer","minimum":1},
  "survivor_id":{"type":"integer","minimum":1}
},"required":["reason","to_agent","kind","priority"],"additionalProperties":false}
```

The runner builds `payload_json` from these fields and adds `chain_id`.

`create_mission`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "robot_id":{"type":"string","minLength":1,"maxLength":32},
  "kind":{"enum":["search_cells","inspect","return_home","hold"]},
  "target_cell_ids":{"type":"array","items":{"type":"integer","minimum":1},"minItems":1,"maxItems":3,"uniqueItems":true},
  "target_lat":{"type":"number","minimum":-90,"maximum":90},
  "target_lon":{"type":"number","minimum":-180,"maximum":180}
},"required":["reason","robot_id","kind"],"additionalProperties":false}
```

Per-kind fields are checked in the guard, not with `oneOf`, because flat schemas are easier for the model.
The writer maps these fields to the module's `create_mission` argument list (`docs/specs/spacetimedb.md`); if that list differs, only `tools/writes.ts` changes.

`cancel_own_mission`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "mission_id":{"type":"integer","minimum":1}
},"required":["reason","mission_id"],"additionalProperties":false}
```

`set_flag_status`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "flag_id":{"type":"integer","minimum":1},
  "status":{"enum":["acted","dismissed"]}
},"required":["reason","flag_id","status"],"additionalProperties":false}
```

Wake packet example (each survivor lists only the rescuers the `propose_assignment` guard accepts, so the model and the mock policy never pick a lapsed rescuer; "next to search" lists only cells no open mission targets):

```
WAKE: survivor #12 score_changed (tier 0)
CHAIN: 1042
TIME: 2026-11-08T03:14:05Z  RUN: #3 "demo 2"
SURVIVORS (unassigned, priority order): #12 house 3 IMMEDIATE score 78, breathing 34/min conf 0.71, 8 m in from front door | candidates (fewest active, then nearest): Rescuer A 41 m NE, 0 active; Rescuer B 118 m E, 0 active | lapsed, do not propose: Rescuer D
RESCUERS: Rescuer A available 41 m NE of #12; Rescuer B available 118 m E; Rescuer C busy (#9)
CELLS: house 3 reported missing 2, found 1, unaccounted 1; 5 unsearched or partly searched, 2 in open missions; next to search: #3 house 3, #4 house 4, #5 house 5
ROBOT: dog1 online READY idle battery 71%
OPEN FLAGS: none
WATCHDOG: fires in 14 s if no proposal for #12
```

System prompt (full text):

```
You are the orchestrator of a search and rescue team at a building collapse.
You are not a chatbot. Nobody is talking to you. Events wake you, and you act only through tools.

The team:
- A robot dog searches rubble with a thermal camera and a breathing camera.
- A perception service scores each person found. You never change a score or a level.
- Rescuers in the field wear glasses. The comms agent writes what they see.
- You also plan the robot's search. You create its missions, and the robot's own safety system decides how it moves, and may refuse.
- The auditor checks every assignment you propose and tells you when it disagrees.
- Coordinators and an incident commander watch a live board.
- The database itself proposes the nearest rescuer with the fewest assignments if you are silent too long. You are there to do better than nearest.

Each time you wake:
1. Read the wake packet. Use read tools only if something you need is missing.
2. For each unassigned survivor, most urgent first, propose the best available rescuer (propose_assignment). Usually that is the nearest rescuer with the fewest active assignments. Choose someone else only for a reason you can state, such as a closer rescuer who is about to be free, or the auditor's objection.
3. Delegate the briefing to the comms agent (delegate, kind brief_rescuer) for every proposal.
4. Plan the search (create_mission). If a building has people unaccounted for, or a detection was weak, create an inspect mission at that place. An ACTIVE mission does not prevent queueing this next inspect mission: queue it now if the robot is online and has no proposed or queued mission, even while it finishes its current mission. Do not wait for the robot to become idle. If the robot is idle and areas are not yet searched, create a search_cells mission with 1 to 3 cells: cells with people unaccounted for first, then unsearched and partially searched cells, then nearest.
5. If the auditor disagreed (a wrong rescuer or an unfair load), decide: act on it (a new proposal), or dismiss it with a reason (set_flag_status).
6. When everything is handled, reply with a one-line summary and no tool calls.

How survivors are ranked:
- IMMEDIATE when breathing was not detected or was unclear, the rate is over 30 or under 10 per minute, or less than 30% of the body is visible. Otherwise DELAYED.
- A person whose level is unknown is treated as IMMEDIATE until scored.
- "Breathing not detected" means the camera could not see breathing, for example because the chest is covered. It never lowers priority.
- Within a level, the higher critical_score goes first.

Rules you must follow. The system rejects calls that break them and tells you why:
- Never say or imply that anyone is dead. Say "no signs of life detected, low confidence".
- You cannot resolve a survivor. Only a person can. Never write that someone is rescued or safe.
- You never drive the robot. You can only create missions.
- A partly searched area is never clear. It stays in the queue.
- Never mark an area searched. Only the robot and coordinators can.
- No missions for an offline robot.
- Use hold or return_home only for low battery or a failed device, and name it.
- One open assignment per survivor. A rescuer may hold several, but spread the load: prefer rescuers with fewer active assignments.
- Assign the most urgent unassigned survivor first.
- Every tool call needs a "reason": one short line that a judge watching the board can understand.
- Do not repeat a call that already succeeded. If a call is rejected, read the error and fix it, or move on.

Be brief. Act, then stop.
```

### 7.3 Comms agent

- Model: `nvidia/nemotron-3.5-lightning-30b-a3b`, thinking off if the smoke test allows it.
- Owns the rescuers' glasses text: briefings, navigation hints, acknowledgement nudges, answers to rescuer voice questions (`answer_rescuer` tasks), and the could-have `sitrep` summary briefing.
- The arrow, distance, critical count, heartbeat, and acknowledgement prompt are plain code in the glasses service, not the comms agent.
- May write: `post_briefing`; optional `describe_still` (could have) and `get_weather` (optional, cut with the vision tool).

Tools:

| Tool | Kind | Guard |
| --- | --- | --- |
| `get_survivor` | read | survivor in the active run |
| `send_briefing` | `post_briefing` | G2, G5; audience is `all`, `coordinators`, `commander`, or the identity hex of a fresh rescuer; a rescuer briefing about a survivor needs that rescuer to hold its `proposed` or `active` assignment, except an answer to that rescuer's own question; the same text to the same audience within 60 s is rejected; at most 2 briefings per cycle |
| `describe_still` | could have, section 7.5 | `ENABLE_VISION=1`; one call per survivor |

`send_briefing`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":140},
  "audience":{"type":"string","description":"all, coordinators, commander, or a rescuer identity hex string"},
  "text":{"type":"string","minLength":3,"maxLength":120},
  "priority":{"enum":["info","warning","critical"]},
  "survivor_id":{"type":"integer","minimum":1}
},"required":["reason","audience","text","priority"],"additionalProperties":false}
```

The runner passes `survivor_id` as `0` when absent (contract: `0` means none).
The runner sets the `post_briefing` `kind` argument from the wake: `briefing` for `brief_rescuer` and `sitrep`, `nav` for a navigation hint, `nudge` for a nudge, `answer` for `answer_rescuer`.

Templates (`templates.ts`), used for nudges always, and for everything when the model is down or cut:

| Use | Template |
| --- | --- |
| Briefing | `{LEVEL} {place}: {breathing}. {location_note}. {distance} m {compass}.` cut to 120 characters, dropping parts from the end |
| Breathing part | `breathing {rate}/min (conf {c})`, or `breathing not seen, low confidence` for `not_detected` and `unknown` |
| Nudge | `{place} is yours ({LEVEL}). Tap ring to accept or release.` |
| Navigation hint | `Enter {place}: {location_note}.` plus `Ground ahead: {terrain_class}.` when the robot's latest `terrain_class` is `debris`, `step`, `gap`, or `blocked` |
| Answer, model down | `Board: {place} {found} found, {unaccounted} unaccounted. Ask coordinator for more.` |

Wake packet example (`brief_rescuer`):

```
TASK: brief_rescuer #77 for Rescuer A (identity 3f2a...), assignment #55, CHAIN 1042
SURVIVOR #12: IMMEDIATE, house 3, breathing 34/min conf 0.71, visibility 40%, 8 m in from front door
DISTANCE: 41 m NE of Rescuer A
TERRAIN (dog1 latest): debris (0.8)
Write one briefing for Rescuer A.
```

System prompt (full text):

```
You write the text that rescuers see on small smart glasses during a search and rescue operation.
You are not a chatbot. Each task tells you who to write for and what happened.

Each time you wake:
- brief_rescuer: write one briefing for the named rescuer about their survivor, and send it with send_briefing.
- navigation: the rescuer accepted; write one line that helps them find the person (entry point, location note, ground ahead). The glasses already show the arrow and distance.
- answer_rescuer: a rescuer asked a question by voice. Answer from the facts in the task only. If the facts do not answer it, say so and suggest asking a coordinator.
- sitrep: write one situation summary from the counts in the task, and send it to the audience the task names.
Then reply with a one-line summary and no tool calls.

How to write:
- At most 120 characters. Plain ASCII. One line. No line breaks.
- Lead with the level and the place: "IMMEDIATE house 3: ...".
- Then the most useful facts for the next minute: breathing, where the person is, ground hazards.
- Use numbers from the task exactly. Never invent a fact.
- Example: "IMMEDIATE house 3: breathing 34/min (conf 0.71). 8 m in from front door. Debris."

Rules you must follow. The system rejects text that breaks them:
- Never say or imply that anyone is dead. If breathing was not detected, write "breathing not seen, low confidence". That person stays among the most urgent.
- Never write that someone is rescued or safe. Only a person can confirm that.
- Never change anyone's priority. Report the level you are given.
- Write only to the rescuer named in the task, or to the coordinators or commander if the task says so.
- Every tool call needs a short "reason".
```

### 7.4 Auditor

- Model: `nvidia/nemotron-3.5-lightning-30b-a3b`.
- Role `auditor`, name `auditor`.
- An independent verifier, the evaluator in the evaluator pattern [R1]: it reviews every orchestrator proposal through a `review` task and gives a verdict with a reason.
  Using Nano to check Super gives a somewhat more independent second opinion than asking Super twice (inference from `docs/research/agents.md`).
- It judges proposal quality only: the wrong rescuer (a more urgent survivor waiting, a much closer free rescuer, an ignored fact) or an unfair load.
- It does not watch for survivors waiting too long; that belongs to the escalation timer (alerts people) and the watchdog (assigns when the orchestrator is silent).
- Reviews never block an assignment: the proposal is already on the rescuer's glasses while the review runs.
- It reviews watchdog proposals too (`from_agent = module`), with the same checks.
- May write: review results (`complete_agent_task`).
  On `disagree`, the module files the `audit_flag` (kind from `flag_kind`, `filed_by = auditor`) inside `complete_agent_task`; the auditor never calls `file_audit_flag` for a review.
  `file_audit_flag` is only for a problem found outside a review, and this spec gives the auditor no such tool.

Tools:

| Tool | Kind | Guard |
| --- | --- | --- |
| `get_board`, `get_survivor`, `list_rescuers` | read | as above |
| `submit_review` | `complete_agent_task` on the claimed `review` task (the module files the flag on `disagree`) | only on a claimed `review` task; `reason` must cite at least one fact (a distance, a tier, a load); G2 |

`submit_review`

```json
{"type":"object","properties":{
  "reason":{"type":"string","minLength":3,"maxLength":200},
  "verdict":{"enum":["agree","disagree"]},
  "flag_kind":{"enum":["proposal_disagree","load_imbalance"],"description":"only with disagree: proposal_disagree for a wrong rescuer, load_imbalance for an unfair load"},
  "suggested_action":{"type":"string","maxLength":140}
},"required":["reason","verdict"],"additionalProperties":false}
```

The runner completes the task with `complete_agent_task(task_id, "done", {"verdict","reason","flag_kind"?,"suggested_action"})`, with `flag_kind` only on `disagree`.
On `disagree`, the module files the `audit_flag` itself (kind from `flag_kind`, default `proposal_disagree`, entity `assignment`, the reason as the message, `filed_by = auditor`) and logs `review_verdict`.
Both flag kinds wake the orchestrator.

Wake packet example (`review`):

```
TASK: review #78, CHAIN 1042
PROPOSAL: assignment #55, survivor #12 (IMMEDIATE, score 78) to Rescuer A
ORCHESTRATOR REASON: "Most urgent unassigned; Rescuer A nearest at 41 m"
RULE CHECKS (code): higher-tier unassigned survivors: none; nearer available rescuer: none; Rescuer A open assignments: 0
OTHER UNASSIGNED: #13 DELAYED house 5, 30 m from Rescuer A
Review the proposal.
```

The rule checks are computed by `rules.ts` and given to the model, so the model judges with facts, and the same checks are the fallback verdict.

System prompt (full text):

```
You are the auditor for a search and rescue team. You check the work of the orchestrator, which assigns rescuers to survivors.
You are not a chatbot. You are woken by review tasks.

For a review task:
- Decide whether the proposed assignment is a good one: is it the wrong rescuer (a more urgent unassigned survivor, a much closer free rescuer, or a fact the orchestrator ignored, such as a person still unaccounted for), or does it give one rescuer an unfair load while another is free?
- Call submit_review once with verdict agree or disagree, and a reason that cites at least one fact, such as a distance, a level, or a load.
- Disagree only when you can name a better action. Put it in suggested_action. Set flag_kind to proposal_disagree for a wrong rescuer, or load_imbalance for an unfair load.
- Your review never blocks the assignment. The orchestrator decides what to do with it.

You do not watch for survivors waiting too long. Timers in the database do that.

Rules you must follow:
- Never say or imply that anyone is dead. "Breathing not detected" means low confidence, and that person stays among the most urgent.
- Never suggest lowering anyone's priority because breathing was not seen.
- Never suggest resolving a survivor. Only a person can.
- Every tool call needs a short "reason".
When done, reply with a one-line summary and no tool calls.
```

### 7.5 Tools that are not agents (could have)

`describe_still` (comms agent, vision describer):

- Model: `nvidia/nemotron-nano-12b-v2-vl` [V1].
  UNCONFIRMED on the day until `smoke:vision` returns a description for one test still.
- Input: `{reason, survivor_id}`; the tool loads the detection's `camera_image_url` from the media server on the LAN, downsizes it to at most 640 px on the long side, and sends it as a base64 data URL with the fixed prompt "Describe in under 15 words what part of a person is visible and what covers them. Do not guess anything else."
- Output: `{ok, description}`, which the comms agent may put into the briefing.
- It never changes a level or a score, it runs once per survivor, it needs a lit scene, and it costs one request from the shared budget.
- Privacy: it sends a camera image of a person to NVIDIA's cloud, and nothing else (no ids, names, or coordinates).
  `docs/AGENT_WORKFLOW.md` keeps breathing, thermal, and terrain processing local, so the team decides at build time whether one still per survivor is acceptable; the default is `ENABLE_VISION=0`.

`sitrep` (a task kind from the orchestrator to the comms agent, a short situation summary):

- The orchestrator cannot call `post_briefing`, so its `sitrep` tool (input `{reason, audience}`, `audience` `commander` or `coordinators`) posts a `sitrep` task to `comms_agent` with `post_agent_task`.
- The numbers come from `world.ts` (found by tier, unassigned, en route, reached, cells by status, and the `unaccounted` column of each cell) and go into the task payload; the comms agent's model writes only the words, in one cycle.
- Output: the comms agent posts a summary briefing of at most 120 characters to that audience, priority `info`, for example "12 found, 3 IMMEDIATE (all en route). House 4 partly searched. 1 unaccounted at house 3."
  With the comms model down, it posts the numbers from a template.
- Trigger: the orchestrator posts one at most once every 5 minutes while the run is active.

`get_weather` (optional, comms agent, cut with the vision tool):
Open-Meteo forecast API without a key [N9], demo site coordinates only, 3 s timeout, 10 minute cache; it can add "cold risk" or "heat risk" to a briefing and never changes priority.
The earlier walking-route tool (OSRM) is dropped, because street maps are wrong inside rubble and the demo area is small.

## 8. Watchdog, double proposals, and every agent down

### 8.1 Orchestrator heartbeat policy

The contract's `agent_watchdog` fires when there is no orchestrator `agent_heartbeat` for N s, where N is `AGENT_WATCHDOG_S` (30 s, 15 s in demo mode); heartbeats from other agents and agent actions do not count.
It then proposes, for each unassigned `immediate` survivor with no open proposal, the nearest rescuer with the fewest active assignments (free rescuers first), and the module posts a `review` task for each such proposal (`from_agent = module`).
The runner makes the heartbeat mean "the orchestrator is able to act":

- The orchestrator's connection calls `agent_heartbeat()` every 5 s only while its model is not marked down and no tier 0 wake has waited more than 8 s without a finished cycle.
- When the model is down, the orchestrator stops its heartbeat and logs one `model_down` action at the moment of the switch, so the watchdog takes over within N s.
- The orchestrator has no deterministic proposal fallback of its own.
  The database watchdog is its only fallback, so there is exactly one deterministic proposer.

### 8.2 No double proposals

- Both the orchestrator and the watchdog call the same check: a survivor with a `proposed` or `active` assignment gets no new proposal.
  Reducers run as serialized transactions, so if both try at once, one wins and the other gets an error (inference from how reducers work [S1]).
- The orchestrator's guard re-reads the survivor from the cache just before the call; if the watchdog already proposed (`created_by` is not `orchestrator`), it skips and logs "already proposed by watchdog".
- The orchestrator never cancels or replaces a watchdog proposal.
  If it thinks the watchdog's choice is wrong, it posts a `brief_rescuer` as usual and lets the proposal lease decide; a coordinator can reassign.
- The wake packet shows "WATCHDOG: fires in N s", so the model knows the deadline.
- The orchestrator's step limit (4 requests at 15 s) fits inside the 15 s demo-mode watchdog only if the first request proposes; the prompt says to propose first and delegate after.

### 8.3 With every agent down

| Function | Who does it with no agent |
| --- | --- |
| Assignments | the module's `agent_watchdog` (nearest rescuer with the fewest active assignments to each unassigned `immediate`) |
| Lost rescuers | `heartbeat_timer`, `client_disconnected`, and `lease_timer` release assignments; survivors go back to `unassigned` and the watchdog re-proposes |
| Alerts | `escalation_timer`: everyone at N s, the commander at 2N s |
| Glasses | the glasses service still shows the assignment, arrow, distance, critical count, and the module's escalation briefings; only the agent-written text is missing |
| Robot | finishes its current mission; coordinators create missions from the dashboard |
| Board | open tasks expire on the board; the dashboard's "Database" column shows `agent_watchdog_fallback` events |
| Headline | "Critical survivors unattended over 60 s" still computed from the same data |

When an agent process restarts, it claims open tasks addressed to it, ignores tasks older than 120 s except to complete them with its fallback (`stale: true`), and runs one cycle on the current board.

## 9. Fallbacks per agent

| Agent | Fallback (model down, cut, timeout, or deadline) | `model` logged |
| --- | --- | --- |
| Orchestrator | stop heartbeat; the database watchdog proposes, and the module posts the `review` task for each watchdog proposal; no `brief_rescuer` task is posted for it, so the comms agent also wakes on any new `proposed` assignment without a `brief_rescuer` task within 5 s and briefs it from the template; when the robot is idle, the `rules.ts` continue rule creates its next mission (untargeted cells with people unaccounted for first, then the nearest unsearched and partially searched cells; no inspect) | - (`rules` for the continue rule) |
| Comms agent | template briefing (section 7.3); the task completes with `fallback: true` | `rules` |
| Auditor | rules verdict from the code checks in the wake packet: `disagree` (`proposal_disagree`) if a higher-tier survivor is unassigned or a free rescuer is over 50% closer, `disagree` (`load_imbalance`) if a free rescuer is about as close as a proposed rescuer who already has active assignments, else `agree` with "rules check only" | `rules` |
| Vision, sitrep | skipped | - |

Every fallback action is logged like a model action, with `model: "rules"` and the reason prefixed `[fallback]`, so the dashboard shows when the fallback acted.

## 10. Example run with one `chain_id`

Setup (demo simulator): run #3, robot `dog1` searching house 3 (cell #4), Rescuers A (40 m away), B (120 m), C (busy), and a family report of 2 people missing at house 3 (a `person_report` entered by a coordinator).

1. The robot calls `report_detection` (thermal).
   The module creates survivor #12 and `event_log` row #1042 (`survivor_created`).
   `chain_id = 1042` from here on.
2. Perception calls `report_breathing` (34/min, confidence 0.71, visibility 40%) and `set_critical_score` (`immediate`, 78).
   The orchestrator wakes (tier 0, `critical`).
3. Orchestrator, request 1:
   `propose_assignment {survivor_id: 12, rescuer_identity: "<A>", reason: "Most urgent unassigned (IMMEDIATE, breathing 34/min); Rescuer A nearest at 41 m"}`, then
   `delegate {to_agent: "comms_agent", kind: "brief_rescuer", priority: "critical", assignment_id: 55, survivor_id: 12, reason: "Brief Rescuer A on #12"}`, then
   `create_mission {robot_id: "dog1", kind: "inspect", target_lat: <house 3>, target_lon: <house 3>, reason: "1 unaccounted at house 3 (family reports 2, 1 found); kitchen not seen"}`.
   The module posts `review` task #78 to the auditor inside `propose_assignment`.
   Tasks #77 (brief) and #78 (review), and the `create_mission` action for mission #31, all carry `chain_id` 1042.
4. Orchestrator, request 2: no tool calls, summary "Assigned A to #12, briefing delegated, house 3 inspect mission created."
5. Comms agent claims #77 and sends "IMMEDIATE house 3: breathing 34/min (conf 0.71). 8 m in from front door. Debris." (80 characters) to Rescuer A, then completes #77 with `{briefing_id, text}`.
6. Rescuer A taps the ring; the glasses service calls `accept_assignment`; the comms agent wakes on the `active` assignment and sends the navigation hint "Enter house 3 by front door, 8 m in. Ground ahead: debris." (template or model).
7. Mission #31 is `proposed`; a coordinator approves it, and `dog1` leases it when it finishes cell #4.
8. Auditor claims #78; the rule checks show nothing better; it sends `submit_review {verdict: "agree", reason: "IMMEDIATE, no higher tier unassigned; A is nearest free at 41 m, load 0"}`.
9. Later, after #12 is reached, the orchestrator proposes Rescuer B for a DELAYED survivor at house 5, although B has already taken 3 survivors this run and A none.
   The auditor reviews it and disagrees with `flag_kind: "load_imbalance"`: "B has taken 3 survivors, A none and free; give house 5 to A."
   Inside `complete_agent_task`, the module files `audit_flag` #9 `load_imbalance` with `filed_by = auditor`, on the chain of the house 5 survivor.
10. The orchestrator wakes on flag #9.
    It cannot withdraw a proposal already on B's glasses (only coordinators reassign), so it proposes Rescuer A for the next unassigned survivor, delegates that briefing, and marks flag #9 `acted` with the reason "A given next survivor; moving house 5 is a coordinator call".
    The flag stays visible on the dashboard, where a coordinator can reassign house 5.
11. Rescuer A marks #12 reached.
    Only Rescuer A, a coordinator, or the commander can call `resolve_survivor`.

Clicking survivor #12 on the dashboard shows chain 1042: detection, score, proposal #55, tasks #77 and #78, the briefing, the verdict, the acceptance, the navigation hint, and mission #31, each with agent, model, and reason.

If the auditor had disagreed in step 8 (for example, Rescuer C was about to be free 10 m away), it would complete #78 with `verdict: "disagree"`, and the module would file `proposal_disagree`; the orchestrator wakes on the flag, decides, and either keeps the proposal and dismisses the flag with a reason, or acts after the proposal lapses.

## 11. Cut order and graceful degradation

From `docs/AGENT_WORKFLOW.md`; cut from the top.

| # | Cut | Switch | What still works |
| --- | --- | --- | --- |
| 1 | Vision describer tool (and `get_weather`) | `ENABLE_VISION=0` | Briefings from survivor rows only |
| 2 | Sitrep tool | `ENABLE_SITREP=0` | The dashboard's counts |
| 3 | Rescuer voice questions | `ENABLE_QUESTIONS=0` | All pushed briefings; questions go to coordinators by radio |
| 4 | Comms agent model (templates stay) | `ENABLE_COMMS_MODEL=0` | Template briefings, nudges, and hints |
| 5 | Auditor model review | `ENABLE_AUDITOR_MODEL=0` | Rules verdicts on every `review` task |

The orchestrator is never cut; if Nemotron fails, the database watchdog still assigns.
Each switch is a config flag, so a cut is a restart, not a code change.

## 12. Test plan

### 12.1 Unit tests (vitest, no network)

- `priority.ts`: `not_detected` with level `delayed` sorts in tier 0; `unknown` level in tier 0; ties on score, then age.
- `guards.ts`: one passing and one failing case per guard, including "possibly dead" rejected, a 121-character briefing rejected, a briefing to a rescuer without the assignment rejected, a second proposal for a survivor with a `proposed` assignment rejected, a `delayed` survivor proposed while a tier 0 survivor waits rejected, a `search_cells` mission on a `searched` cell rejected, the orchestrator cancelling a mission it did not create rejected, the comms agent calling `propose_assignment` rejected as "unknown tool".
- `parse.ts`: plain JSON, fenced JSON, JSON after `<think>`, the `{"name","arguments"}` leak, garbage.
- `budget.ts`: 25 queued requests in a minute send 20; a `critical` orchestrator request jumps a `normal` auditor request; stale requests fall back.
- `chain.ts`: a survivor's chain is its `survivor_created` event id; a task's chain carries to the tasks it causes.
- `templates.ts`: every template stays at 120 characters or fewer with long location notes.
- These use a `FakeWorld` (in-memory rows with the `WorldView` interface), a `FakeActions` that records reducer calls, and a `MockLLM` that replays `test/fixtures/`.

### 12.2 Dry-run mode

- `DRY_RUN=1`: agents connect and subscribe, run cycles with the real model on open tasks and wakes, but call no reducer at all (no claims, no writes, no `log_agent_action`).
  Write tools return `{ok:true, dry_run:true}`; everything prints to the console and the trace.
  Safe against Maincloud or someone else's live data.
- `DRY_RUN=log`: the same, but `log_agent_action` is called with result `dry_run: not executed`, so the dashboard team can build the Agents panel without the agents changing state.
- `LLM_MODE=mock`: swaps the Nemotron client for the `MockLLM`, which replays recorded model replies from `test/fixtures/`, for tests and dry runs with no API calls and no `NVIDIA_API_KEY`.
  It is agent-internal, not part of the shared contract (CONTRACTS.md version 8.1, "Agent-internal switches").
  It combines with `DRY_RUN`: `LLM_MODE=mock DRY_RUN=1` runs full cycles with no model calls and no reducer calls.
  The default `LLM_MODE=nvidia` uses the hosted models (section 4).
  A request with no matching fixture fails as a model error, so the runner's fallback for that agent applies (section 9).

### 12.3 Scripted scenarios with the demo simulator (`npm run scenario -- <name>`)

Against a local SpacetimeDB with the module published and the simulator from `backend/sim/` (`docs/specs/demo.md`) in demo mode.
Checks look at end states and required tool names in `agent_action`, not exact order.

| Scenario | Script | Must appear | Must not appear |
| --- | --- | --- | --- |
| `chain` | section 10 steps 1 to 8 | proposal to A; tasks `brief_rescuer` and `review` and an `inspect` mission by the orchestrator with the same `chain_id`; a briefing to A of at most 120 characters; a verdict in `result_json` | any proposal by the comms agent or auditor; death words |
| `priority` | a `delayed` survivor, then a `not_detected` survivor, one free rescuer | the free rescuer goes to the `not_detected` survivor | the `delayed` one first |
| `kill_orchestrator` | two processes; kill the orchestrator process before a new `immediate` survivor | an `agent_watchdog_fallback` event and a proposal by the module within N s; the comms agent briefs it from the template; headline stays 0 | two proposals for one survivor |
| `race` | orchestrator slowed to just past N s by a test delay | exactly one proposal; "already proposed by watchdog" in the log | a second proposal |
| `auditor_disagrees` | MockLLM makes the orchestrator pick the far rescuer with a weak reason | the auditor completes `review` with `disagree`; a `proposal_disagree` flag with `filed_by = auditor`; the orchestrator wakes and sets the flag status with a reason | the review blocking the proposal |
| `comms_fallback` | bad API key for Nano only, or `ENABLE_COMMS_MODEL=0` | template briefings with `model: "rules"`; nudge after half the proposal lease | an empty glasses panel |
| `all_down` | stop every agent process | watchdog proposals, releases on heartbeat loss, escalation briefings | any stuck survivor |
| `budget` | 10 detections in 10 s | at most 20 requests per minute; one orchestrator cycle covers several survivors; the auditor falls back first | HTTP 429 loops |

Run `chain` three times with the real models, once with `TOOL_MODE=json`, and in CI with `MockLLM`.

### 12.4 Smoke tests

`smoke:llm` (section 4.3) first, then `smoke:vision` if the vision tool is built.

## 13. Build order (about 8.5 hours for one person)

The order follows "Priority by sponsor track" in `docs/MVP.md`, with the agent order from `docs/AGENT_WORKFLOW.md`: the orchestrator and the auditor first, then the comms agent with templates, and its model only once the core demo runs end to end.
The module's guarantees (priority 1) belong to `spacetimedb.md`, and the agents work on top of them.
Steps 1 to 9 build the core demo end to end on the `agent_task` board (priority 2): the orchestrator proposes and plans the search, the auditor reviews each proposal, and the comms agent briefs the rescuer's glasses from templates.
Steps 10 to 12 add the comms agent's model, voice questions, and the could-have tools.

| # | Task | Hours | Done when |
| --- | --- | --- | --- |
| 1 | Folder, config, `smoke-llm.ts`, tool-mode decision | 0.75 | Tool mode per model written in the folder's README |
| 2 | `geo.ts`, `priority.ts`, `schemas.ts`, `parse.ts`, `templates.ts` with tests | 0.75 | Tests pass |
| 3 | `stdb/`, `world.ts`, `chain.ts` against the bindings (needs the module published locally; until then `FakeWorld`) | 1.25 | Three identities connect, register, and print the active run |
| 4 | `dispatch.ts`, `log_agent_action`, `board.ts` (post, claim, complete) | 0.75 | A test task round-trips and appears in `agent_action` with `chain_id` |
| 5 | `loop.ts`, `llm/client.ts`, `llm/budget.ts` | 1.0 | One orchestrator cycle on the sim reads the packet and ends with a summary |
| 6 | Orchestrator config, guards, heartbeat policy, `create_mission` and `cancel_own_mission` with the continue rule | 1.25 | `priority`, `race`, and `kill_orchestrator` scenarios pass; the orchestrator creates an `inspect` mission for an unaccounted house |
| 7 | Auditor rules verdict and model config | 0.75 | `auditor_disagrees` passes |
| 8 | Comms agent config and templates | 0.5 | `comms_fallback` passes; template briefings under 120 characters |
| 9 | `scenario.ts`, dry-run modes, `chain` scenario | 0.5 | `chain` passes three times (the core demo runs end to end) |
| 10 | Comms agent model | 0.25 | Real briefings under 120 characters |
| 11 | Voice questions (`answer_rescuer` tasks from `rescuer_ask`) | 0.25 | An `answer_rescuer` task is answered on the glasses |
| 12 | Sitrep, then vision (could have) | 0.5 | `smoke:vision` passes; a description appears in one briefing |

Steps 1 and 2 need no other component and can start now.
If the clock runs short, stop at step 9 and apply the cut order in section 11.

## Proposed contract changes

Open (PROPOSED, needs a team decision before it goes into CONTRACTS.md):

1. `STDB_TOKEN_DIR` for the agent runner.
   CONTRACTS.md section "SpacetimeDB environment variables" gives every component `STDB_TOKEN` (one identity token).
   The agent runner holds three identities in one process (orchestrator, comms agent, auditor), so it reads `STDB_TOKEN_DIR` instead and keeps one token file per agent (`<dir>/<agent>.token`).
   Proposal: add `STDB_TOKEN_DIR` to that line as the agent runner's agent-internal replacement for `STDB_TOKEN`.
   Until then it is documented in `backend/agent/README.md`.

Earlier changes were merged into CONTRACTS.md version 8.1.

## Sources

Checked on 2026-11-07 unless noted.

- [N1] Nemotron 3 Super API reference (model id, endpoint, `stream`, `reasoning_effort` values, schema without `tools`): https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer
- [N2] Nemotron 3 Nano API reference (model id `nvidia/nemotron-3-nano-30b-a3b`, endpoint, schema without `tools` or `reasoning_effort`, `chat_template_kwargs` in examples): https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b-infer
- [N3] Nemotron 3 Nano model card (temperature 0.6, top_p 0.95 for tool calling): https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b
- [N4] NIM for LLMs, function calling: https://docs.nvidia.com/nim/large-language-models/1.15.0/function-calling.html
- [N6] NVIDIA API quickstart (getting a key): https://docs.api.nvidia.com/nim/docs/api-quickstart
- [N7] NVIDIA forum, 40 requests per minute report (not official): https://forums.developer.nvidia.com/t/request-for-nvidia-build-api-rate-limit-increase-40-rpm-200-rpm/373495
- [N8] SpacetimeDB TypeScript client and Node.js quickstart: https://spacetimedb.com/docs/clients/typescript and https://spacetimedb.com/docs/quickstarts/nodejs
- [N9] Open-Meteo forecast API: https://open-meteo.com/en/docs
- [N11] Movable Type, latitude and longitude formulas: https://www.movable-type.co.uk/scripts/latlong.html
- [V1] Nemotron Nano 12B v2 VL API reference (model id `nvidia/nemotron-nano-12b-v2-vl`, endpoint, `image_url` parts with a URL or base64 data URI, user role only, `max_tokens` 1 to 8192): https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-nano-12b-v2-vl-infer
- [R1] Anthropic, Building effective agents (evaluator pattern): https://www.anthropic.com/engineering/building-effective-agents
- [S1] SpacetimeDB procedures and reducers: https://spacetimedb.com/docs/functions/procedures
- [S3] DEV Community, a multi-agent system on SpacetimeDB (one connection per subsystem): https://dev.to/aurora_/building-a-self-hosted-multi-agent-system-in-rust-architecture-decisions-and-what-i-learned-3mp1
- Project docs: `docs/specs/CONTRACTS.md`, `docs/AGENT_WORKFLOW.md`, `docs/research/agents.md`, `docs/research/platform.md`, `docs/research/perception.md`, `docs/notes/2026-11-07-nvidia-track.md`.
