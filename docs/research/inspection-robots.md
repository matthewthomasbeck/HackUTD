# Inspection robots and drones in oil and gas

Research for the HackUTD robot as the "field inspector" for the EOG challenge, gathered 2026-11-07.
Every fact has a link.
Lines marked **Inference** are our reasoning, not a sourced fact.
Most results below come from vendors (Boston Dynamics, ANYbotics, ExRobotics, Energy Robotics, Percepto), so treat their numbers as self-reported.

## Key takeaways for the pitch and demo

- The industry already uses robots exactly the way the team wants to: Shell put an ExR-2.5 robot on an unmanned offshore platform so that, after a shutdown or anomaly, it inspects first and engineers then decide whether a crew must travel ([Offshore Magazine, 2026](https://www.offshore-mag.com/equipment-engineering/article/55362594/inspection-robots-complete-six-months-of-offshore-missions)).
- EOG itself already runs "detect, then alert a control center": its 2025 fact sheet says iSense methane sensors continuously monitor facilities and send real-time alerts of potential leaks to a control center ([EOG fact sheet, March 2025](https://eogresources.com/documents/EOG_Fact_Sheet_2025.pdf)).
  The robot pitch is the next step: an alert triggers a robot check before a truck rolls.
- I found no public evidence that EOG uses ground robots or drones for facility inspection.
  The only EOG drone mention found is monitoring endangered plants on a New Mexico conservation lease ([EOG fact sheet, March 2025](https://eogresources.com/documents/EOG_Fact_Sheet_2025.pdf)).
- Real inspection robots carry four kinds of sensing: visual and PTZ cameras (gauge reading), radiometric thermal (hot spots), acoustic and ultrasonic (leaks, abnormal noise), and gas sensors ([ANYbotics](https://www.anybotics.com/anymal-x-the-worlds-first-ex-proof-legged-robot/), [Woodside case study](https://bostondynamics.com/case-studies/woodside/)).
  This team's robot can honestly approximate visual and thermal checks at short range, and cannot do gas or ultrasonic sensing.
- The best demo check for this hardware is a pump hot spot, judged by temperature difference against a reference, at under about 1 m.
  **Inference**, based on the low pixel count and the ±3°C lifetime drift of the MLX90640 class sensor ([Melexis datasheet](https://media.melexis.com/-/media/files/documents/datasheets/MLX90640-datasheet-melexis.pdf)).
- A thermal camera can see a water spill only while the liquid differs from the ground in temperature, for example through evaporative cooling, and it misses spills that have reached equilibrium ([Yeghiyan et al., 2025](https://arxiv.org/abs/2510.08770)).
  Stage the demo leak with water that is clearly warmer or colder than the floor.
- EOG's stated key need is to tell a real problem from a faulty sensor so people are not sent out for nothing (team notes, `docs/notes/2026-11-07-eog-track.md`).
  The robot answers that need directly: it is a second, independent measurement.
- Use the challenge's own `ops.json` costs to price a truck roll in the demo.
  Public truck-roll cost figures are from telecom and field service, not oilfields, and one vendor says no verified benchmark exists ([DPS Telecom](https://www.dpstele.com/blog/how-to-choose-monitoring-solution-reduce-truck-rolls.php), [SunWize](https://www.sunwize.com/application-item/how-much-does-a-site-visit-really-cost/)).
- A production version near wellheads and tanks would need hazardous-location certification (Class I Division 1 or 2 in the US, or ATEX/IECEx zones), which is why commercial robots use nitrogen-purged bodies or fully enclosed electronics ([ANYmal X spec sheet](https://www.anybotics.com/anymal-x-technical-specifications.pdf), [Robotics and Automation News](https://roboticsandautomationnews.com/2023/04/08/exrobotics-develops-new-and-improved-version-of-its-inspection-robot/66544)).

## 1. Real inspection robots and drones

### Boston Dynamics Spot

BP deployed Spot on its Mad Dog platform in the Gulf of Mexico in 2020 ([Offshore Magazine](https://www.offshore-mag.com/equipment-engineering/article/14187549/spot-deployed-on-bps-mad-dog-platform)).
BP's case study lists tasks such as scanning for abnormalities, tracking corrosion, and checking gauges, and says Spot could identify and quantify leaks with gas-sensing and audio payloads ([Boston Dynamics, BP case study](https://bostondynamics.com/case-studies/bp/)).
That case study also mentions a methane sensor that shuts Spot down where gas levels are high-risk ([Boston Dynamics, BP case study](https://bostondynamics.com/case-studies/bp/)).
It reports no measured time or cost savings, and says Spot was at first less reliable on grated stairs until software updates ([Boston Dynamics, BP case study](https://bostondynamics.com/case-studies/bp/)).

Woodside listed six applications for Spot: gauge reading, leak detection, noise anomaly detection, thermal inspection, gas detection, and remote inspection ([Woodside case study](https://bostondynamics.com/case-studies/woodside/)).
Woodside operators walk the same plant route every 12 hours ([Woodside case study](https://bostondynamics.com/case-studies/woodside/)).
The case study gives no measured savings ([Woodside case study](https://bostondynamics.com/case-studies/woodside/)).

At a 40-acre midstream gas plant, Spot carried a FLIR MUVE C360 gas sensor, detected a combustible gas plume from a pinhole leak during routine compressor rounds, and shut itself down at its LEL threshold, which was the first sign of the leak ([Boston Dynamics blog](https://bostondynamics.com/blog/autonomous-detection-of-combustible-gas-leaks/)).

Spot CAM+IR payload specs: 640 x 512 radiometric thermal camera, accuracy ±5°C, 69 x 56° field of view, -40°C to +160°C in high gain, plus a PTZ camera with 30x optical zoom ([Spot CAM+IR spec sheet](https://www.bostondynamics.com/wp-content/uploads/2023/05/spot-cam-plus-ir.pdf)).
Boston Dynamics says Spot's gauge-reading models can alert when a gauge is out of the desired range ([Boston Dynamics, visual inspection](https://bostondynamics.com/solutions/inspection/visual/)).

### ANYbotics ANYmal and ANYmal X

ANYbotics announced ANYmal X in March 2022 as an Ex-proof legged robot approved under IECEx and ATEX for Zone 1 ([ANYbotics, 2022](https://www.anybotics.com/anymal-x-the-worlds-first-ex-proof-legged-robot/)).
It lists gas sensors for methane, carbon monoxide, and hydrogen sulfide, thermography, vibration analysis, readout of gauges, liquid levels, and lever positions, and 3D scanning ([ANYbotics, 2022](https://www.anybotics.com/anymal-x-the-worlds-first-ex-proof-legged-robot/)).
Its spec sheet describes a pressurized main body filled with inert nitrogen and IP67 protection ([ANYmal X spec sheet](https://www.anybotics.com/anymal-x-technical-specifications.pdf)).
On October 27, 2026, ANYbotics said it had begun shipping ANYmal X to customers including Equinor and DSM-Firmenich ([Marine Technology News](https://www.marinetechnologynews.com/news/anybotics-unleashes-legged-robot-666992)).
The same report says BP, Equinor, Shell, PETRONAS, Petrobras, BASF, and SLB tested it in an early access program since 2023, and that it is certified for Gas Group IIB, so it cannot enter Zone 0, dust atmospheres, or hydrogen and acetylene atmospheres ([Marine Technology News](https://www.marinetechnologynews.com/news/anybotics-unleashes-legged-robot-666992)).
I found no published hours-saved figure from an oil and gas customer.

### ExRobotics ExR-2 and ExR-2.5

ExR-2 was developed with Shell Pernis and Dow Terneuzen, and its electronics are fully enclosed so it is certified for IECEx and ATEX Zone 1 ([Robotics and Automation News, 2023](https://roboticsandautomationnews.com/2023/04/08/exrobotics-develops-new-and-improved-version-of-its-inspection-robot/66544)).
In 2024 Shell deployed an ExR-2.5 on a normally unmanned platform 175 km offshore and 16 km from the nearest manned facility ([Offshore Magazine, 2026](https://www.offshore-mag.com/equipment-engineering/article/55362594/inspection-robots-complete-six-months-of-offshore-missions)).
It ran twice-daily rounds over 20 points of interest, collecting pressure and temperature readings, vibration indicators, gas and liquid seepage detection, and visual and thermal images ([Offshore Magazine, 2026](https://www.offshore-mag.com/equipment-engineering/article/55362594/inspection-robots-complete-six-months-of-offshore-missions)).
Reported six-month results: 80% of missions completed without intervention, 1,997 inspection points recorded, 9.33 km traveled, and no physical servicing offshore ([Offshore Magazine, 2026](https://www.offshore-mag.com/equipment-engineering/article/55362594/inspection-robots-complete-six-months-of-offshore-missions)).
That article is written by the ExRobotics CEO.
In June 2026 ExRobotics launched the ExR-2.5 in North America as a UL-certified robot for hazardous environments ([World Pipelines](https://www.worldpipelines.com/equipment-and-safety/25062026/exrobotics-launches-the-first-ul-certified-robot-for-hazardous-industrial-environments-in-north-america/)).

### Taurob

Taurob, with TU Darmstadt, won TotalEnergies' ARGOS Challenge, which ran 2014 to 2017 ([Wikipedia, Taurob Inspector](https://en.wikipedia.org/wiki/Taurob_Inspector)).
In August 2020 the Taurob Inspector made what is reported as the first offshore deployment of an ATEX-certified robot, a week-long mission on a TotalEnergies platform in the K5 field off the Netherlands ([Wikipedia, Taurob Inspector](https://en.wikipedia.org/wiki/Taurob_Inspector)).
Taurob says TotalEnergies operated its ATEX Zone 1 robots at the Shetland Gas Plant for 12 months ([Taurob](https://www.taurob.com/company/)).

### Energy Robotics

Energy Robotics is software that runs missions on robots and drones from several makers, including ExR-2 and Spot ([Energy Robotics, ExR-2](https://www.energy-robotics.com/robot-fleet/exr-2)).
At Shell Rheinland, its automated drone inspected the roofs of storage tanks about 25 m high for seal condition and rainwater, and inspection time dropped from "several hours" to "20 minutes" ([case study](https://www.casestudies.com/company/energy-robotics/case-study/drone-tank-inspections-at-shell-rheinland)).
This is the closest public example of EOG's "survey a tank" idea.

### Gecko Robotics

Gecko's TOKA robots use magnetic wheels to climb carbon steel equipment such as boilers and storage tanks and take ultrasonic thickness readings ([Gecko Robotics](https://www.geckorobotics.com/company/robots)).
Gecko claims about 1,000 times more data at about 10 times the speed of earlier methods, which is the vendor's own figure ([Gecko Robotics](https://www.geckorobotics.com/company/robots)).
This is contact ultrasonic inspection for wall loss, which is outside what the team's robot can do.

### Drones: methane and pipeline right-of-way

Bridger Photonics flies Gas Mapping LiDAR on aircraft and states 3 kg/h sensitivity at over 90% probability of detection ([Bridger Photonics](https://info.bridgerphotonics.com/why-bridger-photonics)).
A single-blind study measured a wind-normalized detection limit of 0.25 and 0.41 (kg/h)/(m/s) at 500 and 675 ft ([eScholarship](https://escholarship.org/uc/item/5bw1m4g2)).
Percepto says its drone-in-a-box with an OGI camera detects methane at 100 g/h with 90% confidence, tested at METEC and a Permian site ([Percepto](https://percepto.co/remote-ogi-inspections-field-validated-performance-pending-epa-approval/)), and trade press reported EPA approval as an alternative test method in October 2025 ([DroneLife](https://dronelife.com/2025/10/29/autonomous-methane-detection-drones-earn-epa-approval-for-oil-and-gas-compliance/)).
Phoenix Air Unmanned flew 320 miles of Shell pipeline patrol in one day under an FAA beyond-visual-line-of-sight waiver ([Inside Unmanned Systems](https://insideunmannedsystems.com/phoenix-air-unmanned-achieves-single-day-pipeline-patrol-milestone/)).
A drone operator in North Dakota says its leak reporting time fell from four weeks to four days ([PR Newswire](https://prnewswire.com/news-releases/aerial-production-services-aps-teams-with-iris-automation-to-jumpstart-faa-permissions-for-pipeline-inspections-with-drones-301249213.html)).

## 2. EOG Resources and automation

EOG's 2025 fact sheet lists "Superior In-House Technical Expertise, Proprietary Information Technology" and "Real-Time, Data-Driven Decision Making" ([EOG fact sheet, March 2025](https://eogresources.com/documents/EOG_Fact_Sheet_2025.pdf)).
The same fact sheet describes iSense methane sensors for continuous leak detection with real-time alerts to a control center ([EOG fact sheet, March 2025](https://eogresources.com/documents/EOG_Fact_Sheet_2025.pdf)).
It says over 99% of water used in the Delaware Basin in 2024 came from reuse or nonfresh sources ([EOG fact sheet, March 2025](https://eogresources.com/documents/EOG_Fact_Sheet_2025.pdf)), which matches the produced-water network in the challenge.
It also says EOG uses drone technology to monitor two endangered plant species on a New Mexico conservation lease ([EOG fact sheet, March 2025](https://eogresources.com/documents/EOG_Fact_Sheet_2025.pdf)).
EOG's Q4 2024 results mention artificial lift automation ([EOG Q4 2024 results](https://www.quantisnow.com/insight/eog-resources-reports-fourth-quarter-and-full-year-2024-results-announces-5914665)).
EOG posts automation technician jobs covering sensors, PLCs, RTUs, and HMIs ([job listing](https://www.justjobs.com/career/16279144/Automation-Technician-Ii-Wyoming-Cheyenne)).
In March 2025 TETRA Technologies announced a produced water reuse pilot with EOG ([The Water Network](https://industrial-water-treatment.thewaternetwork.com/news-post-TFp/Pd-oKNpOWBp7EvrqsXeNMg)).
I found no public EOG ground robot or facility-inspection drone program.

## 3. Sensors used in real inspections, and what this robot can approximate

The team's thermal camera model is not confirmed (`docs/ROBOT.md`).
The two common I2C modules below are examples only.

### Example thermal modules

| Spec | MLX90640 (Melexis) | AMG8833 (Panasonic Grid-EYE) |
| --- | --- | --- |
| Pixels | 32 x 24 (768) | 8 x 8 (64) |
| Field of view | 55° x 35° or 110° x 75° | 60° |
| Target range | -40°C to 300°C | 0°C to 80°C |
| Accuracy | Example in datasheet: ±1.5°C for an 80°C target (BAA type, zone 1), plus up to ±3°C lifetime drift | ±2.5°C |
| Noise | NETD 0.1 K RMS at 1 Hz | not found |
| Frame rate | 0.5 to 64 Hz | 1 to 10 fps |
| Human detection range | n/a | 7 m or less (reference value) |

Sources: [Melexis MLX90640 datasheet](https://media.melexis.com/-/media/files/documents/datasheets/MLX90640-datasheet-melexis.pdf), [Panasonic AMG8833](https://na.industrial.panasonic.com/products/sensors/sensors-automotive-industrial-applications/lineup/grid-eye-infrared-array-sensor/series/70496/model/72453), [SparkFun AMG8833](https://www.sparkfun.com/products/14607), [Farnell AMG8833](https://pt.farnell.com/panasonic-electronic-components/amg8833/temperature-sensor-ir-2-5deg-c/dp/2576419).

The Melexis datasheet says accuracy specs apply only under settled isothermal conditions and only if the object fills the sensor's whole field of view ([Melexis datasheet](https://media.melexis.com/-/media/files/documents/datasheets/MLX90640-datasheet-melexis.pdf)).

**Inference (geometry):** one MLX90640 pixel in the 55° version covers about 55/32 = 1.7°, so about 1.5 cm at 0.5 m, 3 cm at 1 m, and 9 cm at 3 m.
The 110° version doubles those sizes.
One AMG8833 pixel covers about 60/8 = 7.5°, so about 13 cm at 1 m and 39 cm at 3 m.
A small pump bearing or a puddle needs to cover several pixels to read reliably, so plan for the robot to stop within about 0.5 to 1 m of the target.

**Inference (method):** with ±1.5°C to ±3°C absolute error, judge "hot" by the temperature difference between the suspect part and a reference (the same part on a healthy pump, or the ambient frame), not by an absolute number.

For comparison, the Spot CAM+IR thermal camera has 640 x 512 pixels ([Spot CAM+IR spec sheet](https://www.bostondynamics.com/wp-content/uploads/2023/05/spot-cam-plus-ir.pdf)), which is about 427 times the pixels of the MLX90640 (**Inference**, 327,680 / 768).

### Sensor by sensor

| Inspection need | What real robots use | Can this robot approximate it in a demo? |
| --- | --- | --- |
| Liquid leak or spill | Visual cameras and "liquid seepage detection" ([Offshore Magazine](https://www.offshore-mag.com/equipment-engineering/article/55362594/inspection-robots-complete-six-months-of-offshore-missions)); Woodside lists water and steam leak detection ([Woodside](https://bostondynamics.com/case-studies/woodside/)) | Partly. Thermal works only while the spill differs in temperature from the floor (section 4). The NoIR camera gives a photo for a human to confirm, including at night with its IR illuminators. |
| Gas leak | Optical gas imaging cameras in the 3.2 to 3.4 µm band with cooled mid-wave detectors ([EPA-hosted vendor presentation](https://www.epa.gov/sites/production/files/2019-12/documents/opticalgasimaging_jeffleake.pdf)); point gas sensors such as FLIR MUVE C360 ([Boston Dynamics blog](https://bostondynamics.com/blog/autonomous-detection-of-combustible-gas-leaks/)) | No. Neither the NoIR camera nor an MLX90640 class sensor can image methane (**Inference**: the NoIR sees near-IR around 800 nm ([TechRadar](https://www.techradar.com/news/computing-components/peripherals/infra-red-camera-board-bakes-night-vision-into-raspberry-pi-1194871)), far from 3.2 µm). Say so in the pitch. |
| Hot or failing pump or motor | Radiometric thermal cameras ([ANYbotics](https://www.anybotics.com/anymal-x-the-worlds-first-ex-proof-legged-robot/), [Spot CAM+IR](https://www.bostondynamics.com/wp-content/uploads/2023/05/spot-cam-plus-ir.pdf)); practitioners compare temperature rise against a similar component and confirm with vibration ([irinfo.org paper](https://irinfo.org/images/articles/pdf/12-01-2017-umdenstorck-keithline.pdf)) | Yes, at short range. This is the strongest check for this hardware. Compare suspect pump to a reference. |
| Vibration and acoustic anomalies | Vibration analysis on ANYmal ([ANYbotics](https://www.anybotics.com/anymal-x-the-worlds-first-ex-proof-legged-robot/)); acoustic imaging cameras such as FLIR Si124, 124 microphones, 2 to 65 kHz ([FLIR Si124 reseller listing](https://datatec.eu/de/en/flir-si124)) | Weakly. **Inference:** the IMU could sense vibration only if the robot touches the pump skid, and the robot has no microphone. A USB microphone would be a cheap add, but this is not tested. |
| Gauge reading | PTZ camera plus gauge-reading models with out-of-range alerts ([Boston Dynamics](https://bostondynamics.com/solutions/inspection/visual/)) | Yes. The NoIR camera can photograph a printed gauge, and a vision model or the agent can read it. Fiducial tags help aim the camera. |

Practitioner thresholds for "how hot is too hot" vary between sources: one paper recommends deeper investigation of motors above a ΔT of 25°C ([irinfo.org paper](https://irinfo.org/images/articles/pdf/12-01-2017-umdenstorck-keithline.pdf)).
I could not confirm the NETA table values directly, so do not quote a specific threshold as an industry standard.

## 4. Can a thermal camera see a water spill?

Yes, but only under some conditions.

Where it works:

- Liquids at a different temperature than the floor show up, and evaporation and heat transfer make the edges of a spill stand out ([Yeghiyan et al., 2025](https://arxiv.org/abs/2510.08770)).
- A patent on automatic spill detection describes a spill near surface temperature becoming more visible over several minutes as evaporation cools it, with the edges cooling first ([US patent 9987752](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9987752)).
- On watered pavement, infrared measurements showed surface temperature drops of up to 4°C in shade and up to 13°C in sun ([Hendel et al., 2014](https://arxiv.org/abs/1412.2165)).
- A lab study for buried water pipes found ground-surface temperature change from evaporation detectable, and a low-resolution camera did about as well as a high-resolution one ([Shakmak and Al-Habaibeh, 2015](https://irep.ntu.ac.uk/id/eprint/26749/)).
  That rig simulated dry desert sand, so it may not transfer to humid sites.
- A 2025 robot study used a Topdon TC001 thermal camera at 256 x 192 and reported up to 100% accuracy on its test set with VGG19 and NASNetMobile, at as low as 44 ms per image on an RTX 4080 ([Yeghiyan et al., 2025](https://arxiv.org/abs/2510.08770)).
  That camera has 64 times the pixels of the MLX90640 (**Inference**, 49,152 / 768), and the test was indoors on tile and concrete.

Where it fails:

- A spill at the same temperature and emissivity as the floor disappears, and thin films reach equilibrium faster than pools ([Yeghiyan et al., 2025](https://arxiv.org/abs/2510.08770)).
- Heaters, sunlight patches, and warm machinery cause false positives, and reflective surfaces can mimic spills ([Yeghiyan et al., 2025](https://arxiv.org/abs/2510.08770)).
- A 2025 drone study on buried leaks reported a 60% detection rate once shadows and solar energy were modeled ([MDPI Remote Sensing, 2025](https://www.mdpi.com/2072-4292/17/14/2399)).

The NoIR camera cannot reliably detect water by spectrum.
Water absorbs weakly near 900 nm and strongly at 1400 to 1500 nm ([J. Sens. Sens. Syst., 2020](https://jsss.copernicus.org/articles/9/133/2020/)), and road-wetness sensors use InGaAs detectors that cover 0.9 to 1.7 µm ([J. Sens. Sens. Syst., 2022](https://jsss.copernicus.org/articles/11/187/2022/)).
**Inference:** a silicon camera like the NoIR sees mostly below the strong water band, so treat its picture as evidence for a human, not a water sensor.

**Demo inference:** use a tray of water clearly warmer or colder than the floor (for example 10°C or more different), placed indoors away from heaters and windows, and have the robot stop within about 0.5 m.
Be ready to say that real produced-water leaks outdoors in Texas sun are harder.

## 5. Verification workflow

Shell's ExR-2.5 case shows the pattern: after a shutdown or anomaly, the robot inspects at once, engineers review the data remotely, and they decide whether to send people ([Offshore Magazine, 2026](https://www.offshore-mag.com/equipment-engineering/article/55362594/inspection-robots-complete-six-months-of-offshore-missions)).
Onshore supervisors reviewed alerts from more than 1,000 km away ([Offshore Magazine, 2026](https://www.offshore-mag.com/equipment-engineering/article/55362594/inspection-robots-complete-six-months-of-offshore-missions)).
ExRobotics describes a three-step flow: the robot collects data, algorithms turn it into a mission report, and discrepancies go to the control room, with leak locations sent to an operator ([Energies Media, 2023](https://energiesmedia.com/operator-rounds-by-exception)).
The same article describes a future where a digital twin sends the robot out for more data when it sees an anomaly it cannot confirm ([Energies Media, 2023](https://energiesmedia.com/operator-rounds-by-exception)).
In security, a patent describes a robot that drives to an alarm location and records video to verify the alarm before police dispatch ([US patent 10726712](https://patents.justia.com/patent/10726712)).

Why it matters for operators: alarm-management guidance puts about 6 alarms per operator per hour as very likely acceptable and about 12 as the maximum manageable ([Emerson, Alarm management by numbers](https://d1-live.emerson.com/documents/automation/article-alarm-management-by-numbers-deltav-en-38292.pdf)).
ISA-18.2 defines an alarm flood as more than 10 alarms in 10 minutes for one operator ([Yokogawa](https://www.yokogawa.com/tw/library/resources/media-publications/implementing-alarm-management-per-the-ansi-isa-182-standard-control-engineering)).
**Inference:** the EOG "hard case" (two or three pumps failing within an hour) is the moment where an automatic first check saves operator attention.

False-alarm truck rolls:

- A telecom monitoring vendor cites truck-roll costs from $150 to over $1,000, including TSIA at $1,000+ fully loaded and Aberdeen at $200 to $300 direct cost ([DPS Telecom](https://www.dpstele.com/blog/how-to-choose-monitoring-solution-reduce-truck-rolls.php)).
- The same vendor says 17% to 25% of truck rolls end as "No Fault Found", without naming a study ([DPS Telecom](https://www.dpstele.com/blog/how-to-choose-monitoring-solution-reduce-truck-rolls.php)).
- A remote-site vendor says remote oil and gas sites hours from a service center cost more per visit, but gives no number ([SunWize](https://www.sunwize.com/application-item/how-much-does-a-site-visit-really-cost/)).
- I found no oilfield-specific published rate of false-alarm dispatches.
  Use the truck and shut-in costs in the challenge's `ops.json` instead.

Produced water context: an Inside Climate News analysis of Railroad Commission records found more than 148 million gallons of produced water spilled in Texas from 2013 to 2022 ([Inside Climate News](https://insideclimatenews.org/news/18122023/state-of-denial-oil-gas-wastewater-spills-texas/)).

## 6. Hazards and what a production version would need

US definitions (OSHA 29 CFR 1910.399):

- Class I, Division 1: ignitable concentrations of flammable gases or vapors may exist under normal operating conditions, or frequently because of repair or maintenance ([OSHA 1910.399](https://www.law.cornell.edu/cfr/text/29/1910.399)).
- Class I, Division 2: flammable gases or liquids are normally confined in closed systems, or the area is adjacent to a Division 1 location and gas might occasionally reach it ([OSHA 1910.399](https://www.law.cornell.edu/cfr/text/29/1910.399)).

API RP 500 is the US recommended practice for classifying Class I Division 1 and 2 locations at petroleum facilities ([GlobalSpec, API RP 500](https://standards.globalspec.com/std/1565474/api-rp-500)).
The Zone-system equivalent is API RP 505 (**Inference** from secondary summaries; confirm before quoting).
I did not find a free source that gives the exact classified distances around wellheads or tank vents, so do not quote them.

ATEX (EU): Zone 0 has an explosive atmosphere continuously or for long periods, Zone 1 is likely in normal operation, and Zone 2 is unlikely and brief; equipment Category 1, 2, and 3 maps to Zones 0, 1, and 2 ([ABB](https://new.abb.com/drives/segments/motors-and-drives-in-potentially-explosive-atmospheres/groups-zones-categories-and-devices)).

How commercial robots meet this:

- ANYmal X: nitrogen-purged pressurized body, ATEX and IECEx Zone 1, Gas Group IIB, not for Zone 0 or hydrogen ([ANYmal X spec sheet](https://www.anybotics.com/anymal-x-technical-specifications.pdf), [Marine Technology News](https://www.marinetechnologynews.com/news/anybotics-unleashes-legged-robot-666992)).
- ExR-2: electronics fully built inside for IECEx and ATEX Zone 1, with an ATEX-certified LiDAR ([Robotics and Automation News](https://roboticsandautomationnews.com/2023/04/08/exrobotics-develops-new-and-improved-version-of-its-inspection-robot/66544)); ExR-2.5 is UL certified for North America ([World Pipelines](https://www.worldpipelines.com/equipment-and-safety/25062026/exrobotics-launches-the-first-ul-certified-robot-for-hazardous-industrial-environments-in-north-america/)).
- Non-Ex robots such as Spot use a gas sensor that shuts the robot down when gas is detected ([Boston Dynamics, BP case study](https://bostondynamics.com/case-studies/bp/), [Boston Dynamics blog](https://bostondynamics.com/blog/autonomous-detection-of-combustible-gas-leaks/)).

**Pitch inference:** say the prototype is a non-certified proof of concept, and a production version would need a certified enclosure or purge, a certified charging dock, a gas sensor that stops the robot, and to stay out of Division 1 areas until certified.

## Suggested demo check

**Inference**, built from sections 3 to 5.

1. The software flags `pump_degradation` on one facility from the telemetry.
2. The Nemotron agent asks whether the alert could be a faulty sensor, and calls the robot tool `inspect(pump_id)`.
3. The robot drives to a mock pump, stops within about 0.5 m, and takes a thermal frame and a NoIR photo.
   Heat the "bad" pump (for example with a small running motor or a warm water bottle) and leave a reference pump at room temperature.
4. The robot reports the temperature difference between the suspect pump and the reference, not an absolute temperature.
5. The agent combines robot evidence with telemetry: "confirmed, send inspector" or "not confirmed, likely sensor fault, recheck in 1 hour", and prices the avoided truck roll from `ops.json`.

Optional second check: a `pipeline_leak` with a tray of clearly warm or cold water near the mock pipe, confirmed by thermal contrast plus a NoIR photo.
Optional third check: a printed analog pressure gauge with a fiducial tag, read from the NoIR photo.

## Sources

- Boston Dynamics, BP case study: https://bostondynamics.com/case-studies/bp/
- Offshore Magazine, Spot on Mad Dog: https://www.offshore-mag.com/equipment-engineering/article/14187549/spot-deployed-on-bps-mad-dog-platform
- Boston Dynamics, Woodside case study: https://bostondynamics.com/case-studies/woodside/
- Boston Dynamics, combustible gas leak blog: https://bostondynamics.com/blog/autonomous-detection-of-combustible-gas-leaks/
- Boston Dynamics, Spot CAM+IR spec sheet: https://www.bostondynamics.com/wp-content/uploads/2023/05/spot-cam-plus-ir.pdf
- Boston Dynamics, visual inspection: https://bostondynamics.com/solutions/inspection/visual/
- ANYbotics, ANYmal X announcement (2022): https://www.anybotics.com/anymal-x-the-worlds-first-ex-proof-legged-robot/
- ANYbotics, ANYmal X spec sheet: https://www.anybotics.com/anymal-x-technical-specifications.pdf
- Marine Technology News, ANYmal X shipping (2026): https://www.marinetechnologynews.com/news/anybotics-unleashes-legged-robot-666992
- Robotics and Automation News, ExR-2 (2023): https://roboticsandautomationnews.com/2023/04/08/exrobotics-develops-new-and-improved-version-of-its-inspection-robot/66544
- Offshore Magazine, ExR-2.5 six months offshore (2026): https://www.offshore-mag.com/equipment-engineering/article/55362594/inspection-robots-complete-six-months-of-offshore-missions
- World Pipelines, ExR-2.5 UL certification (2026): https://www.worldpipelines.com/equipment-and-safety/25062026/exrobotics-launches-the-first-ul-certified-robot-for-hazardous-industrial-environments-in-north-america/
- Energies Media, Operator rounds by exception (2023): https://energiesmedia.com/operator-rounds-by-exception
- Wikipedia, Taurob Inspector: https://en.wikipedia.org/wiki/Taurob_Inspector
- Taurob, company page: https://www.taurob.com/company/
- Energy Robotics, ExR-2: https://www.energy-robotics.com/robot-fleet/exr-2
- Energy Robotics, Shell Rheinland drone tank case study: https://www.casestudies.com/company/energy-robotics/case-study/drone-tank-inspections-at-shell-rheinland
- Gecko Robotics, robots: https://www.geckorobotics.com/company/robots
- Bridger Photonics: https://info.bridgerphotonics.com/why-bridger-photonics
- Single-blind methane LiDAR study: https://escholarship.org/uc/item/5bw1m4g2
- Percepto, remote OGI: https://percepto.co/remote-ogi-inspections-field-validated-performance-pending-epa-approval/
- DroneLife, EPA approval (2025): https://dronelife.com/2025/10/29/autonomous-methane-detection-drones-earn-epa-approval-for-oil-and-gas-compliance/
- Inside Unmanned Systems, Phoenix Air pipeline patrol: https://insideunmannedsystems.com/phoenix-air-unmanned-achieves-single-day-pipeline-patrol-milestone/
- PR Newswire, Aerial Production Services: https://prnewswire.com/news-releases/aerial-production-services-aps-teams-with-iris-automation-to-jumpstart-faa-permissions-for-pipeline-inspections-with-drones-301249213.html
- EOG fact sheet, March 2025: https://eogresources.com/documents/EOG_Fact_Sheet_2025.pdf
- EOG Q4 2024 results: https://www.quantisnow.com/insight/eog-resources-reports-fourth-quarter-and-full-year-2024-results-announces-5914665
- EOG automation technician listing: https://www.justjobs.com/career/16279144/Automation-Technician-Ii-Wyoming-Cheyenne
- The Water Network, TETRA and EOG: https://industrial-water-treatment.thewaternetwork.com/news-post-TFp/Pd-oKNpOWBp7EvrqsXeNMg
- Melexis MLX90640 datasheet: https://media.melexis.com/-/media/files/documents/datasheets/MLX90640-datasheet-melexis.pdf
- Panasonic AMG8833: https://na.industrial.panasonic.com/products/sensors/sensors-automotive-industrial-applications/lineup/grid-eye-infrared-array-sensor/series/70496/model/72453
- SparkFun AMG8833: https://www.sparkfun.com/products/14607
- Farnell AMG8833: https://pt.farnell.com/panasonic-electronic-components/amg8833/temperature-sensor-ir-2-5deg-c/dp/2576419
- EPA-hosted OGI vendor presentation: https://www.epa.gov/sites/production/files/2019-12/documents/opticalgasimaging_jeffleake.pdf
- FLIR Si124 reseller listing: https://datatec.eu/de/en/flir-si124
- irinfo.org thermography paper: https://irinfo.org/images/articles/pdf/12-01-2017-umdenstorck-keithline.pdf
- TechRadar, Pi NoIR: https://www.techradar.com/news/computing-components/peripherals/infra-red-camera-board-bakes-night-vision-into-raspberry-pi-1194871
- Yeghiyan et al., thermal spill detection on a robot (2025): https://arxiv.org/abs/2510.08770
- US patent 9987752, automatic spill detection: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9987752
- Hendel et al., pavement watering (2014): https://arxiv.org/abs/1412.2165
- Shakmak and Al-Habaibeh (2015): https://irep.ntu.ac.uk/id/eprint/26749/
- MDPI Remote Sensing (2025): https://www.mdpi.com/2072-4292/17/14/2399
- J. Sens. Sens. Syst. (2020): https://jsss.copernicus.org/articles/9/133/2020/
- J. Sens. Sens. Syst. (2022): https://jsss.copernicus.org/articles/11/187/2022/
- US patent 10726712, alarm verification robot: https://patents.justia.com/patent/10726712
- Emerson, Alarm management by numbers: https://d1-live.emerson.com/documents/automation/article-alarm-management-by-numbers-deltav-en-38292.pdf
- Yokogawa, ISA-18.2: https://www.yokogawa.com/tw/library/resources/media-publications/implementing-alarm-management-per-the-ansi-isa-182-standard-control-engineering
- DPS Telecom, truck rolls: https://www.dpstele.com/blog/how-to-choose-monitoring-solution-reduce-truck-rolls.php
- SunWize, site visit cost: https://www.sunwize.com/application-item/how-much-does-a-site-visit-really-cost/
- Inside Climate News, Texas produced water spills: https://insideclimatenews.org/news/18122023/state-of-denial-oil-gas-wastewater-spills-texas/
- OSHA 29 CFR 1910.399: https://www.law.cornell.edu/cfr/text/29/1910.399
- GlobalSpec, API RP 500: https://standards.globalspec.com/std/1565474/api-rp-500
- ABB, ATEX groups, zones, categories: https://new.abb.com/drives/segments/motors-and-drives-in-potentially-explosive-atmospheres/groups-zones-categories-and-devices
