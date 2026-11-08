"""Local SQLite state in data/perception.db (perception.md sections 2, 3, 7, 8).

Tables:
- media: the media index; GET /media/<name> looks up the path here.
- jobs: breathing jobs (queued, running, done, error) with the result JSON.
- survivor_breathing: the breathing values this service last stood behind per survivor,
  after the re-scan rule (an unknown never replaces an earlier detected or not_detected).
- analyzed_detections: detections the watcher already queued, so nothing is queued twice.
- person_checks: the display-only person check per detection.
- pending_writes: reducer calls kept while SpacetimeDB is unreachable, retried in order.
- score_writes: the last critical score this service wrote per survivor.

One connection shared by every thread, guarded by a lock. SQLite is fast enough for this.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS media (
    name TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    robot_id TEXT NOT NULL,
    run_id INTEGER NOT NULL,
    detection_id INTEGER,
    original_filename TEXT,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    survivor_id INTEGER NOT NULL,
    detection_id INTEGER,
    robot_id TEXT,
    clip_url TEXT,
    clip_name TEXT,
    roi TEXT,
    fps REAL,
    status TEXT NOT NULL,
    reason TEXT,
    write_state TEXT,
    result_json TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_detection ON jobs (detection_id);
CREATE INDEX IF NOT EXISTS jobs_survivor ON jobs (survivor_id);
CREATE INDEX IF NOT EXISTS jobs_clip_url ON jobs (clip_url);
CREATE TABLE IF NOT EXISTS survivor_breathing (
    survivor_id INTEGER PRIMARY KEY,
    breathing TEXT NOT NULL,
    rate_bpm REAL,
    confidence REAL NOT NULL,
    visibility_pct REAL,
    display_url TEXT,
    job_id TEXT,
    earlier_kept INTEGER NOT NULL DEFAULT 0,
    gate_reason TEXT,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS analyzed_detections (
    detection_id INTEGER PRIMARY KEY,
    clip_url TEXT,
    job_id TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS person_checks (
    detection_id INTEGER PRIMARY KEY,
    image_url TEXT,
    person_image_url TEXT,
    person_confirmed INTEGER NOT NULL,
    person_conf REAL NOT NULL,
    box_json TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_writes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    survivor_id INTEGER NOT NULL,
    calls_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS score_writes (
    survivor_id INTEGER PRIMARY KEY,
    level TEXT NOT NULL,
    score REAL NOT NULL,
    confidence REAL NOT NULL,
    reasons_json TEXT NOT NULL,
    written_at REAL NOT NULL
);
"""


def _row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


