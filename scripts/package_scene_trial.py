"""Bundle the prebuilt platform app with local trial data; outputs stay private."""
import argparse
import json
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', type=Path, default=ROOT/'local-samples'/'trial-jsz-dense55m-001298')
    parser.add_argument('--release', type=Path, default=ROOT/'release')
    args = parser.parse_args()
    metadata = json.loads((args.scene/'source-metadata.json').read_text(encoding='utf-8'))
    version = json.loads((ROOT/'package.json').read_text())['version']
    for platform in ('Windows', 'macOS'):
        root = f'SCRI-Scene-JSZ{metadata["baseFrame"]}-{platform}-v{version}'
        target = args.release/f'{root}.zip'
        source = args.release/f'AtlasStudio-{platform}-v{version}.zip'
        with zipfile.ZipFile(source) as app, zipfile.ZipFile(target, 'w') as out:
            for item in app.infolist():
                rel = item.filename.split('/', 1)[1]
                if rel == 'README.md': continue
                info = zipfile.ZipInfo(f'{root}/{rel}')
                info.external_attr = item.external_attr; info.create_system = item.create_system
                out.writestr(info, app.read(item), compress_type=zipfile.ZIP_DEFLATED)
            for path in args.scene.rglob('*'):
                if path.is_file():
                    out.write(path, f'{root}/scene-data/{path.relative_to(args.scene).as_posix()}',
                              compress_type=zipfile.ZIP_STORED if path.suffix == '.jpg' else zipfile.ZIP_DEFLATED)
            launcher = f'Start-Scene-{platform}.bat' if platform == 'Windows' else 'Start-Scene-macOS.command'
            code = ('@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\ncall Start-Atlas-Windows.bat --scene-dir "%~dp0scene-data" %*\r\n'
                    if platform == 'Windows' else '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec sh ./Start-Atlas-macOS.command --scene-dir "$(pwd)/scene-data" "$@"\n')
            info = zipfile.ZipInfo(f'{root}/{launcher}'); info.create_system = 3
            info.external_attr = (stat.S_IFREG | (0o755 if platform == 'macOS' else 0o644)) << 16
            out.writestr(info, code, compress_type=zipfile.ZIP_DEFLATED)
            readme = f'''# 尖沙咀街景平台试用 · {platform} · {version}

本包已包含平台与真实数据：{metadata['sampledPointCount']:,} 个 RGB 点、{metadata['imageCount']} 张原始全景，行进距离约 {metadata['sampledTrajectoryLengthMeters']:.1f} m。

安装 Node.js 20+ 后，解压整个目录并运行 `{launcher}`。macOS 也可在终端运行 `sh ./{launcher}`。启动器会显示实际本机地址并打开场景，无需在浏览器中选择文件。

按“粗配准 → 同名点精调 → 投影核验”操作；两侧拖动、滚轮双向同步，上一帧/下一帧同步相机位置。可切换分屏和全宽投影；相机数值与算法服务在更多设置。点云可切换高程、亮度和原色显示。精调时选 6–10 对分散的静态地物角点，求解并核验后进入标注。标注后保存并导出。保持启动窗口运行；重新打开同一地址可恢复已保存记录。

此场景使用 INS 粗位姿；显式全景零方位假设为 {metadata.get('panoramaYawOffsetDeg', 0)}°，仅作待核验的粗初值。原始 INS-only 位姿（如有）保存在 scene-data/registration-ins-only.json。未应用待确认 CSV，未验证 4° 精度。原始数据只读挂载，私有数据包不上传 GitHub。两平台共用同一数据格式。详细说明见 docs/SYNCHRONIZED_REGISTRATION.md。
'''
            out.writestr(f'{root}/README.md', readme, compress_type=zipfile.ZIP_DEFLATED)
        with zipfile.ZipFile(target) as z:
            if z.testzip() is not None: raise ValueError('Corrupt scene app bundle')
        print(f'{target} ({target.stat().st_size/2**20:.1f} MiB)')


if __name__ == '__main__': main()
