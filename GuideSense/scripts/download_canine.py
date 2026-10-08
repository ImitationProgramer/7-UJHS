"""Download pinned Mendeley v4 CSV source and descriptions; verify publisher SHA256."""

import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

URL = "https://data.mendeley.com/public-api/datasets/vxhx934tbn/files?folder_id=root&version=4"
NAMES = ("Data_description.txt", "DogInfo.csv", "DogMoveData_csv_format.zip")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url, path):
    subprocess.run(
        [
            "curl",
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--retry",
            "3",
            url,
            "--output",
            str(path),
        ],
        check=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=Path("data/external/mendeley-v4")
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    metadata_path = args.output / "files-metadata.json"
    download(URL, metadata_path)
    files = json.loads(metadata_path.read_text())
    manifest = {
        "dataset": "https://data.mendeley.com/datasets/vxhx934tbn/4",
        "doi": "10.17632/vxhx934tbn.4",
        "license": "CC BY 4.0",
        "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        "files": [],
    }
    for name in NAMES:
        entry = next(f for f in files if f["filename"] == name)
        path = args.output / name
        expected = entry["content_details"]["sha256_hash"]
        reused = path.exists() and sha256(path) == expected
        if not reused:
            part = path.with_suffix(path.suffix + ".part")
            download(entry["content_details"]["download_url"], part)
            if sha256(part) != expected:
                raise ValueError(f"SHA256 mismatch: {name}")
            part.replace(path)
        manifest["files"].append(
            {
                "name": name,
                "bytes": path.stat().st_size,
                "sha256": expected,
                "reused_verified_file": reused,
            }
        )
        print("Verified", name, flush=True)
    with zipfile.ZipFile(args.output / "DogMoveData_csv_format.zip") as archive:
        temporary_csv = args.output / "DogMoveData.csv.part"
        with (
            archive.open("DogMoveData.csv") as source,
            temporary_csv.open("wb") as destination,
        ):
            shutil.copyfileobj(source, destination)
        temporary_csv.replace(args.output / "DogMoveData.csv")
    csv_path = args.output / "DogMoveData.csv"
    manifest["extracted_csv"] = {
        "bytes": csv_path.stat().st_size,
        "sha256": sha256(csv_path),
    }
    (args.output / "download-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
