"""Bundle only catalog-listed scenes with each platform app. Outputs stay private."""
import argparse
import json
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--catalog', type=Path, required=True)
    p.add_argument('--release', type=Path, default=ROOT/'release')
    args = p.parse_args()
    root = args.catalog.resolve()
    catalog = json.loads((root/'scene-catalog.json').read_text(encoding='utf-8'))
    assets = [root/'scene-catalog.json']
    for scene in catalog['scenes']:
        directory = (root/scene['directory']).resolve()
        if not directory.is_relative_to(root): raise ValueError('Scene directory escapes catalog')
        assets.extend(path for path in directory.rglob('*') if path.is_file())
    version = json.loads((ROOT/'package.json').read_text())['version']
    for platform in ('Windows', 'macOS'):
        folder = f'SCRI-Generalization-{platform}-v{version}'
        target = args.release/f'{folder}.zip'
        with zipfile.ZipFile(args.release/f'AtlasStudio-{platform}-v{version}.zip') as app, zipfile.ZipFile(target, 'w') as out:
            for item in app.infolist():
                rel = item.filename.split('/', 1)[1]
                if rel == 'README.md': continue
                info = zipfile.ZipInfo(f'{folder}/{rel}'); info.create_system = item.create_system; info.external_attr = item.external_attr
                out.writestr(info, app.read(item), compress_type=zipfile.ZIP_DEFLATED)
            for path in assets:
                out.write(path, f'{folder}/scene-data/{path.relative_to(root).as_posix()}', compress_type=zipfile.ZIP_STORED if path.suffix.lower() in ('.jpg', '.png') else zipfile.ZIP_DEFLATED)
            launcher = 'Start-Suite-Windows.bat' if platform == 'Windows' else 'Start-Suite-macOS.command'
            code = ('@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\ncall Start-Atlas-Windows.bat --scene-dir "%~dp0scene-data" %*\r\n' if platform == 'Windows'
                    else '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec sh ./Start-Atlas-macOS.command --scene-dir "$(pwd)/scene-data" "$@"\n')
            info = zipfile.ZipInfo(f'{folder}/{launcher}'); info.create_system = 3
            info.external_attr = (stat.S_IFREG | (0o755 if platform == 'macOS' else 0o644)) << 16
            out.writestr(info, code)
            out.writestr(f'{folder}/README.md', f'''# 四场景验证版 · {platform} · {version}

安装 Node.js 20+，完整解压后运行 `{launcher}`。macOS 可运行 `sh ./{launcher}`。
左侧主流程为“数据 → 配准 → 标注 → 训练”。在“数据”中选择校园、六层、图书馆或尖沙咀卡片；通过上一帧/下一帧切换，共 32 张原始全景。标注页不再混入配准工具。点径可用滑杆、＋/−及固定像素模式调整，点云标题栏可放大窗口。设计与操作见 docs/WORKFLOW_UI_0.13.0.md。

前三组使用各自的源 SLAM 位姿，未套用尖沙咀的朝向。尖沙咀保留 INS + 180° 待核验初值，增加全部 12 个 DS 分块的全局概览，总 6,215,955 点。概览保留地图范围，采用降采样；局部 450 万真实 RGB 点继续保留。全局灰度为强度显示，不是真实颜色。

同步测试通过不等于配准精度通过；本包未证明 4° 误差。不同设备坐标约定必须确认。新数据可运行 Import-Scene 启动器，详见 docs/SCENE_IMPORT_VALIDATION.md。原始数据只读，标注按场景 ID 隔离保存于浏览器。数据包只留在本地，不上传 GitHub。Windows 已实测；macOS 桌面图形性能需实体机器复核。
''', compress_type=zipfile.ZIP_DEFLATED)
        with zipfile.ZipFile(target) as archive:
            if archive.testzip() is not None: raise ValueError('Corrupt private bundle')
        print(f'{target} ({target.stat().st_size/2**20:.1f} MiB)', flush=True)


if __name__ == '__main__': main()
