# Agent workflow

A one-page summary of how the AI agents work, updated 2026-11-07 for multi-agent orchestration on SpacetimeDB (the final agent set is under review in `docs/research/agents.md`).
The full spec is `docs/specs/agent.md`; shared names are in `docs/specs/CONTRACTS.md` (FINAL version 8 wins where they differ).

## The principle

The agents improve decisions and communication.
The database guarantees that nobody is dropped, even if every agent is down.

## The agents

Decided from `docs/research/agents.md` (2026-11-07).
Each agent is a configuration of one shared agent runner (one Node.js process type and one tool loop), so adding an agent is a prompt, a tool list, a model, and the rows that wake it.

| Agent | Owns | Model | May write | Status |
| --- | --- | --- | --- | --- |
| Orchestrator | Triage, rescuer assignments, the search plan and robot missions, delegating work | Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) | `propose_assignment`, `create_mission`, `post_agent_task`, `set_audit_flag_status` | Must have, never cut, built first |
| Auditor | Judges the quality of every orchestrator proposal (wrong rescuer, unfair load) with a verdict and a reason | Nemotron 3 Nano (`nvidia/nemotron-3-nano-30b-a3b`) | `file_audit_flag`, review task results | Must have, built first |
| Comms agent | The rescuers' glasses: briefings, nudges, answers to rescuer voice questions | Nemotron 3 Nano | `post_briefing` | Templates first; its model is added once the core demo runs end to end |

The search agent was cut on 2026-11-07: the orchestrator already plans the search, and with a few houses it does not need a separate agent.

Who watches for an unattended survivor, without overlap:
- The escalation timer alerts people when an urgent survivor waits too long.
- The watchdog timer assigns the nearest free rescuer when the orchestrator is silent.
- The auditor does not watch for waiting; it only judges whether each proposal is a good one.

Tools, not agents (could have): a vision describer the comms agent can call (one camera still to a scene description), and the sitrep tool (a short situation summary for the orchestrator and the incident commander).

Why split at all: the agents have different jobs and speed needs (the board does not wait for the auditor; a rescuer waits for the comms agent), and the auditor gives an independent check.
Research shows that splitting without such a reason makes systems less reliable, so we stop at three.

## Cut order if time runs short

1. Vision describer tool.
2. Sitrep tool.
3. Rescuer voice questions.
4. The comms agent's model (templates stay).
5. The auditor's model review.

The orchestrator is never cut, and if Nemotron fails, the database's watchdog still assigns rescuers.

## How they talk

Agents never call each other directly.
They post tasks to a shared task board (the `agent_task` table in SpacetimeDB), and the addressed agent claims a task with a lease, works it, and marks it done.
A SpacetimeDB subscription wakes the right agent when a task or an event arrives, so nobody polls.
If an agent does not finish a claimed task in time, the lease expires and the task goes back on the board.
The dashboard shows the board live, so judges watch the hand-offs, and replay keeps them.

```
          events (SpacetimeDB subscriptions: detections, scores, leases, person reports)
                                       │
                                       v
                                ┌──────────────┐  review task   ┌─────────┐
                                │ Orchestrator │ ─────────────> │ Auditor │
                                │              │ <───────────── │         │
                                └──┬────────┬──┘  verdict/flag  └─────────┘
                    create_mission │        │ brief_rescuer task
                                   v        v
                         ┌────────────┐  ┌─────────────┐
                         │   Robot    │  │ Comms agent │ (templates first, model later)
                         │ (missions; │  └──────┬──────┘
                         │ own safety │         v
                         │   gate)    │   glasses briefings (glasses service)
                         └────────────┘
```

## Example hand-off chain

1. The robot reports a warm shape at house 3; perception scores it IMMEDIATE.
2. The orchestrator wakes, picks the nearest free rescuer, calls `propose_assignment`, and posts `brief_rescuer` to the comms agent; the proposal also creates a `review` task for the auditor.
3. The comms agent writes the briefing for that rescuer's glasses ("IMMEDIATE house 3: breathing 34/min, conf 0.71. 8 m in from front door.").
4. A coordinator has entered a family report that two people live at house 3, so house 3 shows "1 unaccounted".
5. The orchestrator sees the unaccounted person and creates a mission that sends the robot back into house 3 for another thermal and camera search.
6. The auditor reviews the proposal and agrees; on a later proposal it disagrees because Rescuer B already has three tasks and Rescuer A none, and the orchestrator rebalances.

Every step carries the same `chain_id`, so the dashboard can show the whole chain for one survivor.

## Requests and models

- All agents share one budget of 20 requests per minute (about half the reported limit), with critical tasks and the orchestrator first.
- Each agent uses strict JSON tool calls, short timeouts, and a deterministic fallback if its model fails.
- The NVIDIA API key lives in the agents' `.env`, never in the SpacetimeDB module.
- Breathing, thermal, and terrain processing stay local; only results and short clips go to the cloud.

## What the database guarantees without any agent

- Every survivor is in exactly one state: unassigned, assigned, en route, reached, resolved; functions reject skipped steps.
- An assignment counts only after the rescuer acknowledges it on the glasses.
- A missed glasses heartbeat or a closed session releases the assignment at once; the lease is the backup.
- An IMMEDIATE survivor unassigned for N seconds alerts everyone, and at 2N seconds the incident commander.
- If the orchestrator is silent for N seconds while urgent work exists, the database itself proposes the nearest free rescuer.
- Blocked areas are "partially searched", never clear; a robot going offline reopens its area.
- Dashboard headline: "Critical survivors unattended over 60 s: 0".

## What no agent can ever do

- Resolve a survivor (humans only).
- Label anyone dead, or lower anyone's priority because breathing was not seen.
- Drive the robot (missions only; the robot's state machine and safety gate decide motion).
- Mark an area searched (robot and coordinators only).

## Demo beats

- Watch the hand-off chain above on the dashboard's Agents panel.
- Stop the agents: the database's watchdog still assigns, and the headline stays at 0.
