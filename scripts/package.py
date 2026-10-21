"""Package the extension without modifying the original release ZIP."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]


def main():
    version = json.loads((ROOT / "extension/manifest.json").read_text())["version"]
    output = ROOT / "dist" / f"session-lab-{version}-rebuilt.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in (ROOT / "extension").rglob("*") if p.is_file())
    files += [ROOT / "INSTALL.md", ROOT / "RELEASE-NOTES.md"]
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for path in files:
            info = ZipInfo(f"Session-Lab-{version}/{path.relative_to(ROOT).as_posix()}", (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    print(output.relative_to(ROOT))
    print("SHA256:", hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
