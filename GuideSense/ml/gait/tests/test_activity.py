"""Synthetic contract tests. Real-data integration tests are explicitly opt-in below."""

import copy
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from guidesense_gait.activity_data import (
    COLUMNS,
    CSV_SHA256,
    DATASET_VERSION,
    PREPROCESSING_VERSION,
    SEED,
    UNITS,
    UNIT_SPACE,
    annotation_sets,
    assert_split,
    iter_sessions,
    label_window,
    prepare_session,
    sha256,
    split_dogs,
    write_json,
)
from guidesense_gait.activity_model import ActivityModel, compatibility
from guidesense_gait.activity_replay import export_replay, validate_replay
from guidesense_gait.activity_train import evaluate_test, fit_candidates, load_features, train_model
from guidesense_gait.adapters import from_live_buffer
from guidesense_gait.pipeline import (
    FEATURE_NAMES,
    FEATURE_SCHEMA_VERSION,
    extract_features,
    make_window,
)


def table(seconds=12, dog=1, test=1):
    t = np.arange(seconds * 100) / 100
    df = pd.DataFrame({"DogID": dog, "TestNum": test, "t_sec": t})
    for i, col in enumerate(COLUMNS[3:9]):
        df[col] = np.sin(t * (i + 1)) + i
    df["Task"] = "Task sit"  # Deliberately conflicts with actual behavior: must be ignored.
    df["Behavior_1"] = "Walking"
    df["Behavior_2"] = "<undefined>"
    df["Behavior_3"] = "<undefined>"
    df["PointEvent"] = "<undefined>"
    return df


def test_actual_annotations_not_task_or_column_priority():
    df = table()
    assert label_window(df, 3)["actual_activity"] == "Walking"
    df["Behavior_3"], df["Behavior_1"] = df.Behavior_1.copy(), "<undefined>"
    assert label_window(df, 3)["actual_activity"] == "Walking"
    df.loc[450, "Behavior_2"] = "Panting"
    assert label_window(df, 3)["actual_activity"] is None
    assert "MULTI_LABEL_AMBIGUITY" in label_window(df, 3)["reasons"]


@pytest.mark.parametrize(
    "mode,reason",
    [
        ("undefined", "UNANNOTATED"),
        ("transition", "LABEL_TRANSITION"),
        ("context", "FILTER_CONTEXT_AMBIGUITY"),
        ("point", "POINT_EVENT"),
        ("context_point", "FILTER_CONTEXT_POINT_EVENT"),
        ("tail", "INSUFFICIENT_RAW_SAMPLES"),
    ],
)
def test_label_rejections(mode, reason):
    df = table()
    start = 3
    if mode == "undefined":
        df.loc[450, "Behavior_1"] = "<undefined>"
    elif mode == "transition":
        df.loc[450:599, "Behavior_1"] = "Sitting"
    elif mode == "context":
        df.loc[290, "Behavior_2"] = "Sniffing"
    elif mode == "point":
        df.loc[450, "PointEvent"] = "Bark"
    elif mode == "context_point":
        df.loc[290, "PointEvent"] = "Bark"
    else:
        start = 11
    result = label_window(df, start)
    assert result["actual_activity"] is None and reason in result["reasons"]


def test_annotation_sets_preserve_simultaneous_labels():
    df = table()
    df.loc[0, ["Behavior_2", "Behavior_3"]] = ["Sniffing", "Panting"]
    assert annotation_sets(df)[0] == ("Panting", "Sniffing", "Walking")


def test_session_streaming_across_chunks_and_reappearing_session(tmp_path):
    a, b = table(seconds=1), table(seconds=1, test=2)
    path = tmp_path / "raw.csv"
    pd.concat([a, b]).to_csv(path, index=False)
    sessions = list(iter_sessions(path, chunksize=37))
    assert [len(s) for s in sessions] == [100, 100]
    assert [s.TestNum.iloc[0] for s in sessions] == [1, 2]
    with pytest.raises(ValueError, match="One dog"):
        prepare_session(pd.concat([a, b]))
    pd.concat([a, b, a]).to_csv(path, index=False)
    with pytest.raises(ValueError, match="Non-contiguous"):
        list(iter_sessions(path, chunksize=37))


