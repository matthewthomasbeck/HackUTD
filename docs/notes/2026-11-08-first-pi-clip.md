# First Pi camera clip over SSH (2026-11-08)

Eric's task "First Pi camera clip over SSH" from `docs/tasks/eric-remaining.md`.
This is a capture and pipeline check only, not a breathing accuracy result.

## Setup

- Pi: host `raspberrypi`, Debian 12 (Bookworm), aarch64, reached over Tailscale with an SSH key (`~/.ssh/id_ed25519_assess_pi` on Eric's laptop).
- Camera: `rpicam-hello --list-cameras` reports one ov5647 (modes 640x480, 1296x972, 1920x1080, 2592x1944, all 30 fps).
- Matthew's live stream (`rpicam-vid -t 0 --width 640 --height 480 --framerate 30 --inline --listen -o tcp://0.0.0.0:8888`) held the camera.
  With Eric's approval it was stopped for about 30 s and restarted with the same command under `nohup`, so it no longer belongs to Matthew's terminal.

## Capture

1. `rpicam-still` on auto read the room settings: exposure 59971 us, analogue gain 4.375, colour gains 1.236 and 1.622, about 56 lux.
2. `rpicam-vid -n -t 20000 --width 640 --height 480 --framerate 30 --shutter 59971 --gain 4.375 --awbgains 1.236,1.622 --codec libav -o pi_clip_<time>.mp4`
3. The clip and capture files are on the Pi in `~/assess_clips/` and on Eric's laptop in `backend/perception/data/real-pi/` (git-ignored; the frame shows teammates' faces).

`ffprobe`: 640x480, 685 frames in 19.92 s, so the container rate is 34.4 fps, not 30.
The auto shutter (60 ms) is longer than one frame at 30 fps (33 ms), so the camera probably shortened it; the recorded exposure was not checked frame by frame.
Next capture: lock the shutter at 33000 us or less, raise the gain to match, and save `--metadata` to confirm the locked values.

## Pipeline result

`scripts/analyze_clip.py data/real-pi/pi_clip_20261108-045713.mp4 --score` read the clip and ran YOLO pose.
The scene was the room, not a staged subject: the person found sat far from the camera behind a desk.
Result: `unknown`, confidence 0.0, reason "chest region too small", about 41% of body visible.
The score was IMMEDIATE 67.6 with confidence 0.3 and "needs human triage", as the confidence caps require.
The pose chest box landed on the far person's chest (`data/real-pi/analysis/roi.jpg`).

So the Pi camera produces clips the pipeline reads and abstains on correctly.

## Second clip: close, seated subject

`pi_clip_20261108-050553.mp4`, recorded 05:05:53 to 05:06:14 on the Pi clock, with the stream stopped for about 35 s and restarted.
A teammate sat about 1 m away, facing the camera; a second person sat down at the right partway through.
Lock: shutter 33000 us, gain 9.675 (the auto exposure and gain scaled to a 33 ms shutter), colour gains 1.242 and 1.607.
The `--metadata` file came out empty with `--codec libav`, so the locked values are still not confirmed frame by frame.

`ffprobe`: 686 frames, timestamps spread evenly over 19.91 s, so 34.4 fps again.
The whole recording took 20.9 s of wall clock including camera start-up, so the frames cannot have come at 30 fps (686 frames would need 22.9 s); 34.4 fps looks real, even though the camera lists its 640x480 mode as 30 fps.

| Run | ROI | Result | Rate | Confidence |
|---|---|---|---|---|
| Container rate (34.4 fps) | pose, on chest (`analysis2/roi.jpg`) | detected | 7.2/min | 0.35 |
| `--fps 30` (wrong rate, check only) | pose | detected | 12.6/min | 0.63 |

The two runs differ by more than the frame-rate ratio, so the rate depends on the clip's frame timing; the 34.4 fps run is the one to trust.
Score: IMMEDIATE 52.0, confidence 0.17, "breathing 7/min, under 10" and "needs human triage".
Truth: the subject was breathing normally; breaths were not counted.
So "detected" is correct, but the 7.2/min rate is unchecked, and the score's "under 10" reason rests on it.
