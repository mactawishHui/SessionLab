"""Build a store-layout candidate without changing the original local extension.

This is packaging only; consult store/README.md for unresolved review requirements.
"""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]


def main():
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
    version = manifest['version']
    # The store assigns the signing identity. Keep the original development key
    # in extension/manifest.json; never imply the new store ID preserves local data.
    manifest.pop('key', None)
    manifest['icons'] = {str(n): f'icons/icon-{n}.png' for n in (16, 32, 48, 128)}
    manifest['action']['default_icon'] = manifest['icons'].copy()
    files = {p.relative_to(ROOT / 'extension').as_posix(): p.read_bytes()
             for p in sorted((ROOT / 'extension').rglob('*')) if p.is_file()}
    files['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    for size, name in manifest['icons'].items():
        files[name] = (ROOT / 'store/assets' / f'icon-{size}.png').read_bytes()
    output = ROOT / 'dist' / f'session-lab-{version}-webstore-candidate.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.sha256').write_text(f'{digest}  {output.name}\n')
    print(output.relative_to(ROOT))
    print('SHA256:', digest)
    print('Candidate only: resolve store/README.md blockers before submission.')


if __name__ == '__main__':
    main()
