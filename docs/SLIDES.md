# HackUTD pitch deck

Status: content draft for C5, 2026-11-07.
This is a slide script and evidence checklist, not a finished visual deck.
Use Figma Slides in the shared design file or Canva if the team chooses Canva for slides; keep one deck in one place.
Design source and screenshot requirements are in [DESIGN.md](DESIGN.md).
External evidence and fuller caveats are in [research/pitch-facts.md](research/pitch-facts.md).

Decision 2026-11-08: the judged demo is hard-coded.
Only SpacetimeDB runs live; the simulator scripts the robot (`sim-dog`), the find, the breathing result and critical score, and any rescuer actions.
The Nemotron agents, the perception service, the real robot, and the real G2 hardware do not run live in the judged demo, so no slide may say or imply that they did.
The dashboard and the glasses view (on the G2 or the fallback page) are real clients that render the scripted data live from SpacetimeDB subscriptions.
The demo story ends at the find in house 3 (`docs/specs/demo.md`, "Judged demo (hard-coded, 2026-11-08)").

## Deck outline

| # | Title | On-slide copy | Visual and evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | Nobody gets lost in the rubble | A robot finds survivors; a live system keeps every rescue moving. | Robot on mock rubble, project name, one-line promise. | Blocked on Matthew's robot photo. |
| 2 | One building. One long night. | At Mayfield's candle factory, Kyanna Parsons-Perez was trapped under debris for about two hours before rescuers reached her. | Respectful, sourced account; use a credited, openly licensed scene image or a simple location and timeline graphic, not an unlicensed disaster photo. Cite TODAY and NWS in speaker notes. | Fact sourced; visual TBD. |
| 3 | The first day matters | In one 1980 earthquake study, 87.9% of people extricated on day zero were alive, compared with 35.3% on day one. | Large 87.9% and 35.3% figures with labels “alive at extrication”; cite De Bruycker et al. in the slide footer or speaker notes. Add “1980 southern Italy earthquake, 548 rescued casualties” in small type. | Fact sourced; keep the study context visible. |
| 4 | Find. Triage. Assign. Guide. | A robot reports a person; agents coordinate; SpacetimeDB tracks the work; glasses guide a rescuer. | One diagram: robot → detection → agent task board → survivor assignment → glasses. Use product tokens and a live board screenshot thumbnail. | Blocked on working dashboard screenshot and approved design file. |
| 5 | Live demo | Watch one find reach the dashboard and the glasses through SpacetimeDB. | Minimal card that says "Scripted robot and find; SpacetimeDB live", then switch to the `demo` timeline run. Show “DEMO MODE” in the glasses fallback screenshot. (Updated 2026-11-08 for the hard-coded demo; the earlier copy was "Watch one find move from the robot to a rescuer.") | Blocked on screenshot. |
| 6 | Agents plan and hand off | The orchestrator proposes; the auditor checks; the comms agent briefs the rescuer. | Full Agents panel showing one survivor's `chain_id`, task board, and auditor verdict. Add the measured median verdict time only after C4; otherwise label it TBD and omit from the live slide. Since 2026-11-08 the agents are not in the judged demo: label any agent screenshot as a separate test run (for example the Brev validation in `notes/2026-11-08-brev-validation.md`), not the demo. | Blocked on full Agents panel screenshot and C4 measurement. |
| 7 | Nobody falls out of the queue | The database tracks every critical survivor until a rescuer acknowledges the assignment. | Dashboard headline “Critical survivors unattended over 60 s: 0” after the `scale 300` run; show the queue and a measured disconnect/watchdog timeline. | Blocked on simulator run, screenshot, and measured timings. Do not present zero as a real-world outcome. Since 2026-11-08 the sim crew is minimal (R1 and R2, `extra_sim_rescuers` 0), so this run would need extra helper rescuers, and it is not part of the judged demo. |
| 8 | The database runs the response | Reducers enforce the rules; scheduled rows run timers; subscriptions keep both screens in sync. | Counts from `spacetime describe assess-0hw81 --json`, the Timers tab, and a photo of dashboard plus glasses/fallback. | Blocked on deployed module, command output, and screenshots. |
| 9 | Results we measured | Find to acknowledgement: TBD. Breathing result: TBD. Thermal range: TBD. | Three large values, each with units, test conditions, and sample count. Replace TBD only with measurements from C4, Eric's clip evaluation, and Matthew/Eric's thermal range test. | Blocked on all three measurements. |
| 10 | A cue for a human, with limits | We show a possible survivor and confidence; we never diagnose death or claim to see through rubble. | Survivor row “No signs of life detected, low confidence” and a “PARTIAL, still in queue” search cell. | Blocked on representative UI screenshots. |
| 11 | Team and next steps | Four teammates built a demo; a field pilot needs tested hardware, validated sensing, and responder evaluation. | Names and confirmed roles from `TASKS.md`; pilot needs as a short list. | Blocked on Camille's last name and final role confirmation. |

## Two-minute speaking plan

| Time | Slides | Spoken beat |
| --- | --- | --- |
| 0:00-0:15 | 1-2 | A real survivor story, then the problem: locating and accounting for people is urgent and difficult. |
| 0:15-0:25 | 3 | One study shows why earlier discovery matters; state the study and its limits. |
| 0:25-0:55 | 4-5 | Explain the flow, then run the demo or video. |
| 0:55-1:20 | 6 | Show one agent handoff and the rescuer's glasses view. |
| 1:20-1:40 | 7-8 | Stop the agents; show the database fallback, timers, and live synchronized views. |

Since 2026-11-08 the judged demo ends at the find and has no agent stop, so the 0:55-1:40 beats are slides only: say the agents and the watchdog test were run separately, and do not stop agents live.
| 1:40-2:00 | 9-11 | Share measured results only, state safety limits, introduce the team, and name the next step. |

## Asset and evidence checklist

- [ ] Confirm Figma Slides or Canva and add the design file link to `DESIGN.md`.
- [ ] Get Matthew's robot-on-mock-rubble photo and confirm its usage rights.
- [ ] Capture live dashboard, Agents panel, glasses fallback, timer view, and paired screens after the integration run.
- [ ] Run `scale 300` and save the exact simulator run and output behind the unattended headline (needs extra helper rescuers since the 2026-11-08 minimal crew).
- [ ] Measure disconnect release, watchdog assignment, find-to-acknowledgement, breathing performance on the selected clips, and thermal detection range with conditions and sample counts.
- [ ] Add a “simulated demo” label anywhere simulated people or performance are shown.
- [ ] Add source attribution on slide 2 and slide 3 or in visible speaker notes, and preserve limitations from `research/pitch-facts.md`.
- [ ] Confirm team names and roles before exporting the deck.

## Claims to leave out until verified

- Do not say the robot detects breathing with thermal imaging; the breathing check uses the regular camera and requires light.
- Do not say the robot sees through walls, boxes, or rubble, replaces search dogs, or determines whether a person is dead.
- Do not call the 1980 study a universal survival curve or say that no one survives after 72 hours.
- Do not claim Nemotron tool calling works with our hosted key until Eric's smoke test passes.
- Do not say the robot, the agents, the perception service, or the real G2 ran live in the judged demo (hard-coded since 2026-11-08); say the simulator scripted the robot and the find, and SpacetimeDB ran live.
- Do not report timing, accuracy, range, number of people protected, or other project performance without a measured result and test conditions.
