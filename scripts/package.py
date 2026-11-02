"""Rebuild a local-load ZIP without replacing the supplied release artifact."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]


def main():
    version = json.loads((ROOT / 'extension/manifest.json').read_text())['version']
    output = ROOT / 'dist' / f'session-lab-{version}-rebuilt.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    files = {f'extension/{p.relative_to(ROOT / "extension").as_posix()}': p
             for p in (ROOT / 'extension').rglob('*') if p.is_file()}
    files.update({name: ROOT / name for name in ['INSTALL.md', 'RELEASE-NOTES.md']})
    files['可选工具/DEBUG-BANNER.md'] = ROOT / 'docs/DEBUG-BANNER.md'
    files.update({f'可选工具/{p.name}': p for p in (ROOT / 'tools').glob('*.command')})
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for name, path in sorted(files.items()):
            info = ZipInfo(f'Session-Lab-{version}/{name}', (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = (0o100755 if path.suffix == '.command' else 0o100644) << 16
            archive.writestr(info, path.read_bytes())
    print(output.relative_to(ROOT))
    print('SHA256:', hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