@pytest.mark.parametrize(
    "mode", ["nan", "inf", "missing", "duplicate", "backward", "invalid_time", "short"]
)
def test_invalid_source_rejected_before_features(mode):
    df = table()
    if mode in ("nan", "inf"):
        df.loc[450, "GBack_x"] = float(mode)
    elif mode == "missing":
        df = df.drop(index=450)
    elif mode == "duplicate":
        df.loc[450, "t_sec"] = df.t_sec.iloc[449]
    elif mode == "backward":
        df.loc[450, "t_sec"] = 0
    elif mode == "invalid_time":
        df.loc[450, "t_sec"] = np.nan
    else:
        df = df.iloc[:2]
    with pytest.raises(ValueError):
        prepare_session(df)


def test_common_features_units_and_input_immutability():
    df = table()
    original = df.copy(deep=True)
    processed = prepare_session(df)
    pd.testing.assert_frame_equal(df, original)
    w = make_window(processed, 3)
    assert compatibility(w)["status"] == "SUPPORTED"
    assert tuple(extract_features(w)) == FEATURE_NAMES
    assert len(w.series.t) == 150
    assert processed.metadata["units"] == UNITS
    assert processed.metadata["unit_space"] == UNIT_SPACE
    np.testing.assert_allclose(np.diff(w.series.t), 0.02)
    assert compatibility(make_window(processed, 11))["status"] == "INVALID"


def test_reproducible_disjoint_dog_and_session_split():
    a = split_dogs(range(45))
    assert a == split_dogs(range(44, -1, -1))
    assert list(map(len, a.values())) == [31, 7, 7]
    assert_split(a, range(45))
    assert a != split_dogs(range(45), seed=100)
    b = copy.deepcopy(a)
    b["test"].append(b["train"][0])
    with pytest.raises(ValueError, match="leakage"):
        assert_split(b, range(45))
    # TestNum is never part of the assignment; both sessions inherit the same dog's part.
    for dog in range(45):
        assert len({k for k, ids in a.items() for _ in (1, 2) if dog in ids}) == 1


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    root = tmp_path_factory.mktemp("activity-model")
    dataset, model = root / "dataset", root / "model"
    dataset.mkdir()
    split = split_dogs(range(1, 13))
    rows = []
    for part, dogs in split.items():
        for dog in dogs:
            for i, activity in enumerate(["Walking", "Sitting"]):
                values = {name: float(i * 10 + dog / 100) for name in FEATURE_NAMES}
                rows.append(
                    {
                        "dog_id": dog,
                        "test_num": 1,
                        "start": 3 + i * 3,
                        "activity": activity,
                        "split": part,
                        **values,
                    }
                )
    frame = pd.DataFrame(rows)
    frame.to_csv(dataset / "features.csv", index=False)
    manifest = {
        "dataset_version": DATASET_VERSION,
        "source_sha256": CSV_SHA256,
        "feature_order": list(FEATURE_NAMES),
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "preprocessing_version": PREPROCESSING_VERSION,
        "units": UNITS,
        "unit_space": UNIT_SPACE,
        "sampling_rate": 50,
        "window_duration": 3,
        "stride_seconds": 3,
        "split": split,
        "seed": SEED,
        "classes": ["Walking", "Sitting"],
        "features_sha256": sha256(dataset / "features.csv"),
    }
    write_json(dataset / "manifest.json", manifest)
    train_model(dataset, model)
    return dataset, model


