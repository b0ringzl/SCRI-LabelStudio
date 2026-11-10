#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 scripts/setup_depth.py "$@"
printf '\nDA2 ready. Start Atlas and select DA2 in Registration.\n'
