# R1 step 9: scripted laptop mock check

Date: 2026-11-08. Branch: `eric-cv-benchmark`.

The existing C++ robot built successfully and all 88 CTest tests passed. The scripted
mock lifecycle check passed using an isolated temporary copy of
`raspberrypi/robot/config/robot.laptop.yaml`. Only `/tmp/robot` paths in that copy
were changed to a private temporary directory. The repository configuration,
hardware details and motion implementation were unchanged.

## Reproduce

From `raspberrypi/robot/`:

```sh
cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build -j
ctest --test-dir build --output-on-failure
python3 tools/check_mock_lifecycle.py
```

The script uses only Python's standard library and the existing `robot` and
`robotctl` binaries. It waits for READY, starts a hold, requests e-stop, checks
SAFE_STOP with the latch set, tries another start, resets, waits for READY again,
then sends SIGINT and checks exit code 0. Each sampled status must report every
device mocked and zero outgoing motion. The script also checks the process log
for startup, reset/re-init and shutdown transitions and the rejected restart.
It cleans up only its own process and temporary files.

## Captured evidence

Build reported all hardware backends OFF on this laptop: libcamera, OpenCV,
Coral, systemd and pigpio. CTest reported:

```text
100% tests passed out of 88
Total Test time (real) = 1.17 sec
```

Status samples, in order (fields omitted here only to keep the note readable):

```text
READY     latched=false mission=null motion={vx_mps:0, vy_mps:0, wz_dps:0}
ACTIVE    latched=false mission=hold motion={vx_mps:0, vy_mps:0, wz_dps:0}
SAFE_STOP latched=true  mission=null motion={vx_mps:0, vy_mps:0, wz_dps:0}
SAFE_STOP latched=true  mission=null motion={vx_mps:0, vy_mps:0, wz_dps:0}
READY     latched=false mission=null motion={vx_mps:0, vy_mps:0, wz_dps:0}
```

Actual process log excerpt; timestamps are copied as emitted by the robot:

```text
04:05:13.306 [I] BOOT -> INIT: config valid
04:05:13.331 [I] INIT -> READY: all required devices OK
04:05:13.390 [I] READY -> ACTIVE: start mission 0 (hold)
04:05:13.426 [I] ACTIVE -> SAFE_STOP: e-stop (latched until a human resets it)
04:05:13.426 [W] mission 0 failed: safe stop: estop
04:05:13.468 [W] mission 0 rejected: robot not ready: SAFE_STOP
04:05:13.511 [I] SAFE_STOP -> FAULT: reset by operator
04:05:13.529 [I] FAULT -> INIT: retry 1 of 3
04:05:13.549 [I] INIT -> READY: all required devices OK
04:05:13.607 [I] READY -> SAFE_STOP: sigterm: stopping motion before shutdown
04:05:13.626 [I] SAFE_STOP -> SHUTDOWN: motion stopped
04:05:13.627 [I] thread movement stopped
04:05:13.640 [I] thread vision stopped
04:05:13.642 [I] thread camera-mock stopped
04:05:13.642 [I] SHUTDOWN
PASS: all devices mocked; hold, latched e-stop, rejected restart, reset and SIGINT exit 0
```

The robot uses the internal `sigterm` event for both SIGINT and SIGTERM; the script
sent SIGINT. Shutdown passed through SAFE_STOP before SHUTDOWN, as the state
machine requires. The initial script expected a direct READY to SHUTDOWN log;
that assertion was corrected to match the documented stop-before-shutdown behavior.

This checks the actual executable's local control path with mock devices. It does
not validate physical e-stop wiring, actuators, live Pi capture or SpacetimeDB
integration. The evidence is ready to paste into a PR, but no PR comment was
posted from this run. R1 step 9's PR-paste requirement remains open until that is done.
