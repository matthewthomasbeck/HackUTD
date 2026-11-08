"""Indexed local media storage. Original filenames never determine disk paths."""
from datetime import datetime, timezone
import hashlib
import mimetypes
from pathlib import Path
import re
import uuid
import httpx

EXTENSIONS = {".jpg", ".jpeg", ".png", ".mp4", ".mkv", ".avi", ".h264", ".mov", ".wav", ".npy", ".json", ".csv", ".bin"}
KINDS = {"thermal", "camera", "clip", "terrain", "log", "voice"}


class MediaError(ValueError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


class Media:
    def __init__(self, config, store):
        self.config, self.store = config, store

    def save(self, stream, filename, run_id=0, robot_id="unknown", kind=None, detection_id=0):
        ext = Path(filename or "").suffix.lower()
        if ext not in EXTENSIONS:
            raise MediaError(415, "unsupported media extension")
        kind = kind or ("voice" if ext == ".wav" else "clip" if ext in {".mp4", ".mkv", ".avi", ".h264", ".mov"} else "camera" if ext in {".jpg", ".jpeg", ".png"} else "log")
        if kind not in KINDS:
            raise MediaError(422, "invalid media kind")
        if run_id < 0:
            raise MediaError(422, "invalid run id")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", robot_id):
            raise MediaError(422, "invalid robot id")
        now = datetime.now(timezone.utc)
        name = f"r{run_id}_{robot_id}_{kind}_{now.strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}{ext}"
        folder = self.config.data_dir / "media" / f"run_{run_id}" / robot_id
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / name
        temporary = path.with_suffix(path.suffix + ".part")
        digest, size = hashlib.sha256(), 0
        try:
            with temporary.open("wb") as output:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.config.upload_max_bytes:
                        raise MediaError(413, "media exceeds upload limit")
                    output.write(chunk)
                    digest.update(chunk)
            temporary.replace(path)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        record = dict(name=name, path=str(path.resolve()), kind=kind, run_id=run_id,
            robot_id=robot_id, detection_id=detection_id, original_filename=filename,
            bytes=size, sha256=digest.hexdigest(), created_at=now.isoformat())
        self.store.put("media", name, record)
        return self.config.public_base_url + "/media/" + name

    def lookup(self, name):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name in {".", ".."}:
            raise MediaError(400, "invalid media name")
        record = self.store.get("media", name)
        if not record or not Path(record["path"]).is_file():
            raise MediaError(404, "media not found")
        return Path(record["path"])

    def resolve_url(self, url, kind="clip"):
        prefix = self.config.public_base_url + "/media/"
        if url.startswith(prefix):
            return self.lookup(url[len(prefix):])
        if not url.startswith(("http://", "https://")):
            raise MediaError(422, "media URL must use HTTP or HTTPS")
        # Remote imports are bounded exactly like uploads. The laptop receives
        # URLs from the robot on its local network, so private hosts are valid.
        import tempfile
        from urllib.parse import urlparse
        with tempfile.TemporaryFile() as temporary:
            with httpx.stream("GET", url, timeout=10, follow_redirects=True) as response:
                response.raise_for_status()
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > self.config.upload_max_bytes:
                        raise MediaError(413, "media exceeds upload limit")
                    temporary.write(chunk)
            temporary.seek(0)
            new_url = self.save(temporary, Path(urlparse(url).path).name, kind=kind)
        return self.lookup(new_url.rsplit("/",1)[1])

    def register_derived(self, path, name):
        path = Path(path)
        if not path.exists():
            return None
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise MediaError(400, "invalid derived media name")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        self.store.put("media", name, {"name":name, "path":str(path.resolve()),
            "kind":"derived", "bytes":path.stat().st_size, "sha256":digest})
        return self.config.public_base_url + "/media/" + name