def test_candidates_fit_only_train_no_scaler(monkeypatch):
    from sklearn.dummy import DummyClassifier
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.preprocessing import StandardScaler

    def forbidden(*args, **kwargs):
        raise AssertionError("No scaler is needed or allowed in this experiment")

    monkeypatch.setattr(StandardScaler, "fit", forbidden)
    seen = []
    for klass in (DummyClassifier, RandomForestClassifier):
        original = klass.fit

        def spy(self, x, y, _original=original, **kwargs):
            assert len(x) == 12 and np.max(x) < 100
            seen.append(len(x))
            return _original(self, x, y, **kwargs)

        monkeypatch.setattr(klass, "fit", spy)
    train = pd.DataFrame(np.ones((12, 112)), columns=FEATURE_NAMES)
    train["activity"], train["dog_id"] = ["Walking", "Sitting"] * 6, [1] * 12
    validation = train.copy()
    validation[list(FEATURE_NAMES)] += 1000
    validation["dog_id"] = 2
    _, _, _ = fit_candidates(train, validation, ["Walking", "Sitting"], SEED)
    assert seen == [12, 12, 12]


def test_train_reload_and_final_test_lock(trained):
    dataset, model = trained
    estimator = ActivityModel(model)
    assert estimator.metadata["training_windows"] == 16
    assert json.loads((model / "selection.json").read_text())["reload_predictions_identical"]
    result = evaluate_test(dataset, model)
    assert result["selected"]["windows"] == 4
    assert result["selected"]["dogs"] == 2
    assert len(result["selected"]["confusion_matrix"]) == 2
    with pytest.raises(ValueError, match="already"):
        evaluate_test(dataset, model)
    assert "test" in ActivityModel(model).metadata["evaluation_metrics"]


def test_wrong_features_and_source_rejected(trained):
    _, folder = trained
    model = ActivityModel(folder)
    features = extract_features(make_window(prepare_session(table()), 3))
    args = {
        "feature_schema": FEATURE_SCHEMA_VERSION,
        "units": UNITS,
        "unit_space": UNIT_SPACE,
        "source": "mendeley_vxhx934tbn_v4",
        "preprocessing_version": PREPROCESSING_VERSION,
        "window_quality": "VALID",
    }
    assert model.predict_features(features, **args) in model.metadata["classes"]
    for key, value in [
        ("units", {"acceleration": "g", "gyroscope": "rad/s"}),
        ("unit_space", "unknown-other-dataset"),
        ("source", "iphone_imu"),
        ("feature_schema", "v2"),
        ("preprocessing_version", "v0"),
        ("window_quality", "INVALID_WINDOW"),
    ]:
        with pytest.raises(ValueError):
            model.predict_features(features, **{**args, key: value})
    for bad in [
        dict(reversed(list(features.items()))),
        {**features, "extra": 0},
        {**features, FEATURE_NAMES[0]: np.nan},
    ]:
        with pytest.raises(ValueError):
            model.predict_features(bad, **args)


@pytest.mark.parametrize(
    "key,value",
    [
        ("units", {}),
        ("feature_order", []),
        ("model_version", "unknown"),
        ("classes", ["Walking"]),
        ("model_sha256", "bad"),
    ],
)
def test_model_metadata_rejection(trained, tmp_path, key, value):
    import shutil

    _, folder = trained
    shutil.copytree(folder, tmp_path / "model")
    meta = json.loads((tmp_path / "model/metadata.json").read_text())
    meta[key] = value
    write_json(tmp_path / "model/metadata.json", meta)
    with pytest.raises(ValueError):
        ActivityModel(tmp_path / "model")


def test_live_iphone_unvalidated_and_no_inference(trained):
    frames = []
    for i in range(150):
        stamp = 1700000000000 + i * 20
        sensor = {"x": 1, "y": 0, "z": 0, "timestamp": stamp}
        frames.append({"timestamp": stamp, "accelerometer": sensor, "gyroscope": sensor})
    window = make_window(from_live_buffer(frames), 0)
    assert compatibility(window)["status"] == "UNVALIDATED"
    with pytest.raises(ValueError, match="UNVALIDATED"):
        ActivityModel(trained[1]).predict_window(window)
    window.series.metadata["units"] = UNITS
    assert compatibility(window)["status"] == "INVALID"


