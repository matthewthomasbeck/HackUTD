# Agents research: which AI agents the rubble search project needs

Research by a research agent on 2026-11-07, about 17 hours before the HackUTD deadline.
Every external fact has a source URL in brackets, listed at the end.
Lines marked "Inference:" are this file's own judgment, not a sourced fact.
Scope: the rubble search robot dog in `docs/MVP.md` and `docs/AGENT_WORKFLOW.md`, with the Photon calls agent removed and SpacetimeDB as the backend again.

## Recommendation

- Build three LLM agents and one optional fourth: Orchestrator (Nemotron 3 Super), Comms agent (Nemotron 3 Nano), Auditor (Nemotron 3 Nano), and, if time allows, a Search agent (Nemotron 3 Nano) for the robot.
- Do not build the vision describer or the situation summarizer as agents.
  Make the vision describer a tool that the Comms agent can call, and make the summary a tool of the Orchestrator ("sitrep"), both only if time allows.
- Write one agent runner (one Node.js TypeScript process, one tool loop) and make each agent a configuration: a system prompt, an allowed tool list, a model, and the table rows that wake it.
  Inference: this makes the third and fourth agent cost about an hour each instead of a new service each.
- Agents coordinate only through the `agent_task` table in SpacetimeDB, with leases, and every tool call is a reducer call.
  Reducers check the caller's identity, so each agent can only call its own reducers, and the database guarantees still hold with every agent down.
- Make the Auditor a real verifier, not a log reader: it reviews every orchestrator proposal and gives an independent verdict with a reason.
  Deterministic checks (unassigned too long, load imbalance) stay in scheduled reducers, and the Auditor explains and escalates them.
- Show the orchestration on the dashboard as a hand-off board (tasks by agent and state) and a live action log (every tool call with agent, model, reason, and time), linked by a chain id so judges can follow one survivor from detection to acknowledgement.
- Cut order if time runs short: vision tool, then sitrep tool, then rescuer voice questions, then the Search agent (merge `plan_search` into the Orchestrator), then the Auditor's LLM review (keep the reducer flags), then Comms falls back to templates.
  The Orchestrator is never cut, and if Nemotron fails, the database watchdog still assigns.
- In the pitch, say plainly why the work is split: different inputs and outputs (robot, glasses), different speed needs (the rescuer waits for Comms, the board does not wait for the Auditor), and independent checking.
  The evidence below says that splitting without such a reason makes systems less reliable.

## 1. What NVIDIA judges and sponsors reward

### The track slide

The NVIDIA track asks for Nemotron "beyond a chatbot", multi-step workflows with "agents that plan and execute complex tasks", tool integration with external APIs and services, and real-world use (from `docs/notes/2026-11-07-nvidia-track.md`).
The slide does not say that more agents score higher.

### What NVIDIA says about Nemotron and agents

- NVIDIA describes Nemotron 3 Super (120B total, 12B active) as "designed to handle complex subtasks inside a multi-agent system", with "high-accuracy tool calling" [N1].
- The same post warns that multi-agent workflows "generate up to 15x more tokens than standard chat", and names "goal drift" and a "thinking tax" (reasoning at every step with a large model) as costs [N1].
  Inference: NVIDIA itself frames cost and drift as the problems to manage, so a design that uses Super only where planning is needed and Nano for narrow agents matches NVIDIA's own message.
- NVIDIA's AI-Q blueprint, built on the NeMo Agent Toolkit, uses a multi-agent design with a planner, researcher, and orchestrator, and lists Nemotron 3 Super and Nemotron 3 Nano as agent models [N2][N3].
- The NeMo Agent Toolkit is NVIDIA's open-source framework for building, profiling, and optimizing agents from any framework, and it works with any function-calling model on build.nvidia.com [N4][N5].
  Inference: using the toolkit is not required by the slide, and adding a Python framework 17 hours out is a risk; naming the AI-Q pattern (planner, workers, verifier) in the pitch gets most of the credit.

### Winning projects

