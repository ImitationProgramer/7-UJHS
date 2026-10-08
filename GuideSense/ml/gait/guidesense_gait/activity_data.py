"""Session-bounded, provenance-preserving training data using the Goal 2 pipeline."""

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from .adapters import BEHAVIORS, from_dataset
from .pipeline import FEATURE_NAMES, FEATURE_SCHEMA_VERSION, extract_features, make_window, resample

DATASET_VERSION = "mendeley-vxhx934tbn-v4"
DATASET_URL = "https://data.mendeley.com/datasets/vxhx934tbn/4"
CSV_SHA256 = "f5028606724b9a043f0ab098b6f622aceb58ba5f21722ddaccff0600ab2be060"
PREPROCESSING_VERSION = "goal3-back50hz-strict3s-v1"
UNITS = {"acceleration": "UNKNOWN", "gyroscope": "UNKNOWN"}
UNIT_SPACE = "mendeley-vxhx934tbn-v4-native-unverified"
CANDIDATES = ("Walking", "Trotting", "Standing", "Sitting", "Lying chest", "Sniffing", "Playing")
COLUMNS = (
    ["DogID", "TestNum", "t_sec"]
    + [f"{sensor}Back_{axis}" for sensor in "AG" for axis in "xyz"]
    + ["Task", *BEHAVIORS, "PointEvent"]
)
SEED = 20261008
GUARD = 0.2  # half-support of the shared 41-tap 100->50 Hz FIR


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def verify_dataset(path):
    actual = sha256(path)
    if actual != CSV_SHA256:
        raise ValueError("Dataset checksum differs from the audited Mendeley v4 CSV")
    return actual


def iter_sessions(path, chunksize=250_000):
    """At most one session plus one CSV chunk; never concatenate the complete dataset."""
    pending, key, seen = [], None, set()
    for chunk in pd.read_csv(path, usecols=COLUMNS, chunksize=chunksize, keep_default_na=False):
        boundary = chunk[["DogID", "TestNum"]].ne(chunk[["DogID", "TestNum"]].shift()).any(axis=1)
        for _, part in chunk.groupby(boundary.cumsum(), sort=False):
            current = (int(part.DogID.iloc[0]), int(part.TestNum.iloc[0]))
            if key is not None and current != key:
                seen.add(key)
                yield pd.concat(pending, ignore_index=True)
                pending = []
            if current in seen:
                raise ValueError("Non-contiguous repeated session; refusing to merge or reorder")
            key = current
            pending.append(part)
    if pending:
        yield pd.concat(pending, ignore_index=True)


def prepare_session(table):
    """No unit conversion: evidence does not establish CSV physical units.

    This separate preprocessing stage leaves raw CSV/adapter/Goal 2 behavior unchanged.
    No per-dog fitted orientation correction or data-derived population statistics.
    """
    series = from_dataset(table, position="back")
    if len(series.t) < 3 or not np.allclose(np.diff(series.t), 0.01, atol=1e-8, rtol=0):
        raise ValueError("INVALID_SOURCE_TIMESTAMPS_OR_MISSING_SAMPLES")
    processed = resample(series, target_rate=50.0)
    processed.metadata.update(
        {
            "dataset_version": DATASET_VERSION,
            "preprocessing_version": PREPROCESSING_VERSION,
            "unit_space": UNIT_SPACE,
            "unit_conversion": "none; CSV units UNKNOWN",
        }
    )
    return processed


def annotation_sets(table):
    # Behavior columns are parallel simultaneous observations, not label priorities.
    rows = table[BEHAVIORS].fillna("").astype(str).to_numpy()
    return [tuple(sorted(set(v for v in row if v not in ("", "<undefined>")))) for row in rows]


