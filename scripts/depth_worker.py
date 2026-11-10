"""Pinned official DA2 inference + scale-aware local geometry adapter.

Source and checkpoint stay outside Git. Official model modules are imported
unchanged; CLI/Gradio/training dependencies are not needed by this adapter.
"""
from __future__ import annotations
import argparse
import base64
from contextlib import nullcontext, redirect_stdout
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import subprocess
import time
import types
import cv2
import numpy as np
from depth_geometry import VERSION, align_depth

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT/'scripts/da2-release.json').read_text(encoding='utf-8'))
SOURCE = ROOT/'local-models/DA-2'
WEIGHTS = ROOT/'local-models/da2-weights'/LOCK['filename']
CACHE = ROOT/'local-samples/depth-cache'


def status():
    try:
        import torch
        import torchvision
        import safetensors
        import einops
        import huggingface_hub
        if not WEIGHTS.is_file() or WEIGHTS.stat().st_size != LOCK['bytes']:
            raise RuntimeError('请运行 Setup-Depth 下载并校验 DA2 权重')
        if not (SOURCE/'src/da2/model/spherevit.py').is_file():
            raise RuntimeError('缺少 DA2 官方源码，请运行 Setup-Depth')
        revision = subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'],
            text=True, stderr=subprocess.DEVNULL, timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0).strip()
        if revision != LOCK['sourceRevision']:
            raise RuntimeError('DA2 源码版本与锁文件不一致，请运行 Setup-Depth')
        if subprocess.run(['git', '-C', str(SOURCE), 'diff', '--quiet', '--', 'src', 'configs'],
            timeout=5, creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0).returncode:
            raise RuntimeError('DA2 官方源码有本地修改，请先检查版本；未静默覆盖')
        device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
        return {'configured': True, 'label': 'DA² 全景深度辅助配准', 'device': device,
                'algorithmVersion': VERSION, 'modelRevision': LOCK['modelRevision'],
                'weightsRequired': True}
    except Exception as error:
        return {'configured': False, 'weightsRequired': True, 'reason': str(error)}


def predict(rgb):
    import torch
    from safetensors.torch import load_file
    # Namespace import intentionally skips da2/__init__.py, whose demo-only
    # exports otherwise require Accelerate, utils3d and visualization packages.
    package = types.ModuleType('atlas_da2_release')
    package.__path__ = [str(SOURCE/'src/da2')]
    sys.modules[package.__name__] = package
    with redirect_stdout(sys.stderr):
        model_class = importlib.import_module('atlas_da2_release.model.spherevit').SphereViT
        config = json.loads((SOURCE/'configs/infer.json').read_text(encoding='utf-8'))
        model = model_class(config)
        model.load_state_dict(load_file(str(WEIGHTS), device='cpu'), strict=True)
        chosen = os.environ.get('ATLAS_DEPTH_DEVICE', 'auto')
        if chosen not in ('auto', 'cpu', 'cuda', 'mps'):
            raise ValueError('ATLAS_DEPTH_DEVICE must be auto/cpu/cuda/mps')
        device = ('cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu') if chosen=='auto' else chosen
        torch.set_num_threads(min(8, os.cpu_count() or 4))
        torch.manual_seed(42)
        model.to(device).eval()
        image = torch.from_numpy(np.ascontiguousarray(rgb.transpose(2, 0, 1))).float().unsqueeze(0).to(device)/255.
        amp = torch.autocast('cuda', dtype=torch.float16) if device=='cuda' else nullcontext()
        started = time.monotonic()
        with torch.inference_mode(), amp:
            depth = model(image).float().cpu().numpy()[0]
        duration = time.monotonic()-started
        memory = float(torch.cuda.max_memory_allocated()/1024**3) if device=='cuda' else 0.
    if not np.isfinite(depth).all() or np.min(depth) <= 0:
        raise ValueError('DA2 returned invalid radial depth; no candidate generated')
    return depth.astype(np.float32), {'device': device, 'inferenceSeconds': duration, 'peakGpuGiB': memory}


def solve(payload):
    started = time.monotonic()
    if payload.get('schemaVersion') != 'registration-depth/1.0':
        raise ValueError('Unsupported depth registration schema')
    encoded = payload['imageDataUrl'].split(',', 1)[1]
    raw = base64.b64decode(encoded, validate=True)
    bgr = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if bgr is None or not 1.9 <= bgr.shape[1]/bgr.shape[0] <= 2.1 or max(bgr.shape[:2]) > 8192:
        raise ValueError('Need a valid 2:1 equirectangular RGB panorama')
    # Exactly the official inference grid (14-pixel backbone patches).
    bgr = cv2.resize(bgr, (1092, 546), interpolation=cv2.INTER_AREA)
    key = hashlib.sha256(raw+LOCK['sha256'].encode()+VERSION.encode()).hexdigest()
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE/(key+'.npz')
    cached = cache_file.is_file()
    metadata = {}
    if cached:
        try:
            with np.load(cache_file, allow_pickle=False) as saved:
                depth = saved['depth']
                metadata = json.loads(str(saved['metadata']))
            if depth.shape != (546, 1092) or not np.isfinite(depth).all() or depth.min() <= 0:
                raise ValueError('Invalid cache')
        except Exception:
            cached = False
    if not cached:
        depth, metadata = predict(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        temporary = CACHE/(key+'.partial.npz')
        np.savez_compressed(temporary, depth=depth, metadata=json.dumps(metadata))
        temporary.replace(cache_file)
    log_depth = np.log(np.maximum(depth, 1e-6))
    near, far = np.percentile(log_depth, [2, 98])
    color = cv2.applyColorMap(np.clip((log_depth-near)/max(far-near, 1e-6)*255, 0, 255).astype('uint8'), cv2.COLORMAP_TURBO)
    preview = base64.b64encode(cv2.imencode('.jpg', color, [cv2.IMWRITE_JPEG_QUALITY, 88])[1]).decode()
    try:
        result = align_depth(payload['points'], depth, payload['prior'])
    except ValueError as error:
        result = {'status': 'rejected', 'reason': str(error), 'registration': payload['prior'],
                  'metrics': {}, 'independentlyVerified': False}
    result.update({'schemaVersion': 'registration-depth/1.0', 'frameId': payload['frameId'],
                   'algorithmVersion': VERSION, 'method': 'da2', 'signal': 'predicted-radial-depth',
                   'modelRevision': LOCK['modelRevision'], 'sourceRevision': LOCK['sourceRevision'],
                   'depthPreviewDataUrl': 'data:image/jpeg;base64,'+preview,
                   'depthWidth': int(depth.shape[1]), 'depthHeight': int(depth.shape[0]),
                   'cacheHit': cached, 'inference': metadata,
                   'durationSeconds': time.monotonic()-started,
                   'depthIsMetric': False, 'confidenceIsLearned': False})
    return result


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.check:
        print(json.dumps(status(), ensure_ascii=False))
        return
    ready = status()
    if not ready['configured']:
        raise RuntimeError(ready['reason'])
    payload = json.loads(args.input.read_text(encoding='utf-8')) if args.input else json.load(sys.stdin)
    result = solve(payload)
    output = json.dumps(result, ensure_ascii=False, allow_nan=False)
    if args.output:
        args.output.write_text(output, encoding='utf-8')
    else:
        print(output)


if __name__ == '__main__':
    main()
