# HackUTD Ideas

Sources: the team group chat (Cayden, Eric Lee, Matthew Beck), read on 2026-10-18, the [2026-10-30 team call](notes/2026-10-30-team-call.md), the [Discord chat of 2026-10-31 and 11-01](notes/2026-11-01-team-chat.md), and the [2026-11-01 team call](notes/2026-11-01-team-call.md).
Nothing here is locked.

## Current state (2026-11-07)

The team moved to a robot project, recorded in [ROBOT.md](ROBOT.md), which is now the source of truth.
The possible theme is a firefighter-assistance robot, and the use case and MVP are not chosen.
The Nov 7 whiteboard confirmed the computers (Raspberry Pi 4B and a Pi Pico), C++, inverse kinematics instead of RL, and no URDF.
The grid outage idea (idea 9) is no longer the plan.
Later on 2026-11-07 the tracks became NVIDIA, State Farm, and SpacetimeDB, then briefly NVIDIA, State Farm, and Photon on Supabase, and finally NVIDIA, State Farm, and SpacetimeDB again (Photon dropped as too much work with too many edge cases), after the team looked at CBRE, EOG, T-Mobile, and NMC² (each has a dated file in `notes/`).
State Farm's challenge (catastrophe response, "no one overlooked") is close to the grid outage welfare-check idea (idea 9), which became the starting point ([State Farm notes](notes/2026-11-07-state-farm-track.md)).
The locked project is a rubble search robot dog, described in [PROJECT.md](PROJECT.md).
The rest of this file is the ideation history, kept as it was.

Notes on how the robot connects to the ideas below (not from the team):

- The firefighter angle echoes the "Sophie" reference, which interviewed two firefighter stations (see the winning formula below).
- The robot uses most of Matthew's parts (servos, Maestros, Pis, the Pico, the thermal sensor, the lidar), which answers his wish to use his sensors and the hardware track concern about touching objects.
- The brief lists an Intel NCS2 or Coral accelerator, and earlier notes list "3x tensor processing units".
  Whether these are the same parts is unconfirmed.

## State as of 2026-11-01 (superseded)

- Leading idea: grid outage monitoring (idea 9), now widened to an all-weather home monitor pitched on Texas freezes.
  Matthew and Camille back it, and Cayden came around to it on the call.
  Eric is not sold, so this is still not a confirmed team decision.
- The team said it needs to choose tonight, because the UPS hat must be bought now to arrive by Nov 5 or 6.
- Eric's unanswered question: the map needs many homes to have hardware, and Standard Response needed none.
- Other ideas from the call: glasses and elderly-care concepts (ideas 11 to 13), and the desk robot (idea 6) came back.
- The fish robot (idea 7) and brace (idea 10) did not come up as live options on the call.
- Soldier injury detection (idea 8) was the backup on the 2026-10-30 call, and has not come up since.
- Cayden added two new ideas on 2026-11-06, not yet discussed with the team: farm disease scouting (idea 14) and used car inspection (idea 15).
- The fish robot's open action items (pool access, buying PVC, rubber, and resin) were set before this change, so confirm them before anyone spends money.

## Candidate ideas

### 1. Tank-based helper robot (Matthew)

Wheeled or tracked platform.
Matthew already has the DC motor controllers, motors, and actuators.
Wheeled is easier than walking, so the team spends time on what the robot does instead of on locomotion.
Frame can be PVC and plastic sheets, which makes assembly easy.
About counter-top height, slightly shorter than Matthew, so it can grab things from counters.
Needs a working end effector.
The use case could be a variety of tasks (Eric suggested elderly help).

Risks:

- Stairs are a problem for wheeled and tracked robots.
- Use case is still undefined.
- Matthew drew a sketch of the arm on a tracked base and shared it in the chat.

### 2. Drone (Matthew)

Context: Matthew's uncle works for Fluidion, a French robotics company, which is delivering a heavy boat drone to Pepperdine for water sampling.
The idea is a nimble flying drone that does the same job, possibly a dirigible.
Status: effectively dropped.
Eric is worried about demoing it, and Matthew agreed that water and air drones do not fit the hackathon template.
Idea 7 returns to water, but as a pool robot with a prerecorded demo instead of a drone.

### 3. Legged robot (Matthew, Eric)

Matthew shared a one-person, seven-day legged robot build as a reference.
He would suggest a robot dog, since he has more experience with them than with humanoids.
It would likely win the hardware track and would be a stage-worthy demo.

