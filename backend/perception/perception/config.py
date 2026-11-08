"""Config loading (perception.md section 1).

Order, later wins:
1. config.toml (path from PERCEPTION_CONFIG, else backend/perception/config.toml)
2. .env (backend/perception/.env): the plain names in ENV_MAP below, for example STDB_URI
3. PERCEPTION_<SECTION>_<KEY> environment overrides, for example PERCEPTION_SCORE_RR_HIGH=32

load_config() returns a dict of sections, each a plain dict, so other modules can do
cfg["breathing"]["min_fps"]. The .env values are also put into os.environ (without
replacing values that are already set), so modules such as stt.py can read secrets like
NVIDIA_API_KEY from os.environ. Secrets are never copied into the returned dict.
"""

from __future__ import annotations

import copy
import json
import os
import tomllib
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/perception/
DEFAULT_CONFIG_PATH = BASE_DIR / "config.toml"
DEFAULT_ENV_PATH = BASE_DIR / ".env"

# Plain environment names (from .env.example) mapped to (section, key).
ENV_MAP: dict[str, tuple[str, str]] = {
    "STDB_URI": ("stdb", "uri"),
    "STDB_DATABASE": ("stdb", "database"),
    "STDB_TOKEN": ("stdb", "token"),
    "PUBLIC_BASE_URL": ("server", "public_base_url"),
    "CORS_ORIGINS": ("server", "cors_origins"),
    "STT_ENGINE": ("stt", "engine"),
    "RIVA_SERVER": ("stt", "riva_server"),
    "RIVA_FUNCTION_ID": ("stt", "riva_function_id"),
    "WHISPER_MODEL": ("stt", "whisper_model"),
}

PREFIX = "PERCEPTION_"


def parse_env_file(path: Path) -> dict[str, str]:
    """Read KEY=VALUE lines. Blank lines and # comments are skipped, and an unquoted value
    loses a trailing ' # comment' (the style .env.example uses)."""
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value[:1] in ("'", '"') and value[-1:] == value[:1] and len(value) >= 2:
            value = value[1:-1]
        else:
            hash_at = value.find(" #")
            if hash_at >= 0:
                value = value[:hash_at].rstrip()
            elif value.startswith("#"):
                value = ""
        out[key] = value
    return out


def _coerce(text: str, like):
    """Convert an environment string to the type of the existing config value."""
    if isinstance(like, bool):
        return text.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(like, int):
        try:
            return int(text)
        except ValueError:
            return float(text)
    if isinstance(like, float):
        return float(text)
    if isinstance(like, list):
        stripped = text.strip()
        if stripped.startswith("["):
            return json.loads(stripped)
        return [part.strip() for part in stripped.split(",") if part.strip()]
    return text


def _apply_overrides(cfg: dict, environ: dict[str, str]) -> None:
    """PERCEPTION_<SECTION>_<KEY>. The section is the longest known section name that fits,
    so a key with underscores (min_fps) still works."""
    sections = sorted(cfg.keys(), key=len, reverse=True)
    for name, text in environ.items():
        if not name.startswith(PREFIX):
            continue
        rest = name[len(PREFIX):].lower()
        for section in sections:
            if rest.startswith(section + "_"):
                key = rest[len(section) + 1:]
                if not key:
                    break
                like = cfg[section].get(key)
                cfg[section][key] = _coerce(text, like) if like is not None else text
                break


def load_config(path: str | os.PathLike | None = None, env_path: str | os.PathLike | None = None,
                environ: dict[str, str] | None = None) -> dict:
    """Load config.toml, then .env, then PERCEPTION_* overrides. Returns a new dict each call."""
    env = os.environ if environ is None else environ
    cfg_path = Path(path or env.get("PERCEPTION_CONFIG") or DEFAULT_CONFIG_PATH)
    with open(cfg_path, "rb") as fh:
        cfg = copy.deepcopy(tomllib.load(fh))
    for section in ("server", "paths", "media", "stdb", "breathing", "evm", "score", "terrain", "stt"):
        cfg.setdefault(section, {})

    dotenv_path = Path(env_path or env.get("PERCEPTION_ENV_FILE") or DEFAULT_ENV_PATH)
    dotenv = parse_env_file(dotenv_path)
    if environ is None:
        for key, value in dotenv.items():
            os.environ.setdefault(key, value)

    # .env first, then the real environment, so an exported variable beats the file.
    merged = dict(dotenv)
    merged.update({k: v for k, v in env.items() if k in ENV_MAP or k.startswith(PREFIX)})
    for name, (section, key) in ENV_MAP.items():
        if name in merged and merged[name] != "":
            cfg[section][key] = merged[name]
    _apply_overrides(cfg, merged)

    data_dir = Path(cfg["paths"].get("data_dir", "data"))
    if not data_dir.is_absolute():
        data_dir = BASE_DIR / data_dir
    cfg["paths"]["data_dir"] = str(data_dir)
    cfg["server"]["public_base_url"] = str(cfg["server"].get("public_base_url", "")).rstrip("/")
    origins = cfg["server"].get("cors_origins", "")
    if isinstance(origins, str):
        origins = [o.strip() for o in origins.split(",") if o.strip()]
    cfg["server"]["cors_origins"] = origins
    return cfg
