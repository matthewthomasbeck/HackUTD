import hashlib
import re
from pathlib import Path

from perception import media

NAME = re.compile(r"^r(\d+)_([A-Za-z0-9-]+)_([a-z]+)_\d{8}T\d{6}Z_[0-9a-f]{8}\.([a-z0-9]+)$")
JPEG = b"\xff\xd8\xff\xe0" + b"jpeg-bytes" * 10


def upload(client, data=JPEG, filename="photo.JPG", **form):
    return client.post("/media", files={"file": (filename, data)}, data=form)


def test_upload_returns_url_that_serves_the_file(client, cfg):
    r = upload(client, kind="camera", robot_id="dog1")
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("http://testserver/media/")
    name = url.rsplit("/", 1)[1]
    m = NAME.match(name)
    assert m and m.groups() == ("0", "dog1", "camera", "jpg")

    got = client.get(f"/media/{name}")
    assert got.status_code == 200
    assert got.content == JPEG
    assert got.headers["content-type"] == "image/jpeg"

    stored = Path(cfg["paths"]["data_dir"]) / "media" / "run_0" / "dog1" / name
    assert stored.is_file()


def test_client_filename_never_used_on_disk_but_indexed(client, app):
    r = upload(client, filename="../../evil name.jpg", robot_id="dog1")
    name = r.json()["url"].rsplit("/", 1)[1]
    row = app.state.store.get_media(name)
    assert row["original_filename"] == "../../evil name.jpg"
    assert "evil" not in row["path"]
    assert row["bytes"] == len(JPEG)
    assert row["sha256"] == hashlib.sha256(JPEG).hexdigest()
    assert row["kind"] == "camera" and row["robot_id"] == "dog1" and row["run_id"] == 0


def test_kind_defaults_from_extension(client):
    for filename, kind in (("q.wav", "voice"), ("c.mp4", "clip"), ("t.npy", "thermal"), ("l.csv", "log")):
        name = upload(client, filename=filename).json()["url"].rsplit("/", 1)[1]
        assert NAME.match(name).group(3) == kind
        assert NAME.match(name).group(2) == "unknown"


def test_unknown_kind_is_400(client):
    assert upload(client, kind="selfie").status_code == 400


def test_run_id_comes_from_active_run(client, fake_stdb):
    fake_stdb.tables["run"] = [{"id": 2, "ended_at": "2026-11-08T01:00:00Z"}, {"id": 3, "ended_at": None}]
    name = upload(client, robot_id="dog1").json()["url"].rsplit("/", 1)[1]
    assert name.startswith("r3_dog1_camera_")
    # an explicit run_id wins
    name = upload(client, robot_id="dog1", run_id="7").json()["url"].rsplit("/", 1)[1]
    assert name.startswith("r7_dog1_")


def test_run_id_zero_when_database_unreachable(client, fake_stdb):
    fake_stdb.sql_down = True
    name = upload(client).json()["url"].rsplit("/", 1)[1]
    assert name.startswith("r0_")


def test_robot_id_is_sanitized(client):
    name = upload(client, robot_id="dog_1/../x").json()["url"].rsplit("/", 1)[1]
    assert NAME.match(name)
    assert NAME.match(name).group(2) == "dog-1----x"


def test_path_traversal_is_400(client):
    assert client.get("/media/..%2F..%2Fetc%2Fpasswd").status_code == 400
    assert client.get("/media/a%20b.jpg").status_code == 400
    assert client.get("/media/sub/dir.jpg").status_code == 400


def test_unknown_name_is_404(client):
    assert client.get("/media/r0_dog1_camera_20261108T031522Z_00000000.jpg").status_code == 404


def test_bad_extension_is_415(client):
    assert upload(client, filename="run.exe").status_code == 415
    assert upload(client, filename="noext").status_code == 415


def test_too_large_is_413(app, client, cfg):
    cfg["media"]["max_mb"] = 0.0001  # about 100 bytes
    r = upload(client, data=b"x" * 500, filename="big.bin")
    assert r.status_code == 413
    leftovers = [p for p in (Path(cfg["paths"]["data_dir"]) / "media").rglob("*") if p.is_file()]
    assert leftovers == []


def test_save_bytes_indexes_like_post_media(client, app):
    saved = media.save_bytes(b"\x89PNG-fake", ext=".png", kind="terrain", robot_id="dog1", detection_id=5,
                             original_filename="frame.png")
    assert set(saved) == {"name", "path", "url"}
    assert NAME.match(saved["name"]).groups() == ("0", "dog1", "terrain", "png")
    row = app.state.store.get_media(saved["name"])
    assert row["detection_id"] == 5 and row["original_filename"] == "frame.png"
    got = client.get(f"/media/{saved['name']}")
    assert got.status_code == 200 and got.content == b"\x89PNG-fake"


def test_register_file_serves_derived_name(client, app, cfg, tmp_path):
    p = Path(cfg["paths"]["data_dir"]) / "derived" / "det_40" / "roi.jpg"
    p.parent.mkdir(parents=True)
    p.write_bytes(JPEG)
    saved = media.register_file(p, "det40_roi.jpg", detection_id=40)
    assert saved["url"] == "http://testserver/media/det40_roi.jpg"
    assert client.get("/media/det40_roi.jpg").content == JPEG


def test_cors_header_for_dashboard_origin(client):
    r = client.get("/health", headers={"Origin": "http://localhost:5180"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5180"
