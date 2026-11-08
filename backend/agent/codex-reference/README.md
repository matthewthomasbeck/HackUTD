# Nemotron agent runner

One configurable TypeScript runner for orchestrator, auditor, and comms.
Agents coordinate through the shared task board and guarded reducers. Agents
never directly drive actuators or resolve survivors.

## Run locally

Node.js 22+, from this directory:

```bash
npm ci
npm test
npm run typecheck
npm run scenario -- chain
LLM_MODE=mock npm run dry
```

30 tests and the TypeScript check pass. The chain fixture demonstrates one
rescuer proposal, auditor review, comms briefing, and high-level inspect request
with shared chain ID 1042. Priority, race, and auditor-disagreement scenarios
also pass. These use deterministic inputs and FakeWorld, not NVIDIA or a live
database. The kill/all-down scenarios explicitly refuse to claim the database
watchdog was tested without a running module.

Implemented: strict native/JSON parsing, tool schemas, board reads, write guards,
shared request budget, event coalescing, task claiming/completion, model timeout
fallbacks, action logs, dry-run shadow state, and role-specific configuration.
Comms starts with templates; its model and rescuer questions are configurable.

## Live setup

```bash
cp .env.example .env
# Supply the key, database URI/name, model endpoint, and chosen tool modes.
npm run smoke:llm
LLM_MODE=nvidia npm start
```

Use NVIDIA_BASE_URL for a compatible Brev endpoint if that is where the models
run. Never commit .env, token files, or logs. The smoke command records native
tool round trips and strict JSON support for both models. Without a key it
prints skipped; no hosted support, rate limit, or latency is claimed yet.

Cayden must publish the SpacetimeDB module, generate
backend/spacetimedb-bindings/index.ts, and grant the three service roles before
live subscription/reducer integration can run. The adapter fails clearly when
bindings are absent. Its SATS conversions still need verification against the
generated code and actual reducer signatures.

DRY_RUN=1 operates on a shadow of subscribed state without live reducer writes.
DRY_RUN=log writes only dry-run action logs. Heartbeats are suppressed in dry
mode. The database watchdog, leases, reconnects, dashboard chain, and glasses
acknowledgement require separate live checks.

## Optional tools and limits

Sitrep delegates current board counts to comms and remains disabled by default.
The vision describer is not implemented: smoke:vision reports that status and
does not upload a person image. The task requires a team decision before cloud
image uploads. The local breathing, person-confirmation, and Whisper paths work
without sending images to a hosted vision model.

For remaining acceptance checks and measured evidence, see
[Eric's task status](../../../docs/tasks/eric.md).
