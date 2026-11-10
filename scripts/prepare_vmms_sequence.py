"""Build a local, three-frame VMMS registration example from the TREE INS table.

The copied panoramas and mapped PCD are ignored by Git. Poses remain platform
approximations until camera lever arm, boresight, and panorama zero azimuth are
independently calibrated.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
from pathlib import Path

from prepare_vmms_sample import DEFAULT_FRAMES, DEFAULT_VMMS, world_from_flu


def transpose(matrix: list[list[float]]) -> list[list[float]]:
    return [list(row) for row in zip(*matrix)]


def multiply(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [[sum(a[i][k] * b[k][j] for k in range(len(b))) for j in range(len(b[0]))] for i in range(len(a))]


def pose(row: dict[str, str]) -> tuple[list[float], list[list[float]]]:
    position = [float(row[key]) for key in ("local_x", "local_y", "local_z")]
    rotation = world_from_flu(*(float(row[key]) for key in ("roll_rad", "pitch_rad", "heading_rad")))
    return position, rotation


def camera_to_local(base: dict[str, str], current: dict[str, str]) -> list[float]:
    base_position, base_rotation = pose(base)
    current_position, current_rotation = pose(current)
    # Point cloud: viewer = B * base_FLU. Camera viewer -> current_FLU = B^T.
    body_to_viewer = [[0, -1, 0], [0, 0, 1], [-1, 0, 0]]
    rotation = multiply(multiply(multiply(body_to_viewer, transpose(base_rotation)), current_rotation), transpose(body_to_viewer))
    delta = [[current_position[i] - base_position[i]] for i in range(3)]
    translation = multiply(multiply(body_to_viewer, transpose(base_rotation)), delta)
    return [rotation[0][0], rotation[0][1], rotation[0][2], translation[0][0],
            rotation[1][0], rotation[1][1], rotation[1][2], translation[1][0],
            rotation[2][0], rotation[2][1], rotation[2][2], translation[2][0],
            0, 0, 0, 1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vmms", type=Path, default=DEFAULT_VMMS)
    parser.add_argument("--frames", type=Path, default=DEFAULT_FRAMES)
    parser.add_argument("--cloud", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "sample-cloud.pcd")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "local-samples" / "jianshazui-sequence")
    parser.add_argument("--stream", default="jianshazui_pano_1")
    parser.add_argument("--base-frame", default="001298")
    parser.add_argument("--offsets", type=int, nargs="+", default=[-4, 0, 4])
    args = parser.parse_args()
    with args.frames.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = {row["frame_id"]: row for row in csv.DictReader(handle) if row["stream_id"] == args.stream}
    base = rows.get(args.base_frame)
    if base is None:
        raise SystemExit(f"Base frame {args.base_frame} not found")
    if not args.cloud.is_file():
        raise SystemExit(f"Mapped local cloud missing: {args.cloud}; run prepare_vmms_sample.py first")
    selection = []
    for offset in sorted(set(args.offsets)):
        frame_id = f"{int(args.base_frame) + offset:06d}"
        row = rows.get(frame_id)
        if row is None:
            raise SystemExit(f"Frame {frame_id} not found")
        source = args.vmms.parent / row["source_image_relpath"]
        if not source.is_file():
            raise SystemExit(f"Panorama missing: {source}")
        selection.append((row, source))
    args.output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.cloud, args.output / "sample-cloud.pcd")
    frame_records = []
    for row, source in selection:
        image_name = f"frame_{row['frame_id']}{source.suffix.lower()}"
        shutil.copyfile(source, args.output / image_name)
        frame_records.append({"image": image_name, "utcSeconds": float(row["utc_seconds"]),
                              "cameraToCloud": camera_to_local(base, row),
                              "sourceFrameId": row["frame_id"]})
    manifest = {"schemaVersion": "registration/1.0", "source": "TREE interpolated INS; platform approximation",
                "baseFrameId": args.base_frame,
                "limitations": "Camera lever arm, boresight, and panorama zero azimuth unverified; refine with tie points",
                "frames": frame_records}
    (args.output / "registration.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Prepared {len(frame_records)} panoramas in {args.output}")
    print("Import sample-cloud.pcd, all frame_*.jpg, and registration.json in Data Sources")


if __name__ == "__main__":
    main()
