# A7: primary local transcription evaluation

Date: 2026-11-08. Branch: `eric-cv-benchmark`.

This runs the primary `perception.stt.transcribe()` path, not the separate reference
implementation. It does not alter the application, thresholds, model selection or
Claude's CV benchmark and Pi capture work. The judged demo remains scripted.

## Reproduce

From `backend/perception/`:

```bash
.venv/bin/python scripts/evaluate_stt.py
.venv/bin/python -m pytest -q tests/test_stt.py
```

The script requires cached `small.en` weights by default. `--allow-model-download`
permits a first download; `--model` selects another size, which requires a separate
evaluation. Raw/public and generated audio stays in ignored `data/stt-evaluation/`.
The compact result is `testdata/voice/stt-evaluation.json`, with every transcript,
confidence, timing, fixture checksum and software version.

Public input is the first eight seconds of the
[faster-whisper JFK fixture](https://github.com/SYSTRAN/faster-whisper/blob/846467d436117e44d54ad74f555d85c75834edb0/tests/data/jfk.flac),
pinned to revision `846467d436117e44d54ad74f555d85c75834edb0` and SHA256
`63a4b1e4c1dc655ac70961ffbf518acd249df237e5a0152faae9a4a836949715`.
The upstream repository has an
[MIT license](https://github.com/SYSTRAN/faster-whisper/blob/846467d436117e44d54ad74f555d85c75834edb0/LICENSE);
the recording is an excerpt of JFK's US federal government inaugural address.
The three existing question WAVs have no recording provenance or independently
verified transcript in this checkout, so their filenames are not accuracy labels.
No new teammate recording or hosted transcription was used.

## Configuration and method

Apple M4 Pro, macOS arm64, Python 3.12.12, faster-whisper 1.2.1,
CTranslate2 4.8.5. Model: `small.en`, CPU/int8, beam size 5, English,
VAD enabled, previous-text conditioning disabled, `no_speech_max=0.6`.
Cached model files total 486,098,798 bytes (about 464 MiB), snapshot
`d1d751a5f8271d482d14ca55d9e2deeebbae577f`.
Model initialization plus the service's silence probe took 0.633 s with cached
weights and a warm filesystem. It is not a cold-start/download measurement.

Six inputs, each in three conditions, were transcribed three times, for 54 calls:

- The three question WAV fixtures and eight-second public speech clip: clean,
  additive Gaussian noise at 20 dB SNR, and at 0 dB SNR.
- Two-second fixture silence and generated eight-second silence: clean, noise
  RMS 0.01, and noise RMS 0.1 in float audio units. Silence has no defined SNR.

Noise has a fixed seed and exact RMS before PCM quantization. A common gain
prevents clipping while preserving speech-to-noise ratio. Timings include file
loading and resampling, exclude initialization/download, and were collected while
other agents were testing on the same laptop. They are observations, not latency
guarantees. Every condition produced identical transcripts across its three repeats.

## Measured results

Each timing is the median of three calls in seconds.

| Input | Duration | Clean | 20 dB noise | 0 dB noise | Observation |
| --- | ---: | ---: | ---: | ---: | --- |
| `is_anyone_else_in_house_3.wav` | 1.40 s | 0.958 | 0.889 | 0.899 | Clean/20 dB says house 3; 0 dB says `house food`, confidence 0.41 |
| `how_many_still_unaccounted.wav` | 2.07 s | 0.931 | 0.950 | 0.965 | Same transcript in all conditions; confidence 0.79/0.79/0.74 |
| `which_survivor_is_most_critical.wav` | 1.83 s | 0.946 | 0.902 | 0.917 | 0 dB changes singular survivor to plural; confidence 0.70/0.70/0.56 |
| Public speech, first 8 s | 8.00 s | 1.071 | 1.051 | 1.062 | 0 word errors after case/punctuation normalization in this one excerpt; confidence 0.82/0.77/0.73 |

All 18 silence/noise-only calls returned empty text and confidence 0.0.
Two-second silence medians were 0.0037 to 0.0038 s; eight-second silence medians
were 0.0127 s. The slowest speech call was 1.173 s in the final measured run.

`tests/test_stt.py`: **17 passed in 3.25 s**. The script also compiles with
`py_compile`, and its downloaded/generated audio is confirmed git-ignored.

## Limits and decision

Keep `small.en` as the tested local fallback. The three-second target was met by
the eight-second public fixture here, but no other model size was measured and
this does not establish venue latency or accuracy. At 0 dB, noise RMS equals
speech RMS and the house number is corrupted. Do not treat low-quality transcripts
or their confidence as verified locations; the existing transcript display and
coordinator clarification remain necessary. No thresholds were tuned on these clips.

This small smoke evaluation does not establish general ASR accuracy. Gaussian
noise does not model crowd speech, echo, a mask, microphone placement or robot
noise. Question fixture reference transcripts remain unverified; their model
outputs are observations only. The model's confidence is not calibrated accuracy.
Hosted Riva, actual G2 microphone capture, database question posting, model answers
and the complete glasses voice round trip remain separate acceptance work.
