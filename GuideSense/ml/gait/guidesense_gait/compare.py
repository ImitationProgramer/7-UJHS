"""Reproducible public dog Walking versus explicitly recorded iPhone window comparison."""

import argparse
import json
from pathlib import Path

from .adapters import from_dataset, read_capture, read_dog_session, walking_segment
from .pipeline import analyze_window, make_window, resample, windows


def compare(dataset, capture, dog=16, test=1, iphone_start=None, dog_start=None):
    table = read_dog_session(dataset, dog, test)
    segment = walking_segment(table)
    raw = from_dataset(segment)
    public = resample(raw)
    # 0.5 s away from FIR edge padding; homogeneous annotation covers the whole window.
    public_start = float(public.t[0] + 0.5) if dog_start is None else dog_start
    if public_start < public.t[0] + 0.2 or public_start + 3 > public.t[-1] - 0.2:
        raise ValueError("Dog window needs >=0.2s FIR context inside the Walking segment")
    public_result = analyze_window(make_window(public, public_start))
    public_result["raw_sample_count_in_window"] = int(
        ((raw.t >= public_start - 1e-8) & (raw.t < public_start + 3 - 1e-8)).sum()
    )
    public_result["annotations"] = {
        k: str(segment[k].iloc[0]) for k in ["Task", "Behavior_1", "Behavior_2", "Behavior_3"]
    }
    phone = read_capture(capture)
    candidates = list(windows(phone))
    if iphone_start is not None:
        phone_window = make_window(phone, iphone_start)
    else:
        phone_window = next(
            (w for w in candidates if w.quality["status"] == "VALID"), candidates[0]
        )
    phone_result = analyze_window(phone_window)
    phone_result["session_window_quality"] = [w.quality for w in candidates]
    return {
        "public_dog": public_result,
        "iphone": phone_result,
        "same_feature_schema": public_result["feature_names"] == phone_result["feature_names"],
        "both_valid": all(r["quality"]["status"] == "VALID" for r in (public_result, phone_result)),
        "physical_values_comparable": False,
        "limitations": [
            "Public physical units UNKNOWN: no guessed conversion or cross-source ratios",
            "Human-held iPhone is not dog gait",
            "No activity or disease inference",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset", type=Path, default=Path("data/external/mendeley-v4/DogMoveData.csv")
    )
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--dog", type=int, default=16)
    parser.add_argument("--test", type=int, default=1)
    parser.add_argument("--iphone-start", type=float, help="Seconds from first captured frame")
    parser.add_argument(
        "--dog-start", type=float, help="t_sec within selected annotated Walking segment"
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = compare(
        args.dataset, args.capture, args.dog, args.test, args.iphone_start, args.dog_start
    )
    content = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content)
    else:
        print(content, end="")
    if not result["both_valid"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
