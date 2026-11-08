"""stdb.py: SATS-JSON encoding, the HTTP client (with httpx.MockTransport), and the SQL row decoder.

The SQL fixture is hand-written, NOT captured from a real server (see its _note); replace it with
smoke_stdb.py output once the module is published."""

import json
from pathlib import Path

import httpx
import pytest

from perception.stdb import (StdbClient, StdbRejected, StdbUnavailable, decode_rows, decode_sql_response,
                             decode_value, encode_enum, encode_option, micros_to_iso)

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "sql_sample_not_captured.json").read_text())
URI = "http://stdb.test"
DB = "assess-0hw81"
T0 = 1794107722000000


def make_client(handler, tmp_path, token="tok", sleeps=None):
    sleeps = [] if sleeps is None else sleeps
    return StdbClient(URI, DB, token=token, identity_path=tmp_path / "identity.json",
                      transport=httpx.MockTransport(handler), sleep=sleeps.append)


# encoding

def test_encode_enum_and_option():
    assert encode_enum("detected") == {"detected": []}
    assert encode_enum("perception") == {"perception": []}
    assert encode_option(17.8) == {"some": 17.8}
    assert encode_option(None) == {"none": []}
    assert encode_option(0.0) == {"some": 0.0}
    assert encode_option("http://x/media/a.mp4") == {"some": "http://x/media/a.mp4"}


# calls

def test_call_posts_json_array_with_bearer_token(tmp_path):
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200)

    c = make_client(handler, tmp_path)
    args = [12, encode_enum("detected"), encode_option(17.8), 0.64, encode_option(59.0), encode_option(None)]
    c.call("report_breathing", args)
    req = seen[0]
    assert req.method == "POST"
    assert str(req.url) == f"{URI}/v1/database/{DB}/call/report_breathing"
    assert req.headers["authorization"] == "Bearer tok"
    assert json.loads(req.content) == [12, {"detected": []}, {"some": 17.8}, 0.64, {"some": 59.0}, {"none": []}]
    assert c.ok_once


@pytest.mark.parametrize("status", [400, 404, 530])
def test_rejection_is_not_retried(tmp_path, status):
    count = []

    def handler(request):
        count.append(1)
        return httpx.Response(status, text="no signs of life must stay high")

    sleeps = []
    c = make_client(handler, tmp_path, sleeps=sleeps)
    with pytest.raises(StdbRejected) as err:
        c.call("set_critical_score", [1, {"minor": []}, 10.0, 0.1, []])
    assert len(count) == 1 and sleeps == []
    assert err.value.status == status
    assert "no signs of life must stay high" in err.value.text
    assert not c.ok_once


def test_5xx_is_retried_with_backoff_then_succeeds(tmp_path):
    responses = [httpx.Response(503), httpx.Response(502), httpx.Response(200)]
    sleeps = []
    c = make_client(lambda r: responses.pop(0), tmp_path, sleeps=sleeps)
    c.call("set_critical_score", [1, {"immediate": []}, 75.0, 0.1, ["needs human triage"]])
    assert sleeps == [0.5, 1.0]


def test_network_errors_exhaust_the_schedule(tmp_path):
    count = []

    def handler(request):
        count.append(1)
        raise httpx.ConnectError("refused", request=request)

    sleeps = []
    c = make_client(handler, tmp_path, sleeps=sleeps)
    with pytest.raises(StdbUnavailable):
        c.call("report_breathing", [1])
    assert len(count) == 6
    assert sleeps == [0.5, 1.0, 2.0, 4.0, 8.0]


def test_sql_without_token_does_not_retry_identity(tmp_path):
    count = []

    def handler(request):
        count.append(request.url.path)
        raise httpx.ConnectError("refused", request=request)

    sleeps = []
    c = make_client(handler, tmp_path, token=None, sleeps=sleeps)
    with pytest.raises(StdbUnavailable):
        c.sql("SELECT * FROM survivor")
    assert count == ["/v1/identity"]
    assert sleeps == []


