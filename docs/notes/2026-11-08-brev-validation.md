# Brev-only agent validation

Validated on 2026-11-08 from the `eric` branch.
The agent runner uses Super VL NVFP4 on Brev's RTX PRO 6000 and Lightning BF16 on Brev's A100.
Both model connections use local SSH tunnels and placeholder credentials; no Build API key is needed.
Setup and restart instructions are in `backend/agent/README.md`.

## Results

| Check | Result |
| --- | --- |
| Agent TypeScript check | Pass |
| Agent tests | 87 passed |
| Eight mock scenarios | 8/8 passed |
| Perception tests | 750 passed, no skips |
| Brev model smoke tests | Both models pass native tool call, tool result, reasoning off, and JSON action checks |
| Real native chain | 3 consecutive passes |
| Real JSON chain with constrained JSON output | 3 consecutive passes |
| Real priority ordering | Pass: the rescuer goes to the survivor whose breathing was not detected |
| Real auditor disagreement | Pass: the auditor flags a deliberately seeded far-rescuer proposal and the orchestrator handles the flag |
| Real watchdog recovery | Pass: fallback proposal 11 s after the survivor; unattended headline maximum 0 |

The real-model scenarios use the fake database. They do not validate a published SpacetimeDB module, live subscriptions, glasses hardware, or robot motion.
The generated SpacetimeDB bindings are still absent from this checkout, so live integration remains open.

## Changes justified by the tests

- Clarified that an online robot with an active mission may queue its next inspection when no proposed or queued mission already exists. Super previously skipped this step because the robot was active.
- Added `SUPER_REASONING_EFFORT`; it defaults to `low`, and the local Brev deployment uses `none` under agent.md's slow-response policy. Native chain tool calls completed in about 3.5 to 3.8 s instead of sometimes taking over 10 s.
- JSON-mode requests now ask the serving engine for `response_format: {"type":"json_object"}`. Before this constraint, Super sometimes omitted a closing brace and repeated the malformed reply after correction. Tool shapes, arguments, allow lists, and guards are still checked by the runner.
- Real priority tests assert the correct assignment without requiring the mock's deliberate wrong-first attempt. The mock suite still tests that rejection.
- Real auditor-disagreement tests start with a deliberately bad proposal. They do not require Super to make a mistake before the auditor can be tested. A mock regression also covers this setup.
- Added a local HTTP test showing that each model reaches its configured server with its own credential, and that the separate Nano server does not receive the Super credential.

In ordinary chain runs, some auditor verdicts used the existing rules fallback after the consistency guard rejected the model's review. The deliberately bad-proposal test produced a model-authored disagreement.

## Repeat the checks

From `backend/agent/`, with both Brev tunnels available:

```bash
npm run typecheck
npm test
npm run scenario -- all
npm run smoke:llm
npm run scenario -- chain chain chain --real
TOOL_MODE_SUPER=json TOOL_MODE_NANO=json npm run scenario -- chain chain chain --real
npm run scenario -- priority auditor_disagrees kill_orchestrator --real
```

From `backend/perception/`:

```bash
.venv/bin/python -m pytest -q
```
