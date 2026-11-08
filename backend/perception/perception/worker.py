"""Analysis queue: one background thread (perception.md sections 3, 4, 7, 8.4).

One worker thread runs every breathing job and every person check, one at a time, so YOLO and
OpenCV never compete for the CPU. For a breathing job it:

1. checks the survivor exists (unknown survivor gives status error, nothing written),
2. finds the clip (local index, or downloads a clip_url from elsewhere),
3. runs perception.breathing.analyze() into data/derived/det_<id>/ (or surv_<sid>_<job8>/),
4. applies the re-scan rule (an unknown never replaces an earlier detected or not_detected),
5. calls report_breathing, then set_critical_score (score from perception.score.compute_score).

A rejected call (4xx or 530) marks the job error and stops, so a failed report_breathing is
never followed by set_critical_score. If SpacetimeDB is unreachable after the retries, the
remaining calls are kept in SQLite (pending_writes) and a second thread retries them in order
every pending_retry_s (10 s).

breathing.py, score.py, and roi.py are written by other people; they are imported only when
needed, so this file works (and its tests pass) while they are missing.
"""

from __future__ import annotations

import importlib
import logging
import queue
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import media
from .stdb import StdbRejected, StdbUnavailable, encode_enum, encode_option, parse_iso

log = logging.getLogger(__name__)

WAITING_STATUSES = ("unassigned", "assigned", "en_route")
KEPT_BREATHING = ("detected", "not_detected")

# derived file in out_dir -> result key holding its URL
DERIVED_FILES = (
    ("roi.jpg", "roi_image_url"),
    ("spectrum.png", "spectrum_url"),
    ("evm.mp4", "display_clip_url"),
    ("person.jpg", "person_image_url"),
)


def load_optional(name: str):
    """Import a module that may not exist yet (another teammate's file). None if missing."""
    try:
        return importlib.import_module(name)
    except ImportError as exc:
        log.debug("optional module %s not available: %s", name, exc)
        return None
    except Exception:  # noqa: BLE001 - a broken teammate module must not stop the service
        log.exception("optional module %s failed to import", name)
        return None


def minutes_waiting(survivor: dict | None, now: datetime | None = None) -> float:
    """Minutes since survivor.created_at while the status is unassigned, assigned, or en_route."""
    if not survivor or survivor.get("status") not in WAITING_STATUSES:
        return 0.0
    created = parse_iso(survivor.get("created_at"))
    if created is None:
        return 0.0
    now = now or datetime.now(timezone.utc)
    return max(0.0, (now - created).total_seconds() / 60.0)


def parse_roi(text: str | None) -> tuple[int, int, int, int] | None:
    """'x,y,w,h' in pixels to a tuple. Raises ValueError if malformed."""
    if text is None or str(text).strip() == "":
        return None
    parts = [int(round(float(p))) for p in str(text).split(",")]
    if len(parts) != 4 or parts[0] < 0 or parts[1] < 0 or parts[2] <= 0 or parts[3] <= 0:
        raise ValueError("roi must be x,y,w,h with w and h above 0")
    return parts[0], parts[1], parts[2], parts[3]


def score_call(survivor_id: int, s: dict) -> list:
    return ["set_critical_score", [int(survivor_id), encode_enum(s["level"]), float(s["score"]),
                                   float(s["confidence"]), [str(r) for r in s["reasons"]]]]


def compute_survivor_score(cfg: dict, store, rows, survivor_id: int, survivor: dict | None,
                           score_mod=None) -> dict | None:
    """Score a survivor from what this service last stood behind (survivor_breathing), else from
    the survivor row the database holds. Used by the re-score timer. None if score.py is missing."""
    score_mod = score_mod or load_optional("perception.score")
    if score_mod is None:
        return None
    sb = store.get_survivor_breathing(survivor_id)
    if sb is not None:
        b, rr, q, vis = sb["breathing"], sb["rate_bpm"], sb["confidence"], sb["visibility_pct"]
        kept, reason = bool(sb["earlier_kept"]), sb["gate_reason"]
    else:
        row_b = (survivor or {}).get("breathing")
        if row_b in (None, "unknown"):
            b, rr, q, vis = None, None, 0.0, (survivor or {}).get("visibility_pct")
        else:
            b = row_b
            rr = (survivor or {}).get("breathing_rate_bpm")
            q = float((survivor or {}).get("breathing_confidence") or 0.0)
            vis = (survivor or {}).get("visibility_pct")
        kept, reason = False, None
    thermal = rows.thermal_conf_for(survivor_id) if rows is not None else None
    return score_mod.compute_score(
        breathing=b, rate_bpm=rr if b == "detected" else None, breathing_conf=float(q or 0.0),
        visibility_pct=vis, minutes_waiting=minutes_waiting(survivor), thermal_conf=thermal,
        earlier_kept=kept, cfg=cfg["score"], reason=reason if b == "unknown" else None)


