# A2: primary breathing quality gate audit

Date: 2026-11-08. Branch: `codex/a2-quality-gate-audit`.

## Finding and change

There is evidence of one false rejection of a usable rate, not evidence that all
12 rejected MPSC-RR clips are good. The baseline lighting gate suppresses VRWi
M14 resting 030s in operator-ROI mode even though its candidate rate is 14.2/min
against the belt-derived 14.39/min. Raising `flicker_c_max` from 0.5 to 0.6
recovers it with confidence 0.80. The same clip already worked with the pose ROI
(13.7/min, confidence 0.40). The motion threshold stays at 0.5: neither labelled
development window failed it, so there is no labelled basis for relaxing it.

The two reserved labelled windows show **no improvement** after this change.
In particular, bypassing the gates in service-mode 090s exposes a wrong rate
of 9.2/min versus truth 19.12/min. Removing all gates would increase coverage
while admitting at least this known error. Do not call coverage accuracy.

## Protocol and evidence limits

Before A2 reruns, fixed development to M14 resting **030s/060s**, and evaluation
to **090s/120s**, in both operator/center (`reference`) and automatic pose
(`service`) modes. All four were already exposed in A1 and its task description.
This is a temporal split of one seated subject, not a genuinely unseen or
subject-independent test. No new clinical or rescue-scene accuracy claim follows.
Belt alignment follows upstream preprocessing and has not been independently
verified. Adjacent windows and both ROI modes are not independent samples.

Candidate lighting concentrations were fixed at 0.5, 0.6, 0.7, 0.8, 0.9, choosing
the first for which every development rate is within 3/min and all 15 synthetic
expectations pass. Only 0.5 and 0.6 were executed; 0.6 satisfied that rule.
The development JSON was written before evaluation; its SHA-256 is embedded in
the evaluation JSON. No choice was revised after evaluating 090s/120s or MPSC-RR.
All other thresholds, ROI logic, rate extraction and confidence rules stayed fixed.

Only VRWi has independent real-video rate references here. Synthetic cases have
known generated rates but cannot validate real camera performance. MPSC-RR has
no public rate labels in this release and contributes no accuracy metric. Its
existing subject split (s1 tune, s2 held_out) is retained in the rows, but neither
subject was used to select the threshold. No robot-camera clip was available.

## Labelled results

MAE is over returned rates only; the fraction within 3/min counts abstentions
against the full window count. The evaluation rows below are reported unchanged.

| Split and mode | Baseline returned rates | Selected returned rates | Baseline / selected MAE per min | Baseline / selected within 3/min |
| --- | --- | --- | --- | --- |
| Development, reference | 1/2 | 2/2 | 0.02 / 0.10 | 1/2 / 2/2 |
| Development, service | 2/2 | 2/2 | 0.43 / 0.43 | 2/2 / 2/2 |
| Evaluation, reference | 2/2 | 2/2 | 4.58 / 4.58 | 1/2 / 1/2 |
| Evaluation, service | 1/2 | 1/2 | 1.14 / 1.14 | 1/2 / 1/2 |

| Evaluation window | Mode | Truth per min | Baseline and selected | Confidence | Diagnostic bypass only |
| --- | --- | --- | --- | --- | --- |
| 090s | reference | 19.12 | 11.1/min, wrong | 0.27 | same 11.1/min |
| 090s | service | 19.12 | abstain, lighting gate | 0.00 | 9.2/min, confidence 0.17, wrong |
| 120s | reference | 17.14 | 16.0/min | 0.40 | same 16.0/min |
| 120s | service | 17.14 | 16.0/min | 0.25 | same 16.0/min |

The 090s failure remains low confidence. None of the evaluation rates has
confidence at least 0.5. A lower MAE on fewer returned rates does not establish
better performance. The development gain is one recovered labelled window,
with no demonstrated evaluation gain.

## What the gates measure

The primary flicker gate rejects when the outside-person brightness signal has
a spectral peak within 0.05 Hz of the chest peak and concentration at least the
threshold. It does not directly measure exposure changes. In VRWi 030s reference
mode, concentration is 0.511 (just over 0.5), chest candidate 14.2/min and flicker
peak 16.1/min, within that 3/min proximity. Background ratio is only 0.074 and
optical flow agrees with the chest candidate. The pose ROI changes both the
chest signal and the excluded person region; its flicker concentration is 0.480
and it already passes. These numbers demonstrate threshold/ROI sensitivity,
not proof that the physical lighting stayed constant.

