"""Check the store ZIP's layout, runtime provenance, permissions and icons."""
import hashlib
import json
import struct
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'extension/manifest.json').read_text())
archive = ROOT / 'dist' / f'session-lab-{source["version"]}-webstore-candidate.zip'
assert archive.exists(), 'Build the Web Store candidate first'
with ZipFile(archive) as z:
    assert z.testzip() is None
    names = z.namelist()
    assert len(names) == len(set(names))
    assert 'manifest.json' in names, 'Manifest must be at ZIP root'
    assert all(not Path(n).is_absolute() and '..' not in Path(n).parts for n in names)
    manifest = json.loads(z.read('manifest.json'))
    expected = {k: v for k, v in source.items() if k != 'key'}
    expected['icons'] = {str(n): f'icons/icon-{n}.png' for n in (16, 32, 48, 128)}
    expected['action'] = {**source['action'], 'default_icon': expected['icons']}
    assert manifest == expected, 'Only key omission and icons may differ'
    runtime = {p.relative_to(ROOT / 'extension').as_posix(): p for p in (ROOT / 'extension').rglob('*') if p.is_file()}
    assert set(names) == set(runtime) | set(manifest['icons'].values())
    for name, path in runtime.items():
        if name != 'manifest.json':
            assert z.read(name) == path.read_bytes(), name
    for size, name in manifest['icons'].items():
        data = z.read(name)
        assert data[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II', data[16:24]) == (int(size), int(size))
        assert data == (ROOT / 'store/assets' / Path(name).name).read_bytes()
    assert len(manifest['description']) <= 132
print('PASS: ZIP integrity, root manifest, exact runtime provenance, metadata, permissions, icon sizes')
print('SHA256:', hashlib.sha256(archive.read_bytes()).hexdigest())
print('Packaging check only. This does not certify policy compliance or Chrome Web Store approval.')
