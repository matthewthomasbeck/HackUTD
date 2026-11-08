"""Download pinned MPSC-RR videos and prepare unlabelled 20 s E1 inputs.

Run from any directory with Python 3.11+ and ffmpeg/ffprobe on PATH.
No breathing-rate measurements are invented when reference labels are absent.
"""

import csv
import hashlib
import json
import shutil
import subprocess
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "testdata" / "public"


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url, destination, expected):
    if destination.exists() and sha256(destination) == expected:
        return
    temporary = destination.with_suffix(destination.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as response:
        with temporary.open("wb") as output:
            shutil.copyfileobj(response, output)
    if sha256(temporary) != expected:
        raise ValueError(f"Checksum mismatch: {destination.name}")
    temporary.replace(destination)


def probe(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-count_frames", "-show_entries",
         "stream=width,height,avg_frame_rate,nb_read_frames,duration",
         "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )
    stream = json.loads(result.stdout)["streams"][0]
    numerator, denominator = map(float, stream["avg_frame_rate"].split("/"))
    fps = numerator / denominator
    frames = int(stream["nb_read_frames"])
    if frames != 600 or abs(fps - 30) > 0.01:
        raise ValueError(f"Expected 600 frames at 30 fps: {path}")
    return {"fps": fps, "frames": frames, "duration_s": frames / fps,
            "width": stream["width"], "height": stream["height"]}


def main():
    for binary in ("ffmpeg", "ffprobe"):
        if not shutil.which(binary):
            raise SystemExit(f"Install {binary} before running this script.")
    manifest = json.loads((ROOT / "mpsc-rr.json").read_text())
    raw = ROOT / "raw"
    clips = ROOT / "clips"
    raw.mkdir(exist_ok=True)
    clips.mkdir(exist_ok=True)
    report = []
    for item in manifest["files"]:
        source = raw / Path(item["path"]).name
        url = (f"https://huggingface.co/datasets/{manifest['dataset']}/resolve/"
               f"{manifest['revision']}/{item['path']}")
        print(f"Fetching/verifying {source.name}", flush=True)
        download(url, source, item["sha256"])
        if source.stat().st_size != item["bytes"]:
            raise ValueError(f"Size mismatch: {source}")
        for start in (30, 60, 90, 120):
            destination = clips / f"{source.stem}_{start:03d}s.mp4"
            if not destination.exists():
                temporary = destination.with_name(destination.stem + ".part.mp4")
                subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                     "-ss", str(start), "-i", str(source), "-t", "20", "-an",
                     "-vf", "fps=30", "-c:v", "libx264", "-crf", "18",
                     "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(temporary)],
                    check=True,
                )
                probe(temporary)
                temporary.replace(destination)
            report.append({"file": str(destination.relative_to(ROOT)),
                           "subject": item["subject"], "split": item["split"],
                           "start_s": start, "source_url": url,
                           "sha256": sha256(destination), **probe(destination)})
    (ROOT / "prepared.json").write_text(json.dumps(report, indent=2) + "\n")
    truth = ROOT / "truth.csv"
    # Preserve future human annotations on repeat runs.
    if not truth.exists():
        with truth.open("w", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=[
                "file", "condition", "truth_bpm", "chest_visible", "who",
                "lighting", "coverage", "camera", "notes", "split", "label_source"])
            writer.writeheader()
            for clip in report:
                writer.writerow({"file": clip["file"], "condition": "public_rgb",
                                 "who": clip["subject"], "split": clip["split"],
                                 "label_source": "unlabelled",
                                 "notes": "Reference belt labels not distributed; exclude from accuracy metrics."})
    print(f"Prepared and decoded {len(report)} clips; rates remain unlabelled.")


if __name__ == "__main__":
    main()