- NVIDIA's own write-up of a NeMo Agent Toolkit hackathon says entries were "judged on real-world applicability, technical execution" and how well they showed agentic AI [W1].
  The 1st place project "orchestrates a team of AI agents": it read plain-language logistics instructions, planned routes with cuOpt, tested them in Omniverse simulation, and sent them to Jetson Nano robots [W1].
  An honorable mention used specialized sub-agents for logs, network, and processes that share findings [W1].
- At NVIDIA's UC Santa Cruz agentic hackathon (2026), the Edge Track winner was FactoryMind (autonomous factory robots) and another winner, HydroClaw, was an agent that runs a hydroponic farm, "constantly monitoring growth and taking corrective action in real time" [W2].
  The article does not say whether the winners were multi-agent [W2].
- The Nemotron Developer Days Seoul grand prize went to a synthetic data pipeline, not a multi-agent system, and judges praised a team that showed "not only qualitative but also quantitative evaluation" [W3].
- The SpacetimeDB winners at Cal Hacks 13.0 (Vouch, Pacioli, skyFall) had agents propose actions inside database rules, gave measured numbers, and showed progress as live rows (from `docs/notes/2026-11-07-spacetime-winners.md`).
- No Devpost result was found for a Nemotron disaster-response robot, so there is no direct precedent.

### Does multi-agent score better than one well-tooled agent?

Inference: the evidence says judges reward agents that plan and act on the real world, with measured results, more than the number of agents.
The closest precedent (W1, 1st place) is an orchestrated team of agents that ends in real robots, which is very close to this project.
So a small, clearly reasoned multi-agent team that drives a real robot and real glasses is a good fit, and a large team of agents that only pass messages is not.

## 2. Multi-agent versus single agent: reliability and cost

- Anthropic: start with "the simplest solution possible", and add complexity only "when it demonstrably improves outcomes" [R1].
  It separates workflows ("predefined code paths") from agents (the LLM "dynamically direct[s] its own processes"), and names orchestrator-workers (subtasks decided from the input) and evaluator-optimizer (one model generates, another evaluates) as patterns [R1].
- Anthropic's research system: multi-agent beat a single agent by 90.2% on its research eval, but used about 15 times the tokens of chat; it fits "heavy parallelization" and does not fit domains where agents "share the same context or depend heavily on each other" [R2].
- Cognition: "Share context, and share full agent traces", because "conflicting decisions carry bad results"; the default is "a single-threaded linear agent" [R3].
- Berkeley MAST study: 14 failure modes from 1600+ traces across 7 frameworks, and failures often come from system design, not only model limits [R4].
- Google Research, DeepMind, and MIT (180 configurations): independent agents amplify errors up to 17.2 times, a central orchestrator limits this to about 4.4 times, and gains from more agents fade once a single agent is already accurate [R5][R6].

### When splitting helps in this project

Inference, applying the sources above:

- Separate channels with separate outputs: the robot and the glasses are different devices with different message formats, so they do not need to share one context.
  This matches the "sectioning" case [R1], and avoids Cognition's conflict problem because each agent writes to a different thing.
- Different speed needs: a rescuer asking a question waits for Comms, but the Auditor can run seconds later.
  One agent doing both would make the rescuer wait behind audit work.
- Independent verification: a second model that only checks the Orchestrator's proposals is the evaluator pattern [R1] and the central validation role that cut error amplification in [R5].
- Not a reason to split: triage and assignment share the same context (the whole board), so they stay in one agent, the Orchestrator.

### What makes it safe

The database, not the agents, keeps everyone from being dropped (`docs/AGENT_WORKFLOW.md`).
Agents only propose, through narrow reducers.
Inference: this is why the MAST and error-amplification risks matter less here: a wrong agent output can make a worse suggestion, but it cannot remove a survivor from the board.

## 3. Each candidate agent

"Plain code" means a reducer, a scheduled reducer, or a function in the robot or glasses service.

### Orchestrator (keep, LLM, Nemotron 3 Super)

- Decision plain code cannot make: weigh several survivors, rescuers, and open areas at once, with soft facts (blocked routes, "possibly more" hints, call-out transcripts such as "my leg is stuck"), and choose who goes where and what to search next.
  Nearest-free-rescuer is plain code and is already the database fallback; the Orchestrator's value is the cases where nearest is wrong.
