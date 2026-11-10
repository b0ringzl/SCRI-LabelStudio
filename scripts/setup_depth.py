"""Install pinned DA2 source/weights in this project only (Windows/macOS).

Requires Python 3.10+ and Git. This script never activates or modifies another
project's environment. TORCH is intentionally separate for platform wheels.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import venv

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT/'scripts/da2-release.json').read_text(encoding='utf-8'))
SOURCE = ROOT/'local-models/DA-2'
WEIGHTS = ROOT/'local-models/da2-weights'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8*1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def download_weights():
    WEIGHTS.mkdir(parents=True, exist_ok=True)
    target = WEIGHTS/LOCK['filename']
    if target.is_file() and target.stat().st_size == LOCK['bytes'] and digest(target) == LOCK['sha256']:
        print('Checkpoint SHA-256 verified', flush=True)
        return
    partial = target.with_suffix('.partial')
    # A failed transfer never becomes the active checkpoint.
    url = f"https://huggingface.co/{LOCK['modelRepository']}/resolve/{LOCK['modelRevision']}/{LOCK['filename']}"
    last = time.monotonic()
    with urllib.request.urlopen(url, timeout=90) as response, partial.open('wb') as stream:
        count = 0
        while block := response.read(4*1024*1024):
            stream.write(block)
            count += len(block)
            if time.monotonic()-last > 8:
                print(f'Checkpoint {count/1e6:.0f}/{LOCK["bytes"]/1e6:.0f} MB', flush=True)
                last = time.monotonic()
    if partial.stat().st_size != LOCK['bytes'] or digest(partial) != LOCK['sha256']:
        raise RuntimeError('Checkpoint size or SHA-256 mismatch; original checkpoint retained')
    partial.replace(target)
    (WEIGHTS/'verified.json').write_text(json.dumps(LOCK, indent=2), encoding='utf-8')
    print('Checkpoint downloaded and SHA-256 verified', flush=True)


def setup_source():
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    if not SOURCE.exists():
        subprocess.run(['git', 'clone', LOCK['repository'], str(SOURCE)], check=True)
    actual = subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != LOCK['sourceRevision']:
        dirty = subprocess.check_output(['git', '-C', str(SOURCE), 'status', '--porcelain'], text=True)
        if dirty.strip():
            raise RuntimeError('DA2 source has local changes; it was not overwritten')
        subprocess.run(['git', '-C', str(SOURCE), 'fetch', 'origin', LOCK['sourceRevision']], check=True)
        subprocess.run(['git', '-C', str(SOURCE), 'checkout', '--detach', LOCK['sourceRevision']], check=True)
    print('DA2 source pinned: '+LOCK['sourceRevision'], flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--weights-only', action='store_true')
    parser.add_argument('--assets-only', action='store_true')
    parser.add_argument('--cpu', action='store_true', help='Install CPU torch wheels (CUDA not required)')
    args = parser.parse_args()
    if args.weights_only:
        download_weights()
        return
    setup_source()
    if not args.assets_only:
        if sys.platform == 'darwin' and platform.machine() != 'arm64':
            raise SystemExit('DA2 local setup currently targets Apple Silicon macOS; Intel Macs can still run the UI and NID backend')
        if sys.version_info < (3, 10):
            raise SystemExit('Python 3.10+ is required')
        environment = ROOT/'.venv-da2'
        python = environment/('python.exe' if (environment/'conda-meta').is_dir() and os.name=='nt'
                              else 'Scripts/python.exe' if os.name=='nt' else 'bin/python')
        if not python.is_file():
            venv.EnvBuilder(with_pip=True).create(environment)
        command = [str(python), '-m', 'pip', 'install', 'torch==2.5.0', 'torchvision==0.20.0']
        if sys.platform != 'darwin':
            command += ['--index-url', 'https://download.pytorch.org/whl/'+('cpu' if args.cpu else 'cu124')]
        subprocess.run(command, check=True)
        subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT/'scripts/requirements-depth.txt')], check=True)
    download_weights()
    print('DA2 assets ready. Run the Start-Atlas launcher; select DA2 in registration.', flush=True)


if __name__ == '__main__':
    main()
