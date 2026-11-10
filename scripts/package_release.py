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
        add_file(archive, ROOT / "scripts" / "localSceneGateway.mjs", f"{folder}/scripts/localSceneGateway.mjs")
        add_file(archive, ROOT / "scripts" / "sceneCatalogGateway.mjs", f"{folder}/scripts/sceneCatalogGateway.mjs")
        for name in ("pointcloud_io.py", "import_scene_dataset.py", "import_and_open.py", "complete_scene_coverage.py", "package_generalization_suite.py", "requirements-scene-import.txt", "extract_registration_poses.py"):
            add_file(archive, ROOT / "scripts" / name, f"{folder}/scripts/{name}")
        add_file(archive, ROOT / "scripts" / "llmGateway.mjs", f"{folder}/scripts/llmGateway.mjs")
        for name in ("registrationGateway.mjs", "registration_worker.py", "setup_registration.py", "requirements-registration.txt"):
            add_file(archive, ROOT / "scripts" / name, f"{folder}/scripts/{name}")
        for name in ("depthGateway.mjs", "depth_worker.py", "depth_geometry.py", "setup_depth.py", "requirements-depth.txt", "da2-release.json"):
            add_file(archive, ROOT / "scripts" / name, f"{folder}/scripts/{name}")
        depth_setup = "Setup-Depth-Windows.bat" if platform == "Windows" else "Setup-Depth-macOS.command"
        add_file(archive, ROOT / depth_setup, f"{folder}/{depth_setup}", executable=platform == "macOS")
        for name in ("DEPTH_REGISTRATION.md", "CHANGELOG_0.16.0.md"):
            add_file(archive, ROOT / "docs" / name, f"{folder}/docs/{name}")
        setup = "Setup-Registration-Windows.bat" if platform == "Windows" else "Setup-Registration-macOS.command"
        add_file(archive, ROOT / setup, f"{folder}/{setup}", executable=platform == "macOS")
        for name in ("AUTOMATIC_REGISTRATION.md", "CHANGELOG_0.15.0.md"):
            add_file(archive, ROOT / "docs" / name, f"{folder}/docs/{name}")
        add_file(archive, ROOT / "scripts" / "prepare_vmms_sample.py", f"{folder}/scripts/prepare_vmms_sample.py")
        add_file(archive, ROOT / "scripts" / "prepare_vmms_sequence.py", f"{folder}/scripts/prepare_vmms_sequence.py")
        add_file(archive, ROOT / "scripts" / "prepare_trial_scene.py", f"{folder}/scripts/prepare_trial_scene.py")
        add_file(archive, ROOT / "scripts" / "package_scene_trial.py", f"{folder}/scripts/package_scene_trial.py")
        for name in ("validate_extrinsics.py", "validate_vendor_color_control.py", "test_extrinsics_validation.py", "requirements-extrinsics-validation.txt"):
            add_file(archive, ROOT / "scripts" / name, f"{folder}/scripts/{name}")
        add_file(archive, ROOT / "examples" / "mock-model-server.mjs", f"{folder}/examples/mock-model-server.mjs")
        add_file(archive, ROOT / "examples" / "registration" / "poses-two-frames.json", f"{folder}/examples/registration/poses-two-frames.json")
        add_file(archive, ROOT / launcher, f"{folder}/{launcher}", executable=launcher.endswith(".command"))
        validation_launcher = "Validate-Extrinsics-Windows.bat" if platform == "Windows" else "Validate-Extrinsics-macOS.command"
        add_file(archive, ROOT / validation_launcher, f"{folder}/{validation_launcher}", executable=platform == "macOS")
        import_launcher = "Import-Scene-Windows.bat" if platform == "Windows" else "Import-Scene-macOS.command"
        add_file(archive, ROOT / import_launcher, f"{folder}/{import_launcher}", executable=platform == "macOS")
        add_file(archive, ROOT / "docs" / readme, f"{folder}/README.md")
        add_file(archive, ROOT / "docs" / "ROAD_FURNITURE_REVIEW.md", f"{folder}/docs/ROAD_FURNITURE_REVIEW.md")
        add_file(archive, ROOT / "docs" / "MODEL_API.md", f"{folder}/docs/MODEL_API.md")
        add_file(archive, ROOT / "docs" / "MODEL_SWITCHING.md", f"{folder}/docs/MODEL_SWITCHING.md")
        add_file(archive, ROOT / "docs" / "MERGE_NOTES_2026-10-09.md", f"{folder}/docs/MERGE_NOTES_2026-10-09.md")
        add_file(archive, ROOT / "docs" / "LLM_PROVIDERS.md", f"{folder}/docs/LLM_PROVIDERS.md")
        add_file(archive, ROOT / "docs" / "DISTILLATION_API.md", f"{folder}/docs/DISTILLATION_API.md")
        add_file(archive, ROOT / "docs" / "FEATURE_HANDOFF.md", f"{folder}/docs/FEATURE_HANDOFF.md")
        add_file(archive, ROOT / "docs" / "UI_DESIGN.md", f"{folder}/docs/UI_DESIGN.md")
        add_file(archive, ROOT / "docs" / "UI_ARCHITECTURE.md", f"{folder}/docs/UI_ARCHITECTURE.md")
        add_file(archive, ROOT / "docs" / "REGISTRATION_WORKFLOW.md", f"{folder}/docs/REGISTRATION_WORKFLOW.md")
        for name in ("TRIAL_SCENE.md", "CHANGELOG_0.10.3.md", "SYNCHRONIZED_REGISTRATION.md", "CHANGELOG_0.11.0.md"):
            add_file(archive, ROOT / "docs" / name, f"{folder}/docs/{name}")
        for name in ("SCENE_IMPORT_VALIDATION.md", "CHANGELOG_0.12.0.md"):
            add_file(archive, ROOT / "docs" / name, f"{folder}/docs/{name}")
        for name in ("WORKFLOW_UI_0.13.0.md", "CHANGELOG_0.13.0.md", "CHANGELOG_0.13.1.md"):
            add_file(archive, ROOT / "docs" / name, f"{folder}/docs/{name}")
        for name in ("CHANGELOG_0.10.2.md", "EXTRINSICS_VALIDATION.md", "REGISTRATION_OPTIONS_4DEG.md", "REGISTRATION_PLAN-Windows.md", "REGISTRATION_PLAN-macOS.md"):
            add_file(archive, ROOT / "docs" / name, f"{folder}/docs/{name}")
        for name in ("PANORAMA_CONTOUR_EDITING.md", "CHANGELOG_0.14.0.md", "WALL_VOLUME_0.14.1.md", "CHANGELOG_0.14.1.md"):
            add_file(archive, ROOT / "docs" / name, f"{folder}/docs/{name}")
        add_file(archive, ROOT / "docs" / "TREE_REGISTRATION_TRANSFER.md", f"{folder}/docs/TREE_REGISTRATION_TRANSFER.md")
        add_file(archive, ROOT / "docs" / "REGISTRATION_MANUAL.md", f"{folder}/docs/REGISTRATION_MANUAL.md")
        for source in sorted((ROOT / "docs" / "manuals").rglob('*')):
            if source.is_file():
                add_file(archive, source, f"{folder}/docs/manuals/{source.relative_to(ROOT/'docs'/'manuals').as_posix()}")
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