class Worker:
    def __init__(self, cfg: dict, store, stdb, rows=None):
        self.cfg = cfg
        self.store = store
        self.stdb = stdb
        self.rows = rows
        self.q: queue.Queue = queue.Queue()
        self.write_lock = threading.RLock()
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    # queue
    def start(self) -> None:
        for job in self.store.jobs_with_status("queued", "running"):
            self.store.update_job(job["job_id"], status="queued")
            self.q.put(("breathing", job["job_id"]))
        for target, name in ((self._run_loop, "perception-worker"), (self._pending_loop, "perception-pending")):
            t = threading.Thread(target=target, name=name, daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()
        self.q.put(None)

    def submit_breathing(self, *, survivor_id: int, clip_url: str, clip_name: str | None = None,
                         detection_id: int | None = None, robot_id: str | None = None,
                         roi: str | None = None, fps: float | None = None) -> dict:
        job = self.store.create_job(job_id=str(uuid.uuid4()), survivor_id=survivor_id, detection_id=detection_id,
                                    robot_id=robot_id, clip_url=clip_url, clip_name=clip_name, roi=roi, fps=fps)
        self.q.put(("breathing", job["job_id"]))
        return job

    def enqueue_person(self, detection_id: int, image_url: str, robot_id: str | None = None) -> None:
        self.q.put(("person", detection_id, image_url, robot_id))

    def queue_size(self) -> int:
        return self.store.queue_depth() + sum(1 for item in list(self.q.queue) if item and item[0] == "person")

    def process_next(self, timeout: float | None = None) -> bool:
        """Run one queued item on the calling thread. Returns False if the queue was empty."""
        try:
            item = self.q.get(timeout=timeout) if timeout else self.q.get_nowait()
        except queue.Empty:
            return False
        if item is None:
            return False
        try:
            if item[0] == "breathing":
                self.run_job(item[1])
            elif item[0] == "person":
                self.run_person_check(item[1], item[2], item[3])
        except Exception:  # noqa: BLE001 - one bad job must not stop the worker
            log.exception("worker item %s failed", item)
        return True

    def _run_loop(self) -> None:
        while not self._stop.is_set():
            self.process_next(timeout=0.5)

    def _pending_loop(self) -> None:
        interval = float(self.cfg["stdb"].get("pending_retry_s", 10))
        while not self._stop.wait(interval):
            try:
                self.flush_pending()
            except Exception:  # noqa: BLE001
                log.exception("pending write retry failed")

    # breathing job
    def _fail(self, job_id: str, reason: str) -> None:
        log.warning("job %s error: %s", job_id, reason)
        self.store.update_job(job_id, status="error", reason=reason)

    def _survivor(self, survivor_id: int) -> tuple[bool | None, dict | None]:
        """(True, row) if found, (False, None) if the database says no such survivor,
        (None, None) if the database could not be asked."""
        if self.rows is None:
            return None, None
        try:
            row = self.rows.get_survivor(survivor_id)
        except Exception as exc:  # noqa: BLE001 - unreachable database: analyze anyway
            log.warning("survivor %s lookup failed: %s", survivor_id, exc)
            return None, None
        return (True, row) if row is not None else (False, None)

    def run_job(self, job_id: str) -> None:
        job = self.store.get_job(job_id)
        if job is None:
            return
        self.store.update_job(job_id, status="running")
        sid = int(job["survivor_id"])
        det = job["detection_id"]

        found, survivor = self._survivor(sid)
        if found is False:
            self._fail(job_id, "unknown survivor")
            return

        breathing = load_optional("perception.breathing")
        if breathing is None:
            self._fail(job_id, "breathing module not installed")
            return

        try:
            if job["clip_name"]:
                path = media.lookup(job["clip_name"])["path"]
            else:
                saved = media.resolve_url(job["clip_url"], kind="clip", robot_id=job["robot_id"], detection_id=det)
                path = saved["path"]
        except media.MediaError as exc:
            self._fail(job_id, f"clip unavailable: {exc.detail}")
            return
        except Exception as exc:  # noqa: BLE001 - download failure
            self._fail(job_id, f"clip unavailable: {exc}")
            return

        prefix = f"det{det}" if det else f"surv{sid}_{job_id[:8]}"
        out_dir = media.derived_root() / (f"det_{det}" if det else f"surv_{sid}_{job_id[:8]}")
        out_dir.mkdir(parents=True, exist_ok=True)
        roi = parse_roi(job["roi"])
        try:
            result = dict(breathing.analyze(path, fps=job["fps"], roi=roi, cfg=self.cfg["breathing"],
                                            out_dir=str(out_dir)))
        except Exception as exc:  # noqa: BLE001
            log.exception("analyze failed for job %s", job_id)
            self._fail(job_id, f"analysis failed: {exc}")
            return

        result.update({"survivor_id": sid, "detection_id": det, "clip_url": job["clip_url"]})
        self._attach_derived(result, out_dir, prefix, det)
        self.store.update_job(job_id, result=result)
        self.write_result(job_id, sid, result, survivor)

    def _attach_derived(self, result: dict, out_dir: Path, prefix: str, det: int | None) -> None:
        for fname, key in DERIVED_FILES:
            p = out_dir / fname
            if p.is_file() and not result.get(key):
                result[key] = media.register_file(p, f"{prefix}_{fname}", detection_id=det)["url"]
            result.setdefault(key, None)
        pc = self.store.get_person_check(det) if det else None
        if pc is not None:
            result["person_image_url"] = pc["person_image_url"]
            result["person_confirmed"] = pc["person_confirmed"]
            result["person_conf"] = pc["person_conf"]
        result.setdefault("person_confirmed", False)
        result.setdefault("person_conf", 0.0)

    def write_result(self, job_id: str, survivor_id: int, result: dict, survivor: dict | None) -> None:
        """Re-scan rule, then report_breathing and set_critical_score."""
        new_b = result.get("breathing", "unknown")
        reasons = result.get("reasons") or []
        gate_reason = (result.get("reason") or (reasons[0] if reasons else None)) if new_b == "unknown" else None

        prev = self.store.get_survivor_breathing(survivor_id)
        if prev is None and survivor and survivor.get("breathing") in KEPT_BREATHING:
            prev = {"breathing": survivor["breathing"], "rate_bpm": survivor.get("breathing_rate_bpm"),
                    "confidence": float(survivor.get("breathing_confidence") or 0.0),
                    "visibility_pct": survivor.get("visibility_pct"),
                    "display_url": survivor.get("breathing_display_url"), "job_id": None}
        kept = new_b == "unknown" and prev is not None and prev["breathing"] in KEPT_BREATHING

        if kept:
            eff = {"breathing": prev["breathing"], "rate_bpm": prev["rate_bpm"], "confidence": prev["confidence"],
                   "visibility_pct": prev["visibility_pct"], "display_url": prev.get("display_url"),
                   "job_id": prev.get("job_id")}
        else:
            eff = {"breathing": new_b,
                   "rate_bpm": result.get("rate_bpm") if new_b == "detected" else None,
                   "confidence": float(result.get("breathing_confidence") or 0.0),
                   "visibility_pct": result.get("visibility_pct"),
                   "display_url": result.get("display_clip_url"), "job_id": job_id}
        self.store.set_survivor_breathing(survivor_id, **eff, earlier_kept=kept, gate_reason=gate_reason)

        calls: list = []
        if not kept:
            calls.append(["report_breathing", [
                int(survivor_id), encode_enum(eff["breathing"]), encode_option(eff["rate_bpm"]),
                float(eff["confidence"]), encode_option(eff["visibility_pct"]), encode_option(eff["display_url"]),
            ]])
        score_mod = load_optional("perception.score")
        if score_mod is not None:
            thermal = self.rows.thermal_conf_for(survivor_id) if self.rows is not None else None
            s = score_mod.compute_score(
                breathing=eff["breathing"], rate_bpm=eff["rate_bpm"], breathing_conf=float(eff["confidence"]),
                visibility_pct=eff["visibility_pct"], minutes_waiting=minutes_waiting(survivor),
                thermal_conf=thermal, earlier_kept=kept, cfg=self.cfg["score"],
                reason=gate_reason if eff["breathing"] == "unknown" else None)
            result["critical_score"] = s
            calls.append(score_call(survivor_id, s))
        else:
            log.warning("score module not installed; set_critical_score skipped for survivor %s", survivor_id)
        result["earlier_result_kept"] = kept
        self.store.update_job(job_id, result=result)

        outcome, detail = self.write_calls(job_id, survivor_id, calls)
        if outcome == "rejected":
            self.store.update_job(job_id, status="error", reason=f"rejected: {detail}", write_state="rejected")
        else:
            self.store.update_job(job_id, status="done", write_state=outcome)

    # writes
    def _record_score(self, reducer: str, args: list) -> None:
        if reducer == "set_critical_score":
            level = next(iter(args[1]))
            self.store.set_score_write(int(args[0]), level=level, score=args[2], confidence=args[3], reasons=args[4])

    def write_calls(self, job_id: str | None, survivor_id: int, calls: list) -> tuple[str, str | None]:
        """Send calls in order. Returns ("written"|"pending_write"|"rejected", detail)."""
        if not calls:
            return "written", None
        with self.write_lock:
            if self.store.pending_writes() and not self.flush_pending():
                self.store.add_pending_write(job_id, survivor_id, calls, "queued behind earlier pending writes")
                return "pending_write", None
            remaining = list(calls)
            while remaining:
                reducer, args = remaining[0]
                try:
                    self.stdb.call(reducer, args)
                except StdbRejected as exc:
                    log.error("%s rejected for survivor %s: %s", reducer, survivor_id, exc.text or exc)
                    return "rejected", f"{reducer}: {exc.text or exc}"
                except StdbUnavailable as exc:
                    log.warning("SpacetimeDB unreachable, keeping %d call(s) as pending_write", len(remaining))
                    self.store.add_pending_write(job_id, survivor_id, remaining, str(exc))
                    return "pending_write", str(exc)
                self._record_score(reducer, args)
                remaining.pop(0)
            return "written", None

    def flush_pending(self) -> bool:
        """Retry pending writes in order. True if none are left."""
        with self.write_lock:
            for p in self.store.pending_writes():
                remaining = list(p["calls"])
                while remaining:
                    reducer, args = remaining[0]
                    try:
                        self.stdb.call(reducer, args)
                    except StdbRejected as exc:
                        log.error("pending %s rejected: %s", reducer, exc.text or exc)
                        self.store.delete_pending_write(p["id"])
                        if p["job_id"]:
                            self.store.update_job(p["job_id"], status="error", write_state="rejected",
                                                  reason=f"rejected: {reducer}: {exc.text or exc}")
                        remaining = None
                        break
                    except StdbUnavailable as exc:
                        self.store.update_pending_write(p["id"], remaining, str(exc))
                        return False
                    self._record_score(reducer, args)
                    remaining.pop(0)
                if remaining is not None:
                    self.store.delete_pending_write(p["id"])
                    if p["job_id"]:
                        self.store.update_job(p["job_id"], write_state="written")
            return True

    # person check (display only, never written to SpacetimeDB)
    def run_person_check(self, detection_id: int, image_url: str, robot_id: str | None = None) -> None:
        roi_mod = load_optional("perception.roi")
        if roi_mod is None or not hasattr(roi_mod, "confirm_person"):
            log.info("roi module not installed; person check for detection %s skipped", detection_id)
            return
        try:
            saved = media.resolve_url(image_url, kind="camera", robot_id=robot_id, detection_id=detection_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("camera still for detection %s unavailable: %s", detection_id, exc)
            return
        out_dir = media.derived_root() / f"det_{detection_id}"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / "person.jpg"
        r = roi_mod.confirm_person(saved["path"], str(out_path), cfg=self.cfg["breathing"])
        url = None
        if out_path.is_file():
            url = media.register_file(out_path, f"det{detection_id}_person.jpg", detection_id=detection_id)["url"]
        self.store.set_person_check(detection_id, image_url=image_url, person_image_url=url,
                                    person_confirmed=bool(r.get("person_confirmed")),
                                    person_conf=float(r.get("person_conf") or 0.0), box=r.get("box"))