def label_window(table, start, annotations=None):
    """Require one unchanged singleton behavior in 100% of raw rows and FIR context."""
    t = table.t_sec.to_numpy(dtype=float)
    a, b = np.searchsorted(t, [start - 1e-9, start + 3 - 1e-9])
    annotations = annotation_sets(table) if annotations is None else annotations
    labels = annotations[a:b]
    reasons = []
    if b - a != 300:
        reasons.append("INSUFFICIENT_RAW_SAMPLES")
    if not labels or any(not x for x in labels):
        reasons.append("UNANNOTATED")
    if any(len(x) > 1 for x in labels):
        reasons.append("MULTI_LABEL_AMBIGUITY")
    if len(set(labels)) > 1:
        reasons.append("LABEL_TRANSITION")
    if (table.PointEvent.iloc[a:b] != "<undefined>").any():
        reasons.append("POINT_EVENT")
    actual = labels[0][0] if labels and not reasons and len(labels[0]) == 1 else None
    if actual:
        c, d = np.searchsorted(t, [start - GUARD - 1e-9, start + 3 + GUARD - 1e-9])
        if c == 0 and t[0] > start - GUARD + 1e-8 or t[-1] < start + 3 + GUARD - 0.01 - 1e-8:
            reasons.append("INSUFFICIENT_FILTER_CONTEXT")
        elif any(x != (actual,) for x in annotations[c:d]):
            reasons.append("FILTER_CONTEXT_AMBIGUITY")
        elif (table.PointEvent.iloc[c:d] != "<undefined>").any():
            reasons.append("FILTER_CONTEXT_POINT_EVENT")
    return {
        "actual_activity": actual if not reasons else None,
        "reasons": reasons,
        "purity_required": 1.0,
        "raw_sample_count": int(b - a),
    }


def split_dogs(dogs, seed=SEED):
    dogs = sorted(set(map(int, dogs)))
    if len(dogs) < 6:
        raise ValueError("At least six dogs required")
    shuffled = np.random.default_rng(seed).permutation(dogs)
    n_eval = max(1, round(len(dogs) * 0.15))
    return {
        "train": sorted(map(int, shuffled[2 * n_eval :])),
        "validation": sorted(map(int, shuffled[n_eval : 2 * n_eval])),
        "test": sorted(map(int, shuffled[:n_eval])),
    }


def assert_split(split, dogs):
    sets = [set(split[k]) for k in ("train", "validation", "test")]
    if any(not s for s in sets) or any(sets[i] & sets[j] for i in range(3) for j in range(i)):
        raise ValueError("DogID leakage or empty split")
    if set.union(*sets) != set(map(int, dogs)):
        raise ValueError("Split does not exactly cover dataset dogs")


def distribution(table, classes):
    return {
        label: {
            "windows": int((table.activity == label).sum()),
            "dogs": int(table.loc[table.activity == label, "dog_id"].nunique()),
            "sessions": int(
                table.loc[table.activity == label, ["dog_id", "test_num"]]
                .drop_duplicates()
                .shape[0]
            ),
        }
        for label in classes
    }