def test_identity_created_saved_and_reused(tmp_path):
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path == "/v1/identity":
            return httpx.Response(200, json={"identity": "c0ffee" * 10 + "abcd", "token": "new-token"})
        assert request.headers["authorization"] == "Bearer new-token"
        return httpx.Response(200)

    c = make_client(handler, tmp_path, token=None)
    c.register_participant()
    assert [r.url.path for r in seen] == ["/v1/identity", f"/v1/database/{DB}/call/register_participant"]
    assert json.loads(seen[1].content) == ["perception", {"perception": []}]
    saved = json.loads((tmp_path / "identity.json").read_text())
    assert saved == {"identity": "c0ffee" * 10 + "abcd", "token": "new-token"}

    # a second client loads the saved identity without asking for a new one
    seen.clear()
    c2 = make_client(handler, tmp_path, token=None)
    assert c2.ensure_identity() == "new-token"
    assert c2.identity == saved["identity"]
    assert seen == []


def test_sql_sends_text_body_and_decodes(tmp_path):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=FIXTURE["survivor"])

    c = make_client(handler, tmp_path)
    rows = c.sql("SELECT * FROM survivor")
    assert seen[0].url.path == f"/v1/database/{DB}/sql"
    assert seen[0].content == b"SELECT * FROM survivor"
    assert [r["id"] for r in rows] == [12, 13]


# decoder (fixture NOT captured from a real server)

def test_decode_survivor_rows_both_value_forms():
    a, b = decode_sql_response(FIXTURE["survivor"])[0]
    # row 1: sums as [tag_index, value], timestamps as [micros]
    assert a["id"] == 12 and a["cell_id"] == 3
    assert a["house_label"] == "house 3"
    assert a["breathing"] == "detected"
    assert a["breathing_rate_bpm"] == 17.8
    assert a["visibility_pct"] == 59.0
    assert a["critical_level"] == "delayed"
    assert a["status"] == "en_route"
    assert a["resolution"] is None and a["resolved_by"] is None and a["escalated_at"] is None
    assert a["score_reasons"] == ["breathing 17/min", "needs human triage"]
    assert a["created_at"] == micros_to_iso(T0)
    assert a["created_at"].endswith("Z")
    # row 2: sums as {name: value}, timestamps as {"__timestamp_micros_since_unix_epoch__": micros}
    assert b["house_label"] is None
    assert b["breathing"] == "unknown" and b["breathing_rate_bpm"] is None and b["visibility_pct"] is None
    assert b["status"] == "unassigned"
    assert b["escalated_at"] == micros_to_iso(T0 + 120_000_000)
    assert b["created_at"] == micros_to_iso(T0 + 30_000_000)


def test_decode_detection_rows():
    d1, d2 = decode_sql_response(FIXTURE["detection"])[0]
    assert d1["source"] == "thermal" and d1["survivor_id"] == 12 and d1["gps_fix"] is True
    assert d1["max_temp_c"] == 34.2 and d1["thermal_confidence"] == 0.82
    assert d1["breathing_clip_url"].endswith("_clip_20261108T031522Z_9f2c41ab.mp4")
    assert d2["survivor_id"] == 0 and d2["camera_image_url"] is None and d2["breathing_clip_url"] is None


def test_decode_object_rows_without_schema():
    stmt = {"schema": {"elements": []}, "rows": [
        {"id": 5, "breathing": {"not_detected": []}, "rate": {"none": []}, "conf": {"some": 0.2},
         "created_at": {"__timestamp_micros_since_unix_epoch__": T0}, "who": {"__identity__": "0xAB"}}]}
    (row,) = decode_rows(stmt)
    assert row == {"id": 5, "breathing": "not_detected", "rate": None, "conf": 0.2,
                   "created_at": micros_to_iso(T0), "who": "ab"}


def test_decode_integer_tag_and_plain_timestamp():
    breathing = {"Sum": {"variants": [{"name": {"some": n}, "algebraic_type": {"Product": {"elements": []}}}
                                      for n in ("detected", "not_detected", "unknown")]}}
    assert decode_value(1, breathing) == "not_detected"
    assert decode_value({"2": []}, breathing) == "unknown"
    ts = {"Product": {"elements": [{"name": {"some": "__timestamp_micros_since_unix_epoch__"},
                                    "algebraic_type": {"I64": []}}]}}
    assert decode_value(T0, ts) == micros_to_iso(T0)


def test_smoke_script_skips_non_json_helper_lines():
    # The SpacetimeDB SDK prints log lines on the helper's stdout; the smoke test must skip them.
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "scripts" / "smoke_stdb.py"
    spec = importlib.util.spec_from_file_location("smoke_stdb", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.json_line("ℹ️ INFO Connecting to SpacetimeDB WS...") is None
    assert mod.json_line("[1, 2]") is None
    assert mod.json_line('{"status": "connected"}') == {"status": "connected"}
