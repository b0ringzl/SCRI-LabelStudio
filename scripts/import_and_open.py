"""Import a new SLAM dataset, then open its prepared scene on loopback only."""
import argparse
from datetime import datetime
from pathlib import Path
import shutil
import subprocess
from import_scene_dataset import prepare

ROOT = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('dataset', nargs='?', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--max-frames', type=int, default=0)
    p.add_argument('--point-budget', type=int, default=1800000)
    p.add_argument('--world-axes', choices=['z-up', 'y-up'], default='z-up')
    p.add_argument('--camera-axes', choices=['flu', 'opencv', 'viewer'], default='flu')
    p.add_argument('--matrix-direction', choices=['camera-to-world', 'world-to-camera'], default='camera-to-world')
    p.add_argument('--no-open', action='store_true')
    a = p.parse_args()
    dataset = a.dataset or Path(input('Dataset folder (DenseMap.pcd + CameraPoseInSlam.csv + panoramas): ').strip().strip('"'))
    if a.max_frames < 0 or a.point_budget < 1000 or a.point_budget > 8000000:
        p.error('max-frames must be >= 0; point-budget must be 1000..8000000')
    output = a.output or ROOT / 'local-samples' / ('import-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    node = shutil.which('node')
    if not node: raise SystemExit('Node.js 20+ is required')
    if (ROOT/'package.json').exists():
        npm = shutil.which('npm')
        if not npm: raise SystemExit('npm is required in a source checkout')
        if not (ROOT/'node_modules'/'vite').exists(): subprocess.run([npm, 'ci'], cwd=ROOT, check=True)
        subprocess.run([npm, 'run', 'build'], cwd=ROOT, check=True)
    if not (ROOT/'dist'/'index.html').exists(): raise SystemExit('Build missing: run npm run build first')
    prepare(dataset, output, a.max_frames, a.point_budget, a.world_axes, a.camera_axes, a.matrix_direction)
    print(f'Prepared scene: {output.resolve()}', flush=True)
    command = [node, str(ROOT/'scripts'/'serve.mjs'), '--scene-dir', str(output.resolve())]
    if a.no_open: command.append('--no-open')
    subprocess.run(command, cwd=ROOT, check=True)


if __name__ == '__main__': main()
