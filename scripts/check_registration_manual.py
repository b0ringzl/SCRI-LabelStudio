"""Check that the published manuals match their source and reproducible builder."""
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    data = path.read_bytes()
    if path.suffix in ('.md', '.py', '.json', '.svg'):
        data = data.replace(b'\r\n', b'\n')
    return hashlib.sha256(data).hexdigest()


def main():
    published = ROOT/'docs'/'manuals'
    manifest = json.loads((published/'build-manifest.json').read_text(encoding='utf-8'))
    assert manifest['sourceSha256'] == sha(ROOT/'docs'/'REGISTRATION_MANUAL.md'), 'Manual source changed; regenerate both PDFs'
    assert manifest['builderSha256'] == sha(ROOT/'scripts'/'build_registration_manual.py'), 'Builder changed; regenerate both PDFs'
    assert manifest['illustratorSha256'] == sha(ROOT/'scripts'/'manual_illustrations.py'), 'Illustration renderer changed; regenerate both PDFs'
    figures=json.loads((published/'figures'/'figures.json').read_text(encoding='utf-8'))['figures']
    assert manifest['figureCount']==len(figures)==10, 'Ten operation illustrations required'
    links=re.findall(r'!\[[^]]*\]\(manuals/figures/(figure-[^)]+)\.svg\)',(ROOT/'docs'/'REGISTRATION_MANUAL.md').read_text(encoding='utf-8'))
    assert len(links)==len(figures) and set(links)=={f['id'] for f in figures}, 'Markdown/PDF illustration mismatch'
    assets={entry['file']:entry['sha256'] for entry in manifest['figureAssets']}
    actual={path.relative_to(published).as_posix() for path in (published/'figures').rglob('*') if path.is_file()}
    assert set(assets)==actual, 'Illustration assets changed; regenerate both PDFs'
    for name,digest in assets.items():
        path=(published/name).resolve()
        assert path.is_relative_to(published.resolve()) and sha(path)==digest, f'Illustration changed: {name}'
    for figure in figures:
        assert ET.parse(published/'figures'/f'{figure["id"]}.svg').getroot().tag.endswith('svg')
        width,height=figure['size']
        for pin in figure.get('pins',[]):
            for x,y in (pin['badge'],pin['target']):
                assert 0<=x<=width and 0<=y<=height, 'Callout outside illustration'
    editions = manifest['editions']
    expected = {f'Registration-Manual-{platform}.pdf' for platform in ('Windows', 'macOS')}
    assert {e['file'] for e in editions} == expected and len(editions) == 2
    for edition in editions:
        path = published/edition['file']
        assert path.is_file() and path.read_bytes().startswith(b'%PDF-')
        assert edition['sha256'] == sha(path), f'Published PDF differs: {path.name}'
        assert edition['pages'] >= 15, 'Incomplete manual'
    print('Both platform PDFs and 10 illustrations match Markdown, renderers and published checksums')


if __name__ == '__main__':
    main()
