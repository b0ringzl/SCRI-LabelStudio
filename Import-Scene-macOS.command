#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .venv-scene-import/bin/python ]; then
  python3 -m venv .venv-scene-import
fi
if ! .venv-scene-import/bin/python -c 'import numpy, cv2' >/dev/null 2>&1; then
  .venv-scene-import/bin/python -m pip install -r scripts/requirements-scene-import.txt
fi
exec .venv-scene-import/bin/python scripts/import_and_open.py "$@"
