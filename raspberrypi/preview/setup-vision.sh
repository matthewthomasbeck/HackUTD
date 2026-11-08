#!/bin/sh
# One-time laptop dependency setup. Nothing is installed globally.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python_bin=${1:-python3}
"$python_bin" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'
"$python_bin" -m venv "$script_dir/.venv"
"$script_dir/.venv/bin/python" -m pip install -r "$script_dir/requirements-vision.txt"
echo "Inference Python: $script_dir/.venv/bin/python"
