"""Prepare one small, camera-local VMMS pair for the browser prototype.

Reads the original survey and TREE's interpolated INS frame table without
modifying either. The source scan files are multi-gigabyte; the output is a
bounded, reservoir-sampled PCD near one Ladybug panorama.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import shutil
import struct
from pathlib import Path


DEFAULT_VMMS = Path.home() / "Desktop" / "receive" / "vmms" / "20250210-jianshazui"
DEFAULT_FRAMES = Path.home() / "Desktop" / "receive" / "TREE" / "hk-tree-vmms" / "outputs" / "coordinates" / "frame_coordinates.csv"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "public"


def matrix_multiply(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def world_from_flu(roll: float, pitch: float, heading: float) -> list[list[float]]:
    """Match TREE's ENU-from-forward/left/up INS convention."""
    sh, ch = math.sin(heading), math.cos(heading)
    cr, sr = math.cos(roll), math.sin(roll)
    cp, sp = math.cos(pitch), math.sin(pitch)
    level = [[sh, -ch, 0], [ch, sh, 0], [0, 0, 1]]
    roll_m = [[1, 0, 0], [0, cr, -sr], [0, sr, cr]]
    pitch_m = [[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]]
    return matrix_multiply(matrix_multiply(level, roll_m), pitch_m)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vmms", type=Path, default=DEFAULT_VMMS)
    parser.add_argument("--frames", type=Path, default=DEFAULT_FRAMES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--stream", default="jianshazui_pano_1")
    parser.add_argument("--frame", default="001298")
    parser.add_argument("--radius", type=float, default=42.0)
    parser.add_argument("--max-points", type=int, default=100_000)
    args = parser.parse_args()

    with args.frames.open("r", encoding="utf-8-sig", newline="") as handle:
        frame = next((row for row in csv.DictReader(handle) if row["stream_id"] == args.stream and row["frame_id"] == args.frame), None)
    if frame is None:
        raise SystemExit(f"Frame {args.stream}/{args.frame} not found")

    origin = [float(frame[key]) for key in ("local_x", "local_y", "local_z")]
    rotation = world_from_flu(*(float(frame[key]) for key in ("roll_rad", "pitch_rad", "heading_rad")))
    rng = random.Random(20261007)
    selected: list[tuple[float, float, float, float]] = []
    eligible = 0
    by_file: dict[str, int] = {}
    radius_sq = args.radius * args.radius

    for path in sorted((args.vmms / "pointcloud" / "mapping").glob("pointcloud_DS_*.pcd")):
        count = 0
        with path.open("r", encoding="ascii", errors="replace") as handle:
            for line in handle:
                if line.startswith("DATA "):
                    if line.strip() != "DATA ascii":
                        raise SystemExit(f"Expected ASCII PCD: {path}")
                    break
            for line in handle:
                parts = line.split()
                if len(parts) < 4:
                    continue
                try:
                    x, y, z, intensity = map(float, parts[:4])
                except ValueError:
                    continue
                dx, dy, dz = x - origin[0], y - origin[1], z - origin[2]
                if dx * dx + dy * dy > radius_sq or dz < -12 or dz > 60:
                    continue
                count += 1
                eligible += 1
                point = (dx, dy, dz, intensity)
                if len(selected) < args.max_points:
                    selected.append(point)
                else:
                    index = rng.randrange(eligible)
                    if index < args.max_points:
                        selected[index] = point
        if count:
            by_file[path.name] = count
    if not selected:
        raise SystemExit("No mapped points near the selected panorama")

    args.output.mkdir(parents=True, exist_ok=True)
    cloud_path = args.output / "sample-cloud.pcd"
    with cloud_path.open("wb") as handle:
        header = (
            "# .PCD v0.7 - Point Cloud Data file format\n"
            "VERSION 0.7\n"
            "FIELDS x y z intensity\n"
            "SIZE 4 4 4 4\n"
            "TYPE F F F F\n"
            "COUNT 1 1 1 1\n"
            f"WIDTH {len(selected)}\n"
            "HEIGHT 1\n"
            "VIEWPOINT 0 0 0 1 0 0 0\n"
            f"POINTS {len(selected)}\n"
            "DATA binary\n"
        )
        handle.write(header.encode("ascii"))
        for dx, dy, dz, intensity in selected:
            # camera/viewer: +X right, +Y up, -Z forward
            forward = rotation[0][0] * dx + rotation[1][0] * dy + rotation[2][0] * dz
            left = rotation[0][1] * dx + rotation[1][1] * dy + rotation[2][1] * dz
            up = rotation[0][2] * dx + rotation[1][2] * dy + rotation[2][2] * dz
            handle.write(struct.pack("<ffff", -left, up, -forward, intensity))

    image = args.vmms.parent / frame["source_image_relpath"]
    image_path = args.output / "sample-panorama.jpg"
    shutil.copyfile(image, image_path)
    metadata = {
        "source": "20250210-jianshazui",
        "stream_id": args.stream,
        "frame_id": args.frame,
        "utc_seconds": float(frame["utc_seconds"]),
        "local_origin_enu_m": origin,
        "ins_roll_pitch_heading_rad": [float(frame[key]) for key in ("roll_rad", "pitch_rad", "heading_rad")],
        "point_coordinate_system": "camera-local: +X right, +Y up, -Z forward",
        "panorama_projection": "u=0.5-atan2(left,forward)/(2*pi), v=0.5-asin(up/r)/pi",
        "registration_status": "INS platform-frame approximation; camera lever arm and boresight are unavailable",
        "source_panorama": frame["source_image_relpath"],
        "source_pointcloud_files": by_file,
        "eligible_points": eligible,
        "sampled_points": len(selected),
        "radius_m": args.radius,
    }
    (args.output / "sample-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"points": len(selected), "eligible": eligible, "sources": by_file, "image": str(image_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
