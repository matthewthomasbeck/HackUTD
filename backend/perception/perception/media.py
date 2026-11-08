"""Media storage, naming, and the index (perception.md section 2).

Files are stored under data/media/run_<run_id>/<robot_id>/<name>, where
<name> = r<run_id>_<robot_id>_<kind>_<YYYYmmddTHHMMSSZ>_<8 hex>.<ext>.
The client filename is never used on disk; only its lowercased extension is kept,
and the original filename goes into the index. Files are never deleted.

Other modules (terrain, the person check) call save_bytes() and register_file();
both index the file exactly like POST /media.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import secrets
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Callable
from urllib.parse import urlparse

log = logging.getLogger(__name__)

NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
CHUNK = 1024 * 1024

# Default kind when the form does not send one (perception.md section 2: "default from the extension").
KIND_BY_EXT = {
    ".jpg": "camera", ".jpeg": "camera", ".png": "camera",
    ".mp4": "clip", ".mkv": "clip", ".avi": "clip", ".h264": "clip", ".mov": "clip",
    ".wav": "voice",
    ".npy": "thermal",
    ".json": "log", ".csv": "log", ".bin": "log",
}


class MediaError(Exception):
    """A request problem with an HTTP status (400, 404, 413, 415)."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


_lock = threading.Lock()
_ctx: dict = {"cfg": None, "store": None, "run_id_provider": None}


def configure(cfg: dict, store, run_id_provider: Callable[[], int] | None = None) -> None:
    """Called by app.create_app(). Modules that call save_bytes() before that get a lazy default."""
    with _lock:
        _ctx["cfg"] = cfg
        _ctx["store"] = store
        _ctx["run_id_provider"] = run_id_provider


def set_run_id_provider(fn: Callable[[], int] | None) -> None:
    with _lock:
        _ctx["run_id_provider"] = fn


def _context():
    with _lock:
        if _ctx["cfg"] is None:
            from .config import load_config
            from .store import Store
            cfg = load_config()
            _ctx["cfg"] = cfg
            _ctx["store"] = Store(Path(cfg["paths"]["data_dir"]) / "perception.db")
        return _ctx["cfg"], _ctx["store"], _ctx["run_id_provider"]


def data_dir() -> Path:
    cfg, _, _ = _context()
    return Path(cfg["paths"]["data_dir"])


def media_root() -> Path:
    return data_dir() / "media"


def derived_root() -> Path:
    return data_dir() / "derived"


def normalize_ext(ext_or_name: str | None) -> str:
    """'.MP4', 'mp4', or 'clip.MP4' -> '.mp4'. Raises 415 if not allowed."""
    cfg, _, _ = _context()
    allowed = [e.lower() for e in cfg["media"]["allowed_ext"]]
    text = (ext_or_name or "").strip().lower()
    if "." in text:
        ext = "." + text.rsplit(".", 1)[1]
    elif text:
        ext = "." + text
    else:
        ext = ""
    if ext not in allowed:
        raise MediaError(415, f"extension not allowed: {ext or '(none)'}")
    return ext


def kind_for(kind: str | None, ext: str) -> str:
    cfg, _, _ = _context()
    if not kind:
        return KIND_BY_EXT.get(ext, "log")
    kind = kind.strip().lower()
    if kind not in cfg["media"]["kinds"]:
        raise MediaError(400, f"unknown kind: {kind}")
    return kind


def safe_robot_id(robot_id: str | None) -> str:
    """Letters, digits, and '-' only, because '_' separates the parts of a file name."""
    text = re.sub(r"[^A-Za-z0-9-]", "-", (robot_id or "").strip())[:32].strip("-")
    return text or "unknown"


def active_run_id(run_id: int | None) -> int:
    """A given run_id wins; 0 or None means the active run from SpacetimeDB, else 0."""
    if run_id:
        return int(run_id)
    _, _, provider = _context()
    if provider is None:
        return 0
    try:
        return int(provider() or 0)
    except Exception as exc:  # noqa: BLE001 - the database being down must not block uploads
        log.debug("run id lookup failed: %s", exc)
        return 0


