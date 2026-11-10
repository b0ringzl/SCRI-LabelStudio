"""Smoke-test both extracted platform ZIPs with a private two-scene fixture."""
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']


def main():
    with tempfile.TemporaryDirectory(prefix='scri-release-smoke-') as td:
        temp = Path(td).resolve()
        scenes = temp/'scenes'; scenes.mkdir()
        for key in ('alpha', 'beta'):
            folder = scenes/key; (folder/'panoramas').mkdir(parents=True)
            (folder/'scene-cloud.pcd').write_bytes(key.encode())
            (folder/'panoramas'/'1.jpg').write_bytes(key.encode())
            (folder/'registration.json').write_text(json.dumps({'frames':[{'image':'1.jpg','cameraToCloud':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]}))
        (scenes/'scene-catalog.json').write_text(json.dumps({'schemaVersion':'scene-catalog/1.0','scenes':[{'key':key,'directory':key} for key in ('alpha','beta')]}))
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for platform in ('Windows', 'macOS'):
            folder = f'AtlasStudio-{platform}-v{VERSION}'
            with zipfile.ZipFile(ROOT/'release'/f'{folder}.zip') as archive:
                for entry in archive.infolist():
                    assert (temp/entry.filename).resolve().is_relative_to(temp)
                if platform == 'macOS':
                    assert stat.S_IMODE(archive.getinfo(folder+'/Import-Scene-macOS.command').external_attr >> 16) == 0o755
                    assert stat.S_IMODE(archive.getinfo(folder+'/Setup-Registration-macOS.command').external_attr >> 16) == 0o755
                for worker in ('registration_worker.py','registrationGateway.mjs','setup_registration.py','requirements-registration.txt'):
                    assert archive.read(folder+'/scripts/'+worker) == (ROOT/'scripts'/worker).read_bytes()
                assert not any('/.venv-registration/' in item.filename for item in archive.infolist())
                assert archive.read(folder+'/dist/index.html') == (ROOT/'dist'/'index.html').read_bytes()
                for edition in ('Windows', 'macOS'):
                    assert archive.read(folder+f'/docs/manuals/Registration-Manual-{edition}.pdf').startswith(b'%PDF-')
                illustrations=json.loads(archive.read(folder+'/docs/manuals/figures/figures.json'))['figures']
                assert len(illustrations)==10
                for illustration in illustrations:
                    assert archive.read(folder+'/docs/manuals/figures/'+illustration['id']+'.svg').startswith(b'<svg')
                    for panel in illustration.get('panels',[]):
                        assert archive.read(folder+'/docs/manuals/figures/'+panel['source']).startswith(b'\x89PNG\r\n\x1a\n')
                assert archive.read(folder+'/scripts/extract_registration_poses.py') == (ROOT/'scripts'/'extract_registration_poses.py').read_bytes()
                archive.extractall(temp)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
            app = temp/folder
            process = subprocess.Popen(['node', str(app/'scripts'/'serve.mjs'), '--no-open', '--port', str(port), '--scene-dir', str(scenes)],
                cwd=app, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            try:
                line = process.stdout.readline()
                match = re.search(r'http://127\.0\.0\.1:\d+/', line)
                if not match: raise RuntimeError('Packaged server failed: '+line+process.stdout.read())
                url = match.group(0)
                with opener.open(url, timeout=10) as response: assert response.status == 200
                with opener.open(url+'api/local-scene/manifest?scene=beta', timeout=10) as response:
                    manifest = json.load(response)
                assert manifest['sceneKey'] == 'beta' and len(manifest['scenes']) == 2
                with opener.open(url.rstrip('/')+manifest['pointCloudUrl'], timeout=10) as response: assert response.read() == b'beta'
                print(platform+' ZIP: extracted server, catalog, assets and current build PASS', flush=True)
            finally:
                process.terminate(); process.wait(timeout=10)


if __name__ == '__main__': main()
