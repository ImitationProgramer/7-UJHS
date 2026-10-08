"""Recorded canine replay files for Goal 4; relative timestamps, never live telemetry."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .activity_data import (
    DATASET_URL,
    DATASET_VERSION,
    GUARD,
    PREPROCESSING_VERSION,
    UNIT_SPACE,
    UNITS,
    annotation_sets,
    label_window,
    prepare_session,
    sha256,
    verify_dataset,
    write_json,
)
from .activity_model import ActivityModel
from .adapters import BEHAVIORS, read_dog_session
from .pipeline import make_window

REPLAY_SCHEMA_VERSION = "guidesense-recorded-canine-replay-v1"
ATTRIBUTION = (
    "Vehkaoja, Somppi, Törnqvist, Valldeoriola Cardó, Kumpulainen, Väätäjä, Majaranta, "
    "Surakka, Kujala, Vainio. Movement Sensor Dataset for Dog Behavior Classification, "
    "Mendeley Data v4, DOI 10.17632/vxhx934tbn.4. CC BY 4.0."
)


def export_replay(table, model, output, start, seconds, source_sha256):
    if (
        not np.isfinite(start)
        or not np.isfinite(seconds)
        or seconds <= 0
        or seconds > 300
        or not np.isclose(seconds / 3, round(seconds / 3))
    ):
        raise ValueError("Replay duration must be a positive multiple of 3, at most 300 seconds")
    series = prepare_session(table)
    if (
        start < series.t[0] + GUARD - 1e-8
        or start + seconds + GUARD > table.t_sec.iloc[-1] + 0.01 + 1e-8
        or not np.isclose((start - series.t[0]) * 50, round((start - series.t[0]) * 50))
    ):
        raise ValueError("Replay must fit one session with FIR context and align to 50Hz grid")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    annotations = annotation_sets(table)
    dog, test = int(table.DogID.iloc[0]), int(table.TestNum.iloc[0])
    split = next((k for k, ids in model.metadata["split"].items() if dog in ids), "external")
    common = {
        "source": "public_canine_dataset",
        "recording_mode": "DATASET_REPLAY",
        "dataset_source": DATASET_URL,
        "dataset_version": DATASET_VERSION,
        "dog_id": dog,
        "test_num": test,
        "session_id": f"dog-{dog}-test-{test}",
        "split": split,
        "model_version": model.metadata["model_version"],
    }
    records = []
    for i in range(round(seconds / 3)):
        window = make_window(series, start + 3 * i)
        truth = label_window(table, start + 3 * i, annotations)
        prediction = model.predict_window(window) if window.quality["status"] == "VALID" else None
        records.append(
            {
                **common,
                "window_id": i,
                "timestamp": float(start + 3 * i),
                "window_start": float(start + 3 * i),
                "window_end": float(start + 3 * (i + 1)),
                "prediction_available_at": float(start + 3 * (i + 1) + GUARD),
                "actual_activity": truth["actual_activity"],
                "label_quality": truth,
                "evaluation_eligible": truth["actual_activity"] in model.metadata["classes"],
                "window_quality": window.quality["status"],
                "quality_details": window.quality,
                "predicted_activity": prediction["predicted_activity"] if prediction else None,
                "model_prediction": prediction,
                "offline_precomputed": True,
            }
        )
    with (output / "windows.jsonl").open("w") as destination:
        for row in records:
            destination.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
    selected = (series.t >= start - 1e-9) & (series.t < start + seconds - 1e-9)
    timestamps, values = series.t[selected], series.values[selected]
    raw_t = table.t_sec.to_numpy()
    with (output / "samples.jsonl").open("w") as destination:
        for t, value in zip(timestamps, values):
            raw_index = int(np.searchsorted(raw_t, t + 1e-8, side="right") - 1)
            raw = table.iloc[raw_index]
            i = min(int((t - start + 1e-8) // 3), len(records) - 1)
            row = {
                **common,
                "timestamp": float(t),
                "elapsed_seconds": float(t - start),
                "accelerometer": dict(zip("xyz", value[:3].tolist())),
                "gyroscope": dict(zip("xyz", value[3:].tolist())),
                "label": list(annotations[raw_index]),
                "behavior_annotations": {k: str(raw[k]) for k in BEHAVIORS},
                "task": str(raw.Task),
                "point_event": str(raw.PointEvent),
                "window_id": i,
                "window_quality": records[i]["window_quality"],
                "model_prediction": {
                    "predicted_activity": records[i]["predicted_activity"],
                    "available_at": records[i]["prediction_available_at"],
                    "offline_precomputed": True,
                },
            }
            destination.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
    # Also preserve the actual unmodified six-axis CSV values for provenance/debugging.
    raw = table[(table.t_sec >= start - 1e-9) & (table.t_sec < start + seconds - 1e-9)]
    raw.to_csv(output / "raw-back.csv", index=False, float_format="%.17g")
    manifest = {
        **common,
        "replay_schema_version": REPLAY_SCHEMA_VERSION,
        "source_sha256": source_sha256,
        "model_sha256": model.metadata["model_sha256"],
        "timestamp_basis": "seconds_since_test_start; not Unix/live time",
        "start": start,
        "end": start + seconds,
        "sampling_rate": 50,
        "samples": len(timestamps),
        "windows": len(records),
        "raw_samples": len(raw),
        "units": UNITS,
        "unit_space": UNIT_SPACE,
        "preprocessing_version": PREPROCESSING_VERSION,
        "signal_representation": "Back CSV -> shared timestamp interpolation + anti-alias FIR",
        "prediction_timing": "offline; withhold predictions until window_end+0.2s replay time",
        "attribution": ATTRIBUTION,
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "changes": "Back selection, 100->50Hz FIR, relative time, 3s activity inference; no unit conversion",
        "is_live": False,
        "is_training_data": split == "train",
        "files": {
            name: sha256(output / name)
            for name in ("samples.jsonl", "windows.jsonl", "raw-back.csv")
        },
    }
    write_json(output / "manifest.json", manifest)
    validate_replay(output)
    return manifest


def validate_replay(folder):
    folder = Path(folder)
    manifest = json.loads((folder / "manifest.json").read_text())
    if (
        manifest["replay_schema_version"] != REPLAY_SCHEMA_VERSION
        or manifest["is_live"]
        or manifest["recording_mode"] != "DATASET_REPLAY"
        or manifest["source"] != "public_canine_dataset"
        or manifest["dataset_version"] != DATASET_VERSION
        or manifest["units"] != UNITS
        or manifest["unit_space"] != UNIT_SPACE
        or manifest["is_training_data"] != (manifest["split"] == "train")
    ):
        raise ValueError("Replay provenance mismatch")
    for name in ("samples.jsonl", "windows.jsonl", "raw-back.csv"):
        if sha256(folder / name) != manifest["files"][name]:
            raise ValueError("Replay file checksum mismatch")
    samples = [json.loads(s) for s in (folder / "samples.jsonl").read_text().splitlines()]
    windows = [json.loads(s) for s in (folder / "windows.jsonl").read_text().splitlines()]
    if len(samples) != manifest["samples"] or len(windows) != manifest["windows"]:
        raise ValueError("Replay counts differ")
    expected_count = round((manifest["end"] - manifest["start"]) * 50)
    if not samples or len(samples) != expected_count or len(samples) != 150 * len(windows):
        raise ValueError("Replay duration/count mismatch")
    t = np.asarray([s["timestamp"] for s in samples])
    if not np.isfinite(t).all() or not np.allclose(np.diff(t), 0.02, atol=1e-8, rtol=0):
        raise ValueError("Replay timestamps are not ordered 50Hz samples")
    if not np.allclose(t, manifest["start"] + np.arange(len(t)) / 50, atol=1e-8, rtol=0):
        raise ValueError("Replay timestamps differ from declared interval")
    for row in samples + windows:
        if any(
            row[k] != manifest[k]
            for k in (
                "source",
                "recording_mode",
                "dataset_source",
                "dataset_version",
                "dog_id",
                "test_num",
                "session_id",
                "split",
                "model_version",
            )
        ):
            raise ValueError("Replay session/source boundary crossing")
    for i, w in enumerate(windows):
        if (
            w["window_id"] != i
            or w["window_start"] != manifest["start"] + 3 * i
            or w["window_end"] != w["window_start"] + 3
        ):
            raise ValueError("Replay windows are not consecutive")
        if w["prediction_available_at"] < w["window_end"] + GUARD - 1e-8:
            raise ValueError("Replay prediction disclosed before full window/filter context")
        if w["actual_activity"] != w["label_quality"]["actual_activity"]:
            raise ValueError("Ground truth differs from label policy")
    for i, sample in enumerate(samples):
        values = [
            sample[sensor][axis] for sensor in ("accelerometer", "gyroscope") for axis in "xyz"
        ]
        if not np.isfinite(values).all():
            raise ValueError("Nonfinite replay sensors")
        annotation = sorted(
            {v for v in sample["behavior_annotations"].values() if v not in ("", "<undefined>")}
        )
        w = windows[i // 150]
        if (
            sample["label"] != annotation
            or sample["window_id"] != w["window_id"]
            or sample["model_prediction"]["predicted_activity"] != w["predicted_activity"]
            or sample["model_prediction"]["available_at"] != w["prediction_available_at"]
        ):
            raise ValueError("Replay annotation/prediction linkage mismatch")
    return manifest


def replay_dataset(dataset, model_folder, output, dog, test, start, seconds):
    digest = verify_dataset(dataset)
    model = ActivityModel(model_folder)
    table = read_dog_session(dataset, dog, test)
    return export_replay(table, model, output, start, seconds, digest)


def demo_selection(dataset_folder):
    """First chronological eligible Test Walking window; never select by prediction success."""
    frame = pd.read_csv(
        Path(dataset_folder) / "features.csv",
        usecols=["dog_id", "test_num", "start", "activity", "split"],
    )
    row = (
        frame[(frame.split == "test") & (frame.activity == "Walking")]
        .sort_values(["dog_id", "test_num", "start"])
        .iloc[0]
    )
    return int(row.dog_id), int(row.test_num), float(row.start)
