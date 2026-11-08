"""Live perception-role integration check. This intentionally writes one survivor.

Run after the team module is published and a coordinator grants this identity:
python scripts/smoke_stdb.py --survivor-id 1
No credentials are printed. The script cannot validate unavailable bindings.
"""
import argparse
import json
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from perception.config import load_config
from perception.stdb import SpacetimeDB,encode_enum,encode_option


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--survivor-id",type=int,required=True)
    args = parser.parse_args()
    if args.survivor_id <= 0:
        parser.error("survivor id must be positive")
    db = SpacetimeDB(load_config())
    if not db.configured:
        raise SystemExit("Set STDB_URI and STDB_DATABASE in the perception .env first")
    db.initialize()
    survivors = db.rows("survivor")
    if not any(row["id"] == args.survivor_id for row in survivors):
        raise SystemExit("Create the requested survivor with the simulator first")
    db.call("report_breathing",[args.survivor_id,encode_enum("unknown"),encode_option(None),0.1,encode_option(None),encode_option(None)])
    db.call("set_critical_score",[args.survivor_id,encode_enum("immediate"),75,0.1,["smoke test","needs human triage"]])
    row = next(row for row in db.rows("survivor") if row["id"] == args.survivor_id)
    assert row["breathing"] == "unknown"
    assert row["critical_level"] == "immediate" and row["critical_score"] == 75
    folder = ROOT / "data" / "stdb-smoke"
    folder.mkdir(parents=True,exist_ok=True)
    (folder/"survivor.json").write_text(json.dumps(row,indent=2)+"\n")
    print("PASS: registered, wrote breathing then critical score, read both back")


if __name__ == "__main__":
    main()
