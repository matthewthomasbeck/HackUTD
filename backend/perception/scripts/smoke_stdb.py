"""SpacetimeDB smoke test for the perception service (perception.md section 8.6).

Run as soon as the module is published:
    cd backend/perception && source .venv/bin/activate
    python scripts/smoke_stdb.py                 # uses .env (STDB_URI, STDB_DATABASE, STDB_TOKEN)
    python scripts/smoke_stdb.py --survivor 3    # pick the survivor to write to
    python scripts/smoke_stdb.py --save-fixture  # also save the raw SQL JSON to tests/fixtures/

Steps:
1. Create or load the identity (data/identity.json), register as perception.
2. Print the raw JSON of SELECT * FROM survivor and SELECT * FROM detection (first row each),
   so the SQL row decoder can be checked against the real module.
3. Call report_breathing (unknown, none, 0.1, none, none) and set_critical_score
   (immediate, 75, 0.1, ["smoke test", "needs human triage"]) on a survivor.
4. Read the survivor back and check the fields changed.
5. If stdb-helper is built, start it and check the survivor update arrives as one JSON line within 2 s.
"""

from __future__ import annotations

import argparse
import json
import queue
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from perception.config import BASE_DIR, load_config  # noqa: E402
from perception.stdb import StdbClient, StdbError, decode_sql_response, encode_enum, encode_option  # noqa: E402


def first_row_raw(raw) -> dict:
    stmt = raw[0] if isinstance(raw, list) and raw else {}
    return {"schema": stmt.get("schema"), "first_row": (stmt.get("rows") or [None])[0]}


def check_helper(cfg: dict, token: str, survivor_id: int, trigger) -> bool:
    script = BASE_DIR / cfg["stdb"]["helper_script"]
    node = shutil.which("node")
    if node is None or not script.is_file():
        print(f"5. skipped: helper not built ({script}) or node missing")
        return True
    env = {"STDB_URI": cfg["stdb"]["uri"], "STDB_DATABASE": cfg["stdb"]["database"], "STDB_TOKEN": token,
           "PATH": str(Path(node).parent)}
    proc = subprocess.Popen([node, str(script)], cwd=str(BASE_DIR), env=env, stdout=subprocess.PIPE, text=True)
    lines: queue.Queue = queue.Queue()
    threading.Thread(target=lambda: [lines.put(line) for line in proc.stdout], daemon=True).start()
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:  # wait for the subscription to apply
            try:
                event = json.loads(lines.get(timeout=1))
            except queue.Empty:
                continue
            if event.get("status") == "connected":
                break
        else:
            print("5. FAIL: helper never printed {\"status\":\"connected\"}")
            return False
        trigger()
        start = time.monotonic()
        while time.monotonic() - start < 2.0:
            try:
                event = json.loads(lines.get(timeout=0.1))
            except queue.Empty:
                continue
            if event.get("table") == "survivor" and event.get("op") == "update" \
                    and int(event["row"].get("id", 0)) == survivor_id:
                print(f"5. ok: helper printed the survivor update in {time.monotonic() - start:.2f} s")
                print("   ", json.dumps(event)[:300])
                return True
        print("5. FAIL: no survivor update line from the helper within 2 s")
        return False
    finally:
        proc.terminate()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--survivor", type=int, default=None, help="survivor id to write to (default: first row)")
    ap.add_argument("--save-fixture", action="store_true", help="save the raw SQL output to tests/fixtures/")
    args = ap.parse_args()

    cfg = load_config()
    stdb = StdbClient.from_config(cfg)
    print(f"server {cfg['stdb']['uri']} database {cfg['stdb']['database']}")

    token = stdb.ensure_identity()
    print(f"1. identity {stdb.identity or '(from STDB_TOKEN)'}")
    try:
        stdb.register_participant(cfg["stdb"].get("participant_name", "perception"), "perception")
        print("   registered as perception")
    except StdbError as exc:
        print(f"   register_participant FAILED: {exc}. Outside demo mode a coordinator must grant_role "
              f"this identity the perception role.")
        return 1

    raw_surv = stdb.sql_raw("SELECT * FROM survivor")
    raw_det = stdb.sql_raw("SELECT * FROM detection")
    print("2. raw survivor:", json.dumps(first_row_raw(raw_surv))[:2000])
    print("   raw detection:", json.dumps(first_row_raw(raw_det))[:2000])
    if args.save_fixture:
        out = BASE_DIR / "tests" / "fixtures" / "sql_sample_captured.json"
        out.write_text(json.dumps({"_note": f"captured by smoke_stdb.py from {cfg['stdb']['uri']}",
                                   "survivor": raw_surv, "detection": raw_det}, indent=1))
        print(f"   saved {out}")

    survivors = decode_sql_response(raw_surv)[0]
    if not survivors:
        print("3. no survivor rows; create one with the simulator and run again")
        return 1
    sid = args.survivor or int(survivors[0]["id"])
    print(f"   decoded survivor {sid}:", {k: survivors[0].get(k) for k in ("breathing", "critical_level", "status",
                                                                         "created_at")})

    stdb.call("report_breathing", [sid, encode_enum("unknown"), encode_option(None), 0.1,
                                   encode_option(None), encode_option(None)])
    stdb.call("set_critical_score", [sid, encode_enum("immediate"), 75.0, 0.1, ["smoke test", "needs human triage"]])
    print(f"3. report_breathing and set_critical_score sent for survivor {sid}")

    (row,) = stdb.sql(f"SELECT * FROM survivor WHERE id = {sid}")
    checks = {
        "breathing": row.get("breathing") == "unknown",
        "breathing_confidence": abs(float(row.get("breathing_confidence") or 0) - 0.1) < 1e-9,
        "critical_level": row.get("critical_level") == "immediate",
        "critical_score": abs(float(row.get("critical_score") or 0) - 75.0) < 1e-9,
        "score_reasons": row.get("score_reasons") == ["smoke test", "needs human triage"],
    }
    print("4. read back:", "ok" if all(checks.values()) else f"FAIL {checks}")

    def trigger():
        stdb.call("set_critical_score", [sid, encode_enum("immediate"), 76.0, 0.1,
                                         ["smoke test", "needs human triage"]])

    helper_ok = check_helper(cfg, token, sid, trigger)
    return 0 if all(checks.values()) and helper_ok else 1


if __name__ == "__main__":
    sys.exit(main())