def build_dataset(path, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    csv_hash = verify_dataset(path)
    audit = {
        "dataset_version": DATASET_VERSION,
        "source_sha256": csv_hash,
        "raw_rows": 0,
        "sessions": [],
        "raw_annotation_cardinality": Counter(),
        "annotation_combinations": Counter(),
        "raw_label_transitions": 0,
        "window_exclusions": Counter(),
        "window_primary_exclusions": Counter(),
        "total_windows": 0,
        "invalid_sessions": [],
        "behaviors": {},
    }
    raw_counts, raw_dogs, raw_sessions = Counter(), defaultdict(set), defaultdict(set)
    rows = []
    for table in iter_sessions(path):
        dog, test = int(table.DogID.iloc[0]), int(table.TestNum.iloc[0])
        annotations = annotation_sets(table)
        audit["raw_rows"] += len(table)
        audit["sessions"].append({"dog_id": dog, "test_num": test, "raw_rows": len(table)})
        audit["raw_label_transitions"] += sum(a != b for a, b in zip(annotations, annotations[1:]))
        audit["raw_annotation_cardinality"].update(map(len, annotations))
        audit["annotation_combinations"].update(" + ".join(x) or "<undefined>" for x in annotations)
        for label, n in Counter(v for x in annotations for v in x).items():
            raw_counts[label] += n
            raw_dogs[label].add(dog)
            raw_sessions[label].add((dog, test))
        try:
            series = prepare_session(table)
        except (ValueError, FloatingPointError) as exc:
            audit["invalid_sessions"].append({"dog_id": dog, "test_num": test, "reason": str(exc)})
            continue
        starts = np.arange(table.t_sec.iloc[0], table.t_sec.iloc[-1] + 1e-9, 3.0)
        accepted = 0
        for start in starts:
            audit["total_windows"] += 1
            label = label_window(table, start, annotations)
            window = make_window(series, start)
            reasons = label["reasons"] + window.quality["reasons"]
            if not reasons:
                try:
                    features = extract_features(window)
                except (ValueError, FloatingPointError) as exc:
                    reasons = ["INVALID_FEATURES:" + type(exc).__name__]
            if reasons:
                audit["window_exclusions"].update(set(reasons))
                audit["window_primary_exclusions"].update(reasons[:1])
                continue
            rows.append(
                {
                    "dog_id": dog,
                    "test_num": test,
                    "start": float(start),
                    "activity": label["actual_activity"],
                    **features,
                }
            )
            accepted += 1
        print(f"Dog {dog} / Test {test}: {accepted}/{len(starts)} clear valid windows", flush=True)
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise ValueError("No valid labeled windows")
    all_classes = sorted(raw_counts)
    for label, counts in distribution(frame, all_classes).items():
        audit["behaviors"][label] = {
            "raw_samples": raw_counts[label],
            "raw_dogs": len(raw_dogs[label]),
            "raw_sessions": len(raw_sessions[label]),
            **counts,
        }
    dogs = sorted({s["dog_id"] for s in audit["sessions"]})
    split = split_dogs(dogs)
    assert_split(split, dogs)
    parts = {k: frame[frame.dog_id.isin(ids)] for k, ids in split.items()}
    selected = []
    decisions = {}
    for label in CANDIDATES:
        counts = audit["behaviors"].get(label, {})
        per_split = {k: distribution(v, [label])[label] for k, v in parts.items()}
        eligible = (
            counts.get("windows", 0) >= 100
            and counts.get("dogs", 0) >= 10
            and all(c["windows"] >= 20 and c["dogs"] >= 2 for c in per_split.values())
        )
        decisions[label] = {"selected": eligible, "by_split": per_split}
        if eligible:
            selected.append(label)
    if len(selected) < 2:
        raise ValueError("Insufficient class coverage; do not resample Test dogs")
    frame = frame[frame.activity.isin(selected)].copy()
    frame["split"] = frame.dog_id.map({dog: k for k, ids in split.items() for dog in ids})
    frame.to_csv(output / "features.csv", index=False, float_format="%.17g")
    manifest = {
        "dataset_version": DATASET_VERSION,
        "dataset_source": DATASET_URL,
        "source_sha256": csv_hash,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_order": list(FEATURE_NAMES),
        "preprocessing_version": PREPROCESSING_VERSION,
        "sampling_rate": 50,
        "window_duration": 3,
        "stride_seconds": 3,
        "units": UNITS,
        "unit_space": UNIT_SPACE,
        "seed": SEED,
        "split": split,
        "classes": selected,
        "class_decisions": decisions,
        "class_policy": "candidate, >=100 windows/10 dogs overall; >=20 windows/2 dogs each split; 100% singleton + 0.2s FIR guard",
        "features_sha256": sha256(output / "features.csv"),
        "split_distribution": {k: distribution(frame[frame.split == k], selected) for k in split},
        "windows": len(frame),
        "all_clear_windows": len(rows),
    }
    audit["selected_windows"] = len(frame)
    audit["unselected_clear_windows"] = len(rows) - len(frame)
    write_json(output / "manifest.json", manifest)
    write_json(output / "label-audit.json", audit)
    print(json.dumps({"classes": selected, "windows": len(frame), "split": split}), flush=True)
    return manifest