def test_replay_preserves_truth_prediction_source_timing_and_split(trained, tmp_path):
    model = ActivityModel(trained[1])
    dog = model.metadata["split"]["test"][0]
    df = table(dog=dog)
    df.loc[650, "Behavior_2"] = "Sniffing"
    target = tmp_path / "replay"
    manifest = export_replay(df, model, target, 3, 6, "synthetic-test-only")
    assert manifest["samples"] == 300 and manifest["raw_samples"] == 600
    assert (
        manifest["split"] == "test" and not manifest["is_live"] and not manifest["is_training_data"]
    )
    samples = [json.loads(s) for s in (target / "samples.jsonl").read_text().splitlines()]
    windows = [json.loads(s) for s in (target / "windows.jsonl").read_text().splitlines()]
    assert windows[0]["actual_activity"] == "Walking"
    assert windows[1]["actual_activity"] is None and not windows[1]["evaluation_eligible"]
    assert all("predicted_activity" in w for w in windows)
    assert samples[175]["label"] == ["Sniffing", "Walking"]
    np.testing.assert_allclose(np.diff([s["timestamp"] for s in samples]), 0.02)
    assert windows[0]["prediction_available_at"] == 6.2
    raw = pd.read_csv(target / "raw-back.csv")
    np.testing.assert_allclose(raw[COLUMNS[3:9]], df.iloc[300:900][COLUMNS[3:9]])
    validate_replay(target)
    # Deliberately corrupt timestamps, updating hash so temporal validator is exercised.
    samples[1]["timestamp"] = samples[0]["timestamp"]
    (target / "samples.jsonl").write_text("\n".join(json.dumps(s) for s in samples) + "\n")
    manifest["files"]["samples.jsonl"] = sha256(target / "samples.jsonl")
    write_json(target / "manifest.json", manifest)
    with pytest.raises(ValueError, match="timestamps"):
        validate_replay(target)
    with pytest.raises(ValueError, match="one session"):
        export_replay(df, model, tmp_path / "cross", 9, 6, "synthetic-test-only")


def test_feature_artifact_tamper_rejected(trained, tmp_path):
    import shutil

    dataset, _ = trained
    shutil.copytree(dataset, tmp_path / "dataset")
    with (tmp_path / "dataset/features.csv").open("a") as f:
        f.write("corruption")
    with pytest.raises(ValueError, match="checksum"):
        load_features(tmp_path / "dataset")


@pytest.mark.skipif(
    os.getenv("GUIDESENSE_REAL_DATA") != "1", reason="explicit local public-data integration opt-in"
)
def test_real_public_artifacts_inference_and_replay():
    root = Path(__file__).resolve().parents[3]
    manifest, frame = load_features(root / "artifacts/goal3/dataset")
    model = ActivityModel(root / "artifacts/goal3/model")
    replay = validate_replay(root / "artifacts/goal3/replay-demo")
    assert replay["source_sha256"] == CSV_SHA256 and replay["split"] == "test"
    records = [
        json.loads(s)
        for s in (root / "artifacts/goal3/replay-demo/windows.jsonl").read_text().splitlines()
    ]
    w = records[0]
    row = frame[
        (frame.dog_id == w["dog_id"])
        & (frame.test_num == w["test_num"])
        & (frame.start == w["window_start"])
    ].iloc[0]
    actual = model.estimator.predict(row[list(FEATURE_NAMES)].to_numpy(dtype=float).reshape(1, -1))[
        0
    ]
    assert w["predicted_activity"] == actual and w["actual_activity"] == row.activity
    assert replay["dog_id"] not in manifest["split"]["train"]
    assert "test" in model.metadata["evaluation_metrics"]
