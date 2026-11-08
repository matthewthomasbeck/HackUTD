# HackUTD

Robot entry for HackUTD.
The team is Cayden Hutcheson, Matthew Beck, Eric Lee, and Camille (last name to add).

Target tracks: NVIDIA ("Use Nemotron Beyond a Chatbot"), State Farm, and SpacetimeDB, which also runs the whole backend.
The project: a robot dog searches rubble after a disaster, finds survivors with a thermal camera, checks for breathing with Eulerian video magnification, scores how critical each person is, and guides an operator wearing smart glasses to the most critical survivors.
See `docs/PROJECT.md`.
The robot is a Raspberry Pi 4B running a C++ state machine that drives the actuators, and a Raspberry Pi Pico that reads the sensors and streams them to the Pi.

- `docs/MVP.md` - the MVP to share with the team: demo, scope, workstreams, fallbacks.
- `docs/TASKS.md` and `docs/tasks/` - who builds what, with phases, checkpoints, and "done when" for every task.
- `docs/DESIGN.md` - design control for the dashboard, glasses, and slides, plus the slide outline.
- `docs/PROJECT.md` - what the team is building (source of truth).
- `docs/AGENT_WORKFLOW.md` - one-page summary of how the single AI agent works.
- `docs/specs/` - implementation specs per component, with the shared contracts and build order (start at `docs/specs/README.md`).
- `docs/ROBOT.md` - the robot brief and source of truth (hardware, pin map, architecture, protocol, open questions).
- `docs/research/` - research for the dropped EOG direction (produced water, leak detection, inspection robots, images).
- `docs/IDEAS.md` - the ideation history and earlier candidate ideas.
- `docs/notes/` - dated meeting and chat notes.

The team's code repo is https://github.com/matthewthomasbeck/HackUTD.
No code exists yet.
