# Video breathing repositories and public test inputs

Migration: this work now lives on `eric`, under
`backend/perception/codex-reference/` and `backend/agent/codex-reference/`.
Eric already had newer primary implementations, including live model checks;
those are preserved at their original paths. Results here describe the separate
reference implementation, not the primary implementation.

Checked 2026-11-08. Eric authorized public data for initial E1 development.
This changes the input source for development, not the breathing method or the
shared contracts. The demo-camera validation in perception.md section 10 remains.

## Repository comparison

The table below records source inspections. The runnable subset was then tested
as described in the measured comparison below.

| Repository | What it implements | License | Fit for our project |
| --- | --- | --- | --- |
| [resPyre](https://github.com/phuselab/resPyre) | Chest frame differences, Farneback optical flow, 1D motion profiles, deep methods, and dataset evaluation | GPL-3.0 | Best reference for comparing simple chest-motion methods and evaluation. `motion/motion.py` exposes small signal extractors. Its frame-difference method is not our grid/PCA PIC method. |
| [Lightweight Video-Based Respiration Rate Detection](https://github.com/ShawnTan86/Lightweight-Video-based-Respiration-Rate-Detection-Algorithm) | Improved optical flow, respiratory waveform, FFT and three other rate estimators; three bundled example videos | Apache-2.0 | Best small standalone optical-flow baseline to try alongside our PIC implementation. CPU-oriented dependencies are OpenCV, NumPy, SciPy, and Matplotlib. |
| [respmon](https://github.com/kevroy314/respmon) | EVM-based ROI calibration, average intensity or optical-flow measurement, peak detection, and recalibration | GPL-3.0 | Useful reference for the stop, calibrate, measure flow. Old OpenCV/Qt dependencies and explicit TODOs about no-motion handling and double peaks make it a poor drop-in service. |
| [RRPIPS](https://github.com/mxahan/RRPIPS) | Persistent point tracking for respiratory motion, filtering, and clustering; links to MPSC-RR | No top-level license found | Relevant research, but `demo_BR.py` hard-codes CUDA and loads `../data.pkl`; more setup than the classical baselines. Do not vendor its code without reuse permission. |
| [VRWiDataset](https://github.com/fnkslab/VRWiDataset) | CNN/ConvLSTM waveform estimation, pretrained models, video/webcam demos, and belt-reference data | MIT for source in `eval/` and `demo/` per README; data CC BY-NC 4.0 | Useful additional adult data/reference source. It is a different learned method. Archives are large (F01 about 1.72 GB). Its video demo uses the removed pandas `DataFrame.append`, so current environments need adjustment. |

Recommendation: use resPyre as a methods/evaluation reference and the lightweight
optical-flow repo as the first external comparison. Keep the spec's PIC primary
signal, optical-flow cross-check, uncertainty gates, and EVM for display only.
Copying GPL code brings its license obligations. Reference code is downloaded
only into ignored `data/benchmarks/`, retaining upstream licenses; it is not
vendored into our implementation. No external breathing model has been adopted.

## Measured comparison (2026-11-08)

Executed 140 method/input combinations: 15 deterministic synthetic inputs,
16 unlabelled MPSC-RR windows, and 4 VRWi windows with independent belt-derived
reference rates, across three external configurations and our PIC pipeline.
The complete results are in
[`comparison-results.json`](../../backend/perception/codex-reference/testdata/public/comparison-results.json).

| Executed configuration | Mean absolute error on five clean synthetic rates | Mean absolute error on four VRWi windows | VRWi rates within 3/min |
| --- | --- | --- | --- |
| Our signed PIC/PCA plus quality gates | 0.02/min | 2.29/min | 3/4 |
| resPyre Farneback waveform plus harness FFT | 0.11/min | 12.55/min | 1/4 |
| resPyre frame differences plus harness FFT | 25.10/min | 9.31/min | 1/4 |
| Lightweight repo's native FFT output | 22.79/min | 12.82/min | 0/4 |

These numbers describe the exact configurations tested, not a ranking of the
papers or all of their methods. resPyre functions are unchanged but use a shared
harness filter/FFT rather than its full evaluator. The lightweight repo uses
its native defaults and whole-frame feature selection, whereas the other
methods receive a chest ROI; its other rate outputs are retained in the JSON.
Its default filter is 2 to 40/min, while our requirement reaches 60/min.
Its native FFT chooses the second largest bin without restricting the search
to the breathing band, and even returned 279.47/min for the still synthetic
clip. Its peak-count estimator did substantially better on several clean
synthetic inputs. This is evidence against using that native FFT unchanged,
not evidence that optical flow cannot work.

The four VRWi reference rates were 14.39, 18.68, 19.12, and 17.14/min.
Our outputs were 14.2 (confidence 0.80), 18.7 (0.80), 11.3 (0.26), and 16.0
(0.80). All three confidence-at-least-0.5 results were within 3/min; the fourth
was wrong and carried low confidence. Do not hide that fourth case by reporting
only the high-confidence subset. Four windows from one seated subject cannot
establish general accuracy, dim-light accuracy, or rescue-scene performance.

The synthetic set tests 9, 15, 24, 36, and 54/min, plus stillness, camera sway,
global flicker, no texture, darkness, noise, fan motion, irregular breathing,
small motion, and a short clip. Our pipeline detects the five clean rates and
rejects the intended acquisition failures. It returns `not_detected` with
confidence 0.24 for a still operator ROI, and `unknown` for uncertain cases.
The unlabelled MPSC-RR windows remain diagnostic inputs, not accuracy evidence.

Decision: retain our spec's signed PIC/PCA primary signal, optical-flow
cross-check, and explicit quality gates. Keep resPyre as an independent
comparison. A tested acquisition gate is more useful here than a method that
always returns a number. No method was tuned on the VRWi windows.

Reproduce from the repo root after installing perception requirements plus
`requirements-benchmark.txt`:

```bash
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/prepare_public_clips.py
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/make_synthetic.py --out backend/perception/codex-reference/data/synthetic
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/prepare_reference_clips.py
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/compare_breathing.py
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/compare_breathing.py --cases backend/perception/codex-reference/data/synthetic/manifest.json --output backend/perception/codex-reference/data/benchmarks/synthetic-comparison.json
backend/perception/codex-reference/.venv/bin/python backend/perception/codex-reference/scripts/compare_breathing.py --cases backend/perception/codex-reference/data/vrwi/cases.json --output backend/perception/codex-reference/data/benchmarks/vrwi-comparison.json
```

For example, a 20 s lying-person clip can feed an operator-selected chest ROI,
then our PIC extractor and the external optical-flow baseline. Compare each
result to an independent reference. Agreement between two algorithms alone is
not a ground-truth label.

## Primary pipeline on the same inputs (2026-11-08, task A1)

The table above measures the `codex-reference/` code. These rows measure the
primary pipeline (`perception.breathing.analyze`, the code the service and
`scripts/analyze_clip.py` run), on the same 15 synthetic, 4 VRWi and 16 MPSC-RR
windows. Full rows, scores and reasons are in
[`primary-results.json`](../../backend/perception/testdata/public/primary-results.json).
Two modes: "reference" gives the same inputs as the reference run (operator
ROI for synthetic and VRWi, center ROI for MPSC-RR, YOLO off); "service" gives
no operator ROI and YOLO pose on, as the service does with an uploaded clip.
No threshold was tuned on these windows.

| Primary, mode | Source | Windows | Detected | Abstained | Mean absolute error | Within 3/min | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| primary, reference | synthetic | 15 | 8 | 6 | 0.01/min (7 clean rates) | 7/7 | every case met its expected outcome (15/15) |
| primary, service | synthetic | 15 | 8 | 7 | 0.01/min | 7/7 | no person in synthetic clips, so center ROI and confidence capped at 0.4 |
| primary, reference | VRWi | 4 | 3 | 1 | 3.06/min (3 rates) | 2/4 | 060s 18.7 (0.80); 090s 11.1 (0.27, wrong, low confidence); 120s 16.0 (0.40); 030s abstained, "lighting or exposure changed" |
| primary, service | VRWi | 4 | 3 | 1 | 0.67/min (3 rates) | 3/4 | pose ROI on the chest in all 4; confidence 0.25 to 0.40; 090s abstained, "lighting or exposure changed" |
| primary, reference | MPSC-RR | 16 | 4 | 12 | not reported (no labels) | not reported | abstentions: 8 "lighting or exposure changed", 4 "camera or scene moved" |
| primary, service | MPSC-RR | 16 | 4 | 12 | not reported (no labels) | not reported | abstentions: 7 "lighting or exposure changed", 5 "camera or scene moved" |

Findings:

- The primary pipeline differs from the reference on VRWi 030s: the reference
  gave 14.2 (0.80); the primary rejects it with the flicker gate in reference mode
  but gives 13.7 (0.40) in service mode. Most MPSC-RR rejections are the same two
  gates. Whether these are false rejections is task A2 (development and held-out
  split before any threshold change).
- The VRWi 090s case stays wrong with low confidence, as in the reference run.
  Do not report only the confident subset.
- Service mode never gave confidence above 0.5 on these windows, so on its own
  it would not mark anyone confidently breathing from a public clip.

Chest ROI review (task A3, service mode, every `roi.jpg` opened):

| Clips | ROI source | Review |
| --- | --- | --- |
| VRWi 030s to 120s (seated, face blurred) | pose | on chest, 4/4 |
| MPSC-RR s1 and s2 front (torso fills the frame, head cut off) | pose | on chest, 8/8 after the fix below; before it, the box covered only the left half of the torso |
| MPSC-RR s1 lying (4), s2 lying 030s and 120s | center (no person found) | off chest (on the sofa above the person) |
| MPSC-RR s2 lying 060s and 090s | box | off chest (on the sofa above the person) |
| synthetic | center (no person) | not applicable, no person in the clip |

Fix from the review: with both shoulders visible and the hips hidden, the torso
axis used the person box's long axis. A torso that fills a wide frame gives a
wide box, so the chest box ran sideways from the shoulder midpoint. The axis is
now perpendicular to the shoulder line, away from the face (else toward the box
center) (`perception/roi.py`, `tests/test_roi.py`, `perception.md` step 2). The
lying clips are filmed from above with the head out of frame and the chest at
the bottom edge; YOLO finds no usable pose there. Box chest factors were not
changed for six clips from two subjects in one framing. An operator chest box
remains the fallback for such views.

Every row has a critical score with reasons. Every abstention, dark and noisy
case scored with confidence at most 0.3 and the reason "needs human triage".
The public sets have no covered-person clip, so the covered case is still
untested on real footage.

Reproduce from `backend/perception/` with the primary `.venv` (downloads about
1.3 GB into git-ignored folders):

```bash
.venv/bin/python codex-reference/scripts/prepare_public_clips.py
.venv/bin/python codex-reference/scripts/prepare_reference_clips.py
.venv/bin/python scripts/benchmark_public.py --score --debug-dir data/derived/benchmark
```

## Public-data findings

- [MPSC-RR](https://huggingface.co/datasets/justchugh/MPSC-RR) is linked from
  the RRPIPS authors' repo. The card declares CC BY 4.0 and describes belt
  measurements, but the pinned public file tree contains videos, metadata,
  and a filename mapping, with no reference belt signals or rate labels.
  Its metadata describes 31 sessions, not the differing counts on the paper
  website. Treat the actual pinned files as the available release.
- [MPSC-RespView](https://huggingface.co/datasets/shadman-sakib/MPSC-RespView)
  explicitly says belt references are private and absent from the release.
  It does not solve the missing-label problem.
- [COHFACE](https://www.idiap.ch/en/dataset/cohface) describes synchronized
  RGB face videos and breathing recordings. Its 20 fps face framing is less
  representative of our chest-motion input; the linked Zenodo API returned
  no downloadable files during this check. It has not been downloaded.
- [LBRD-IC](https://github.com/ShawnTan86/LBRD-IC-Dataset) describes paired
  chest/abdomen videos and reference rates, but clips are 10 s, shorter than
  our 15 s minimum. Do not repeat or concatenate them to claim a real 20 s
  breathing measurement.
- VRWi supplies timestamped thoracic and abdominal belt TSV files alongside
  videos through GitHub release archives. We downloaded M14, verified the
  release's SHA-256, checked the torso framing, and prepared four 20 s resting
  windows. Reference rates use a band-pass/Hann FFT with dual-belt and independent
  peak-interval agreement checks. All four passed these reference-quality checks.
  Time zero follows the authors' preprocessing (first sensor timestamp equals
  video time zero), an assumption that has not been independently verified.

## Initial local E1 set

`backend/perception/codex-reference/scripts/prepare_public_clips.py` downloads four pinned
MPSC-RR sources (subjects 1 and 2, front and lying) with SHA-256 verification.
It extracts four non-overlapping 20 s windows per source, starting at 30, 60,
90, and 120 seconds. H.264 encoding at CRF 18 and conversion to 30 fps are
recorded transformations, not untouched camera footage. There are 16 clips.
Subject 1 is for tuning, subject 2 for held-out checks, so adjacent windows
from one person do not leak across the split. Two subjects are a starter set,
not evidence of generalization.

The manifest and attribution are committed; raw and derived media are ignored.
`truth.csv` intentionally leaves `truth_bpm`, chest visibility, lighting,
coverage, and camera blank until independently verified. It records
`label_source=unlabelled`. Never treat blank rates as zero or include them in
accuracy metrics. Manual breath annotations, if added later, must identify the
annotator and method, rather than being described as belt ground truth.

This set supports video loading, ROI work, and qualitative pipeline debugging.
VRWi now provides separate independent reference checks and synthetic clips
provide deterministic failure cases. We do not need new teammate recordings to
develop or run these checks. Real robot-camera compatibility and rescue-scene
coverage remain integration checks that public data cannot establish.

## Public alternatives for the other Eric tasks

- E5 uses pretrained Ultralytics YOLO26 pose weights, tested on a public torso
  frame and a blank image. It does not require collecting a person dataset.
- E8 uses open-source [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
  and its pinned public JFK test fixture, resampled to an 8 s mono WAV, plus
  generated silence. Actual tiny.en speech/silence smoke passed. This verifies
  transcription operation, not recognition of rescuer questions in venue noise.
- E9 has an experimental pretrained CLIP baseline plus label/probe/evaluation
  scripts. Public robotics sources include
  [RELLIS-3D](https://github.com/unmannedlab/RELLIS-3D) and its off-road terrain
  annotations/benchmark implementations, with a CC BY-NC-SA 3.0 license. These
  offer independently annotated imagery instead of new recordings. Their terrain
  ontology does not directly provide all five of our scene/hazard classes
  (especially step and gap), so no automatic mapping, training result, or
  mock-rubble performance is claimed. The operational model stays disabled.

## VRWi attribution details

Takao Obi and Kotaro Funakoshi, *Video-Based Respiratory Waveform Estimation in
Dialogue: A Novel Task and Dataset for Human-Machine Interaction*, ICMI 2023,
[DOI](https://doi.org/10.1145/3577190.3614154).
[Dataset and release](https://github.com/fnkslab/VRWiDataset),
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
Downloaded M14 only; extracted resting-session video and two belt files;
made 20 s H.264 excerpts with audio removed and computed belt-derived reference
rates. Archive hash is recorded in `testdata/public/vrwi.json`. No endorsement
is implied. Media remains ignored instead of being redistributed in Git.

## Attribution

MPSC-RR creators: Zahid Hasan, Masud Ahmed, Shadman Sakib, Snehalraj Chugh,
Md Azim Khan, Abu Zaher MD Faridee, and Nirmalya Roy.
Source: [MPSC-RR](https://huggingface.co/datasets/justchugh/MPSC-RR), revision
`439dddb42f8a95cd4aba6465eb6be3bb3af8a8bf`.
License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Associated work: [RRPIPS, CHASE 2025](https://doi.org/10.1145/3721201.3721366).
Changes to the selected videos: temporal excerpts, frame-rate conversion,
H.264 re-encoding, and audio removal. No endorsement is implied.