The motion gate compares background PIC power with chest PIC power near the
chest candidate frequency. It does not distinguish camera movement from other
background changes, nor can it fix an off-chest ROI. All four s1 lying windows
have ratios 3.400 to 5.228 and fail in both modes. A3 had already found the lying
ROIs off chest; this audit reopened `service/mpsc/s1_lying_030s/roi.jpg` and
confirmed the green chest box is on the sofa above the person. A weak/wrong chest
signal can make the ratio large. That is a confound, not evidence that motion
rejection should be disabled. The service s1 front 030s ratio is 1.087 versus
0.036 with the center ROI, another sign that the ROI matters.

Darkness, noise and chest-ROI gates rejected none of these public windows.
They remain unchanged. The old spec note about amplitude-aware flicker and
coherent background flow described `codex-reference/`, not the primary pipeline;
its attribution is corrected in `docs/specs/perception.md`.

## MPSC-RR coverage, never accuracy

| Mode | Baseline detected / abstained | Selected detected / abstained | Selected abstention reasons | Both gates bypassed, diagnostic only |
| --- | --- | --- | --- | --- |
| reference | 4 / 12 | 7 / 9 | 5 lighting, 4 motion | 15 detected, 1 unclear |
| service | 4 / 12 | 6 / 10 | 4 lighting, 5 motion, 1 unclear | 14 detected, 2 unclear |

The selected lighting threshold removes three lighting rejections per mode.
In service mode s2 lying 090s then fails the downstream clarity check, so it
still abstains. The lying-ROI problem means even returned rates may describe
the wrong region. The 15/16 and 14/16 bypass counts are an ablation ceiling,
not a deployable setting or evidence that those rates are correct.

Every original rejected window is listed below. D means a rate returned,
L lighting, M motion, and U downstream unclear. Full numeric diagnostics and
returned rates are in the JSON rows, with no MPSC-RR accuracy fields.

| Window | Reference baseline -> selected | Service baseline -> selected |
| --- | --- | --- |
| s1_front_030s | L -> D | M -> M |
| s1_front_060s | L -> L | D -> D |
| s1_front_090s | D -> D | D -> D |
| s1_front_120s | D -> D | D -> D |
| s1_lying_030s | M -> M | M -> M |
| s1_lying_060s | M -> M | M -> M |
| s1_lying_090s | M -> M | M -> M |
| s1_lying_120s | M -> M | M -> M |
| s2_front_030s | L -> D | L -> L |
| s2_front_060s | L -> L | L -> L |
| s2_front_090s | L -> L | L -> L |
| s2_front_120s | L -> L | L -> L |
| s2_lying_030s | D -> D | D -> D |
| s2_lying_060s | L -> L | L -> D |
| s2_lying_090s | D -> D | L -> U |
| s2_lying_120s | L -> D | L -> D |

## Reproduce and validation

From `backend/perception/`, with A1 prepared clips present:

```sh
.venv/bin/python scripts/audit_quality_gates.py develop --out-dir data/a2-repeat
.venv/bin/python scripts/audit_quality_gates.py evaluate --out-dir data/a2-repeat
.venv/bin/python -m pytest -q
```

The script forces the historical 0.5 lighting baseline, ignores environment
threshold overrides and uses a frozen base configuration for evaluation. It
refuses to overwrite a development freeze. Every public input must exist;
missing input is an error. Bypass settings never write to service config.

- [Development freeze and all trials](../../backend/perception/testdata/public/quality-gates-development.json)
- [Evaluation and diagnostic bypass rows](../../backend/perception/testdata/public/quality-gates-evaluation.json)
- Full primary suite: 773 passed in 130.38 s before adding three explicit
  configured-threshold nuisance regressions. The focused rerun of the audit, synthetic and config tests passed 28/28
  in 105.88 s, including those three added regressions against service settings.
- Both executed development candidates passed all 15 synthetic expectations.
  Real flicker and sway synthetic inputs still abstain with their exact reasons.
- Audit tests enforce the development split, immutable freeze, required evaluation
  freeze, and rejection of candidates with missing/wrong rates or failed nuisances.

E0 and R1 posts are prepared separately in
[the human-post drafts](2026-11-08-human-posts.md). They remain unsent and their
completion checkboxes remain open until Eric posts them.
