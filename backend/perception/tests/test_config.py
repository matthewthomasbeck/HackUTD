"""config.py path resolution (perception.md section 1)."""

from perception.config import BASE_DIR, load_config


def test_yolo_weights_dir_follows_data_dir(tmp_path):
    # rehearsal 2026-11-08: yolo_weights_dir ignored paths.data_dir, so the weights went to
    # backend/perception/data/weights even when the data folder was elsewhere
    env = {"PERCEPTION_PATHS_DATA_DIR": str(tmp_path / "elsewhere")}
    cfg = load_config(env_path=tmp_path / "missing.env", environ=env)
    assert cfg["breathing"]["yolo_weights_dir"] == str(tmp_path / "elsewhere" / "weights")


def test_relative_and_absolute_yolo_weights_dir(tmp_path):
    env = {"PERCEPTION_BREATHING_YOLO_WEIGHTS_DIR": "pose"}
    cfg = load_config(env_path=tmp_path / "missing.env", environ=env)
    assert cfg["breathing"]["yolo_weights_dir"] == str(BASE_DIR / "data" / "pose")
    env = {"PERCEPTION_BREATHING_YOLO_WEIGHTS_DIR": str(tmp_path / "w")}
    cfg = load_config(env_path=tmp_path / "missing.env", environ=env)
    assert cfg["breathing"]["yolo_weights_dir"] == str(tmp_path / "w")
