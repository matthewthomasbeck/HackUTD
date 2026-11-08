"""SQLite state for uploads, durable analysis work, and latest write snapshots."""
import json
from pathlib import Path
import sqlite3
import threading
import time
import uuid


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.db:
            self.db.executescript("""
            CREATE TABLE IF NOT EXISTS media (name TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, survivor_id INTEGER, detection_id INTEGER,
                clip_url TEXT, status TEXT, payload TEXT, result TEXT, error TEXT, updated REAL);
            CREATE UNIQUE INDEX IF NOT EXISTS job_source ON jobs(survivor_id, clip_url);
            CREATE TABLE IF NOT EXISTS score_writes (survivor_id INTEGER PRIMARY KEY, payload TEXT);
            CREATE TABLE IF NOT EXISTS terrain (robot_id TEXT PRIMARY KEY, payload TEXT);
            UPDATE jobs SET status='queued' WHERE status='running';
            """)

    def put(self, table, key, value):
        column = {"media":"name", "score_writes":"survivor_id", "terrain":"robot_id"}[table]
        with self.lock, self.db:
            self.db.execute(f"INSERT OR REPLACE INTO {table} ({column},payload) VALUES (?,?)", (key,json.dumps(value)))

    def get(self, table, key):
        column = {"media":"name", "score_writes":"survivor_id", "terrain":"robot_id"}[table]
        with self.lock:
            row = self.db.execute(f"SELECT payload FROM {table} WHERE {column}=?", (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def terrain_latest(self):
        with self.lock:
            return [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM terrain")]

    def enqueue(self, payload):
        with self.lock, self.db:
            row = self.db.execute("SELECT id FROM jobs WHERE survivor_id=? AND clip_url=?",
                (payload["survivor_id"],payload["clip_url"])).fetchone()
            if row:
                return self.job(row[0])
            job_id = uuid.uuid4().hex
            self.db.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)", (job_id,payload["survivor_id"],
                payload.get("detection_id",0),payload["clip_url"],"queued",json.dumps(payload),None,None,time.time()))
            return self.job(job_id)

    def job(self, job_id):
        with self.lock:
            row = self.db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                return None
            item = dict(row)
            item["job_id"] = item.pop("id")
            for field in ("payload", "result"):
                item[field] = json.loads(item[field]) if item[field] else None
            return item

    def jobs(self, statuses):
        with self.lock:
            marks = ",".join("?" * len(statuses))
            rows = self.db.execute(f"SELECT id FROM jobs WHERE status IN ({marks}) ORDER BY updated", tuple(statuses)).fetchall()
            return [self.job(row[0]) for row in rows]

    def update(self, job_id, status, result=None, error=None):
        with self.lock, self.db:
            self.db.execute("UPDATE jobs SET status=?,result=COALESCE(?,result),error=?,updated=? WHERE id=?",
                (status,json.dumps(result) if result is not None else None,error,time.time(),job_id))

    def latest(self, field, value):
        if field not in {"survivor_id", "detection_id"}:
            raise ValueError("invalid lookup")
        with self.lock:
            row = self.db.execute(f"SELECT result FROM jobs WHERE {field}=? AND result IS NOT NULL ORDER BY updated DESC LIMIT 1", (value,)).fetchone()
            return json.loads(row[0]) if row else None
