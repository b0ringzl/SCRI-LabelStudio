"""Create small, shareable point-cloud and panorama fixtures without external packages."""

from __future__ import annotations

import random
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
RANDOM = random.Random(17)


def create_cloud() -> None:
    points: list[tuple[float, float, float, float]] = []

    def add(x: float, y: float, z: float, intensity: float) -> None:
        points.append((x + RANDOM.uniform(-0.025, 0.025),
                       y + RANDOM.uniform(-0.025, 0.025),
                       z + RANDOM.uniform(-0.025, 0.025), intensity))

    for ix in range(64):
        for iz in range(54):
            add(-15 + ix * 30 / 63, -1.5, -3 - iz * 29 / 53, 35)
    for ix in range(70):
        for iy in range(42):
            add(-9 + ix * 18 / 69, -1.5 + iy * 14 / 41, -24, 66)
    for side in (-1, 1):
        for iz in range(46):
            for iy in range(34):
                add(side * 10.5, -1.5 + iy * 12 / 33, -4 - iz * 21 / 45, 57)
    for ix in range(25):
        for iy in range(14):
            add(-1.5 + ix * 3 / 24, 2.5 + iy * 1.5 / 13, -13, 82)

    header = (
        "# Synthetic Atlas Studio fixture; no real location or scan\n"
        "VERSION .7\nFIELDS x y z intensity\nSIZE 4 4 4 4\n"
        "TYPE F F F F\nCOUNT 1 1 1 1\n"
        f"WIDTH {len(points)}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {len(points)}\nDATA ascii\n"
    )
    with (PUBLIC / "demo-cloud.pcd").open("w", encoding="ascii", newline="\n") as output:
        output.write(header)
        for x, y, z, intensity in points:
            output.write(f"{x:.4f} {y:.4f} {z:.4f} {intensity:.1f}\n")


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))


def create_panorama() -> None:
    width, height = 1024, 512
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            if y < 252:
                color = (91 + y // 18, 158 + y // 30, 207 + y // 42)
            else:
                color = (76 + (y - 252) // 28, 86 + (y - 252) // 25, 93 + (y - 252) // 24)
            if 310 <= x <= 715 and 151 <= y <= 391:
                color = (169, 175, 174)
                if (x - 310) % 42 < 25 and (y - 151) % 42 < 26:
                    color = (68, 103, 124)
            if (145 <= x <= 288 or 742 <= x <= 880) and 207 <= y <= 408:
                color = (154, 145, 134)
                if x % 35 < 19 and y % 39 < 24:
                    color = (67, 91, 105)
            if 477 <= x <= 548 and 299 <= y <= 336:
                color = (203, 73, 89)
            if 483 <= x <= 541 and 305 <= y <= 330:
                color = (239, 226, 196)
            rows.extend(color)
    raw = b"\x89PNG\r\n\x1a\n"
    raw += png_chunk(b"IHDR", struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0))
    raw += png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9))
    raw += png_chunk(b"IEND", b"")
    (PUBLIC / "demo-panorama.png").write_bytes(raw)


if __name__ == "__main__":
    PUBLIC.mkdir(exist_ok=True)
    create_cloud()
    create_panorama()
    print("Created synthetic demo-cloud.pcd and demo-panorama.png")
