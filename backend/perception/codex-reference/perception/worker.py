"""One durable analysis worker. Completed results survive network failures."""
from datetime import datetime, timezone
import json
from pathlib import Path
import threading
import time
from .score import compute_score
from .stdb import encode_enum, encode_option, ReducerRejected


def waiting_minutes(survivor):
    if survivor.get("status") not in {"unassigned", "assigned", "en_route"}:
        return 0
    value = survivor.get("created_at")
    if value is None:
        return 0
    if isinstance(value, (int,float)):
        created = datetime.fromtimestamp(value/1e6, timezone.utc)
    else:
        created = datetime.fromisoformat(str(value).replace("Z","+00:00"))
    return max(0,(datetime.now(timezone.utc)-created).total_seconds()/60)


def score_survivor(survivor, detections, config, result=None):
    data = {**survivor, "rate_bpm":survivor.get("breathing_rate_bpm",survivor.get("rate_bpm")), **(result or {})}
    linked = [row for row in detections if row.get("survivor_id") == survivor["id"]
              and row.get("source",row.get("kind", "thermal")) in {"thermal", "camera"}]
    latest = max(linked,key=lambda row:row.get("id",0),default={})
    reasons = data.get("reasons", [])
    if isinstance(reasons,str):
        reasons = [reasons]
    return compute_score(data.get("breathing","unknown"), data.get("rate_bpm"),
        data.get("breathing_confidence",0), data.get("visibility_pct"), waiting_minutes(survivor),
        latest.get("thermal_confidence"), clip_analyzed=bool(result), gate_reasons=reasons,
        earlier_result_kept=data.get("earlier_result_kept",False), config=config.score)


class Worker:
    def __init__(self, config, store, media, stdb, analyze=None):
        self.config, self.store, self.media, self.stdb = config,store,media,stdb
        self.analyze = analyze
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.run, name="perception-analysis",daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=6)

    def run(self):
        while not self.stop_event.is_set():
            for job in self.store.jobs({"queued", "pending_write"}):
                if self.stop_event.is_set():
                    break
                if job["status"] == "pending_write" and time.time()-job["updated"] < 10:
                    continue
                self.process(job)
            self.stop_event.wait(0.2)

    def process(self, job):
        payload, job_id = job["payload"],job["job_id"]
        result = job["result"]
        try:
            if result is None:
                if self.stdb.configured:
                    survivor = next((r for r in self.stdb.rows("survivor") if r["id"] == payload["survivor_id"]),None)
                    if survivor is None:
                        raise ReducerRejected("unknown survivor")
                self.store.update(job_id,"running")
                if self.analyze is None:
                    from .breathing import analyze_clip
                    analyze = analyze_clip
                else:
                    analyze = self.analyze
                debug_dir = self.config.data_dir / "derived" / f"surv_{payload['survivor_id']}_{job_id[:8]}"
                debug_dir.mkdir(parents=True,exist_ok=True)
                result = analyze(payload["path"], roi=payload.get("roi"), fps=payload.get("fps"),
                                 config=self.config, debug_dir=debug_dir)
                if payload.get("detection_id") and self.stdb.configured:
                    detection = next((row for row in self.stdb.rows("detection")
                        if row.get("id") == payload["detection_id"]),{})
                    if detection.get("camera_image_url"):
                        try:
                            import cv2
                            from .roi import person_check, draw_person
                            still_path = self.media.resolve_url(detection["camera_image_url"],kind="camera")
                            image = cv2.imread(str(still_path))
                            if image is not None:
                                check = person_check(image,self.config.breathing)
                                result.update(person_confirmed=check["person_confirmed"],person_conf=check["person_conf"])
                                person_path = debug_dir / "detection_person.jpg"
                                draw_person(image,check,person_path,self.config.breathing)
                                result["person_image_path"] = str(person_path)
                        except Exception:
                            result.setdefault("warnings",[]).append("camera still check unavailable")
                result["breathing"] = result.get("breathing",result.get("breathing_status","unknown"))
                result["rate_bpm"] = result.get("rate_bpm",result.get("breathing_rate_bpm"))
                result["breathing_confidence"] = result.get("breathing_confidence",result.get("confidence",0))
                if result["breathing"] != "detected":
                    result["rate_bpm"] = None
                    result["breathing_confidence"] = min(0.3,result["breathing_confidence"])
                stem = f"det{payload['detection_id']}" if payload.get("detection_id") else f"surv{payload['survivor_id']}_{job_id[:8]}"
                for source,target,suffix in [("roi_image_path","roi_image_url","roi.jpg"),
                    ("person_image_path","person_image_url","person.jpg"),
                    ("spectrum_path","spectrum_url","spectrum.png"),
                    ("display_clip_path","display_clip_url","evm.mp4")]:
                    if result.get(source):
                        result[target] = self.media.register_derived(result[source],stem+"_"+suffix)
                for field in ("roi_image_url", "person_image_url", "spectrum_url", "display_clip_url"):
                    result.setdefault(field,None)
                self.store.update(job_id,"pending_write",result=result)
                (debug_dir/"result.json").write_text(json.dumps(result,indent=2))
            self.write(job_id,payload,result)
        except ReducerRejected as error:
            self.store.update(job_id,"error",result=result,error=str(error))
        except (ConnectionError, OSError) as error:
            self.store.update(job_id,"pending_write" if result else "queued",result=result,error="database or media unavailable")
        except Exception as error:
            import httpx
            if isinstance(error,(httpx.TransportError,httpx.HTTPStatusError)):
                self.store.update(job_id,"pending_write" if result else "queued",result=result,error="database unavailable")
            else:
                self.store.update(job_id,"error",result=result,error=f"analysis failed: {type(error).__name__}")

    def write(self, job_id, payload, result):
        survivor = next((r for r in self.stdb.rows("survivor") if r["id"] == payload["survivor_id"]),None)
        if survivor is None:
            raise ReducerRejected("unknown survivor")
        effective = dict(result)
        if result["breathing"] == "unknown" and survivor.get("breathing") in {"detected","not_detected"}:
            effective.update({key:survivor.get(key) for key in ("breathing", "rate_bpm", "breathing_confidence", "visibility_pct")})
            effective["rate_bpm"] = survivor.get("breathing_rate_bpm",survivor.get("rate_bpm"))
            effective["earlier_result_kept"] = True
        else:
            self.stdb.call("report_breathing", [payload["survivor_id"],encode_enum(result["breathing"]),
                encode_option(result.get("rate_bpm")),result["breathing_confidence"],
                encode_option(result.get("visibility_pct")),encode_option(result.get("display_clip_url"))])
        score = score_survivor(survivor,self.stdb.rows("detection"),self.config,effective)
        self.stdb.call("set_critical_score",[payload["survivor_id"],encode_enum(score["level"]),
            score["score"],score["confidence"],score["reasons"]])
        self.store.put("score_writes",payload["survivor_id"],score)
        result["critical_score"] = score
        result["earlier_result_kept"] = effective.get("earlier_result_kept",False)
        self.store.update(job_id,"done",result=result)