Risks (all from Matthew):

- Legged robotics is the hardest problem he has met in CS.
- Walking needs either Isaac Lab (NVIDIA RL) or hand-tuned inverse kinematics.
- Needs closed-loop actuators (EDULITE05) that ship from China, so lead time is a risk.
- Work needed: CAD for the parts, a URDF for Isaac Lab, RL in Isaac Lab, onboard robot code, electrical and robot assembly.
- Sim-to-real needs 1:1 parity.
- Matthew said earlier that the team should avoid legged robotics as far too risky, then offered it as an option and said he can pay for the actuators.
- Cayden's point: a sim-only or locomotion-only project is not enough, because the actual robot is the main feature.

### 4. Guide robot for blind or deafblind users (Eric)

Eric floated a robot that acts like a guide dog, using "GVS" (galvanic vestibular stimulation, not GPS) to steer a person along the robot's path.
Eric called it unfeasible but said the GVS steering is the coolest part.
Matthew said the robot is feasible: 360 degree lidar, single-point lidar or cameras for obstacle detection, and a GPS module with the Google Maps API so the user can set a destination.
Voice is the better interface for blind users than a button remote.

Risks:

- Eric: in a crowded space, the user still needs a walking cane so people do not walk in front of the robot.
- A communication device is the hard part for deafblind users.
- Matthew liked the idea and suggested a horn or a speaker that asks people to move, like Avride delivery robots.

### 5. Crab robots (Eric, joke)

Eric shared a LinkedIn video of small crab robots.
Cayden joked that a crab would be funny.
Not a serious candidate.

### 6. Desk companion bot (new teammate, built on by everyone)

Pitched by the fourth chat member (an unsaved number, name unknown): a small bot that sits on your desk.
A sensor detects someone sitting down or moving, and the bot waves or lights up.
With speakers it could take reminders and be talked to like an Amazon Echo, or say hello when someone sits down.
Movement stays minimal because the bot is small.
They were also thinking of Baymax.

Additions from the rest of the team:

- Cayden: it could catch you doomscrolling and say "HEY".
- Cayden: use a way to cut out the face (like Mira), to address the invasiveness worry.
- Matthew: a little turret that shoots water or air from a keyboard cleaner at you when it catches you doomscrolling.
- Eric: a companionship side, where a friend also has a desk bot and the two of you can call each other through it.

Reactions: Eric and Matthew both liked it.
Eric also called it invasive.
Cayden asked whether it would win.

Open questions:

- How does it detect doomscrolling (camera, phone detection, or something else), and how to handle the privacy concern.
- Fits the small, low-lead-time hardware Cayden already has (ESP32s) and Matthew's sensors better than the legged or tank options.
- Weaker on the "actually moves and touches objects" point Cayden raised for the hardware track.

Came back on the 2026-11-01 call as a fun fallback.
New additions: track time at the desk and engagement with computer vision, an app for timers and friends' status, and a robot that drives away with your phone.
One teammate (unlabeled, likely Camille) said they would rather build this, and also said it is not saving lives.

### 7. Underwater fish robot for aquatic rescue (2026-10-30 call)

Main idea as of the call, now behind the grid idea (idea 9).
Eric still prefers it, and said on 2026-10-31 that pool-only scope is fine.
A fish-shaped articulated robot patrols a pool, uses onboard computer vision to spot a drowning, then surfaces to alert and notifies a parent.
The story is that drowning is a leading cause of death in children, and apartment complex pools often lack lifeguards.

Build:

- Body: PVC pipe frame with rubber fins, inspired by the MIT robotic fish.
  Organic movement avoids propeller snag issues.
