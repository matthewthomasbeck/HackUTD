#!/usr/bin/env python3
"""Laptop lifecycle check for the drone program, every device mocked (the dog's R1 check, plus an
MCU heartbeat loss). READY is the idle state; there is no separate IDLE state, as on the dog."""

import json
from pathlib import Path
import signal
import subprocess
import tempfile
import time


def main():
    root = Path(__file__).resolve().parents[1]
    drone = root / "build/drone"
    dronectl = root / "build/dronectl"
    if not drone.is_file() or not dronectl.is_file():
        raise SystemExit("Build drone and dronectl first: cmake -B build && cmake --build build -j")

    # Short /tmp paths also fit macOS's Unix socket path limit. Do not touch a running
    # drone program's sockets; only this temporary copy gets different paths.
    with tempfile.TemporaryDirectory(prefix="d1-", dir="/tmp") as work:
        folder = Path(work)
        config = folder / "drone.yaml"
        config.write_text((root / "config/drone.laptop.yaml").read_text()
                          .replace("/tmp/drone/", work + "/")
                          .replace("/tmp/drone-bridge.sock", work + "/bridge.sock"))
        socket = str(folder / "control.sock")
        log_path = folder / "drone.log"
        with log_path.open("w") as log:
            proc = subprocess.Popen([str(drone), "--config", str(config)], cwd=root,
                                    stdout=log, stderr=log)
            try:
                def command(*words, check=True):
                    result = subprocess.run([str(dronectl), "--socket", socket, *words],
                                            capture_output=True, text=True, timeout=3, check=check)
                    return json.loads(result.stdout)

                def wait_state(state, latched=False):
                    deadline = time.monotonic() + 5
                    last = None
                    while time.monotonic() < deadline:
                        if proc.poll() is not None:
                            raise RuntimeError(f"drone exited early with {proc.returncode}")
                        if Path(socket).exists():
                            last = command("status")
                            if last["state"] == state and last["latched"] == latched:
                                assert all(d["mock"] for d in last["devices"]), last
                                assert all(v == 0 for v in last["motion"].values()), last
                                print(json.dumps({k: last[k] for k in
                                                  ("state", "latched", "mission", "health", "last_transition")}))
                                return last
                        time.sleep(0.05)
                    raise RuntimeError(f"wanted {state}, latched={latched}; last status: {last}")

                wait_state("READY")
                command("start", "hold")
                wait_state("ACTIVE")
                # MCU heartbeat loss: ACTIVE -> SAFE_STOP -> FAULT -> INIT -> READY, starts rejected.
                command("mock", "mcu_link", "lost")
                wait_state("READY")
                command("start", "hold")
                time.sleep(0.3)
                status = wait_state("READY")
                assert not status["health"]["ok"] and "MCU heartbeat" in status["health"]["reason"], status
                command("mock", "mcu_link", "ok")
                time.sleep(0.1)
                command("start", "hold")
                wait_state("ACTIVE")
                command("estop")
                wait_state("SAFE_STOP", latched=True)
                # A start must not release the latch. Check the state again afterward.
                command("start", "hold")
                wait_state("SAFE_STOP", latched=True)
                command("reset")
                wait_state("READY")
                proc.send_signal(signal.SIGINT)
                assert proc.wait(timeout=5) == 0, proc.returncode
            finally:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
        contents = log_path.read_text()
        for transition in ("BOOT -> INIT", "INIT -> READY", "READY -> ACTIVE", "ACTIVE -> SAFE_STOP: mcu_link_lost",
                           "SAFE_STOP -> FAULT", "FAULT -> INIT", "start rejected: MCU heartbeat",
                           "ACTIVE -> SAFE_STOP: e-stop", "SAFE_STOP -> FAULT: reset by operator",
                           "READY -> SAFE_STOP", "SAFE_STOP -> SHUTDOWN"):
            assert transition in contents, f"missing {transition}:\n{contents}"
        assert "rejected: drone not ready: SAFE_STOP" in contents
        print("--- drone state log ---")
        print(contents, end="" if contents.endswith("\n") else "\n")
        print("PASS: all devices mocked; hold, MCU heartbeat loss, latched e-stop, rejected restart, "
              "reset and SIGINT exit 0")


if __name__ == "__main__":
    main()
