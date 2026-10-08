"""Build a local, attributed demo bundle without original CSV or iPhone captures.

Run from the project root with the API venv. Never trains or modifies the model.
"""

import argparse
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/api"))
from guidesense_api.replay import DEFAULT_CLIPS, RecordedClip


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / "artifacts/goal4/guidesense-demo.zip"
    )
    args = parser.parse_args()
    files = [
        ROOT / "artifacts/goal3/model" / name
        for name in ("model.joblib", "metadata.json")
    ]
    report = []
    for clip_id, folder in DEFAULT_CLIPS.items():
        if clip_id != "dog22-demo" and not folder.exists():
            continue
        clip = RecordedClip(folder, ROOT / "artifacts/goal3/model")
        results = [clip.infer(i) for i in range(len(clip.windows))]
        report.append(
            {
                "clip_id": clip_id,
                "manifest": clip.manifest,
                "executed_predictions": results,
            }
        )
        files.extend(
            folder / name
            for name in (
                "manifest.json",
                "samples.jsonl",
                "windows.jsonl",
                "raw-back.csv",
            )
        )
    files.extend(
        ROOT / "docs" / name
        for name in (
            "data-sources.md",
            "goal4-replay-integration.md",
            "demo-scenario.md",
        )
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT))
        archive.writestr(
            "artifacts/goal4/bundle-verification.json",
            json.dumps(report, ensure_ascii=False, indent=2),
        )
        archive.writestr(
            "artifacts/goal4/BUNDLE-NOTICE.txt",
            "GuideSense local demo assets. Extract at GuideSense project root.\n"
            "Recorded public canine data, not live dog measurements. Units UNKNOWN; iPhone UNVALIDATED.\n"
            "Mendeley Data v4 https://data.mendeley.com/datasets/vxhx934tbn/4\n"
            "Dataset license: CC BY 4.0 https://creativecommons.org/licenses/by/4.0/\n"
            "Preserve all manifest attribution, source/license links, changes and docs/data-sources.md citations.\n"
            "Back selection, 100-to-50Hz FIR, relative time and model inference added. No author endorsement.\n"
            "No original 2GB CSV, GPS, iPhone capture, training feature table or credentials included.\n"
            "Only load model.joblib from a trusted source; serialization can execute code.\n",
        )
    print(
        json.dumps(
            {
                "bundle": str(args.output),
                "bytes": args.output.stat().st_size,
                "clips": len(report),
            }
        )
    )


if __name__ == "__main__":
    main()