- Control: neutral buoyancy from lead pellets, and steering from differential fin thrust.
- Waterproofing: resin-printed dummy enclosures with leak-test strips, and the camera behind a glass or plastic bubble dome.
- Detection: pose and limb tracking to separate frantic or thrashing movement from calm swimming, plus an ultrasonic distance sensor ($16 waterproof option found) for objects.
- Alert: the robot surfaces and uses flashing lights or buzzing, since speech underwater is not effective.
- Software: minimal front end (battery status, alert to a parent's phone) and an AI call agent to notify the parent.
- Privacy: skeleton and pose tracking only, no raw video stored.

Hardware Matthew already owns:

- 12x 45kg servos and 12x 25kg servos (24 total, waterproof).
- 2x Pololu Maestros.
- 2x Raspberry Pi (one needed).
- 3x tensor processing units.
- Range extender for Raspberry Pi networking.
- 150 degree FOV infrared camera.

Still needed: PVC pipe, rubber sheets, and resin for 3D-printed fin arms (Matthew is sourcing these).

Scope:

- Pools are the primary scope because the water is clear and no drone is needed.
- Beach or flood scope with a drone + robot duo was deprioritized.
  Vision at altitude is uncertain and ocean winds are a concern for small drones.
- Flood scope would give a richer software case (live robot feed, zone mapping for responders) but complicates the demo.
- Sonar for murky water cannot tell a person from debris.

Risks raised on the call:

- Telling drowning apart from floating or playing.
- Pool access for testing and demo recording.
  Cayden is asking their sister in Dallas, and Matthew is checking with contacts.

Gaps noticed while writing this up (not from the call):

- Actual drowning is often quiet, with little visible thrashing, so "frantic movement" may be the wrong signal.
  Check this with a lifeguard or the drowning literature.
  A lifeguard interview would also supply the real-user credibility the team wants.
- The buy list omits items the design depends on: lead pellets, the ultrasonic sensor, and a waterproof battery setup.
- The design uses a Raspberry Pi and tensor processing units, not a Jetson, so it does not fit the likely Nvidia track as specified.
- Radio does not carry far through water, so the alert probably cannot reach the phone until the robot surfaces.
  That delay matters for the rescue story.

### 8. Soldier injury detection (2026-10-30 call)

Backup concept named on the call.
The notes give no detail beyond the name.
It sits close to the football helmet impact project raised as inspiration, and the observed computer vision + medical + hardware formula.

### 9. Grid outage monitoring (2026-11-01 chat)

Leading idea.
Details are in the [chat notes](notes/2026-11-01-team-chat.md).

Public data exists (ERCOT, utility outage maps, HHS data on people with medical equipment, census, weather), but it is not centralized.
None of it shows in real time which specific houses lost power or how cold they are getting.
A small box fills that gap and feeds a website that shows which homes need a welfare check first.

Build:

- House box: plugs into a wall outlet, with a battery and temperature sensor in a 3D-printed case.
  When power goes out, it switches to battery and reports.
- Website: live map of which houses are out, for how long, and how fast each is getting cold.
- Ranking: combines the live data with public vulnerability data to order welfare checks.
- App: logs the info for users and marks shelters.
- Help button, from Camille and Eric: a button on the box or in the app requests a ride to a warming center, medicine, or water, and the request shows on the map.
  This makes the system two-way.
- Simulation: the pitch names this as a main area of work, but gives no detail.

Reporting when the wifi is down (from Camille):

- Bluetooth to the phone app, which sends the data over cellular.
- ESP-NOW between boxes, so a box with no internet passes its message to a neighbor's box that has internet.
- Store the data on the box and upload it after it reconnects.

Open hardware question: Matthew suggested a Raspberry Pi, for his range extender antenna and for Linux network management.
Camille suggested a split: a plugged-in Pi gateway with the antenna (like a hub at a fire station), and ESP32 house boxes, because they use less battery and a Pi's SD card can corrupt on sudden power loss.
No one has confirmed the split.

Hardware the team already owns: Cayden's 3 ESP32 boards, and Matthew's Raspberry Pis and range extender.
Still needed: batteries, temperature sensors, and printed cases.

Ideas still open from the chat:

- Eric's prediction angle: see a cold front a week out, and warn users that their house will lose power or running water.
- Eric recalled that homes near hospitals did not lose power, which may be a useful input.
- A black box for a house (speaker not labeled).

Gaps noticed while writing this up (not from the chat):

- Hardware track fit.
  The hardware is deliberately simple, and it does not move or touch objects, which Cayden raised as a likely need for the hardware track.
  It also does not use most of Matthew's parts, which he wanted to use.
  Check this year's track prompt, because a healthcare or software track may fit better.
- The boxes only help homes that installed one before the outage, and the most vulnerable homes may be the least likely to do so.
  The pitch needs a distribution story, such as a utility, city, or nonprofit handing them out.
- In a wide outage, neighbors' boxes also lose internet, so ESP-NOW may only help near the edge of the outage.
  Box-to-box and box-to-gateway range through real houses is unverified, and so is cellular service during an outage.
- Check how detailed the public vulnerability data is.
  If the HHS data is not at the household level, ranking specific homes needs users to opt in, and that data is sensitive.
- A home cools slowly, so the demo needs a plan: a sped-up simulation, or a box in a cold container.
  Pulling the plug on a box and watching the map update could work live, with no pool needed.
- The story needs a specific person and real users, per the winning formula below.
  A welfare check responder or a family affected by a Texas winter outage could supply this.

Changes from the [2026-11-01 call](notes/2026-11-01-team-call.md), which replace the build above where they differ:

- Scope: an all-weather home monitor (temperature, humidity, power), pitched on Texas freezes, with heat waves and mold as year-round uses.
- Hardware: a hub in the living room plus a small node in each room.
  The call leaned toward Raspberry Pis for all of it, with both wall and battery power through a UPS hat.
  Matthew showed live that a Pi on a power bank shuts off when wall power is removed.
  The ESP32 question is not closed: the call counted two microcontrollers, but Cayden has 3 ESP32 boards.
- Sensors: Matthew's one thermal sensor and a humidity sensor on I2C.
- Response: a responder dashboard ranks homes by temperature drop, age, and household.
  Eric prefers this over AI voice calls to emergency lines, and residents could still be checked on by phone or through the box.
- AI: a GRU or LSTM on the time series (Matthew), and voice calls to residents.
  Eric's concern about a real use for AI agents is still open.
- Demo: a soldering iron or ice pack on the thermal sensor, a wet rag on the humidity sensor, and simulated data for the rest.
  This resolved Cayden's main objection.
- Possible additions: G2 glasses alerts, and a 3D view of the home from an iPhone Pro LiDAR scan.
- Prediction of when power returns was challenged: if grid operators do not know, the team will not either.
- Install base is the main open weakness.
  Options raised: outage areas for all homes plus detail for boxed homes, a battery-backed thermostat, new construction, and public property records.

### 10. Adaptive scoliosis brace (2026-10-31 chat)

Proposed by Matthew, from his own diagnosis: doctors did not know if his back would break, and a custom brace cost $4k.
That personal story and the medical angle fit the winning formula below.

Camille's prototype: ESP32, servos or adjustable straps, pressure or IMU sensors, and computer vision that analyzes posture and body measurements, then adjusts the brace automatically.
Camille framed it as a proof of concept for personalized fitting, not a medical device.
Eric said computer vision is tricky for precise measurements.

### 11. Guardian angel for elderly relatives (2026-11-01 call)

Proposed by Eric as a way to focus on a group instead of on rare events.
A home device watches over someone who lives alone and has no caretaker, and calls an emergency contact when something is wrong.
It could keep the grid idea's temperature tracking, and add fall detection.
The team did not want a camera, so Eric wants to retry Wi-Fi sensing, or use a thermal sensor.
Open: the team still needs one specific problem older adults face, and Wi-Fi sensing failed on Radar.

### 12. Glasses assistant for elderly users (2026-11-01 call)

Proposed by Eric.
Cayden's Even Realities G2 glasses show step-by-step help on the display, so a parent does not need to call for tech help or directions.
Doubts from the call: will older adults wear them, the $1,000 cost, and how it beats a search.
The G2 has no camera, so it cannot see what the user is looking at.

### 13. Ankle band navigation for visually impaired users (2026-11-01 call)

Speaker unlabeled.
The user asks the glasses for a place, such as an aisle in a store, and an ankle band buzzes directions using the store's map data.
Open: where precise location comes from indoors, since a store app shows only a rough item location.

### 14. Farm disease scouting with a drone and a ground rover (Cayden, 2026-11-06)

Not yet raised with the team.
A drone flies over a field and maps the plants.
Computer vision finds diseased plants, and a model predicts where the disease will spread next.
A ground rover drives to each flagged plant and removes it before the disease spreads.

Why it could fit:

- The rover touches and removes objects, which answers the hardware track concern from idea 9.
- It reuses most of Matthew's parts: DC motors and controllers, actuators, lidar, GPS, the infrared camera, the TPUs, and the Pis.
  The tracked base from idea 1 could be the rover.
- It matches the computer vision + hardware part of the winning formula, with agriculture in place of medical.
- The drone-to-rover handoff gives AI agents a real job: plan the rover's route and choose which plants to remove first.

Risks and open questions (not from the team):

- Idea 2 dropped drones because they are hard to demo.
  The demo could use a camera on a pole or a ceiling mount in place of the drone, with a short drone clip in the video.
  Cayden owns a DJI Mini 4 Pro (said 2026-11-06), so a drone is available for filming or scanning.
- The rover needs an end effector that pulls or cuts a plant, which is the same open problem as idea 1.
- The demo needs a small indoor "field", such as potted plants with some leaves marked or swapped to look diseased.
- Removing a plant is a strong action, so the pitch needs to say which diseases justify it.
  The farmer interview from the winning formula would answer this.

### 15. Used car inspection with a drone and G2 glasses (Cayden, 2026-11-06)

Not yet raised with the team.
A buyer who finds a used car online often cannot see it in person before paying.
A drone circles the car and scans the body for damage, and reads the VIN.
The VIN pulls the car's details and history, and the buyer or inspector sees the results on Cayden's Even Realities G2 glasses.

Why it could fit:

- A specific, relatable problem: being scammed or surprised by hidden damage on a used car.
- Computer vision on real hardware, and it uses the G2 glasses, which came up in ideas 9 and 12.

Risks and open questions (not from the team):

- The G2 has no camera (idea 12), so the drone or a phone must do all the seeing, and the glasses only display.
- The VIN plate is behind the windshield at the base, which is a hard angle for a drone.
  A phone scan may read it more reliably.
- Flying a drone around a car indoors at the venue is likely not allowed, and idea 2 already dropped drones for demo reasons.
  A toy car on a turntable, or a ground rover with a camera mast, could stand in.
- Free VIN decoding exists, but full accident history usually comes from paid services, so confirm what data the demo can show.
- It does not touch or move objects, so it has the same hardware track question as idea 9.
- Check whether this year's sponsors include a car maker or insurer, since that would decide the track.

## Winning formula observed (2026-10-30 call)

- Computer vision + medical + hardware is a strong combination.
- Judges respond to real user consultations, specific personal stories, a strong demo or demo video, and a problem they can relate to.
- Reference: "Sophie", the Cal Hacks first overall smart walker, used a grandfather's fall and interviews with two firefighter stations.

The full list of inspiration projects is in the [call notes](notes/2026-10-30-team-call.md).

## Sponsor tracks (2026-10-30 call)

- Likely targets: Nvidia and T-Mobile.
- Nvidia: likely best use of Jetson Nano, and the prize was considered mid.
- T-Mobile: historically phone and dashboard focused, hard to fit hardware naturally.
- PNC: AI-powered productivity solution for product managers.
- MLH: coaches are ineligible, per an MLH organizer on Slack after Cal Hacks.
  Cayden is an MLH Coach, and the notes do not say whether this rules out only Cayden or the whole team.

These come from memory of past events, not from this year's published list.

A web search on 2026-11-01 found no confirmed 2026 dates or sponsor list.
A [HackUTD redesign page](https://hackutd-redesign.pages.dev/) says Fall 2026 in Richardson, TX, and lists tracks including AI & Machine Learning and Healthcare.
That page may be a draft, so confirm it against the official site.

## Other points from the chat

- Matthew: whatever the team builds should use all of his sensors, both to keep options open and as a demonstration of skill.
- Eric: he and Cayden have not had much time to think about HackUTD, but the team needs to settle parts soon.

- Cayden noted that the hardware track prompt mentions touch sensing, so the robot probably needs to interact with objects, not only move.
- Eric wants an overall balance of software and hardware.
- Eric shared an open-source robotics project (LinkedIn post, "Robotics for everyone") as inspiration.
- Cayden: the team should look at the sponsor tracks before choosing.

## Open decisions

- Confirm the grid idea as a team, given Eric's doubts.
- How to answer the install-base problem, and what AI agents do in the project, if anything.
- Whether the grid idea fits the hardware track, or should target Nvidia and overall.
  The 2026-11-01 call was split between first overall and sponsor tracks.
- Grid hardware: Pis throughout, ESP32 room nodes with a Pi hub, or something else.
- Whether a UPS hat was bought, and whether it fits the team's Pis and reports power loss.
- Whether to order long-lead parts now or only use hardware the team already owns.
- Exact HackUTD dates and this year's sponsor track list.
- Whether the MLH coach rule affects the whole team.
- Live demo or prerecorded video.
  The team first said the demo must work live, and the 2026-10-30 call accepted a prerecorded video on Bill Zhang's advice.
- Who pitches, and who owns software.
  The [call notes](notes/2026-10-30-team-call.md) have primary roles for Matthew, Cayden, and Camille, but not for Eric.
