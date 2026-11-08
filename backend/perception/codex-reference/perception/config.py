"""Configuration loaded from TOML, with explicit environment overrides."""
from dataclasses import dataclass, field
import os
from pathlib import Path
import tomllib

ROOT = Path(__file__).resolve().parents[1]

SCORE_DEFAULTS = dict(rr_high=30, rr_low=10, v_buried=0.3, b_absent=1.0,
                      b_abnormal=0.9, b_normal=0.3, w_breath=0.5, w_buried=0.3,
                      w_wait=0.2, wait_full_min=30, absent_conf_cap=0.3,
                      rescore_interval_s=60, rescore_min_delta=2.0, rescore_conf_delta=0.05)


@dataclass
class Config:
    data_dir: Path = field(default_factory=lambda: ROOT / "data")
    public_base_url: str = "http://localhost:8080"
    stdb_uri: str = ""
    stdb_database: str = ""
    stdb_token: str = ""
    cors_origins: list = field(default_factory=lambda: ["http://localhost:5180"])
    upload_max_bytes: int = 200 * 1024 * 1024
    breathing: dict = field(default_factory=dict)
    score: dict = field(default_factory=lambda: dict(SCORE_DEFAULTS))
    terrain: dict = field(default_factory=lambda: dict(enabled=False, evaluated=False,
        terrain_min_conf=0.5, terrain_max_age_s=5, terrain_write_db=False))
    stt_engine: str = "none"
    whisper_model: str = "small.en"
    nvidia_api_key: str = ""
    riva_server: str = ""
    riva_function_id: str = ""
    riva_model: str = ""


def load_config(path=None):
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=False)
    cfg = Config()
    path = Path(path or ROOT / "config.toml")
    if path.exists():
        values = tomllib.loads(path.read_text())
        cfg.breathing.update(values.get("breathing", {}))
        cfg.score.update(values.get("score", {}))
        cfg.terrain.update(values.get("terrain", {}))
    for name in ("public_base_url", "stdb_uri", "stdb_database", "stdb_token", "stt_engine",
                 "whisper_model", "nvidia_api_key", "riva_server", "riva_function_id", "riva_model"):
        if name.upper() in os.environ:
            setattr(cfg, name, os.environ[name.upper()])
    if "PERCEPTION_DATA_DIR" in os.environ:
        cfg.data_dir = Path(os.environ["PERCEPTION_DATA_DIR"])
    if "CORS_ORIGINS" in os.environ:
        cfg.cors_origins = os.environ["CORS_ORIGINS"].split(",")
    for section in ("breathing", "score", "terrain"):
        mapping = getattr(cfg, section)
        for key, value in os.environ.items():
            prefix = f"PERCEPTION_{section.upper()}_"
            if key.startswith(prefix):
                field_name = key[len(prefix):].lower()
                try:
                    mapping[field_name] = tomllib.loads("value = " + value)["value"]
                except tomllib.TOMLDecodeError:
                    mapping[field_name] = value
    cfg.public_base_url = cfg.public_base_url.rstrip("/")
    return cfg
