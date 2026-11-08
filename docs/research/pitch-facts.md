# Pitch facts: the story, the gap, and the honest limits

Research for slides 2, 3, 6, 7, 8, and 10 (task C5 in `docs/tasks/cayden.md`), done on 2026-11-07.
Every external fact has a source URL.
Lines marked "Inference" are this file's own reasoning or arithmetic, not a sourced fact.
Slide content and the pitch script are in `docs/SLIDES.md`.

## Evidence selected for the current slide draft

- Slide 2 uses Kyanna Parsons-Perez's first-person account as reported by TODAY, including that she was trapped beneath debris for about two hours, and the National Weather Service assessment for the event context ([TODAY](https://www.today.com/today/amp/rcna8462), [NWS assessment PDF](https://www.weather.gov/media/publications/assessments/NWS_Joint_Regional_Service_Assessment_Dec_10-11_2021.pdf)).
- Slide 3 uses the original study's Table 2: among 548 rescued casualties, 87.9% extricated on day 0, 35.3% on day 1, and 8.5% on days 2-3 were alive at extrication ([De Bruycker et al., WHO Bulletin, 1983](https://www.iris.unina.it/retrieve/e268a72d-8b54-4c8f-e053-1705fe0a812c/The%201980%20earthquake%201983.pdf)).
- The NWS assessment confirms 71 tornadoes across eight states and 89 direct tornado fatalities during the December 10-11, 2021 outbreak ([NWS assessment PDF](https://www.weather.gov/media/publications/assessments/NWS_Joint_Regional_Service_Assessment_Dec_10-11_2021.pdf)).
- FEMA's National Incident Management Resource Typing System states that 28 FEMA US&R task forces exist; its Type I teams have 70-person responses ([FEMA NIMS Appendix](https://www.fema.gov/pdf/emergency/nims/nims_appendix.pdf)).
- SpacetimeDB's current documentation describes reducers as atomic database transactions and schedule tables as triggers for reducers at specific times ([reducer transactions](https://spacetimedb.com/docs/intro/key-architecture/), [schedule tables](https://spacetimedb.com/docs/tables/schedule-tables/)). These product facts do not prove that our module implements or passes them; show our own module evidence separately.
- Project performance values for slides 6-9 remain TBD until the C4 run, the perception clip evaluation, the thermal range test, and the `scale 300` simulation are recorded with conditions and outputs.

## Recommended for the slides

### The one story (slide 2)

Mayfield, Kentucky, December 10, 2021: a tornado collapsed the Mayfield Consumer Products candle factory with about 110 people inside.
Kyanna Parsons-Perez, a worker there, was pinned under about five feet of debris for about two hours, called 911, and went live on Facebook to get help and keep her co-workers calm.
She said: "I did not think I was gonna make it at all."
She was one of the last people out.

- Source line: TODAY, "Tornado survivor recalls harrowing experience: 'I did not think I was gonna make it'", updated Dec. 11, 2021, https://www.today.com/today/amp/rcna8462
- Source line for "about 110 inside" and "40 rescued as of Saturday afternoon": CNN via KTVZ, Dec. 11, 2021, https://ktvz.com/news/national-world/cnn-national/2021/12/11/tornado-at-candle-factory-in-kentucky-leaves-many-searching-for-loved-ones/
- Why this story: it is a US tornado, it is about rescue timing, she told it herself in public (so her name is widely published and relevant), and the rescuers had to find people one at a time inside one building.
- Respect rules: use her name and her own quote only; do not show her livestream or any image of the site unless openly licensed and credited; mention that eight co-workers died, without detail.

### The two or three numbers (slide 3)

1. **Being found fast is the difference.**
   In the 1980 southern Italy earthquake study, 87.9% of trapped people extricated on the day of the quake were alive, 35.3% of those extricated the next day, and 8.5% of those extricated on days 2 to 3; from day 4 on, no one was found alive.
   - Source line: De Bruycker M. et al., "The 1980 earthquake in southern Italy: rescue of trapped victims and mortality", Bulletin of the World Health Organization 61(6):1021-1025, 1983, Table 2 (548 rescued casualties), https://www.iris.unina.it/retrieve/e268a72d-8b54-4c8f-e053-1705fe0a812c/The%201980%20earthquake%201983.pdf
   - Say it as: "In one landmark study, about 9 in 10 people dug out on the first day were alive; the next day, about 1 in 3."
   - Caveat to keep in the speaker notes: it is an earthquake in rural villages in 1980, not a tornado, and it measures who was alive at extrication, not a universal survival curve.
2. **Even one building takes days to account for.**
   The candle factory company said all 102 surviving workers were accounted for, "a process that took three days given the chaos brought by the disaster"; the final toll there was eight.
   - Source line: Reuters via KSL, "Kentucky tornado death toll reaches 74 with 8 at candle factory", Dec. 14, 2021, https://www.ksl.com/article/50310733/kentucky-tornado-death-toll-reaches-74-with-8-at-candle-factory
3. **Disasters come in many places at once.**
   That night, 71 tornadoes hit eight states and caused 89 direct tornado deaths; the Mayfield tornado was an EF-4 with a 165.6-mile track.
   The whole national system has 28 FEMA US&R task forces of 70 members each.
   - Source lines: NWS Joint Regional Service Assessment, December 10-11, 2021 Tornado Outbreak, https://www.weather.gov/media/publications/assessments/NWS_Joint_Regional_Service_Assessment_Dec_10-11_2021.pdf ; FEMA Urban Search and Rescue, https://fema.gov/emergency-managers/national-preparedness/frameworks/urban-search-rescue
   - Inference: 28 times 70 is 1,960 Type 1 task force members nationwide, before any are on rest shifts.
   - Use number 3 only if the slide has room; numbers 1 and 2 are the core.

### The one honest line about robots (slides 10 and 11)

At the World Trade Center in 2001, the first known robot search and rescue deployment, robots went 5 to 20 m into the pile versus 2 m for a pole camera, but found no survivors, and the thermal camera "quickly proved not to be useful" because the pile was too hot.
- Source line: Murphy R. R., "Trial by Fire: Activities of the Rescue Robots at the World Trade Center from 11-21 September 2001", IEEE Robotics & Automation Magazine, September 2004, https://student.cs.uwaterloo.ca/~cs492/papers/trial.pdf
- Use it to say: robots are a first look into places people cannot safely enter yet, not a replacement for rescuers or dogs.

## 1. Candidate stories for slide 2

### A. Mayfield candle factory, Kentucky, December 10, 2021 (recommended)

- About 110 people were believed to be inside the plant when the tornado leveled it, and Governor Beshear said 40 had been rescued as of Saturday afternoon ([CNN via KTVZ](https://ktvz.com/news/national-world/cnn-national/2021/12/11/tornado-at-candle-factory-in-kentucky-leaves-many-searching-for-loved-ones/)).
- Kyanna Parsons-Perez was pinned against a wall, lost feeling in her legs, and was under about five feet of debris; a rescuer reached her but told her she would have to wait; she was stuck for about two hours and was one of the last out ([TODAY](https://www.today.com/today/amp/rcna8462)).
- She called 911, then livestreamed on Facebook "to stay calm, and keep everybody else calm" ([TODAY](https://www.today.com/today/amp/rcna8462)).
- She said inmates from the Graves County jail, who worked at the factory, helped dig people out; the jail confirmed it had inmates working there ([TODAY](https://www.today.com/today/amp/rcna8462)).
- The final toll at the factory was eight; the other 102 workers on duty were accounted for after three days ([Reuters via KSL](https://www.ksl.com/article/50310733/kentucky-tornado-death-toll-reaches-74-with-8-at-candle-factory)).
- Statewide on Dec. 13, at least 74 people had died in Kentucky and 109 were still missing, per Governor Beshear ([Reuters via KSL](https://www.ksl.com/article/50310733/kentucky-tornado-death-toll-reaches-74-with-8-at-candle-factory)).
- The outbreak: 71 tornadoes across eight states, 89 direct tornado deaths; the Mayfield tornado was EF-4, 190 mph, with a 165.6-mile track, the longest-tracked December tornado on record; 57 deaths occurred in the NWS Paducah warning area alone ([NWS service assessment](https://www.weather.gov/media/publications/assessments/NWS_Joint_Regional_Service_Assessment_Dec_10-11_2021.pdf)).
- Early counts were far from the final one: early reports said 70 or more appeared missing at the factory and quoted Beshear saying it would be "a miracle" if anyone else were found alive (seen only in search summaries of early wire reports, for example [EastMojo](https://eastmojo.com/world/2021/12/13/tornadoes-kill-dozens-in-5-us-states-final-toll-still-unclear/); not opened directly, not for slides).
  Inference: the gap between early and final counts shows that for days no one knew who was still inside.

### B. Plaza Towers Elementary, Moore, Oklahoma, May 20, 2013

- The EF-5 tornado caused 24 deaths, including seven schoolchildren sheltering in their designated tornado safety area at Plaza Towers Elementary ([NIST](https://www.nist.gov/node/1092741)).
- Rescue workers lifted children alive out of the school's wreckage and passed them along a human chain to a triage area in the parking lot ([Public Radio Tulsa, May 20, 2013](https://www.publicradiotulsa.org/local-regional/2013-05-20/kids-rescued-from-rubble-at-moore-okla-elementary)).
- The school had no reinforced storm shelter, per the director of Oklahoma Emergency Management ([CS Monitor search result, AP](https://csmonitor.com/USA/Latest-News-Wires/2013/0521/Search-and-rescue-efforts-under-way-in-Moore-Okla); not opened directly).
- Why not recommended: the deaths are children, which is hard to tell respectfully in 15 seconds, and early tolls were reported as high as 91 before falling to 24.
  Use no names.

### C. Champlain Towers South, Surfside, Florida, June 24, 2021 (a collapse, not a tornado)

- A passerby heard a boy calling "Can you see my hand?" and saw a hand waving through the rubble; firefighters pulled out 15-year-old Jonah Handler; his mother, Stacie Fang, died ([CBS News](https://www.cbsnews.com/news/florida-building-collapse-surfside-boy-pulled-from-rubble)).
- "No survivors have been located since the initial aftermath of the collapse in the early morning hours of June 24"; the search shifted to recovery on July 7 ([KOAA / Scripps](https://www.koaa.com/news/national/search-effort-at-collapsed-condo-site-in-florida-shifts-from-rescue-to-recovery)).
- The collapse killed 98 people; researchers write that nine people "are thought to have survived the initial collapse, and might have been rescued if rescue workers could have located them" ([Rao, Murphy, Merrick, Choset, arXiv 2301.04743](https://arxiv.org/abs/2301.04743v1)).
- Why not recommended: it is not a natural disaster at scale, and the "nine might have been rescued" claim is a hedged estimate (see "Do not use").
  It is the strongest story for "found by a person who happened to hear him", if the team prefers a collapse.

## 2. The gap: finding trapped people in time

### Survival over time

- **Primary study (strongest).** De Bruycker et al. surveyed 3,619 people in seven villages after the 1980 southern Italy earthquake ([WHO Bulletin 1983](https://www.iris.unina.it/retrieve/e268a72d-8b54-4c8f-e053-1705fe0a812c/The%201980%20earthquake%201983.pdf)):
  - Nearly all deaths (192 of 202) were among trapped people who died before they could be rescued.
  - Probability of being alive at extrication: day 0, 333 of 379 (87.9%); day 1, 20 of 57 (35.3%); days 2-3, 3 of 35 (8.5%); day 4 or later, 0 of 77.
  - 50% of trapped victims were out within 8 hours; 79.6% within two days; 93.6% of all people extricated alive were rescued in the first 24 hours.
  - 90.0% of injured, evacuated victims were dug out by people from the same village, 96.8% without heavy equipment.
  - The authors stress "the importance of providing rescue activities in the first 48 hours after the impact."
  - This is the real source behind the often-quoted "93% within 24 hours" (repeated in Noji's lecture, [Supercourse](https://sites.pitt.edu/~super1/lecture/lec32971/020.htm)); note that 93% is the share of survivors who were rescued on day 0, not a survival rate.
- **Longest survivals (review).** Macintyre, Barbera, and Smith reviewed 34 earthquakes from 1985 to 2004: 25 medical articles report multiple rescues after 48 hours, media reports describe rescues after day 2 in 18 of 34 earthquakes, the longest reliable survival was 14 days, and the average maximum across those 18 events was 6.8 days (median 5.75); the authors say the data "are not necessarily applicable to non-earthquake collapsed-structure events" ([Prehospital and Disaster Medicine 2006, doi:10.1017/S1049023X00003253](https://www.cambridge.org/core/journals/prehospital-and-disaster-medicine/article/abs/surviving-collapsed-structure-entrapment-after-earthquakes-a-timetorescue-analysis/D24F04BFBA9EDA264EA11010418B09B5)).
- **The "golden 72 hours".** No primary study found that defines it; it is a planning convention for when to mobilize search resources, described as such in news explainers ([Al Dia News](https://www.aldianews.com/en/leadership/corporate/time-beneath-rubble)), and the review above shows survivors beyond 72 hours are not rare.
  Inference: the honest framing is "the chance of being found alive falls fast with every hour", not "after 72 hours no one survives".

### How search teams find people

- US&R technical search runs in layers: hazmat checks the air, canine teams work the pile (a "hit" is at least three barks), then technical search specialists "enter with cameras and listening devices to comb the 'hot' area for positive confirmation of victim locations" ([Firehouse, Lt. Michael Daley, 2011](https://www.firehouse.com/tech-comm/atmospheric-monitoring/article/10446789/technical-search-operations-urban-search-and-rescue-teams-usar)).
- Rescuers near a possible victim leave scent that can mask the victim, so access to a canine search area is limited ([Firehouse](https://www.firehouse.com/tech-comm/atmospheric-monitoring/article/10446789/technical-search-operations-urban-search-and-rescue-teams-usar)).
- A FEMA Type 1 task force has 70 members, including canine search teams and structural engineers, and can split into two 35-member teams for 12-hour shifts ([FEMA](https://fema.gov/emergency-managers/national-preparedness/frameworks/urban-search-rescue)).
- Listening devices detect voice and tapping, and lose value as the victim weakens; detection ranges quoted in a secondary search summary (5 to 25 ft acoustic, 50 to 150 ft seismic, from [Fire Engineering](https://www.fireengineering.com/technical-rescue/building-collapse-rescue-operations-technical-search-capabilities/)) were not opened directly, so do not put them on a slide.
- In the 1980 Italy study, most survivors were rescued by neighbors with hands and shovels on day one, before professional teams arrived ([WHO Bulletin 1983](https://www.iris.unina.it/retrieve/e268a72d-8b54-4c8f-e053-1705fe0a812c/The%201980%20earthquake%201983.pdf)).

### Responders versus scale

- 28 FEMA US&R task forces exist nationally ([FEMA](https://fema.gov/emergency-managers/national-preparedness/frameworks/urban-search-rescue)); for 9/11, FEMA activated 25 of them (search summary of FEMA material; not opened directly).
- One night in December 2021: 71 tornadoes, eight states, 89 deaths ([NWS](https://www.weather.gov/media/publications/assessments/NWS_Joint_Regional_Service_Assessment_Dec_10-11_2021.pdf)).
- Inference: 28 task forces cannot be in every damaged neighborhood on the first night, which is exactly when the 1980 study says rescue matters most.

### People missed or found late

- Mayfield: three days to account for 110 workers in one building ([Reuters via KSL](https://www.ksl.com/article/50310733/kentucky-tornado-death-toll-reaches-74-with-8-at-candle-factory)); 109 people still missing statewide on Dec. 13 (same source).
- Surfside: the only survivor recovered from the pile was found in the first hours; none after ([KOAA](https://www.koaa.com/news/national/search-effort-at-collapsed-condo-site-in-florida-shifts-from-rescue-to-recovery)).
- Surfside counterfactual: nine thought to have survived the initial collapse "might have been rescued if rescue workers could have located them" ([arXiv 2301.04743](https://arxiv.org/abs/2301.04743v1)); hedged, see "Do not use".

## 3. Robots in search and rescue: real deployments and their limits

### World Trade Center, 2001

All from [Murphy, IEEE RAM, Sept. 2004](https://student.cs.uwaterloo.ca/~cs492/papers/trial.pdf):
- CRASAR responded within six hours; this was the first known use of robots for urban search and rescue; robots were on site from 11 September to 2 October.
- Uses: searching for victims, finding faster paths to excavate, structural inspection, and hazardous gas detection.
- Robots went 5 to 20 m into the pile versus 2 m for a pole camera, and into voids too small for a person or a dog.
- "Though no survivors were discovered during the response, robots performed all their tasks well"; they found multiple sets of remains, but "technical search is measured by the number of survivors found".
- All robots were teleoperated, and most depended on tethers; a second person had to manage the tether, pulling about once a minute to stop tangling; one robot was lost when its safety rope broke.
- Thermal: the FLIR cameras "quickly proved not to be useful. The rubble pile interior was extremely hot, so any signs of survivors or structural cracks would have been masked."
- Video lacked depth perception and peripheral vision; robots rolled onto or got trapped against unseen obstacles.
- Robots "will be used much like dogs": carried to a void, inserted, then moved to the next void; swarms of autonomous robots "appear to be both physically impractical and at odds with the larger rescue organization."
- Recommendations: a color camera and two-way audio on every robot, recorded video for the task force, and image enhancement or "cueing of interesting regions for human detection" rather than unassisted machine detection.
- "Rescue workers do not trust full autonomy."

### Surfside, 2021

- Most robots at Surfside were drones; the ground robots were bomb squad robots "about the height of a motorcycle but twice as wide", useful only in standing but unsafe parts of the building; small throwable robots were shipped but apparently not used ([Texas A&M, July 21, 2021](https://stories.tamu.edu/news/2021/07/21/texas-am-rescue-robotics-expert-shares-observations-from-surfside/)).
- Responders "go with what you know and trust", and interfaces must not overload responders with information ([Texas A&M](https://stories.tamu.edu/news/2021/07/21/texas-am-rescue-robotics-expert-shares-observations-from-surfside/)).
- Interior voids in the pile were few and small ([arXiv 2301.04743](https://arxiv.org/abs/2301.04743v1)).

### Turkey and Syria earthquakes, 2023

- A Deutsche Welle piece (Feb. 2023), seen only in syndicated copies, reported that research rescue robots are prototypes, none could help locate buried victims in the quake zone, and rescue dogs did that work ([ABS-CBN syndication](https://www.abs-cbn.com/spotlight/02/09/23/will-robots-replace-dogs-in-earthquake-rescue-operations), [ProPakistani syndication](https://propakistani.pk/2023/02/09/robots-can-replace-dogs-in-earthquake-rescue-operations/); both blocked automated fetching, so the wording is from search summaries).
- Drones supported mapping and coordination; those claims come mostly from manufacturers' press releases ([Baykar](https://www.baykartech.com/en/press/bayraktar-uavs-provide-uninterrupted-support-for-earthquake-relief-in-turkiye)).

### How we position our robot (Inference, built on the sources above)

- A first look inside a damaged building that rescuers cannot safely enter yet, the role Murphy describes, not a replacement for dogs or rescuers.
- It cues a person for a human to confirm (a warm blob plus a breathing check with a confidence), which matches Murphy's "cueing" recommendation rather than full autonomy.
- It cannot see through rubble: thermal does not pass through solid cover, and in hot rubble it can be masked ([Murphy 2004](https://student.cs.uwaterloo.ca/~cs492/papers/trial.pdf); `docs/research/perception.md` section 6, including [NFCC Pub 6/92](https://nfcc.org.uk/wp-content/uploads/2023/10/Publication-6_92-Detection-Devices-for-Hidden-or-Buried-Casualties.pdf) and [Zhang et al. 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877370)).
- Our real contribution is the coordination layer: every find becomes a row nobody can forget, which addresses the "three days to account for everyone" problem, not the digging.
- Breathing from thermal at robot distance is not feasible; we use the regular camera and need light (`docs/research/perception.md` section 2).

## 4. Sponsor material

### State Farm ("The Worst Day, at Scale")

- State Farm's catastrophe releases describe catastrophe claim teams, catastrophe adjusters on site in several states, virtual inspections, and "Catastrophe Customer Care sites" in the hardest-hit areas (May 30, 2025, [State Farm newsroom](https://newsroom.statefarm.com/state-farm-mobilizing-catastrophe-response-to-severe-weather-tornadoes-in-mo-and-ky/)).
- After April 26-28, 2024 storms in nine states, State Farm reported about 5,500 home and auto claims and said teams would contact customers and begin claim handling, prioritizing the most severe losses ([State Farm newsroom, April 2024](https://newsroom.statefarm.com/state-farm-response-april-2024/)).
- Inference for the pitch: State Farm already triages by severity after a disaster; we triage people, not property, in the first hours, before any claim exists.
  Do not pitch insurance features; the challenge is about people (`docs/notes/2026-11-07-state-farm-track.md`).

### NVIDIA Nemotron

- NVIDIA describes Nemotron 3 Nano as providing "cost efficiency with high accuracy for specialized sub-agents" and Super as delivering "leading accuracy for reasoning, tool calling, and multimodal agentic tasks" ([NVIDIA Developer](https://developer.nvidia.com/topics/ai/nemotron)).
- The Nemotron 3 technical report says the models are post-trained with multi-environment reinforcement learning for reasoning and multi-step tool use ([arXiv 2512.20856](https://arxiv.org/abs/2512.20856v1), seen via search summary).
- This matches our split: Super for the orchestrator, Nano for the auditor and comms agent (`docs/MVP.md`).
- Tool calling on our hosted key is still unconfirmed until Eric's smoke test; do not claim it on a slide until it runs.

### SpacetimeDB

- Each reducer runs as one atomic transaction and rolls back on error; clients do not get return values but observe committed rows through subscriptions ([SpacetimeDB docs, transactions](https://spacetimedb.com/docs/databases/transactions-atomicity)).
- Schedule tables trigger a reducer at a set time, for reminders, expirations, and periodic maintenance ([SpacetimeDB docs, scheduled tables](https://spacetimedb.com/docs/tables/scheduled-tables)); scheduled reducers can also be called by clients, so they need an auth check (same source).
- `client_disconnected` "runs when a client connection terminates", including close, timeout, or error ([SpacetimeDB docs, lifecycle reducers](https://spacetimedb.com/docs/functions/reducers/lifecycle)); this is what releases a silent rescuer's assignment at once.
- The track requires SpacetimeDB to power the primary functionality and public source on GitHub (`docs/notes/2026-11-07-spacetime-track.md`).

## Do not use

- "Survival drops to near zero after 72 hours" or any "golden 72 hours" survival percentage: no primary source; survivors after 72 hours are documented in many earthquakes ([Macintyre et al. 2006](https://www.cambridge.org/core/journals/prehospital-and-disaster-medicine/article/abs/surviving-collapsed-structure-entrapment-after-earthquakes-a-timetorescue-analysis/D24F04BFBA9EDA264EA11010418B09B5)).
- "93% of trapped people survive if rescued in 24 hours": a misreading; 93.6% is the share of the people rescued alive who came out on day 0 ([De Bruycker 1983](https://www.iris.unina.it/retrieve/e268a72d-8b54-4c8f-e053-1705fe0a812c/The%201980%20earthquake%201983.pdf)).
- "Less than 50% of buried people are alive after 2 to 6 hours": appears in the Noji lecture for earthen buildings in Turkey and China, primary source not checked, and it does not apply to US frame houses.
- "More than 90% of earthquake survivors are rescued within three days": a single expert quote in a news story ([Daily Sabah](https://www.dailysabah.com/turkey/chances-of-survival-may-be-up-to-a-week-after-earthquakes-experts/news/amp)), not a study.
- "Nine Surfside victims could have been saved by robots": the paper says they "are thought to have survived" and "might have been rescued", and the robot benefit is "perhaps" ([arXiv 2301.04743](https://arxiv.org/abs/2301.04743v1)).
- Early tolls: Moore "91 dead" and Mayfield "70 or more missing" were early figures later revised to 24 and 8.
- Listening device ranges (5 to 25 ft, 50 to 150 ft): secondary summary only.
- Drone performance claims from Turkish defense manufacturers: press releases.
- Any claim that our robot "sees through rubble", "detects breathing with thermal", "replaces search dogs", or "confirms death"; all false for our build (`docs/research/perception.md`).
- Any Nemotron benchmark number (for example PinchBench 85.6%): a secondary report of a vendor claim.
- The Mayfield inmates' role beyond what Parsons-Perez said: an early report said her account of it could not be immediately verified (search summary of [Fox News](https://www.foxnews.com/us/kentucky-tornado-candle-factory-worker-live-stream-collapse-trapped-mayfield)), although the jail said it had inmates working at the factory.
