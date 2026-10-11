"""Create self-contained Windows and macOS ZIPs from the same Vite build."""

from __future__ import annotations

import json
import stat
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
RELEASE = ROOT / "release"
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]


def add_file(archive: zipfile.ZipFile, source: Path, destination: str, executable: bool = False) -> None:
    info = zipfile.ZipInfo(destination)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    permissions = stat.S_IFREG | (0o755 if executable else 0o644)
    info.external_attr = permissions << 16
    data = source.read_bytes()
    if source.suffix.lower() == ".bat":
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)


def package(platform: str, launcher: str, readme: str) -> Path:
    folder = f"AtlasStudio-{platform}-v{VERSION}"
    target = RELEASE / f"{folder}.zip"
    with zipfile.ZipFile(target, "w") as archive:
        for source in sorted(DIST.rglob("*")):
            if source.is_file():
                if source.parent == DIST and source.name in {
                    "sample-cloud.pcd", "sample-panorama.jpg", "sample-metadata.json"
                }:
                    continue
                add_file(archive, source, f"{folder}/dist/{source.relative_to(DIST).as_posix()}")
        add_file(archive, ROOT / "scripts" / "serve.mjs", f"{folder}/scripts/serve.mjs")
        add_file(archive, ROOT / "scripts" / "llmGateway.mjs", f"{folder}/scripts/llmGateway.mjs")
        add_file(archive, ROOT / "examples" / "mock-model-server.mjs", f"{folder}/examples/mock-model-server.mjs")
        add_file(archive, ROOT / launcher, f"{folder}/{launcher}", executable=launcher.endswith(".command"))
        add_file(archive, ROOT / "docs" / readme, f"{folder}/README.md")
        add_file(archive, ROOT / "docs" / "ROAD_FURNITURE_REVIEW.md", f"{folder}/docs/ROAD_FURNITURE_REVIEW.md")
        add_file(archive, ROOT / "docs" / "MODEL_API.md", f"{folder}/docs/MODEL_API.md")
        add_file(archive, ROOT / "docs" / "MODEL_SWITCHING.md", f"{folder}/docs/MODEL_SWITCHING.md")
        add_file(archive, ROOT / "docs" / "MERGE_NOTES_2026-10-09.md", f"{folder}/docs/MERGE_NOTES_2026-10-09.md")
        add_file(archive, ROOT / "docs" / "LLM_PROVIDERS.md", f"{folder}/docs/LLM_PROVIDERS.md")
        add_file(archive, ROOT / "docs" / "DISTILLATION_API.md", f"{folder}/docs/DISTILLATION_API.md")
        add_file(archive, ROOT / "docs" / "UI_DESIGN.md", f"{folder}/docs/UI_DESIGN.md")
        add_file(archive, ROOT / "docs" / "UI_ARCHITECTURE.md", f"{folder}/docs/UI_ARCHITECTURE.md")
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise RuntimeError(f"Corrupt archive: {target}")
    return target


def main() -> None:
    if not (DIST / "index.html").is_file():
        raise SystemExit("dist/index.html 不存在；请先执行 npm run build")
    RELEASE.mkdir(exist_ok=True)
    for platform, launcher, readme in (
        ("Windows", "Start-Atlas-Windows.bat", "README-Windows.md"),
        ("macOS", "Start-Atlas-macOS.command", "README-macOS.md"),
    ):
        target = package(platform, launcher, readme)
        print(f"{target} ({target.stat().st_size / 1024 / 1024:.2f} MiB)")


if __name__ == "__main__":
    main()