class Store:
    def __init__(self, db_path: str | Path):
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def _exec(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._db.execute(sql, params)

    def _one(self, sql: str, params: tuple = ()) -> dict | None:
        with self._lock:
            return _row_to_dict(self._db.execute(sql, params).fetchone())

    def _all(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._db.execute(sql, params).fetchall()]

    # media index
    def add_media(self, *, name: str, path: str, kind: str, robot_id: str, run_id: int,
                  detection_id: int | None, original_filename: str | None, size: int, sha256: str) -> None:
        self._exec(
            "INSERT OR REPLACE INTO media (name, path, kind, robot_id, run_id, detection_id, original_filename,"
            " bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, path, kind, robot_id, run_id, detection_id, original_filename, size, sha256, time.time()),
        )

    def get_media(self, name: str) -> dict | None:
        return self._one("SELECT * FROM media WHERE name = ?", (name,))

    # jobs
    def create_job(self, *, job_id: str, survivor_id: int, detection_id: int | None, robot_id: str | None,
                   clip_url: str, clip_name: str | None, roi: str | None, fps: float | None) -> dict:
        now = time.time()
        self._exec(
            "INSERT INTO jobs (job_id, survivor_id, detection_id, robot_id, clip_url, clip_name, roi, fps, status,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
            (job_id, survivor_id, detection_id, robot_id, clip_url, clip_name, roi, fps, now, now),
        )
        return self.get_job(job_id)

    def update_job(self, job_id: str, **fields) -> None:
        if "result" in fields:
            fields["result_json"] = json.dumps(fields.pop("result"))
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k} = ?" for k in fields)
        self._exec(f"UPDATE jobs SET {cols} WHERE job_id = ?", (*fields.values(), job_id))

    @staticmethod
    def _decode_job(job: dict | None) -> dict | None:
        if job is None:
            return None
        raw = job.pop("result_json", None)
        job["result"] = json.loads(raw) if raw else None
        return job

    def get_job(self, job_id: str) -> dict | None:
        return self._decode_job(self._one("SELECT * FROM jobs WHERE job_id = ?", (job_id,)))

    def jobs_with_status(self, *statuses: str) -> list[dict]:
        marks = ", ".join("?" for _ in statuses)
        rows = self._all(f"SELECT * FROM jobs WHERE status IN ({marks}) ORDER BY created_at", statuses)
        return [self._decode_job(r) for r in rows]

    def job_for_clip_url(self, clip_url: str) -> dict | None:
        return self._decode_job(self._one(
            "SELECT * FROM jobs WHERE clip_url = ? ORDER BY created_at DESC LIMIT 1", (clip_url,)))

    def latest_result_for_detection(self, detection_id: int) -> dict | None:
        return self._decode_job(self._one(
            "SELECT * FROM jobs WHERE detection_id = ? AND result_json IS NOT NULL"
            " ORDER BY updated_at DESC LIMIT 1", (detection_id,)))

    def latest_result_for_survivor(self, survivor_id: int) -> dict | None:
        return self._decode_job(self._one(
            "SELECT * FROM jobs WHERE survivor_id = ? AND result_json IS NOT NULL"
            " ORDER BY updated_at DESC LIMIT 1", (survivor_id,)))

    def queue_depth(self) -> int:
        row = self._one("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running')")
        return int(row["n"]) if row else 0

    # survivor breathing (after the re-scan rule)
    def get_survivor_breathing(self, survivor_id: int) -> dict | None:
        return self._one("SELECT * FROM survivor_breathing WHERE survivor_id = ?", (survivor_id,))

    def set_survivor_breathing(self, survivor_id: int, *, breathing: str, rate_bpm: float | None,
                               confidence: float, visibility_pct: float | None, display_url: str | None,
                               job_id: str | None, earlier_kept: bool, gate_reason: str | None) -> None:
        self._exec(
            "INSERT OR REPLACE INTO survivor_breathing (survivor_id, breathing, rate_bpm, confidence, visibility_pct,"
            " display_url, job_id, earlier_kept, gate_reason, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (survivor_id, breathing, rate_bpm, confidence, visibility_pct, display_url, job_id,
             1 if earlier_kept else 0, gate_reason, time.time()),
        )

    # watcher dedupe
    def detection_analyzed(self, detection_id: int) -> bool:
        return self._one("SELECT 1 AS x FROM analyzed_detections WHERE detection_id = ?", (detection_id,)) is not None

    def mark_detection_analyzed(self, detection_id: int, clip_url: str | None, job_id: str | None) -> None:
        self._exec(
            "INSERT OR IGNORE INTO analyzed_detections (detection_id, clip_url, job_id, created_at) VALUES (?, ?, ?, ?)",
            (detection_id, clip_url, job_id, time.time()),
        )

    # person check
    def set_person_check(self, detection_id: int, *, image_url: str | None, person_image_url: str | None,
                         person_confirmed: bool, person_conf: float, box) -> None:
        self._exec(
            "INSERT OR REPLACE INTO person_checks (detection_id, image_url, person_image_url, person_confirmed,"
            " person_conf, box_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (detection_id, image_url, person_image_url, 1 if person_confirmed else 0, float(person_conf),
             json.dumps(box), time.time()),
        )

    def get_person_check(self, detection_id: int) -> dict | None:
        row = self._one("SELECT * FROM person_checks WHERE detection_id = ?", (detection_id,))
        if row is None:
            return None
        row["person_confirmed"] = bool(row["person_confirmed"])
        row["box"] = json.loads(row.pop("box_json") or "null")
        return row

    # pending writes
    def add_pending_write(self, job_id: str | None, survivor_id: int, calls: list, error: str | None) -> int:
        cur = self._exec(
            "INSERT INTO pending_writes (job_id, survivor_id, calls_json, last_error, created_at) VALUES (?, ?, ?, ?, ?)",
            (job_id, survivor_id, json.dumps(calls), error, time.time()),
        )
        return int(cur.lastrowid)

    def pending_writes(self) -> list[dict]:
        rows = self._all("SELECT * FROM pending_writes ORDER BY id")
        for r in rows:
            r["calls"] = json.loads(r.pop("calls_json"))
        return rows

    def update_pending_write(self, pending_id: int, calls: list, error: str | None) -> None:
        self._exec("UPDATE pending_writes SET calls_json = ?, attempts = attempts + 1, last_error = ? WHERE id = ?",
                   (json.dumps(calls), error, pending_id))

    def delete_pending_write(self, pending_id: int) -> None:
        self._exec("DELETE FROM pending_writes WHERE id = ?", (pending_id,))

    # score writes
    def get_score_write(self, survivor_id: int) -> dict | None:
        row = self._one("SELECT * FROM score_writes WHERE survivor_id = ?", (survivor_id,))
        if row is None:
            return None
        row["reasons"] = json.loads(row.pop("reasons_json"))
        return row

    def set_score_write(self, survivor_id: int, *, level: str, score: float, confidence: float,
                        reasons: list[str]) -> None:
        self._exec(
            "INSERT OR REPLACE INTO score_writes (survivor_id, level, score, confidence, reasons_json, written_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (survivor_id, level, float(score), float(confidence), json.dumps(reasons), time.time()),
        )