- Inputs: new or changed survivors and scores, rescuer positions and loads, area states, call-out transcripts, audit verdicts.
- Tools: `propose_assignment`, `post_agent_task` (to Comms and Search), `set_audit_flag_status`; optional `sitrep`.
- Latency need: seconds; the database fallback covers it if it is slow.
- Model: `nvidia/nemotron-3-super-120b-a12b`, the model this project already chose for planning (`docs/research/platform.md`) and the one NVIDIA positions for multi-agent subtasks [N1].

### Search agent, the robot planner (keep if time allows, LLM, Nemotron 3 Nano)

- Decision plain code cannot make: turn "house 3 has 1 unaccounted, the kitchen was blocked" into a mission plan (which rooms, in what order, whether to do a call-out), and decide when a weak detection is worth a second look.
  Inspect, continue, and stop on a clear detection are plain code in the robot's state machine, and the safety gate owns motion.
- Inputs: `plan_search` tasks, area states, robot telemetry summary, detections, terrain labels.
- Tools: `create_mission`, `cancel_own_mission`.
- Latency need: seconds to tens of seconds; the robot keeps its current mission while it waits.
- Verdict: it is a real separate channel (the robot), and it gives the demo its clearest "agent plans and executes in the physical world" moment, like [W1].
  But its decisions are the easiest to fold into the Orchestrator as one `plan_search` tool, so it is the first agent to merge if time runs short.

### Comms agent, the glasses (keep, LLM, Nemotron 3 Nano)

- Decision plain code cannot make: compress a survivor record into a few short lines for a small display, and answer free-form rescuer questions ("Is anyone else in house 3?") from the board.
  The arrow, distance, count of critical survivors, heartbeat, and acknowledgement are plain code in the glasses service.
- Inputs: `brief_rescuer` tasks, the survivor and area rows, rescuer questions (text from the glasses microphone, if the SDK allows).
- Tools: `post_briefing`; optional `describe_still` (the vision tool below).
- Latency need: the fastest of all, because a person is waiting; use Nano with reasoning off, and a template briefing if it times out.
- Verdict: keep; it owns a separate device and the strictest latency.

### Auditor, the verifier (keep, LLM plus reducers, Nemotron 3 Nano)

- The counting checks (survivor unassigned over N seconds, rescuer load imbalance, stale heartbeat, stuck area) are plain code and belong in scheduled reducers, which write audit flags.
- Decision plain code cannot make: review each Orchestrator proposal and say whether it makes sense against the board ("Rescuer B is 40 m from another IMMEDIATE survivor; A is free"), and flag possible duplicate survivors where two detections may be one person.
- Inputs: each new `propose_assignment`, new reducer flags, the board.
- Tools: `file_audit_flag` (verdict: agree or object, with a reason).
- Latency need: low priority; it can lag by seconds without harm.
- Verdict: keep, as the evaluator in the evaluator pattern [R1].
  Inference: using a different model (Nano) from the Orchestrator (Super) gives a somewhat more independent second opinion than asking the same model twice.

### Calls agent (removed)

Removed with Photon, as the team decided.
Its job (turning household answers into person reports) has no input without phone calls.

### Vision describer (do not build as an agent; optional tool)

- Decision: turn one camera still into words for the briefing ("head visible, legs under debris").
- NVIDIA hosts a vision-language model, `nvidia/nemotron-nano-12b-v2-vl`, that takes images and does visual question answering [V1][V2].
- Verdict: a tool that Comms calls once per survivor, not an agent; it makes no decision about what to do next.
  It needs regular light on the scene, and the hosted model id must be confirmed on build.nvidia.com before use.
  Cut first.

### Situation summarizer (do not build as an agent; optional tool)

- Decision: write a short status for the incident commander or a shift handoff ("12 found, 3 IMMEDIATE, house 4 partly searched").
- Verdict: a `sitrep` tool on the Orchestrator, run on a button press or every few minutes, written to a row the dashboard shows.
  The numbers come from a query, and the model only writes the words.
  Cut second.

