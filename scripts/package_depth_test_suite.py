"""Copy validated paired scenes and build private Windows/macOS DA2 test ZIPs.

Standard library only. Run --verify DIRECTORY on a prepared or extracted suite.
Only catalog-referenced PCD, poses, metadata and panoramas are copied; source
survey assets are never altered and are not part of the GitHub release workflow.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def inside(root, relative):
    # Reject Windows and POSIX escapes even when building on the other platform.
    if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
        raise ValueError("Invalid portable asset path")
    rel = PurePosixPath(relative)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError("Asset path escapes suite")
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Asset is outside scene or is not a file")
    return path


def pcd_count(path):
    fields = {}
    with path.open("rb") as stream:
        for _ in range(100):
            raw = stream.readline(8192)
            if not raw or len(raw) >= 8192:
                raise ValueError("Invalid PCD header")
            line = raw.decode("ascii").strip()
            if not line or line.startswith("#"):
                continue
            key, _, value = line.partition(" ")
            fields[key] = value.strip()
            if key == "DATA":
                break
        else:
            raise ValueError("Invalid PCD header")
        names = fields["FIELDS"].split()
        sizes = list(map(int, fields["SIZE"].split()))
        types = fields["TYPE"].split()
        counts = list(map(int, fields.get("COUNT", " ".join(["1"] * len(names))).split()))
        if (fields["DATA"] != "binary" or not {"x", "y", "z"}.issubset(names)
                or len({len(names), len(sizes), len(counts), len(types)}) != 1
                or any(size not in (1, 2, 4, 8) for size in sizes)
                or any(value <= 0 for value in counts) or any(t not in ("F", "I", "U") for t in types)):
            raise ValueError("Test scenes require binary XYZ PCD")
        count = int(fields["POINTS"])
        if count <= 0 or int(fields["WIDTH"]) * int(fields["HEIGHT"]) != count:
            raise ValueError("PCD point count mismatch")
        expected = count * sum(s * c for s, c in zip(sizes, counts))
        padding = path.stat().st_size - stream.tell() - expected
        if padding < 0 or padding > 65536:
            raise ValueError("Truncated PCD or unexpected trailer")
        stream.seek(expected, 1)
        if stream.read().strip(b"\0\r\n\t "):
            raise ValueError("Unexpected PCD trailer")
    if path.stat().st_size > 150 * 1024 * 1024:
        raise ValueError("Prepared cloud exceeds browser 150 MiB limit")
    return count


def image_size(path):
    with path.open("rb") as stream:
        signature = stream.read(24)
        if signature.startswith(b"\x89PNG\r\n\x1a\n") and signature[12:16] == b"IHDR":
            return struct.unpack(">II", signature[16:24])
        if signature[:2] != b"\xff\xd8":
            raise ValueError("Expected JPEG or PNG panorama")
        stream.seek(2)
        while True:
            if stream.read(1) != b"\xff":
                raise ValueError("Invalid JPEG marker")
            marker = stream.read(1)
            while marker == b"\xff":
                marker = stream.read(1)
            if not marker or marker in (b"\xd9", b"\xda"):
                raise ValueError("JPEG dimensions not found")
            length_bytes = stream.read(2)
            if len(length_bytes) != 2:
                raise ValueError("Truncated JPEG")
            length = struct.unpack(">H", length_bytes)[0]
            if length < 2:
                raise ValueError("Invalid JPEG segment")
            if marker[0] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                payload = stream.read(5)
                if len(payload) != 5:
                    raise ValueError("Truncated JPEG dimensions")
                height, width = struct.unpack(">HH", payload[1:])
                return width, height
            stream.seek(length - 2, 1)


def check_pose(matrix):
    if (not isinstance(matrix, list) or len(matrix) != 16
            or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in matrix)
            or any(abs(a - b) > 1e-5 for a, b in zip(matrix[12:], (0, 0, 0, 1)))):
        raise ValueError("Invalid row-major cameraToCloud matrix")
    rows = [matrix[i:i+3] for i in (0, 4, 8)]
    for i in range(3):
        for j in range(3):
            if abs(sum(a*b for a, b in zip(rows[i], rows[j])) - (1 if i == j else 0)) > 0.002:
                raise ValueError("cameraToCloud rotation is not orthonormal")
    a, b, c = rows
    det = a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0])
    if abs(det - 1) > 0.002:
        raise ValueError("cameraToCloud rotation is reflected")


def inspect_catalog(root):
    root = root.resolve()
    catalog_path = inside(root, "scene-catalog.json")
    catalog = read_json(catalog_path)
    entries = catalog.get("scenes", [])
    if catalog.get("schemaVersion") != "scene-catalog/1.0" or not 1 <= len(entries) <= 100:
        raise ValueError("Invalid scene catalog")
    assets = {"scene-catalog.json": catalog_path}
    scenes = []
    seen = set()
    for entry in entries:
        key = entry["key"]
        directory = entry["directory"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", key) or key in seen:
            raise ValueError("Invalid/duplicate scene key")
        seen.add(key)
        # Validate directory through its mandatory file, including symlink containment.
        registration_path = inside(root, directory + "/registration.json")
        folder = registration_path.parent
        if folder != (root / directory).resolve():
            raise ValueError("Registration symlink changes scene directory")
        registration = read_json(registration_path)
        frames = registration.get("frames", [])
        if registration.get("schemaVersion") != "registration/1.0" or not 1 <= len(frames) <= 1000:
            raise ValueError("Invalid scene registration")
        metadata = read_json(inside(folder, "source-metadata.json"))
        cloud = inside(folder, "scene-cloud.pcd")
        count = pcd_count(cloud)
        if metadata.get("sampledPointCount") != count:
            raise ValueError("Metadata and PCD point count disagree")
        names = set()
        images = []
        for frame in frames:
            name = frame["image"]
            if (not isinstance(name, str) or PurePosixPath(name).name != name or "\\" in name
                    or not re.search(r"\.(jpe?g|png)$", name, re.I) or name in names):
                raise ValueError("Invalid/duplicate panorama name")
            names.add(name)
            check_pose(frame["cameraToCloud"])
            rel = f"{directory}/panoramas/{name}"
            image = inside(folder, "panoramas/" + name)
            width, height = image_size(image)
            if width <= 0 or height <= 0 or width != 2 * height:
                raise ValueError("Panorama must be full 2:1 ERP: " + name)
            assets[rel] = image
            images.append({"image": name, "width": width, "height": height})
        base = metadata.get("baseFrameName") or (f"frame_{metadata['baseFrame']}.jpg" if metadata.get("baseFrame") else frames[0]["image"])
        if base not in names:
            raise ValueError("Base frame has no image and pose")
        for name in ("registration.json", "source-metadata.json", "scene-cloud.pcd"):
            assets[f"{directory}/{name}"] = inside(folder, name)
        scenes.append({"key": key, "directory": directory, "name": entry.get("name", key),
                       "pointCount": count, "frameCount": len(frames), "baseFrame": base,
                       "cloudBytes": cloud.stat().st_size, "images": images,
                       "registrationStatus": metadata.get("registrationStatus", "Unverified source poses")})
    return catalog, scenes, assets


def prepare_suite(source, output, plan_path):
    catalog, scenes, assets = inspect_catalog(source)
    plan = read_json(plan_path)
    if plan.get("schemaVersion") != "depth-test-plan/1.0" or plan.get("groundTruthAvailable") is not False:
        raise ValueError("Plan must explicitly declare no independent ground truth")
    by_key = {s["key"]: s for s in scenes}
    if plan.get("defaultSceneKey") not in by_key:
        raise ValueError("Default test scene not found")
    cases = plan.get("cases", [])
    if not cases:
        raise ValueError("No test cases")
    for case in cases:
        scene = by_key.get(case.get("sceneKey"))
        if not scene or case.get("frame") not in {i["image"] for i in scene["images"]}:
            raise ValueError("Test case has no paired image and pose")
    if set(by_key) != {c["sceneKey"] for c in cases}:
        raise ValueError("Every bundled scene needs at least one test case")
    output = output.resolve()
    # Refuse overwrites, including existing annotations, models or source data.
    output.mkdir(parents=True, exist_ok=False)
    target = output / "scene-data"
    target.mkdir()
    files = {}
    for rel, path in sorted(assets.items()):
        destination = target / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        files["scene-data/" + rel] = {"bytes": destination.stat().st_size, "sha256": digest(destination)}
    # Only catalog ordering/default changes; every scene's original pose/image/cloud is byte-identical.
    catalog["defaultSceneKey"] = plan["defaultSceneKey"]
    catalog["scenes"].sort(key=lambda entry: entry["key"] != plan["defaultSceneKey"])
    write_json(target / "scene-catalog.json", catalog)
    files["scene-data/scene-catalog.json"] = {"bytes": (target/"scene-catalog.json").stat().st_size, "sha256": digest(target/"scene-catalog.json")}
    shutil.copyfile(plan_path, output / "test-plan.json")
    files["test-plan.json"] = {"bytes": (output/"test-plan.json").stat().st_size, "sha256": digest(output/"test-plan.json")}
    manifest = {"schemaVersion": "depth-test-suite/1.0", "appVersion": read_json(ROOT/"package.json")["version"],
                "source": "User-provided paired survey scenes; local/private distribution only",
                "groundTruthAvailable": False, "modelOutputsUsedToCreateClouds": False,
                "coordinates": "Prepared viewer coordinates: +X right, +Y up, -Z forward; row-major cameraToCloud. Do not convert again.",
                "scenes": scenes, "files": files}
    write_json(output / "test-suite.json", manifest)
    shutil.copyfile(ROOT/"docs/DEPTH_TEST_SCENES.md", output/"TEST_GUIDE.md")
    verify_suite(output)
    return manifest


def verify_suite(directory):
    directory = directory.resolve()
    manifest = read_json(inside(directory, "test-suite.json"))
    if manifest.get("schemaVersion") != "depth-test-suite/1.0":
        raise ValueError("Invalid test suite")
    for rel, record in manifest["files"].items():
        path = inside(directory, rel)
        if path.stat().st_size != record["bytes"] or digest(path) != record["sha256"]:
            raise ValueError("Checksum mismatch: " + rel)
    _, scenes, assets = inspect_catalog(directory/"scene-data")
    if scenes != manifest["scenes"]:
        # Catalog may be reordered to put the recommended scene first.
        if sorted(scenes, key=lambda s: s["key"]) != sorted(manifest["scenes"], key=lambda s: s["key"]):
            raise ValueError("Scene manifest disagrees with actual paired data")
    if set(manifest["files"]) != {"scene-data/"+rel for rel in assets} | {"test-plan.json"}:
        raise ValueError("Incomplete checksum inventory")
    return manifest


def launcher(platform):
    if platform == "Windows":
        return '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\ncall Start-Atlas-Windows.bat --scene-dir "%~dp0scene-data" --port 44010 %*\r\n'
    return '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec sh ./Start-Atlas-macOS.command --scene-dir "$(pwd)/scene-data" --port 44010 "$@"\n'


def package_suite(prepared, release, platform):
    manifest = verify_suite(prepared)
    version = manifest["appVersion"]
    folder = f"SCRI-DepthTests-{platform}-v{version}"
    destination = release / (folder + ".zip")
    # Exclusive creation prevents silent replacement of a previous test deliverable.
    with zipfile.ZipFile(release/f"AtlasStudio-{platform}-v{version}.zip") as app:
        app_entries = []
        for item in app.infolist():
            path = PurePosixPath(item.filename)
            if path.is_absolute() or ".." in path.parts or len(path.parts) < 2 or "\\" in item.filename:
                raise ValueError("Invalid application ZIP path")
            rel = "/".join(path.parts[1:])
            if rel != "README.md":
                app_entries.append((item, rel))
        with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
            for item, rel in app_entries:
                info = zipfile.ZipInfo(f"{folder}/{rel}")
                info.create_system = item.create_system
                info.external_attr = item.external_attr
                out.writestr(info, app.read(item), compress_type=zipfile.ZIP_DEFLATED)
            for rel in [*manifest["files"], "test-suite.json", "TEST_GUIDE.md"]:
                path = inside(prepared, rel)
                out.write(path, f"{folder}/{rel}", compress_type=zipfile.ZIP_STORED if path.suffix.lower() in (".jpg", ".jpeg", ".png") else zipfile.ZIP_DEFLATED)
            for rel in ("scripts/package_depth_test_suite.py", "docs/DEPTH_TEST_SCENES.md"):
                out.write(ROOT/rel, f"{folder}/{rel}")
            name = "Start-Tests-Windows.bat" if platform == "Windows" else "Start-Tests-macOS.command"
            info = zipfile.ZipInfo(f"{folder}/{name}")
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | (0o755 if platform == "macOS" else 0o644)) << 16
            out.writestr(info, launcher(platform))
            out.writestr(f"{folder}/README.md", f"# DA² 配对场景测试包 · {platform}\n\n完整解压后运行 `{name}`。macOS 可执行 `sh ./{name}`。需要 Node.js 20+；新电脑首次使用 DA² 先运行本包的 Setup-Depth 启动器。详见 TEST_GUIDE.md。\n\n模型、Python 环境与权重不在 ZIP 内。共 {len(manifest['scenes'])} 个真实场景、{sum(s['frameCount'] for s in manifest['scenes'])} 张原始全景；位姿为未独立验收的粗初值。数据留在本地，勿提交公开仓库。\n", compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None:
            raise ValueError("Corrupt test suite ZIP")
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, help="Directory containing scene-catalog.json")
    parser.add_argument("--output", type=Path, help="New private prepared suite directory")
    parser.add_argument("--plan", type=Path, default=ROOT/"examples/registration/depth-test-plan.json")
    parser.add_argument("--release", type=Path, default=ROOT/"release")
    parser.add_argument("--verify", type=Path, help="Verify a prepared or extracted suite; no model needed")
    parser.add_argument("--package-prepared", type=Path, help="Package an already prepared suite without copying data again")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    if args.verify:
        manifest = verify_suite(args.verify)
        print(f"PASS: {len(manifest['scenes'])} paired scenes, all listed asset hashes and formats verified")
        return
    if args.package_prepared:
        for platform in ("Windows", "macOS"):
            archive = package_suite(args.package_prepared, args.release, platform)
            print(f"{archive}: {archive.stat().st_size/2**20:.1f} MiB; SHA256 {digest(archive)}", flush=True)
        return
    if not args.catalog or not args.output:
        parser.error("--catalog and --output are required when preparing a suite")
    manifest = prepare_suite(args.catalog, args.output, args.plan)
    print(f"Prepared {len(manifest['scenes'])} scenes / {sum(s['frameCount'] for s in manifest['scenes'])} panoramas", flush=True)
    if not args.prepare_only:
        for platform in ("Windows", "macOS"):
            archive = package_suite(args.output, args.release, platform)
            print(f"{archive}: {archive.stat().st_size/2**20:.1f} MiB; SHA256 {digest(archive)}", flush=True)


if __name__ == "__main__":
    main()
