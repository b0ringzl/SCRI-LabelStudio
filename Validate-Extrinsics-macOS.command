#!/bin/sh
set -eu
if [ "$#" -ne 4 ]; then
  echo 'Usage: sh Validate-Extrinsics-macOS.command "VMMS_FOLDER" "FRAME_CSV" "EXTRINSICS_CSV" "OUTPUT_FOLDER"'
  exit 2
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 "$script_dir/scripts/validate_extrinsics.py" --vmms "$1" --frames "$2" --extrinsics "$3" --output "$4"