def make_name(run_id: int, robot_id: str, kind: str, ext: str, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    return f"r{run_id}_{robot_id}_{kind}_{stamp}_{secrets.token_hex(4)}{ext}"


def max_bytes() -> int:
    cfg, _, _ = _context()
    return int(float(cfg["media"]["max_mb"]) * 1024 * 1024)


def url_for(name: str) -> str:
    cfg, _, _ = _context()
    return f"{cfg['server']['public_base_url']}/media/{name}"


def save_stream(fileobj: BinaryIO, *, ext: str, kind: str | None, robot_id: str | None = None,
                run_id: int | None = 0, detection_id: int | None = None,
                original_filename: str | None = None) -> dict:
    """Copy a file object into storage with the size limit, hash it, and index it.
    Returns {"name", "path", "url"}."""
    _, store, _ = _context()
    ext = normalize_ext(ext)
    kind = kind_for(kind, ext)
    robot = safe_robot_id(robot_id)
    run = active_run_id(run_id)
    name = make_name(run, robot, kind, ext)
    folder = media_root() / f"run_{run}" / robot
    folder.mkdir(parents=True, exist_ok=True)
    limit = max_bytes()

    digest = hashlib.sha256()
    size = 0
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".upload_")
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = fileobj.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise MediaError(413, f"file larger than {limit} bytes")
                digest.update(chunk)
                out.write(chunk)
        final = folder / name
        os.replace(tmp, final)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise

    store.add_media(name=name, path=str(final), kind=kind, robot_id=robot, run_id=run,
                    detection_id=detection_id, original_filename=original_filename,
                    size=size, sha256=digest.hexdigest())
    return {"name": name, "path": str(final), "url": url_for(name)}


def save_bytes(data: bytes, *, ext: str, kind: str, robot_id: str = "unknown", run_id: int = 0,
               detection_id: int | None = None, original_filename: str | None = None) -> dict:
    """Store bytes exactly like POST /media. run_id 0 means the active run (or 0 if none).
    Returns {"name", "path", "url"}. Raises MediaError (415, 413, 400)."""
    import io
    return save_stream(io.BytesIO(data), ext=ext, kind=kind, robot_id=robot_id, run_id=run_id,
                       detection_id=detection_id, original_filename=original_filename)


def register_file(path: str | Path, name: str, *, kind: str = "derived", robot_id: str = "unknown",
                  run_id: int = 0, detection_id: int | None = None) -> dict:
    """Index a file this service wrote itself (result images, spectrum, EVM clip) under a fixed
    name such as det40_roi.jpg, so GET /media/<name> serves it. Returns {"name", "path", "url"}."""
    _, store, _ = _context()
    if not NAME_RE.match(name):
        raise MediaError(400, f"bad media name: {name}")
    p = Path(path)
    digest = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(CHUNK), b""):
            digest.update(chunk)
    store.add_media(name=name, path=str(p.resolve()), kind=kind, robot_id=robot_id, run_id=run_id,
                    detection_id=detection_id, original_filename=None, size=p.stat().st_size,
                    sha256=digest.hexdigest())
    return {"name": name, "path": str(p.resolve()), "url": url_for(name)}


def lookup(name: str) -> dict:
    """Index row for a name. 400 for a bad name (blocks path traversal), 404 if unknown or gone."""
    _, store, _ = _context()
    if not name or not NAME_RE.match(name):
        raise MediaError(400, "bad media name")
    row = store.get_media(name)
    if row is None or not Path(row["path"]).is_file():
        raise MediaError(404, "not found")
    return row


def local_name_for_url(url: str) -> str | None:
    """The media name if the URL points at this server (PUBLIC_BASE_URL/media/<name>)."""
    cfg, _, _ = _context()
    prefix = f"{cfg['server']['public_base_url']}/media/"
    if url.startswith(prefix):
        name = url[len(prefix):].split("?", 1)[0]
        return name if NAME_RE.match(name) else None
    return None


def resolve_url(url: str, *, kind: str = "clip", robot_id: str | None = None,
                detection_id: int | None = None, client=None) -> dict:
    """Clip URL to a local file (perception.md section 3): read it from the index when it is on
    this server, else download it with httpx into data/media/ first. Returns {"name","path","url"}."""
    name = local_name_for_url(url)
    if name is not None:
        row = lookup(name)
        return {"name": name, "path": row["path"], "url": url}
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise MediaError(400, "clip_url must be http or https")
    import httpx
    cfg, _, _ = _context()
    timeout = float(cfg["media"].get("download_timeout_s", 30))
    own_client = client is None
    client = client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise MediaError(400, f"clip_url download failed with HTTP {resp.status_code}")
            ext = normalize_ext(Path(parsed.path).name)

            class _Reader:
                def __init__(self, it):
                    self._it = it

                def read(self, _n=-1):
                    return next(self._it, b"")

            saved = save_stream(_Reader(resp.iter_bytes(CHUNK)), ext=ext, kind=kind, robot_id=robot_id,
                                detection_id=detection_id, original_filename=Path(parsed.path).name)
    finally:
        if own_client:
            client.close()
    return saved
