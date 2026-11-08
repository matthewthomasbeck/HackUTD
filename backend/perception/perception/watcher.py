"""Detection watcher and re-score timer (perception.md sections 3, 7, 8.1).

Rows come from the Node helper (stdb-helper/, one NDJSON line per row event) when it is up,
and from HTTP SQL polling every poll_interval_s (2 s) when it is not.

For each detection:
- survivor_id = 0: skipped and logged once ("detection <id> has no survivor").
- breathing_clip_url set and not analyzed yet: queued on the worker (a clip already queued
  through POST /breathing with the same clip_url is not queued twice).
- camera_image_url set: a person check is queued on the same worker thread.

Re-score timer, every rescore_interval_s (60 s): every survivor in unassigned, assigned, or
en_route is scored, including survivors with no clip yet; set_critical_score is called only when
perception.score.should_write() says the change is meaningful (or the survivor was never scored).
A new survivor is scored at once. The last written values live in SQLite (score_writes).

Filtering happens in Python, not SQL: SQL cannot filter on enum or option columns.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time

from .config import BASE_DIR
from .stdb import StdbRejected, StdbUnavailable
from .worker import WAITING_STATUSES, compute_survivor_score, load_optional, score_call

log = logging.getLogger(__name__)


class RowCache:
    """Latest detection and survivor rows, plus the cached active run id."""

    def __init__(self, stdb, cfg: dict):
        self.stdb = stdb
        self.cfg = cfg
        self.detections: dict[int, dict] = {}
        self.survivors: dict[int, dict] = {}
        self.loaded = False
        self._lock = threading.RLock()
        self._run: tuple[int, float] = (0, 0.0)

    def apply(self, table: str, op: str, row: dict) -> None:
        with self._lock:
            target = {"detection": self.detections, "survivor": self.survivors}.get(table)
            if target is None or "id" not in row:
                return
            if op == "delete":
                target.pop(int(row["id"]), None)
            else:
                target[int(row["id"])] = row

    def refresh(self) -> tuple[list[dict], list[dict]]:
        """Poll both tables over HTTP SQL. Returns (new detections, new survivors).
        On the first load every row counts as new for detections (they may need analysis),
        but not for survivors (the re-score timer handles those)."""
        dets = self.stdb.sql("SELECT * FROM detection")
        survs = self.stdb.sql("SELECT * FROM survivor")
        with self._lock:
            first = not self.loaded
            new_dets = [d for d in dets if int(d["id"]) not in self.detections]
            new_survs = [] if first else [s for s in survs if int(s["id"]) not in self.survivors]
            self.detections = {int(d["id"]): d for d in dets}
            self.survivors = {int(s["id"]): s for s in survs}
            self.loaded = True
        return new_dets, new_survs

    def get_survivor(self, survivor_id: int) -> dict | None:
        """From the cache, else SQL (u64 filters work in SpacetimeDB SQL). Raises if unreachable."""
        with self._lock:
            row = self.survivors.get(int(survivor_id))
        if row is not None:
            return row
        rows = self.stdb.sql(f"SELECT * FROM survivor WHERE id = {int(survivor_id)}")
        if rows:
            self.apply("survivor", "insert", rows[0])
            return rows[0]
        return None

    def detections_for(self, survivor_id: int) -> list[dict]:
        with self._lock:
            found = [d for d in self.detections.values() if int(d.get("survivor_id") or 0) == int(survivor_id)]
        if found or self.loaded:
            return found
        try:
            return self.stdb.sql(f"SELECT * FROM detection WHERE survivor_id = {int(survivor_id)}")
        except Exception:  # noqa: BLE001
            return []

    def thermal_conf_for(self, survivor_id: int) -> float | None:
        """thermal_confidence of the latest linked thermal or camera detection; None if none."""
        dets = [d for d in self.detections_for(survivor_id) if d.get("source") in ("thermal", "camera", None)]
        if not dets:
            return None
        latest = max(dets, key=lambda d: int(d["id"]))
        value = latest.get("thermal_confidence")
        return float(value) if value is not None else None

    def survivor_rows(self) -> list[dict]:
        with self._lock:
            return list(self.survivors.values())

    def active_run_id(self) -> int:
        """The run row whose ended_at is none, cached run_cache_s (10 s); 0 if none or unreachable."""
        ttl = float(self.cfg["stdb"].get("run_cache_s", 10))
        run_id, at = self._run
        if time.monotonic() - at < ttl and at > 0:
            return run_id
        try:
            rows = self.stdb.sql("SELECT * FROM run")
            active = [int(r["id"]) for r in rows if r.get("ended_at") is None]
            run_id = max(active) if active else 0
        except Exception as exc:  # noqa: BLE001
            log.debug("run lookup failed: %s", exc)
            run_id = 0
        self._run = (run_id, time.monotonic())
        return run_id


class Watcher:
    def __init__(self, cfg: dict, store, stdb, worker, rows: RowCache):
        self.cfg = cfg
        self.store = store
        self.stdb = stdb
        self.worker = worker
        self.rows = rows
        self.helper_up = False
        self._proc: subprocess.Popen | None = None
        self._stop = threading.Event()
        self._warned_no_survivor: set[int] = set()
        self._person_queued: set[int] = set()
        self._lock = threading.Lock()
        self._threads: list[threading.Thread] = []

    # lifecycle
    def start(self) -> None:
        targets = [(self._poll_loop, "perception-poll"), (self._rescore_loop, "perception-rescore")]
        if self.cfg["stdb"].get("helper_enabled", True):
            targets.append((self._helper_loop, "perception-helper"))
        for target, name in targets:
            t = threading.Thread(target=target, name=name, daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()
        proc = self._proc
        if proc and proc.poll() is None:
            proc.terminate()

    # detection handling
    def handle_detection(self, row: dict) -> None:
        did = int(row["id"])
        sid = int(row.get("survivor_id") or 0)
        if sid == 0:
            if did not in self._warned_no_survivor:
                self._warned_no_survivor.add(did)
                log.info("detection %s has no survivor", did)
            return
        clip = row.get("breathing_clip_url") or None
        if clip and not self.store.detection_analyzed(did):
            existing = self.store.job_for_clip_url(clip)
            if existing is not None:
                self.store.mark_detection_analyzed(did, clip, existing["job_id"])
            else:
                job = self.worker.submit_breathing(survivor_id=sid, clip_url=clip, detection_id=did,
                                                   robot_id=row.get("robot_id"))
                self.store.mark_detection_analyzed(did, clip, job["job_id"])
                log.info("queued clip of detection %s for survivor %s (job %s)", did, sid, job["job_id"])
        still = row.get("camera_image_url") or None
        if still:
            with self._lock:
                if did in self._person_queued or self.store.get_person_check(did) is not None:
                    return
                self._person_queued.add(did)
            self.worker.enqueue_person(did, still, row.get("robot_id"))

    def handle_event(self, event: dict) -> None:
        """One NDJSON line from the helper."""
        if "status" in event:
            # the helper prints {"status":"connected"} once its subscription has applied,
            # so every existing row has arrived before new survivors count as new
            self.helper_up = event["status"] == "connected"
            if self.helper_up:
                self.rows.loaded = True
            return
        table, op, row = event.get("table"), event.get("op"), event.get("row") or {}
        if table not in ("detection", "survivor"):
            return
        is_new_survivor = table == "survivor" and op == "insert" and int(row.get("id", 0)) not in self.rows.survivors
        self.rows.apply(table, op, row)
        if table == "detection" and op == "insert":
            self.handle_detection(row)
        elif is_new_survivor and self.rows.loaded:
            self.rescore_one(row)

    def poll_once(self) -> None:
        new_dets, new_survs = self.rows.refresh()
        for d in sorted(new_dets, key=lambda r: int(r["id"])):
            self.handle_detection(d)
        for s in new_survs:
            self.rescore_one(s)

    def _poll_loop(self) -> None:
        interval = float(self.cfg["stdb"].get("poll_interval_s", 2))
        while not self._stop.is_set():
            if not self.helper_up:
                try:
                    self.poll_once()
                except (StdbUnavailable, StdbRejected) as exc:
                    log.debug("detection poll failed: %s", exc)
                except Exception:  # noqa: BLE001
                    log.exception("detection poll failed")
            self._stop.wait(interval)

    # re-score
    def rescore_one(self, survivor: dict) -> bool:
        """Score one survivor and write only on a meaningful change. True if written."""
        if survivor.get("status") not in WAITING_STATUSES:
            return False
        score_mod = load_optional("perception.score")
        if score_mod is None:
            return False
        sid = int(survivor["id"])
        new = compute_survivor_score(self.cfg, self.store, self.rows, sid, survivor, score_mod)
        if new is None:
            return False
        prev = self.store.get_score_write(sid)
        if not score_mod.should_write(prev, new, cfg=self.cfg["score"]):
            return False
        with self.worker.write_lock:
            if self.store.pending_writes():
                return False  # keep the order; the pending retry will catch up first
            try:
                reducer, args = score_call(sid, new)
                self.stdb.call(reducer, args)
            except (StdbRejected, StdbUnavailable) as exc:
                log.warning("re-score of survivor %s not written: %s", sid, exc)
                return False
            self.store.set_score_write(sid, level=new["level"], score=new["score"],
                                       confidence=new["confidence"], reasons=list(new["reasons"]))
        return True

    def rescore_all(self) -> int:
        written = 0
        for row in self.rows.survivor_rows():
            try:
                written += 1 if self.rescore_one(row) else 0
            except Exception:  # noqa: BLE001
                log.exception("re-score of survivor %s failed", row.get("id"))
        return written

    def _rescore_loop(self) -> None:
        interval = float(self.cfg["score"].get("rescore_interval_s", 60))
        # first pass soon after start, once rows have loaded
        self._stop.wait(min(5.0, interval))
        while not self._stop.is_set():
            self.rescore_all()
            self._stop.wait(interval)

    # Node helper
    def _helper_cmd(self) -> list[str] | None:
        script = BASE_DIR / self.cfg["stdb"].get("helper_script", "stdb-helper/dist/index.js")
        node = shutil.which("node")
        if node is None or not script.is_file():
            return None
        return [node, str(script)]

    def _helper_loop(self) -> None:
        cmd = self._helper_cmd()
        if cmd is None:
            log.info("stdb-helper not built or node missing; using HTTP SQL polling")
            return
        backoff = 1.0
        max_backoff = float(self.cfg["stdb"].get("helper_restart_max_s", 30))
        while not self._stop.is_set():
            env = dict(os.environ)
            env.update({"STDB_URI": self.cfg["stdb"]["uri"], "STDB_DATABASE": self.cfg["stdb"]["database"],
                        "STDB_TOKEN": getattr(self.stdb, "token", None) or ""})
            started = time.monotonic()
            try:
                self._proc = subprocess.Popen(cmd, cwd=str(BASE_DIR), env=env, stdout=subprocess.PIPE,
                                              text=True, bufsize=1)
                assert self._proc.stdout is not None
                for line in self._proc.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        self.handle_event(json.loads(line))
                    except Exception:  # noqa: BLE001
                        log.exception("bad helper line: %s", line[:200])
                self._proc.wait()
            except OSError as exc:
                log.warning("stdb-helper failed to start: %s", exc)
            self.helper_up = False
            if self._stop.is_set():
                break
            if time.monotonic() - started > 60:
                backoff = 1.0
            log.warning("stdb-helper exited; restarting in %.0f s", backoff)
            self._stop.wait(backoff)
            backoff = min(max_backoff, backoff * 2)