### Intake of microphone call-outs (no new agent)

The robot's call-out transcript ("I'm here, I can't move my leg") is free text that plain code cannot read well.
Inference: give it to the Orchestrator as part of triage, not to a new agent, because it changes priority, which is the Orchestrator's job.

## 4. Coordination on SpacetimeDB

### Task table with leases, not direct calls

- Keep the design in `docs/AGENT_WORKFLOW.md`: agents never call each other; they post rows to `agent_task`, and the addressed agent claims a row with a lease, works it, and marks it done.
- Reducers run as transactions, so a `claim_task` reducer can check "unclaimed or lease expired" and claim in one step, with no race (inference from how reducers work; see [S1]).
- A scheduled reducer puts expired leases back on the board, which is how the skyFall winner ran its job queue, sweeping every 2 seconds (`docs/notes/2026-11-07-spacetime-winners.md`); schedule tables are documented in [S2].
- Agents subscribe to their own rows, so nobody polls; a developer who ran five agents on one SpacetimeDB instance wrote that "The database _is_ the message bus" and removed about 400 lines of custom queue code [S3].
  The same developer found one shared connection was a bottleneck and moved to one connection per subsystem [S3], so give each agent its own connection and identity.
- Each agent has its own identity, and reducers check the caller against an agent registry, so the Comms agent cannot call `propose_assignment`.
  That developer enforced the same ownership rule in the database [S3].
- Why not direct calls between agents: a direct call hides the hand-off from the database, so it is not logged, not replayable, and not covered by leases.

### Where Nemotron calls run

Keep the agent runner outside the database, as `docs/research/platform.md` recommends.
SpacetimeDB procedures can make HTTP calls but reducers cannot [S1], the docs describe no secrets feature [S1], and procedures are marked unstable in C# and C++ [S1].
Inference: calling Nemotron from inside the module would put the NVIDIA key in the database or in reducer arguments, and would tie a slow model call to the database.

### Request budget

All agents share one request budget (`docs/AGENT_WORKFLOW.md` sets 20 per minute, about half a forum-reported 40 per minute limit, see `docs/research/platform.md`).
Order: Comms answers to a waiting rescuer first, then Orchestrator work on IMMEDIATE survivors, then Search, then the Auditor.
Inference: three or four agents at a few calls per survivor stay well inside this budget for a live demo; the simulator with hundreds of survivors must use the deterministic fallback, not one LLM call per survivor.

### Showing the orchestration to judges

- Hand-off board: one column per agent (Orchestrator, Search, Comms, Auditor, plus "Database" for the watchdog), with task cards moving from posted to claimed to done, and a lease countdown on claimed cards.
- Live action log: one row per tool call, with time, agent, model, tool, short reason, and how long the model took.
  This also gives measured numbers for the pitch, as the SpacetimeDB winners did.
- Chain view: every task carries a `chain_id` from the first detection, so clicking a survivor shows its whole chain (detection, proposal, Auditor verdict, briefing, acknowledgement).
- Kill switch: stop the agent process on stage; the board shows the Database column taking over and the headline stays at 0.
  Inference: this beat shows that the agents improve decisions while the database keeps the promise, which answers both the NVIDIA and State Farm briefs.

## 5. Minimal agent set and fallback plan

The minimal set that still clearly shows multi-agent orchestration is Orchestrator, Comms, and Auditor: a planner, a worker on a separate device, and an independent verifier, coordinating only through the task board.
Add the Search agent if the robot is working early, because it shows a planner handing work to a physical robot.

