# Research

Background research done by research agents on 2026-11-07.
Every external fact in these files has a source URL, and each file marks its own inferences.

## For the current project (rubble search robot dog, see `docs/PROJECT.md`)

| File | What it covers |
| --- | --- |
| [platform.md](platform.md) | SpacetimeDB setup and clients, the Pi bridge, the Nemotron agent and API, GPS wiring, demo network, operator navigation, accounts and keys |
| [g2-glasses.md](g2-glasses.md) | Building an Even Hub plugin for the G2, display and input limits, developer mode, effort estimates, fallbacks |
| [bluebook-reference.md](bluebook-reference.md) | Two working G2 apps used as references: bluebook (server-driven glasses UI) and tesla-even-g2 (a live map on the glasses) |
| [perception.md](perception.md) | Thermal person detection, breathing detection, on-robot person detection, triage and the critical score (in progress) |

## For the dropped EOG direction

Vendor-reported results (robot programs) are not independently verified.

| File | What it covers |
| --- | --- |
| [produced-water-operations.md](produced-water-operations.md) | How produced water works in the Permian, EOG's own monitoring (iDetect, miDetect, round-the-clock control centers), trucking vs pipeline costs, Texas and New Mexico spill data, disposal capacity limits, spill reporting rules |
| [detection-methods.md](detection-methods.md) | Real leak and pump detection methods, real-vs-faulty-sensor checks, and signatures measured on the challenge's `history/full_week/` data |
| [inspection-robots.md](inspection-robots.md) | Spot, ANYmal, ExRobotics, and drone programs in oil and gas, which sensors real inspections use, what this team's hardware can honestly approximate, and a suggested demo |
| [images/](images/README.md) | Openly licensed reference photos with attribution for each: water infrastructure and robots at the top level, water leaks in [images/water/](images/water/README.md), infrared and thermal in [images/ir/](images/ir/README.md) |

### Key points from the EOG research

- EOG already runs control centers and in-house leak software (iDetect, miDetect), so the pitch builds on what EOG does instead of claiming it has nothing.
- All three challenge problems have clear signatures in the practice data.
  Pump failure shows as pump `status` 2.
  A leak shows as a pipeline pressure drop plus receive flow falling below pump flow.
  A worn pump shows as a steady fall in flow relative to `max_flow_bpd`, with discharge pressure falling too.
- The measured detector results are in-sample on one labelled week.
  Check them on the snapshots and the mock test before trusting them.
- The practice data has no faulty sensors, so a real-vs-faulty demo needs a sensor fault injected by the team.
- The robot can honestly do short-range thermal (under about 1 m, as a difference from a reference), photos, and gauge reading.
  It cannot detect gas.
- Open questions for EOG mentors: how often their alarms are false, how they triage alarms, and real transfer pump repair times.

### Rules for using the EOG material

- CC BY and CC BY-SA images need attribution wherever they are used (see `images/README.md`).
- Several images are stand-ins from other settings (pumps, trucks, robots), and the tank photos are from North Dakota, not the Permian.
  The image README labels each one.
- The analysis scripts behind `detection-methods.md` were scratch work and are not in this repo.
