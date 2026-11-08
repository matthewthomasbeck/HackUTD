# Live camera and thermal preview

## Current setup: both physical sensors in one Pi program

Close the old camera viewer and `thermal_stream.py`, then run on the Pi:

```sh
python3 ~/assess-preview/server.py --standalone
```

This starts two independent workers at once: Pico USB thermal and ribbon-camera capture
through `rpicam-vid`, using the same capture pipeline as the existing camera utility.
It requires Python 3 and rpicam-vid on the Pi, with no extra Python dependencies there.
No C++ robot program or control socket is required in standalone mode.

The Pico is discovered through `/dev/pico` or its stable `/dev/serial/by-id/*Pico*` name.
Use `--thermal-device PATH` to select an explicit port. The program sends `STREAM 1`,
parses THM lines, and converts the 32x24 readings to a heatmap. It owns that serial port
exclusively while open. Do not run the robot, thermal_stream.py, or another Pico reader
alongside standalone mode. No worker sends actuator commands.

Capture runs whether or not a viewer is connected. Sensor failures expire the affected
view after two seconds and retry independently. Old frames are overwritten, not queued.
Auto contrast is enabled by default. Use `--thermal-fixed-range --thermal-min-c 20 --thermal-max-c 40` for a fixed display scale and
`--thermal-flip-x` after checking orientation with a warm hand. Display settings do not
change detection thresholds. Camera defaults are 640x480 at 10 fps, configurable with
`--width`, `--height`, and `--fps`. Missing camera software is reported in the terminal.

## API for the website and app

- `GET /camera.jpg`: newest raw ribbon-camera JPEG on Pi port 8081.
- `GET /thermal.png`: newest thermal heatmap on Pi port 8081.
- `GET /vision.jpg`: model-annotated image on laptop port 8082, when `--vision` is enabled.
- `GET /health`: independent camera, thermal, and model freshness flags.

Unavailable frames return 503, and images are never cached. The API is read-only and does
not change SpacetimeDB contracts. Responses include local/source frame age where available.
The default server binds to all interfaces for the demo network; use `--host 127.0.0.1`
for local-only service. This is an unauthenticated LAN/Tailscale preview, not public hosting.
HTTPS websites need an HTTPS proxy for image services. CORS can be restricted with `--origin`.

## Automatic startup on the Pi

After verifying manual capture, stop it with Ctrl+C and install once:

```sh
sh ~/assess-preview/install-service.sh --standalone
```

The installer uses the actual directory and login user, requests sudo for installing the
unit, and enables `assess-preview.service` at boot. It refuses standalone installation if
robot or thermal_stream.py is running. The service restarts crashes and stops its camera
child when stopped. It does not install or start any actuator-driving robot service.

```sh
systemctl status assess-preview
journalctl -u assess-preview -f
curl http://127.0.0.1:8081/health
```

Both `camera` and `thermal` should be true. `vision` is false on the Pi because inference
runs on the laptop. Actual hardware capture must be verified on the Pi; virtual serial and
fake-camera tests exercise concurrency locally but do not establish hardware compatibility.

## Laptop model and UnderDog

One-time laptop setup, from the repository root:

```sh
sh raspberrypi/preview/setup-vision.sh
```

Python 3.11 or newer is required. This creates an isolated .venv with the tested inference
runtime. The model comes from the existing `backend/perception/config.toml` breathing section
via `perception.roi.load_model`, including its configured fallback. The configured model is
`yolo26n-pose.pt`, fallback `yolo11n-pose.pt`. Custom trained weights can be selected in that
configuration. The model's native boxes and keypoints are drawn on each processed frame.
Unavailable model output is never replaced with a raw frame labelled as detections.

From frontend/dashboard, launch the app once with the Pi address:

```sh
npm run app -- --robot-preview-url=http://PI_HOST:8081
```

Replace PI_HOST with the Pi's reachable LAN or Tailscale address. UnderDog saves the address, starts the laptop inference worker automatically on
localhost 8082, restarts it after an exit, and stops it on app quit. Open the existing
Camera view to see model detections and thermal side by side. Later launches need no flags.

For packaged apps, pass `--vision-python=/absolute/path/to/raspberrypi/preview/.venv/bin/python`
once. The bundle includes preview/perception source, not Python or model weights. Weights
are saved in the app's writable preview-data directory. Edit robotPreviewUrl or visionPython
through Server > Open settings file, then restart UnderDog if settings change.

For a website without Electron, start the model worker on the laptop:

```sh
raspberrypi/preview/.venv/bin/python raspberrypi/preview/server.py --camera-url http://PI_HOST:8081/camera.jpg --vision --no-thermal --host 127.0.0.1 --port 8082
```

Configure VITE_ROBOT_PREVIEW_URL to the Pi service and VITE_VISION_PREVIEW_URL to localhost
8082, or pass robotPreview and visionPreview query parameters to the website. A website
cannot start Python itself. The app can keep its worker running for a website viewer too.
Live previews are disabled during replay. The judged Play demo remains scripted.

## Later integration with the C++ robot

Stop standalone preview before letting the robot own the Pico. Reinstall the service with:

```sh
sh ~/assess-preview/install-service.sh --robot-socket /run/robot/control.sock
```

The installer checks the read-only thermal_frame endpoint first. The updated C++ robot
must be running and own the Pico. If its binary lacks this command, rebuild it from this branch, which adds the read-only endpoint. Robot mode reads shared thermal samples and never opens serial.
The preview still owns ribbon-camera capture until C++ capture is implemented; those owners
must then share camera frames instead of competing for camera hardware.

Legacy TCP input from thermal_stream.py remains available with --thermal-host HOST and
--thermal-port 8889. Thermal-only laptop tests use --no-camera. Robot-owned mock thermal
uses the laptop robot's /tmp/robot/control.sock. Tests: python3 -m unittest discover -s
raspberrypi/preview -v. The suite covers fake-camera and virtual-Pico concurrent capture,
PNG rendering, TCP units, stale feeds, and separation of model output from raw camera.

## Thermal display and transfer optimization

The palette uses navy/blue for cooler surfaces, teal for middle temperatures, and
yellow/white for warmer areas. A cached 256-color lookup table reduces rendering work.
The thermal caption shows the scale reported by the server. No detection thresholds change.
ETags skip unchanged image transfers and redundant model-input writes. Matching ETags never
allow stale frames to remain live. Disconnected viewers back off to a four-second retry
interval and return to normal polling after recovery. CORS supports conditional requests.

The thermal endpoint also reports measured minimum, median background, peak temperature,
and peak pixel position in X-Thermal-Stats. The UI marks the hottest pixel and labels it
as not a confirmed person. This diagnostic is separate from the C++ warm-shape tracker
and cannot select or command a movement target.

## Automatic thermal contrast

Auto contrast maps the frame's 2nd to 98th percentile temperatures with padding and a
minimum 4 C display span. A smoothed range reduces flicker; clipped hotspots still retain
their true measured temperatures in the diagnostics. The caption explicitly labels Auto
and shows the current low/high range. Colors can change as the scene changes; use measured
temperatures to compare frames. This changes display contrast only, never detection thresholds.
Use --thermal-fixed-range for stable cross-frame colors.
