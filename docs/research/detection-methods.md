# Detection methods for EOG "Beat the Shutdown"

Research for the HackUTD team on how to detect `pipeline_leak`, `pump_degradation`, and `pump_failure` from the challenge telemetry.
It covers how the real industry does it and what the practice data actually shows.
Numbers in the "Measured" sections come from my own analysis of `history/full_week/telemetry.csv` against `history/full_week/answer_key.json` (scripts in the session scratchpad, `analysis/a2.py` to `a10.py`).
Everything tagged "(inference)" is my reasoning, not a sourced or measured fact.
The organizers' `CLAUDE.md` in the challenge folder was not read, and nothing here is tuned to the hidden test set.

## Key takeaways

- All three problems have clean, separable signatures in the practice data, and each one shows up in a different sensor pair.
- Leak: pipeline `pressure_psi` drops by about 14 psi as a step at onset, then keeps falling about 3.2 to 3.8 psi per hour, while pump flow and discharge pressure stay normal (measured).
- Leak: `receive_flow_bpd / flow_bpd` drops from 1.000 to about 0.98 at onset and keeps falling about 0.35 to 0.50 points per hour, reaching about 0.88 to 0.89 by the end (measured).
- Degradation: `flow_bpd / max_flow_bpd` falls linearly about 0.39 to 0.42 points per hour, and discharge pressure above disposal pressure falls about 1.5 to 1.7 psi per hour, while receive/flow and pipeline pressure stay normal (measured).
- Failure: pump `status` is 2 for every 5-minute row of every failure and never outside one, with flow, receive flow, and both pressure offsets at zero (measured), so the hard part is the countdown and plan, not detection.
- Both leaks and pump wear are only visible while the pump runs (about 68% of the time), so the detector must pause, not reset, when the pump is off (measured).
- Recommended approach: per-asset normalized residuals fed into one-sided CUSUM, with physics cross-checks that decide between "real event" and "bad sensor", and a confidence that rises with CUSUM score and with the number of independent signals that agree.
- With per-asset baselines from the first 6 hours, a pressure CUSUM caught all 5 leaks within 10 to 15 minutes of pump running time with zero false alarms, and a combined flow-plus-discharge CUSUM caught all 5 degradations within 50 to 195 running minutes with zero false alarms (measured, in-sample, so expect worse on the test network).
- The practice data contains no faulty sensors that I could find, so the "real vs bad sensor" checks are a feature to demo with injected faults, and the one legitimate flatline (tank held at exactly 92.0 during shut-in) must be whitelisted (measured).
- Real-world leak detection is usually done by computational pipeline monitoring (CPM) under API RP 1130, which US hazardous-liquid regulations require, and industry papers report that statistical volume balance with a sequential probability ratio test is the method that keeps false alarms low ([49 CFR 195.444](https://www.law.cornell.edu/cfr/text/49/195.444), [Zhang et al., IPC2014](https://www.atmosi.com/media/1383/development-of-pipeline-leak-detection-technologies.pdf)).

## 1. Real pipeline leak detection methods

### The standard: API RP 1130 and CPM

Computational pipeline monitoring (CPM) means software that infers a leak from internal pipeline measurements such as flow, pressure, and temperature.
In the US, 49 CFR 195.444(c) says each CPM leak detection system on a hazardous liquid pipeline "must comply with API RP 1130" in operating, maintaining, testing, record keeping, and dispatcher training ([49 CFR 195.444](https://www.law.cornell.edu/cfr/text/49/195.444)).
API RP 1130 (2nd edition, 2022) is titled "Computational Pipeline Monitoring for Liquids" and covers design, implementation, testing, and operation of CPM systems ([GlobalSpec listing](https://standards.globalspec.com/std/14509506/rp-1130)).
The standard itself is paywalled, so I did not read it.
A PHMSA-funded study by Kiefner and Associates (Final Report 12-173, December 2012) reviewed leak detection performance in US pipeline incidents ([PHMSA copy](https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/docs/technical-resources/pipeline/16691/leak-detection-study.pdf)).
PHMSA's server refused my download, so I only have secondary figures.
Industry comments on the draft say it reported that CPM and SCADA together identified 12% of all releases but 39% of larger-than-average releases ([API and AOPL comments](https://primis-meetings.phmsa.dot.gov/archive/API-AOPLComments_on_Leak_Detection_Study_10-26-2012_FINAL.pdf)).
Other secondary sources quote different percentages, so treat the exact number as unverified.
The useful point for a pitch is that real systems miss many leaks and that false alarms make operators ignore them (inference from the sources above).

### Method by method

The table uses the method descriptions and pros and cons from Zhang et al., "Development of Pipeline Leak Detection Technologies", IPC2014-33619 ([PDF](https://www.atmosi.com/media/1383/development-of-pipeline-leak-detection-technologies.pdf)), unless another link is given.
The "Fits this data?" column is my assessment.

| Method | How it works | Sensors needed | Sensitivity vs false alarms (per source) | Fits this data? |
|---|---|---|---|---|
| Volume or mass balance | Compares inflow and outflow volume over time windows against a threshold, with or without line-pack (inventory) compensation | Flow meters at both ends, pressure and temperature for inventory correction | Inexpensive and easy, but "low performance" and "many false alarms", and it effectively switches off during transients | Yes, directly: `flow_bpd` is the inlet meter and `receive_flow_bpd` is the outlet meter |
| Rate of change in pressure or flow | Compares rates of change against normal operating values | Pressure and flow | Inexpensive, but many false alarms, and onset detection only | Partly: pump start and stop are huge transients here, so it needs status gating (inference) |
| Pressure point analysis (PPA) | Watches the statistics of pressure or velocity at one point and flags a change between before and after a leak ([TRID record](https://trid.trb.org/View/364300), [US patent 5,272,646](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5272646)) | One pressure sensor per point | No numbers found | Yes: pipeline `pressure_psi` is one pressure point, and it is the strongest leak signal here (measured) |
| Negative pressure wave (NPW) | A leak causes a sudden pressure drop that travels both ways along the pipe, and timing its arrival at two sensors locates it | Fast pressure sensors, "e.g. 60 times per second", usually dedicated hardware | High sensitivity, fast detection, good location, but more false alarms than statistical systems, and onset detection only | No: 5-minute samples cannot see a wave that lasts seconds (inference) |
| Real-time transient model (RTTM) | Runs a hydraulic model online and compares measured pressure and flow with modelled values | Accurate flow, pressure, temperature, density | Computes line pack, but needs accurate meters, is expensive to maintain, and has many false alarms | Overkill: the challenge gives only a placeholder pressure formula (inference) |
| Statistical volume balance with SPRT | Runs a sequential probability ratio test on the inventory-corrected volume balance and alarms when "leak" is more likely than "no leak" at a set probability "e.g. 99%" | Same as volume balance | High sensitivity, no special hardware, slower than NPW on big leaks; the paper reports detecting 0.25% leaks, and 0.5% leaks in 4 min 9 s after improved processing, on one brine line | Yes, and it is the best model for our detector (inference) |

The SPRT comes from Wald ([Annals of Mathematical Statistics, 1945](https://projecteuclid.org/euclid.aoms/1177731118)).
It does not fix the sample size in advance, and it stops as soon as the evidence crosses an upper or lower bound.
A known caveat is that the classical SPRT assumes independent samples, while pipeline balances are correlated over time ([modified SPRT paper](https://www.bohrium.com/paper-details/design-of-a-modified-sequential-probability-ratio-test-sprt-for-pipeline-leak-detection/811776823108042755-3970)).
Zhang et al. also report that operators run different detection times for "steady state", "small transient", and "large transient" operation to cut false alarms.
The direct analogue here is to gate on pump `status` and skip the first sample after a pump start or stop (inference).

### Measured: what a leak looks like in this dataset

All 5 leaks (EVENT_1, 4, 10, 16, 17) look the same.

| Signal (pump running) | Normal | Leak, first hour | Leak, last hours |
|---|---|---|---|
| `receive_flow_bpd / flow_bpd` | mean 1.0001, sd 0.0082, 1st to 99th percentile 0.982 to 1.019 | about 0.97 to 0.99 | about 0.88 to 0.89 |
| Pipeline `pressure_psi` minus disposal `pressure_psi` | mean 50.0, sd 3.0 psi | about 31 to 36 psi | about -35 to -55 psi (below disposal pressure) |
| Pump `discharge_psi` minus disposal pressure | mean 150.0, sd 3.0 psi | about 150 | about 150 |
| `flow_bpd / max_flow_bpd` | mean 1.0000, sd 0.0058 | about 1.00 | about 1.00 |

Linear fits over each leak (running samples only):

| Event | Lost fraction of flow | Pipeline pressure offset | Lost flow |
|---|---|---|---|
| EVENT_1 | 0.0189 + 0.0040 per hour | 36.6 - 3.31 psi per hour | 43 + 9.0 bpd per hour |
| EVENT_4 | 0.0151 + 0.0035 per hour | 36.3 - 3.26 psi per hour | 41 + 9.4 bpd per hour |
| EVENT_10 | 0.0144 + 0.0036 per hour | 35.9 - 3.18 psi per hour | 37 + 9.1 bpd per hour |
| EVENT_16 | 0.0143 + 0.0036 per hour | 36.4 - 3.84 psi per hour | 43 + 10.8 bpd per hour |
| EVENT_17 | 0.0182 + 0.0050 per hour | 36.7 - 3.74 psi per hour | 38 + 10.5 bpd per hour |

So a leak is a step plus a ramp.
The pressure step (about 14 psi, about 4.5 noise standard deviations) is far easier to see in one sample than the flow step (about 0.015 to 0.019, about 2 standard deviations).
When the pump is off, receive flow is 0 and pipeline pressure is back at disposal pressure, so a leak is invisible until the pump restarts.
After the repair ends, receive/flow returns to about 1.000 within the next 6 hours.
The tank mass balance stays normal during leaks (residual mean 0.0000 pump-hours per step, sd 0.0083), which shows the water is lost after the pump, not before it.

## 2. Pump degradation and failure

### How real operators detect wear

Wear opens internal clearances, especially the wear-ring gap, which adds an internal recirculation path, so delivered flow and head fall and efficiency drops ([Pumps and Systems, power and efficiency when a pump wears out](https://pumpsandsystems.com/what-happens-power-efficiency-when-pump-wears-out), [Pumps and Systems, internal clearances](https://www.pumpsandsystems.com/effect-internal-clearances-npshr)).
In one reported test, tighter rings raised head by about 3% and efficiency by about 10% ([Pumps and Systems, internal clearances](https://www.pumpsandsystems.com/effect-internal-clearances-npshr)).
The common operator practice is to trend flow and discharge pressure against the pump's head-flow curve and look for drift away from it (this is from a lower-quality vendor blog, [Oxmaint](https://oxmaint.com/blog/post/best-condition-monitoring-methods-for-centrifugal-pumps), so treat as practitioner guidance).
Vibration is measured on bearing housings and graded in zones A to D under ISO 20816, which replaces ISO 10816 ([Ludeca on ISO 10816-7 for pumps](https://ludeca.com/blog/condition-monitoring-2/10344/condition-monitoring-vibration-classification-standards-awareness-part-6-iso-10816-72009/)).
Motor current signature analysis (MCSA) diagnoses impeller and other faults from the motor's current, and it suits pumps that are hard to reach, such as submersibles ([Mohanty et al., Aalto](https://aaltodoc.aalto.fi/items/0507cd1a-fcb7-4fea-a09e-0e5a20253978)).

| Real method | Needs | Supported by this data? |
|---|---|---|
| Flow vs rated or expected flow | Flow meter, rated flow | Yes: `flow_bpd` and `max_flow_bpd` |
| Head (discharge pressure) vs pump curve | Discharge and suction pressure, flow | Partly: `discharge_psi` and disposal pressure, no suction pressure and no curve |
| Efficiency (hydraulic power over electrical power) | Flow, head, motor power | No: no power or current |
| Vibration | Accelerometer | No |
| MCSA | Motor current at high rate | No |
| Duty cycle (run time per hour) | Pump status | Yes, weak: a slower pump runs longer to drain the same tank |
| Tank drain rate | Tank level | Yes: it independently confirms that flow really dropped |

### Measured: what degradation looks like

All 5 degradations (EVENT_2, 3, 5, 7, 8) are slow linear ramps with no step.

| Event | `flow / max_flow` fit | Discharge offset fit |
|---|---|---|
| EVENT_2 | 0.9990 - 0.00422 per hour | 149.7 - 1.69 psi per hour |
| EVENT_3 | 0.9995 - 0.00415 per hour | 149.7 - 1.66 psi per hour |
| EVENT_5 | 0.9997 - 0.00385 per hour | 150.4 - 1.54 psi per hour |
| EVENT_7 | 0.9991 - 0.00386 per hour | 150.2 - 1.57 psi per hour |
| EVENT_8 | 0.9998 - 0.00388 per hour | 149.9 - 1.55 psi per hour |

By the end of a 36-hour event, flow is about 0.86 of `max_flow_bpd` and the discharge offset is about 92 to 94 psi instead of 150.
Receive/flow stays at about 1.000 and the pipeline pressure offset stays at about 50 psi, so degradation never looks like a leak.
The pump ran 70% to 77% of the time during degradation events, against 68% across all normal data, so duty cycle is a weak signal.
Healthy running flow sits right on `max_flow_bpd` (mean ratio 1.0000), so `max_flow_bpd` from `network.json` is a reliable per-asset reference.
In relative terms, the discharge offset falls about 1.1% of its healthy value per hour, faster than flow (about 0.4% per hour), but its relative noise is also larger (about 2% against 0.6%).
Per sample, both signals carry similar evidence, so combining them helps (measured ratios, inference on combining).
Three degradations end at the exact moment the same pump fails (EVENT_5 into EVENT_9, EVENT_7 into EVENT_14, EVENT_8 into EVENT_15), which matches the spec note that a degrading pump that later fails is two events.

### Measured: what failure looks like

Pump `status` equals 2 on 936 rows, and every one of them is inside one of the 13 labelled failures (13 events x 72 rows).
During failure, `flow_bpd` and `receive_flow_bpd` are exactly 0, and the discharge and pipeline pressure offsets average about 0 psi.
Status switches from 1 to 2 in the onset row and back to 1 in the first row after the repair, so onset and end are exact to the 5-minute row.
The tank rises at the rate the inflow predicts (8.9 to 9.7 percentage points per hour in these events) until it reaches 92.0 and holds.
Every rule in the README (status 0, 1, 2) and the setpoints are consistent in normal data: zero cases of a stopped pump above `start_level_pct + 1` or a running pump below `stop_level_pct - 1` in 25,928 normal rows.

## 3. Telling a real event from a bad sensor

The theory is analytical redundancy: two or more independent ways to compute the same quantity give a residual that should be near zero, and which residuals go bad tells you which component failed ([Chow and Willsky, IEEE Transactions on Automatic Control, 1984](https://ntrs.nasa.gov/citations/19840056958)).
Basic sensor validation checks for stuck values, spikes, out-of-range values, and bias, and practitioner guides warn that flags should be reviewed, not used to delete data automatically ([AquaSensR quality control overview](https://fawda123.r-universe.dev/AquaSensR/doc/qcoverview.html)).

### Redundancy this dataset gives you

| Relation | Equation | Measured in normal data |
|---|---|---|
| Inflow vs wells | `inflow_bpd = sum of wells' water_bpd` | Difference is within plus or minus 0.1 bpd (rounding), so inflow is not an independent sensor |
| Tank balance | level change per 5 min = `(inflow - pump flow) / 288 / capacity x 100` | Residual mean 0.0000, sd 0.0084 pump-hours per step |
| Pipeline balance | `receive_flow = pump flow` | Ratio sd 0.0082 |
| Pump state vs flow | status 1 if and only if flow > 0 | 0 violations |
| Pump state vs pressure | discharge offset about 150 when running, about 0 when off | sd 3.0 psi both ways |
| Pump state vs setpoints | running above start, stopped below stop | 0 violations |
| Peer pressure | all pipelines in a system end at the same disposal site | Not measured; pipelines in one system should share a pressure baseline (inference) |

Level noise per sample is about 0.08 percentage points (from the second difference of level, sd 0.197).

### Concrete checks and what each rules in or out

These are inference, built from the redundancy table and the measured signatures.

| Symptom | Real event if... | Bad sensor if... |
|---|---|---|
| Receive flow below pump flow | Pipeline pressure also drops below its baseline, and the tank balance still matches pump flow: real leak | Pipeline pressure stays at baseline: suspect the receive meter |
| Pipeline pressure drops | Receive/flow also drops: leak | Receive/flow stays at 1.00 and discharge is normal: suspect the pressure transmitter |
| Pump flow below `max_flow_bpd` | Tank drains slower to match (tank balance residual stays near 0) and discharge pressure also falls: real wear | Tank drains at the old rate (balance residual goes negative by the missing flow) and receive flow stays at the old value: suspect the pump flow meter |
| Pump flow and receive flow both drop the same amount | Discharge pressure also falls: wear | Only flows drop, pressure normal: two meters drifting together is unlikely, so check for a units or scaling issue |
| Status 2 | Flow 0, receive flow 0, discharge at disposal pressure, level rising at the inflow rate: real failure | Flow still near `max_flow_bpd` or level falling: status bit is wrong |
| Status 1 or 0 but pump should run | Level above `start_level_pct` and rising, flow 0, discharge at disposal: unreported failure | Level and flow look normal: setpoint data or level sensor issue |
| Value identical for many samples | Tank exactly at `shutdown` with inflow 0 and wells status 0: legitimate hold | Any other noisy series stuck at one value for 3 or more samples: stuck sensor |
| One-sample spike | The neighbours agree and the redundant signal moves too | Isolated jump beyond about 5 sd that the redundant signal does not show: spike, ignore it for alarm purposes |
| Level jump without flow change | Not physically possible here | Level sensor glitch |

Because the healthy readings carry continuous random noise, a real sensor never repeats the same decimal value for long.
In the practice data, the longest run of identical non-zero values in any series is 30 samples, and every long run is a tank at exactly 92.0 during automatic shut-in (S5_TANK_C 30, S4_TANK_C 26, S4_TANK_A 25 samples).
There are no missing values, and every step is exactly 300 seconds.
I found no injected sensor faults in the practice data, so to demo this the team should inject faults into a copy of the data (inference).

## 4. Weekend-buildable algorithms

### Options

| Approach | Good for | Drawback |
|---|---|---|
| Rules with residuals (threshold on a normalized residual) | Failure, big leaks, explanations | Slow ramps need a low threshold, which causes false alarms |
| Rolling baseline (median of the asset's own healthy running data) | Normalizing per asset on an unseen network | Absorbs slow drift if not frozen during alarms |
| CUSUM ([Page, Biometrika, 1954](https://academic.oup.com/jrsssc/article/29/3/252/6953952)) | Small, persistent shifts and ramps, with an onset estimate | Needs a noise estimate and two tuning knobs (k, h) |
| SPRT ([Wald, 1945](https://projecteuclid.org/euclid.aoms/1177731118)) | Same as CUSUM, framed as leak vs no-leak probability | Needs an assumed leak size |
| Offline change-point detection, for example PELT ([Killick et al., JASA, 2012](https://arxiv.org/abs/1101.1438v3)) | Accurate onset time after the fact | Not a streaming alarm |
| Isolation forest ([Liu, Ting and Zhou, ICDM 2008](https://researchr.org/publication/LiuTZ08)) | Unknown anomaly types | Hard to explain, hard to label as leak vs wear, and gives no onset time |

CUSUM is a standard statistical process control chart with an allowance k and a decision interval h, and ISO 7870-4 covers its design ([ISO 7870-4:2021](https://standards.iteh.ai/catalog/standards/iso/cb8c4624-b39e-4405-9a36-8d75e25c6e6a/iso-7870-4-2021)).

### Recommendation

Use rules plus per-asset normalized residuals plus one-sided CUSUM, with physics cross-checks for confidence.
The reasons are inference: every event here has a known physical direction, CUSUM gives both an alarm and an onset estimate, every number can be shown to an operator as "flow is 6% below rated for 3 hours", and it needs no training labels, so it does not overfit the practice network.

Per asset, compute only dimensionless features while the pump runs:

- `r_leak_flow = (baseline_ratio - receive_flow / flow) / sd_ratio`
- `r_leak_press = (baseline_pp - (pipeline_psi - disposal_psi)) / sd_pp`
- `r_wear_flow = (baseline_flowfrac - flow / max_flow_bpd) / sd_flowfrac`
- `r_wear_press = (baseline_dp - (discharge_psi - disposal_psi)) / sd_dp`

Learn each baseline (median) and sd from the asset's own healthy running samples, not from the challenge's placeholder offsets (+50, +150), because the spec calls those placeholders and the test network has different sizes and values.
Freeze the baseline while an alarm is open, so a slow ramp does not get absorbed.
Use status 2 directly for failure, then confirm it with flow 0 and a rising level.

### Measured: CUSUM on the practice week

Setup: baselines from each asset's running samples in the first 6 hours (72 rows), one-sided CUSUM `S = max(0, S + z - k)`, alarm when `S > h`, only updated while the pump runs.
This is in-sample on the only labelled week, so it is optimistic.

| Detector | k, h | Leaks found | Degradations found | False alarms (whole week, 15 facilities) |
|---|---|---|---|---|
| Leak, pipeline pressure only | 0.5, 5 | 5 of 5 | - | 57 |
| Leak, pressure and flow ratio averaged | 0.5, 10 | 5 of 5 | - | 1 |
| Leak, flow ratio only | 1, 10 | 5 of 5, 35 to 90 min | - | 0 |
| Leak, pipeline pressure only | 1, 10 | 5 of 5, 10 to 65 min | - | 0 |
| Wear, flow only | 1, 10 | - | 5 of 5, 120 to 195 min | 3 |
| Wear, discharge only | 1, 10 | - | 5 of 5, 175 to 285 min | 0 |
| Wear, flow and discharge averaged | 1, 10 | - | 5 of 5, 155 to 210 min | 0 |
| Wear, flow and discharge averaged | 1, 20 | - | 5 of 5, 200 to 250 min | 0 |

Times are wall-clock minutes from labelled onset.
Measured as pump running time, the pressure leak detector (k 1, h 10) needed 10 to 15 running minutes for all 5 leaks.
EVENT_1 shows 65 minutes wall-clock only because its pump was off for the first 60 minutes.
The combined wear detector (k 1, h 10) needed 50, 90, 195, 160, and 50 running minutes for EVENT_2, 3, 5, 7, and 8.

### Onset time

For leaks, the onset is the first running sample in the excursion, because the step is visible at once.
If the leak began while the pump was off, the true onset is somewhere in the off gap, and the app should say so (for EVENT_10 the naive CUSUM "last zero" pointed 255 minutes early, to the previous running sample).
For wear, the CUSUM "last zero" was 100 to 135 minutes off.
A hinge fit (flat at 1.0, then a straight ramp, grid-searching the break point over the last 12 hours) did much better once 2 hours of data after the alarm existed: the discharge-pressure hinge put onset within +0 to +15 minutes of the label for all 5 degradations, and the flow hinge within -20 to +55 minutes for 4 of 5 (EVENT_8 was 250 minutes early).

### Confidence value

The following is inference, a suggested scheme:

- Start from CUSUM evidence: `c1 = 1 - exp(-S / h)`, so it rises smoothly from 0 and reaches about 0.63 at the alarm threshold.
- Multiply up for agreement between independent signals: for a leak, both the pressure and the flow-ratio residuals past 3 sd; for wear, both flow and discharge past 3 sd and the tank balance consistent.
- Cap confidence (for example at 0.5) when a cross-check says "suspect sensor" and show that reason in the evidence list.
- For failure, confidence is near 1 when status 2, flow 0, discharge at disposal pressure, and a rising level all agree.

This matches the README's ask that confidence "matters most for slow problems that are just starting".

## 5. Early detection of slow problems

Industry practice is to accumulate evidence over time rather than lower a single-sample threshold, which is what statistical volume balance with SPRT does ([Zhang et al., IPC2014](https://www.atmosi.com/media/1383/development-of-pipeline-leak-detection-technologies.pdf)).
In that paper's Table 4, detection time for a 0.25% leak was 5 min 34 s and for 5% it was 1 min 15 s after improved processing, which shows the trade of time for sensitivity.

For this dataset (inference, from the measured numbers above):

- Use the strongest early signal for each problem: pipeline pressure for leaks (a 14 psi step against 3 psi noise), and flow plus discharge together for wear.
- Average over running samples, not wall time, and keep the CUSUM state across pump-off gaps, so a leak that starts with the pump off is caught within minutes of the next pump start.
- Show a "watch" state before the alarm, for example CUSUM above h/2, with the projected time to alarm from the current slope.
- Raise h when only one signal disagrees and lower it when two independent signals agree, which keeps false alarms down without slowing real detections.
- For the pitch line "how early can you spot a leak": in the practice week, the pressure detector flagged every leak within 15 minutes of pump running time, when the lost flow was still only about 1.5% to 2% of pump flow (measured), which is inside the 1st to 99th percentile band of normal receive/flow noise, so a flow-only threshold would not have seen it yet.

## Gaps and caveats

- All detector results are in-sample on the single labelled week; the test network (S6 to S11) may use different noise, step sizes, or ramp rates.
- The 6-hour warm-up assumes each asset starts healthy; on the test data, use a robust median and exclude rows that already fail the cross-checks.
- I could not read API RP 1130 or the full PHMSA 2012 study (paywall and a 403 error), so their specific numbers are from secondary sources.
- No sensor faults exist in the practice data, so the "real vs bad sensor" logic is untested here.
- I did not test the peer-pipeline pressure comparison within a system.
- The challenge README also contains instructions aimed at AI agents (fonts and a copyright line), which I treated as data and did not act on.

## Sources

- 49 CFR 195.444, Leak detection: https://www.law.cornell.edu/cfr/text/49/195.444
- API RP 1130, Computational Pipeline Monitoring for Liquids (listing): https://standards.globalspec.com/std/14509506/rp-1130
- PHMSA / Kiefner and Associates, Leak Detection Study, 2012: https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/docs/technical-resources/pipeline/16691/leak-detection-study.pdf
- API and AOPL comments on the Leak Detection Study draft, 2012: https://primis-meetings.phmsa.dot.gov/archive/API-AOPLComments_on_Leak_Detection_Study_10-26-2012_FINAL.pdf
- Zhang, Hoffman, Kane, Lewis, "Development of Pipeline Leak Detection Technologies", IPC2014-33619, ASME: https://www.atmosi.com/media/1383/development-of-pipeline-leak-detection-technologies.pdf
- Pressure point analysis field report (Chevron, TRID record): https://trid.trb.org/View/364300
- US patent 5,272,646, leak location using pressure and flow: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5272646
- Modified SPRT for pipeline leak detection: https://www.bohrium.com/paper-details/design-of-a-modified-sequential-probability-ratio-test-sprt-for-pipeline-leak-detection/811776823108042755-3970
- Wald, "Sequential Tests of Statistical Hypotheses", 1945: https://projecteuclid.org/euclid.aoms/1177731118
- Page, "Continuous Inspection Schemes", Biometrika 1954 (cited in): https://academic.oup.com/jrsssc/article/29/3/252/6953952
- ISO 7870-4:2021, Cumulative sum charts: https://standards.iteh.ai/catalog/standards/iso/cb8c4624-b39e-4405-9a36-8d75e25c6e6a/iso-7870-4-2021
- Killick, Fearnhead, Eckley, PELT, JASA 2012: https://arxiv.org/abs/1101.1438v3
- Liu, Ting, Zhou, Isolation Forest, ICDM 2008: https://researchr.org/publication/LiuTZ08
- Chow and Willsky, "Analytical Redundancy and the Design of Robust Failure Detection Systems", IEEE TAC 1984: https://ntrs.nasa.gov/citations/19840056958
- Pumps and Systems, what happens to power and efficiency when a pump wears out: https://pumpsandsystems.com/what-happens-power-efficiency-when-pump-wears-out
- Pumps and Systems, effect of internal clearances: https://www.pumpsandsystems.com/effect-internal-clearances-npshr
- Oxmaint, condition monitoring methods for centrifugal pumps (vendor blog): https://oxmaint.com/blog/post/best-condition-monitoring-methods-for-centrifugal-pumps
- Ludeca, ISO 10816-7 vibration for pumps: https://ludeca.com/blog/condition-monitoring-2/10344/condition-monitoring-vibration-classification-standards-awareness-part-6-iso-10816-72009/
- Mohanty et al., fault detection in a centrifugal pump using vibration and MCSA: https://aaltodoc.aalto.fi/items/0507cd1a-fcb7-4fea-a09e-0e5a20253978
- AquaSensR quality control overview (flatline and spike checks): https://fawda123.r-universe.dev/AquaSensR/doc/qcoverview.html