| Agent | Model | Triggers (rows that wake it) | Tools (reducers) | Writes | Cut order |
| --- | --- | --- | --- | --- | --- |
| Orchestrator | Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) | New or changed survivor, call-out transcript, rescuer freed, audit verdict that objects | `propose_assignment`, `post_agent_task`, `set_audit_flag_status`, optional `sitrep` | Proposed assignments, tasks for Search and Comms, flag status, sitrep row | Never cut (database watchdog is its fallback) |
| Comms | Nemotron 3 Nano (`nvidia/nemotron-3-nano-30b-a3b`, confirm hosted id) | `brief_rescuer` task, rescuer question | `post_briefing`, optional `describe_still` | Briefings and answers for the glasses | 6th (falls back to template briefings) |
| Auditor | Nemotron 3 Nano | New proposal, new reducer flag | `file_audit_flag` | Verdicts and flags with reasons | 5th (reducer flags remain) |
| Search (robot) | Nemotron 3 Nano | `plan_search` task, robot finished mission, area reopened | `create_mission`, `cancel_own_mission` | Robot missions | 4th (merge into Orchestrator as a `plan_search` tool) |
| Rescuer voice questions (Comms feature) | Same as Comms | Glasses microphone text | `post_briefing` | Answers | 3rd |
| Sitrep (Orchestrator tool) | Nemotron 3 Super | Button press or timer | `sitrep` | Summary row | 2nd |
| Vision describer (Comms tool) | `nvidia/nemotron-nano-12b-v2-vl` (confirm on build.nvidia.com) | New survivor with a still | `describe_still` | Scene text in the briefing | 1st |

Fallback if Nemotron is down or slow during the demo: every agent has a deterministic path (watchdog assignment, template briefings, reducer flags), so the board and glasses keep working, and the action log marks those rows as "fallback".

## Sources

- [N1] NVIDIA blog, Nemotron 3 Super for agentic AI (March 11, 2026): https://blogs.nvidia.com/blog/nemotron-3-super-agentic-ai/
- [N2] NVIDIA AI-Q Blueprint docs: https://docs.nvidia.com/aiq-blueprint/2.1.0/index.html
- [N3] AI-Q on build.nvidia.com (model card): https://build.nvidia.com/nvidia/aiq/modelcard
- [N4] NVIDIA NeMo Agent Toolkit: https://developer.nvidia.com/agentiq
- [N5] NVIDIA blog, custom agents with the NeMo Agent Toolkit: https://developer.nvidia.com/blog/how-to-build-custom-ai-agents-with-nvidia-nemo-agent-toolkit-open-source-library
- [W1] NVIDIA blog, hackathon winners with the NeMo Agent Toolkit (July 17, 2025): https://developer.nvidia.com/blog/hackathon-winners-bring-agentic-ai-to-life-with-the-nvidia-nemo-agent-toolkit/
- [W2] UC Santa Cruz news, agentic AI hackathon with NVIDIA and ASUS (2026): https://news.ucsc.edu/2026/06/agentic-ai-first-uc-santa-cruz-hackathon-with-nvidia-asus/
- [W3] Nota AI, Nemotron hackathon grand prize: https://blog.nota.ai/insights/nemotron-hackathon-winner
- [R1] Anthropic, Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- [R2] Anthropic, How we built our multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- [R3] Cognition, Don't build multi-agents: https://cognition.com/blog/dont-build-multi-agents
- [R4] Cemri et al., Why Do Multi-Agent LLM Systems Fail? (MAST): https://arxiv.org/abs/2503.13657
- [R5] Google Research blog, Towards a science of scaling agent systems: https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/
- [R6] Kim et al., Towards a Science of Scaling Agent Systems (paper): https://arxiv.org/pdf/2512.08296
- [V1] Nemotron Nano 12B v2 VL on build.nvidia.com: https://build.nvidia.com/nvidia/nemotron-nano-12b-v2-vl/modelcard
- [V2] Nemotron Nano 12B v2 VL deploy page (model id and image input example): https://build.nvidia.com/nvidia/nemotron-nano-12b-v2-vl/deploy
- [S1] SpacetimeDB procedures: https://spacetimedb.com/docs/functions/procedures
- [S2] SpacetimeDB schedule tables: https://spacetimedb.com/docs/tables/schedule-tables/
- [S3] DEV Community, a self-hosted multi-agent system in Rust on SpacetimeDB: https://dev.to/aurora_/building-a-self-hosted-multi-agent-system-in-rust-architecture-decisions-and-what-i-learned-3mp1
