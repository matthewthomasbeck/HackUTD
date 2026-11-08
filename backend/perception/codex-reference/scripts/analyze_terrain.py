"""Run experimental zero-shot CLIP on existing images without enabling advice."""
import argparse
import json
from pathlib import Path
import sys
import time
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from perception.config import load_config
from perception.terrain import TerrainClassifier


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("images",type=Path,nargs="+")
    args = parser.parse_args()
    model = TerrainClassifier(load_config())
    result = []
    for image in args.images:
        start = time.monotonic()
        label,confidence = model.predict_baseline(image)
        result.append(dict(file=str(image),terrain_class=label,confidence=confidence,
            elapsed_s=round(time.monotonic()-start,3),experimental=True,ground_truth=None))
    print(json.dumps(result,indent=2))


if __name__ == "__main__":
    main()
