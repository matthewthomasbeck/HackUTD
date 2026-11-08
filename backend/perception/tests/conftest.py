"""Shared fixtures: a temp data folder, a fake SpacetimeDB client, and stub modules for the files
other people write (breathing.py, score.py, roi.py, stt.py, terrain.py), so these tests run
whether or not those files exist yet."""

from __future__ import annotations

import re
import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from perception.config import load_config
from perception.stdb import StdbRejected, StdbUnavailable

BASE_URL = "http://testserver"


@pytest.fixture
def cfg(tmp_path):
    env = {
        "PERCEPTION_PATHS_DATA_DIR": str(tmp_path / "data"),
        "PERCEPTION_SERVER_PUBLIC_BASE_URL": BASE_URL,
        "PERCEPTION_SERVER_CORS_ORIGINS": "http://localhost:5180",
        "PERCEPTION_STDB_HELPER_ENABLED": "false",
    }
    return load_config(env_path=tmp_path / "missing.env", environ=env)


class FakeStdb:
    """Records reducer calls and answers SELECT * FROM <table> [WHERE <col> = <int>]."""

    def __init__(self):
        self.calls: list[tuple[str, list]] = []
        self.tables: dict[str, list[dict]] = {"survivor": [], "detection": [], "run": []}
        self.fail: dict[str, str] = {}  # reducer (or "*") -> "unavailable" | "reject"
        self.sql_down = False
        self.ok_once = False
        self.token = "test-token"
        self.identity = "ab" * 32

    def call(self, reducer: str, args: list) -> None:
        mode = self.fail.get(reducer) or self.fail.get("*")
        if mode == "unavailable":
            raise StdbUnavailable("server down")
        if mode == "reject":
            raise StdbRejected("rejected", 530, f"{reducer} refused")
        self.calls.append((reducer, args))
        self.ok_once = True
        if reducer == "set_critical_score":
            # as the module does: the survivor row takes the new score
            for row in self.tables["survivor"]:
                if int(row["id"]) == int(args[0]):
                    row.update(critical_level=next(iter(args[1])), critical_score=args[2],
                               score_confidence=args[3], score_reasons=list(args[4]))

    def sql(self, query: str, *, retry: bool = False) -> list[dict]:
        if self.sql_down:
            raise StdbUnavailable("server down")
        m = re.match(r"SELECT \* FROM (\w+)(?: WHERE (\w+) = (\d+))?$", query.strip())
        assert m, query
        rows = self.tables.get(m.group(1), [])
        if m.group(2):
            rows = [r for r in rows if int(r.get(m.group(2)) or 0) == int(m.group(3))]
        return [dict(r) for r in rows]

    def reducers(self) -> list[str]:
        return [c[0] for c in self.calls]


@pytest.fixture
def fake_stdb():
    return FakeStdb()


# stub modules

class BreathingStub(types.ModuleType):
    def __init__(self):
        super().__init__("perception.breathing")
        self.next_result = {"breathing": "detected", "rate_bpm": 17.8, "breathing_confidence": 0.64,
                            "visibility_pct": 59.0, "visibility_source": "pose", "reasons": [], "warnings": []}
        self.seen: list[dict] = []

    def analyze(self, path, *, fps=None, roi=None, cfg=None, out_dir=None):
        self.seen.append({"path": path, "fps": fps, "roi": roi, "cfg": cfg, "out_dir": out_dir})
        if out_dir:
            Path(out_dir, "roi.jpg").write_bytes(b"\xff\xd8\xff\xe0fake-roi-jpeg")
        return dict(self.next_result)


class ScoreStub(types.ModuleType):
    def __init__(self):
        super().__init__("perception.score")
        self.seen: list[dict] = []

    def compute_score(self, breathing, rate_bpm, breathing_conf, visibility_pct, minutes_waiting, thermal_conf,
                      earlier_kept, cfg=None, reason=None):
        self.seen.append(dict(breathing=breathing, rate_bpm=rate_bpm, breathing_conf=breathing_conf,
                              visibility_pct=visibility_pct, minutes_waiting=minutes_waiting,
                              thermal_conf=thermal_conf, earlier_kept=earlier_kept, reason=reason))
        level = "delayed" if breathing == "detected" else "immediate"
        reasons = ["no breathing clip yet"] if breathing is None else [f"breathing {breathing}"]
        if earlier_kept:
            reasons.append("latest clip unclear, earlier result kept")
        reasons.append("needs human triage")
        return {"level": level, "score": round(40.0 + minutes_waiting, 1),
                "confidence": 0.3 if breathing != "detected" else 0.5, "reasons": reasons}

    def should_write(self, prev, new, cfg=None):
        if prev is None:
            return True
        return (prev["level"] != new["level"] or abs(prev["score"] - new["score"]) >= 2.0
                or abs(prev["confidence"] - new["confidence"]) >= 0.05)


class RoiStub(types.ModuleType):
    def __init__(self):
        super().__init__("perception.roi")
        self.loaded = True

    def confirm_person(self, image_path, out_path, cfg=None):
        Path(out_path).write_bytes(b"\xff\xd8\xff\xe0fake-person-jpeg")
        return {"person_confirmed": True, "person_conf": 0.81, "box": [10, 20, 110, 220]}

    def yolo_loaded(self):
        return self.loaded


@pytest.fixture
def stubs(monkeypatch):
    b, s, r = BreathingStub(), ScoreStub(), RoiStub()
    monkeypatch.setitem(sys.modules, "perception.breathing", b)
    monkeypatch.setitem(sys.modules, "perception.score", s)
    monkeypatch.setitem(sys.modules, "perception.roi", r)
    # stt and terrain absent unless a test adds them
    monkeypatch.setitem(sys.modules, "perception.stt", None)
    monkeypatch.setitem(sys.modules, "perception.terrain", None)
    return types.SimpleNamespace(breathing=b, score=s, roi=r)


@pytest.fixture
def app(cfg, fake_stdb, stubs):
    from perception.app import create_app
    return create_app(cfg, stdb=fake_stdb, start_background=False)


@pytest.fixture
def client(app):
    return TestClient(app)
