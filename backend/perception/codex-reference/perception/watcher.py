"""HTTP polling fallback for detections and meaningful score updates.

The generated-binding subscription helper can replace these reads once the
team module is published. SQL never filters option or enum columns.
"""
import threading
import time
from .score import meaningful_change
from .stdb import encode_enum
from .worker import score_survivor


class Watcher:
    def __init__(self, config, store, media, stdb):
        self.config,self.store,self.media,self.stdb = config,store,media,stdb
        self.stop_event = threading.Event()
        self.thread = None
        self.last_score = 0
        self.seen_survivors = set()

    def start(self):
        self.thread = threading.Thread(target=self.run,name="perception-watcher",daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=6)

    def run(self):
        while not self.stop_event.is_set():
            try:
                if self.stdb.configured:
                    if not self.stdb.healthy:
                        self.stdb.initialize()
                    self.tick()
            except Exception:
                # Media endpoints stay available during registration or network
                # failure. Health reports the database state without credentials.
                self.stdb.healthy = False
            self.stop_event.wait(2)

    def tick(self):
        detections,survivors = self.stdb.rows("detection"),self.stdb.rows("survivor")
        for row in detections:
            url,survivor_id = row.get("breathing_clip_url"),row.get("survivor_id",0)
            if url and survivor_id:
                if not any(job["clip_url"] == url and job["survivor_id"] == survivor_id
                    for job in self.store.jobs({"queued","running","pending_write","done","error"})):
                    path = self.media.resolve_url(url)
                    self.store.enqueue(dict(path=str(path),clip_url=url,survivor_id=survivor_id,detection_id=row["id"]))
        now = time.monotonic()
        periodic = now-self.last_score >= self.config.score["rescore_interval_s"]
        for survivor in survivors:
            sid = survivor["id"]
            if survivor.get("status") not in {"unassigned","assigned","en_route"}:
                continue
            if not periodic and sid in self.seen_survivors:
                continue
            score = score_survivor(survivor,detections,self.config)
            if meaningful_change(self.store.get("score_writes",sid),score,self.config.score):
                self.stdb.call("set_critical_score",[sid,encode_enum(score["level"]),score["score"],score["confidence"],score["reasons"]])
                self.store.put("score_writes",sid,score)
            self.seen_survivors.add(sid)
        if periodic:
            self.last_score = now
