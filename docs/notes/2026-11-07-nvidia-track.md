# NVIDIA sponsor track, 2026-11-07

Source: a photo of the NVIDIA track slide, shared by Cayden on 2026-11-07.

Decision: the NVIDIA track is the team's first target track, LOCKED (Cayden, 2026-11-07).
The second track is not chosen.
CBRE is a candidate (see [the CBRE notes](2026-11-07-cbre-track.md)).

## Challenge statement (slide)

Use Nemotron beyond a chatbot.

In addition to using Nemotron, the project must include:

- Beyond a chatbot: not just responding directly to prompts.
- Multi-step workflows: agents that plan and execute complex tasks.
- Tool integration: using external APIs and services intelligently.
- Real-world applicability: solving actual problems.

## Prizes (slide)

- 1st place: 2 RTX 5080 GPUs and $200 in Brev credits.
- 2nd place: 1 RTX 5080 GPU, $200 in Brev credits, and swag.

## How the robot can fit (not from the slide, not decided)

- A Nemotron agent plans the robot's missions instead of answering prompts.
  For example, it reads facility data, chooses which asset to inspect, sends the robot, reads the result, and decides the next step.
- The robot is one of the agent's tools.
  Other tools can be facility data sources and a work order or alert service.
- Where Nemotron runs (an NVIDIA hosted API, a Brev GPU, or another host) is open.
  The Pi and the NCS2 or Coral are not planned to run it.
- The state machine and safety gate in `docs/ROBOT.md` stay in charge of motion.
  The agent sends high-level requests, and only the safety gate passes commands to the drivers.
