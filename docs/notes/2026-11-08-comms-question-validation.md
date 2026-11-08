# Rescuer question answers: local mock validation

Date: 2026-11-08. Branch: `eric-cv-benchmark`. Task: A6 / E8 6b.

This work runs alongside Claude's A1/A3 CV benchmark and Pi clip work. It changes only
the primary agent service and its documentation. Shared contracts and perception code
are unchanged. The judged demo remains scripted, with only SpacetimeDB live.

## Behavior

With questions and the comms model enabled, an `answer_rescuer` task uses the existing
budgeted model loop, six-second request timeout, two-request limit and template fallback.
The packet includes the question, the current survivor's level, breathing rate/confidence,
place and location note, cell counts and the asker's own open assignments. It does not
copy the raw payload, audio URL or rescuer name field. The existing G8 filter replaces
known participant names and identities before every outbound turn. It also masks
email addresses and common phone-number formats from questions and board notes.

The packet marks the question as untrusted data and asks for an explicit unknown answer
if board facts do not answer it. Recipient and survivor restrictions are enforced by
guards, as are a single answer per question and the existing ASCII/length/text rules.
Factual grounding is a prompt instruction, not a semantic verifier.

Example: Rescuer A asks where the person is. The task's survivor points to house 3 with
location note `8 m in from front door`. The model receives those board facts and calls
`send_briefing` using `Rescuer A`; the runner resolves the callsign to the identity locally,
writes an `answer` briefing, and completes the task with its briefing ID, text and
`fallback: false`. The task's chain ID remains on the action log. A reply to Rescuer B,
a broadcast, an unrelated survivor or an oversized reply is rejected; if the model does
not correct it within its cycle, the existing board template answers Rescuer A.

## Evidence

From `backend/agent/`:

- `npm run typecheck`: passed.
- `npx vitest run --exclude '**/codex-reference/**'`: 136 tests across 19 files passed,
  including the separate watchdog-briefing and live-scenario safety regressions added during A5.
- Seventeen tests in `test/comms-questions.test.ts` cover native/JSON factual replies,
  explicit unknown replies without a survivor, payload privacy, four incorrect audiences,
  an incorrect survivor, length rejection, timeout/server failures, model-down fallback,
  model-disabled templates, questions-disabled behavior, one answer per question,
  no-survivor fallback, and contact-detail masking in voice text and board notes.

These tests use scripted model replies and the fake database. They establish routing,
guards, fallback behavior and task completion only. They do not prove Lightning answers
unseen questions correctly, local/Maincloud integration, speech recognition, or display
on glasses. B2 and the live voice acceptance remain open.
