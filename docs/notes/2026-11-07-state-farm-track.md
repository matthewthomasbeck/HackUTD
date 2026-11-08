# State Farm sponsor track, 2026-11-07

Source: a photo of the State Farm challenge slide, shared by Cayden on 2026-11-07.
Status: chosen as the second target track by Cayden on 2026-11-07, next to NVIDIA and SpacetimeDB.

## Challenge (slide)

"The Worst Day, at Scale": Intelligent Catastrophe Response.

When a major disaster affects thousands of people simultaneously, how might we use AI and technology to identify those with the most urgent needs, coordinate assistance, and ensure no one is overlooked?

## Prizes (slide)

- 1st place: Beats Studio Pro.
- 2nd place: RC drone with UHD camera and GPS.
- 3rd place: wireless portable monitor.

## Not on the slide

Judging criteria, whether State Farm provides data, and whether hardware counts.
Ask State Farm before locking the use case.

## What the challenge asks for

Three verbs and one promise:

1. Identify those with the most urgent needs.
2. Coordinate assistance.
3. Do it at scale (thousands of people at once).
4. Ensure no one is overlooked.

The challenge is about people in a disaster, not insurance claims.
The claims ideas from the earlier brainstorm fit it poorly.

## Earlier proposed use case (superseded)

The locked project is the rubble search robot dog in `docs/PROJECT.md`; the welfare-check ideas below are background.

This is close to the grid outage idea from 2026-11-01 (idea 9 in `docs/IDEAS.md`), which ranked homes for welfare checks during a Texas freeze.
That idea now has a sponsor asking for it.

The key insight: the people most at risk in a disaster are often the ones who cannot ask for help (no power, no phone signal, elderly, on medical equipment).
A system that only answers incoming requests overlooks them.

- Signals in: help requests (text messages, calls, app), outage areas, weather, and public vulnerability data.
  Optional: home sensors where installed (the ESP32 box from idea 9).
- A Nemotron agent reads free-text requests, extracts needs (oxygen, insulin, heat, children, mobility), merges duplicates, and scores urgency.
- The system also flags silent households: vulnerable people inside the affected area who have not checked in.
  Silence becomes a signal.
- The agent plans assistance: matches responders and volunteers to households, plans routes, and sends follow-ups until each household is confirmed safe.
- Responders see live tasks on a map, on a phone, or on Cayden's Even Realities G2 glasses.

## How SpacetimeDB makes "no one overlooked" real (not decided)

- Every household is a row with a status, and nothing leaves the board until a person confirms it safe.
- Responders claim tasks with leases.
  If a responder goes silent, the lease expires and a scheduled reducer puts the task back in the queue.
- A scheduled reducer escalates any vulnerable household that is not confirmed within a time limit.
  "No one is overlooked" is enforced by database rules, not by hoping people remember.
- Every coordinator, responder, and volunteer sees the same live board through subscriptions.
- Scheduled reducers can run a simulated disaster with thousands of households, to show scale in the demo.

## The robot dog's role (Cayden: the robot dog must be in the project)

The software triages thousands of households.
The robot dog handles the dangerous last step: a building or room that a responder cannot safely or quickly enter.
Its sensors fit this job:

- Thermal camera: a person is a warm shape in a cold, dark, unpowered building.
  This is the strongest use of a low-resolution thermal sensor, but run a range test first (how far away it can still tell a person apart).
- Camera (regular, corrected 2026-11-07): confirms a person and records the breathing clip, but needs visible light.
- LD19 360 degree LiDAR: maps the rooms it searched.
- IMU: tilt and fall detection on rubble or stairs.
- Force sensors (FSRs, 4): placement TBD, not foot pads.
- Pi 4B with the NCS2 or Coral: on-board person detection from the camera.

"No one overlooked" extends from households to rooms:

- Each room of a searched building is a row in SpacetimeDB.
- A room stays uncleared until the robot or a responder reports it.
- A detection ("possible person, room 2, confidence 0.8, thermal and camera images") appears on every coordinator's board at once.
- A responder sees it on a phone or on the G2 glasses.

The Nemotron agent sends the robot with a high-level tool call (for example "search building 14, rooms 1 to 4").
It never drives motors.
The robot's state machine and safety gate stay in charge of motion (see `docs/ROBOT.md`).

Demo sketch: a dark room with the lights off and a teammate or a heated dummy behind furniture.
The robot enters, maps the room, finds the warm shape, and the board and glasses update live.

Limits to state honestly:

- A thermal camera cannot see through walls or glass.
- One robot does not scale to thousands of homes.
  It is the tool for the few places where people cannot go first.

## Disaster scenario candidates (not decided)

Where sending the robot first beats sending a person:

| Scenario | Why a person should not go in first | Sensor fit | Concerns |
| --- | --- | --- | --- |
| Tornado outbreak (recommended) | Damaged homes can collapse further, power is out, and gas lines may be broken | Thermal finds people in dark rooms, NoIR sees in the dark, LiDAR maps blocked rooms | A small wheeled robot cannot climb a full rubble pile, so scope it to partly damaged homes |
| Winter storm and outage (like Texas 2021) | People run generators or grills indoors, so a home can hold carbon monoxide | Thermal finds a person in a cold, dark home | Needs a carbon monoxide sensor, which is not in the inventory |
| House or wildfire smoke | Smoke blocks vision and the air is toxic | Thermal cameras see through smoke, which is why firefighters use them (the original firefighter theme) | Smoke cannot be shown indoors at the venue |
| Flood (like Hurricane Harvey) | Live wires in standing water | Weak | The robot cannot drive through water |

Real search and rescue uses trained teams and dogs, so the pitch positions the robot as the first look inside, not a replacement for them.

## Facts to verify before using them in a pitch

- Public vulnerability data that could feed the ranking, for example the HHS emPOWER data on people who depend on electricity-powered medical equipment, and the CDC Social Vulnerability Index.
  Check what each offers and at what level of detail.
- Sourced numbers for a reference disaster, for example the February 2021 Texas winter storm (homes without power, deaths).
- What State Farm already does in catastrophe response, so the pitch does not repeat it.
