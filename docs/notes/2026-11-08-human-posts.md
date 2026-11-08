# Posts for Eric to send, 2026-11-08

Prepared on `codex/a2-quality-gate-audit`. Both drafts are unsent. E0 and R1 step 9
remain open until a person posts them; preparing this file does not close either task.

## E0: team chat

Brev validation results (recorded 2026-11-08): Super VL NVFP4 on RTX PRO 6000
and Lightning BF16 on A100 both passed native tool calls, tool-result round trips,
reasoning-off and strict JSON actions. With reasoning off, observed native
call latency was 1.56 s / 1.12 s (Super / Lightning); JSON was 1.02 s / 0.58 s.
Native mode is the configured choice, with strict JSON as a tested alternative.

Three consecutive native chains and three JSON chains passed. Priority ordering,
a seeded auditor disagreement and watchdog recovery also passed; fallback
proposed at 11 s in that watchdog scenario. These were real models against a
fake database. Some ordinary auditor reviews used the rules fallback after the
guard rejected the model reply. A later native chain failed before a diagnostic
rerun passed, so reliability remains open under B1. Later local real-database
checks used mock models and do not establish real-model live integration.

Current deployment note from the handoff: the Super instance was deleted to
save credits; Lightning can be restarted, including its container. The G8
callsign change has not been checked on Super. The judged demo scripts the
robot, breathing, scores and rescuer actions; only SpacetimeDB runs live.

Evidence: https://github.com/matthewthomasbeck/HackUTD/blob/main/docs/notes/2026-11-08-brev-validation.md
Current limits and next checks: https://github.com/matthewthomasbeck/HackUTD/blob/main/docs/tasks/eric-remaining.md

## R1: comment on PR #11

Destination: https://github.com/matthewthomasbeck/HackUTD/pull/11
Copy the text below, including the captured log. After posting, mark R1 step 9
complete in `docs/tasks/camille.md` and record the comment URL in the handoff.

R1 step 9: posting the captured scripted mock lifecycle log to complete the
remaining PR evidence requirement. This is the run recorded on
`eric-cv-benchmark` on 2026-11-08, not a fresh hardware run.

The robot built and all 88 CTest tests passed in that run. The actual executable
passed READY -> ACTIVE (hold) -> latched SAFE_STOP, rejected a restart, reset
through FAULT/INIT to READY, and shut down on SIGINT with exit 0. Every sampled
status reported all devices mocked and zero outgoing motion. Only temporary
socket/log paths in an isolated copy of `robot.laptop.yaml` changed.

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

The internal `sigterm` event handles SIGINT and SIGTERM; this script sent SIGINT.
Reproduce from `raspberrypi/robot/` with `cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo`,
`cmake --build build -j`, `ctest --test-dir build --output-on-failure`, and
`python3 tools/check_mock_lifecycle.py`.

Evidence: https://github.com/matthewthomasbeck/HackUTD/blob/main/docs/notes/2026-11-08-r1-scripted-mock-check.md
This closes R1's remaining local mock/PR evidence step. It does not validate
physical e-stop wiring, actuators, live Pi capture or SpacetimeDB integration.
