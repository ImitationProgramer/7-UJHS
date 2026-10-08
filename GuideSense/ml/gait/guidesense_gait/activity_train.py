"""Fixed DogID splits; validation selection, followed by one frozen final test evaluation."""

import json
import platform
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import scipy
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score

from .activity_data import (
    CSV_SHA256,
    DATASET_VERSION,
    PREPROCESSING_VERSION,
    UNIT_SPACE,
    UNITS,
    assert_split,
    sha256,
    write_json,
)
from .activity_model import MODEL_VERSION, ActivityModel
from .pipeline import FEATURE_NAMES, FEATURE_SCHEMA_VERSION


def evaluate(y, pred, classes, dogs):
    dogs, y, pred = np.asarray(dogs), np.asarray(y), np.asarray(pred)
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, labels=classes, average="macro", zero_division=0)),
        "weighted_f1": float(
            f1_score(y, pred, labels=classes, average="weighted", zero_division=0)
        ),
        "class_report": classification_report(
            y, pred, labels=classes, output_dict=True, zero_division=0
        ),
        "confusion_matrix": confusion_matrix(y, pred, labels=classes).tolist(),
        "confusion_order": classes,
        "windows": len(y),
        "dogs": len(set(dogs.tolist())),
        "per_dog": {
            str(d): {
                "windows": int(sum(dogs == d)),
                "accuracy": float(accuracy_score(y[dogs == d], pred[dogs == d])),
                "macro_f1_present_classes": float(
                    f1_score(
                        y[dogs == d],
                        pred[dogs == d],
                        labels=sorted(set(y[dogs == d])),
                        average="macro",
                        zero_division=0,
                    )
                ),
            }
            for d in sorted(set(dogs.tolist()))
        },
    }


def load_features(dataset):
    dataset = Path(dataset)
    manifest = json.loads((dataset / "manifest.json").read_text())
    expected = {
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
    }
    if any(manifest.get(k) != v for k, v in expected.items()):
        raise ValueError("Incompatible feature manifest")
    if sha256(dataset / "features.csv") != manifest["features_sha256"]:
        raise ValueError("Feature artifact checksum mismatch")
    frame = pd.read_csv(dataset / "features.csv", float_precision="round_trip")
    assert_split(manifest["split"], frame.dog_id.unique())
    assignments = {dog: part for part, dogs in manifest["split"].items() for dog in dogs}
    if not frame.split.eq(frame.dog_id.map(assignments)).all():
        raise ValueError("Row assignment differs from frozen DogID split")
    if not np.isfinite(frame[list(FEATURE_NAMES)].to_numpy()).all():
        raise ValueError("Nonfinite features")
    if frame.duplicated(["dog_id", "test_num", "start"]).any():
        raise ValueError("Duplicate windows")
    for _, session in frame.groupby(["dog_id", "test_num"]):
        if session.split.nunique() != 1 or np.any(np.diff(np.sort(session.start)) < 3 - 1e-8):
            raise ValueError("Session leakage or overlapping windows")
    for part, ids in manifest["split"].items():
        subset = frame[frame.split == part]
        if set(subset.dog_id) != set(ids) or set(subset.activity) != set(manifest["classes"]):
            raise ValueError("Dog assignment or class distribution mismatch")
    return manifest, frame


def fit_candidates(train, validation, classes, seed):
    # Neither estimator requires scaling. All learned statistics/class weights use Train only.
    candidates = {
        "dummy_most_frequent": DummyClassifier(strategy="most_frequent", random_state=seed),
        "rf_unweighted": RandomForestClassifier(
            n_estimators=300,
            min_samples_leaf=2,
            max_features="sqrt",
            class_weight=None,
            random_state=seed,
            n_jobs=4,
        ),
        "rf_balanced": RandomForestClassifier(
            n_estimators=300,
            min_samples_leaf=2,
            max_features="sqrt",
            class_weight="balanced_subsample",
            random_state=seed,
            n_jobs=4,
        ),
    }
    scores = {}
    for name, estimator in candidates.items():
        estimator.fit(train[list(FEATURE_NAMES)].to_numpy(), train.activity.to_numpy())
        pred = estimator.predict(validation[list(FEATURE_NAMES)].to_numpy())
        scores[name] = evaluate(validation.activity, pred, classes, validation.dog_id)
        print(
            f"Validation {name}: accuracy={scores[name]['accuracy']:.6f}, macro F1={scores[name]['macro_f1']:.6f}",
            flush=True,
        )
    best = max(scores, key=lambda name: scores[name]["macro_f1"])
    return candidates, scores, best


def train_model(dataset, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)  # cannot silently overwrite a frozen experiment
    manifest, frame = load_features(dataset)
    train, validation = frame[frame.split == "train"], frame[frame.split == "validation"]
    candidates, scores, best = fit_candidates(
        train, validation, manifest["classes"], manifest["seed"]
    )
    selected = candidates[best]
    joblib.dump(selected, output / "model.joblib", compress=3)
    joblib.dump(candidates["dummy_most_frequent"], output / "dummy.joblib", compress=3)
    metadata = {
        **manifest,
        "model_version": MODEL_VERSION,
        "sensor_position": "back",
        "model_type": type(selected).__name__,
        "selected_candidate": best,
        "selection_metric": "validation macro_f1; insertion order resolves ties",
        "hyperparameters": selected.get_params(),
        "training_windows": len(train),
        "scaling": "none; tree and dummy require no scaler",
        "refit_on_validation": False,
        "evaluation_metrics": {"validation": scores},
        "model_sha256": sha256(output / "model.joblib"),
        "dummy_sha256": sha256(output / "dummy.joblib"),
        "library_versions": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "scipy": scipy.__version__,
            "scikit-learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
    }
    write_json(output / "metadata.json", metadata)
    restored = ActivityModel(output)
    x = validation[list(FEATURE_NAMES)].to_numpy()
    if not np.array_equal(selected.predict(x), restored.estimator.predict(x)):
        raise ValueError("Model reload predictions differ")
    write_json(
        output / "selection.json",
        {
            "selected": best,
            "validation": scores,
            "model_sha256": metadata["model_sha256"],
            "reload_predictions_identical": True,
        },
    )
    return metadata


def evaluate_test(dataset, output):
    output = Path(output)
    if (output / "test-evaluation.json").exists() or (output / "test-evaluation.started").exists():
        raise ValueError("Final test evaluation already started/completed; keep Test frozen")
    manifest, frame = load_features(dataset)
    model = ActivityModel(output)
    if any(
        model.metadata[k] != manifest[k] for k in ("split", "classes", "features_sha256", "seed")
    ):
        raise ValueError("Evaluation dataset differs from training manifest")
    if sha256(output / "dummy.joblib") != model.metadata["dummy_sha256"]:
        raise ValueError("Dummy checksum mismatch")
    (output / "test-evaluation.started").write_text(
        "Test locked after validation-only model selection.\n"
    )
    test = frame[frame.split == "test"]
    x = test[list(FEATURE_NAMES)].to_numpy()
    pred = model.estimator.predict(x)
    dummy = joblib.load(output / "dummy.joblib")
    result = {
        "selected": evaluate(test.activity, pred, manifest["classes"], test.dog_id),
        "dummy": evaluate(test.activity, dummy.predict(x), manifest["classes"], test.dog_id),
        "model_sha256": model.metadata["model_sha256"],
    }
    write_json(output / "test-evaluation.json", result)
    metadata = model.metadata
    metadata["evaluation_metrics"]["test"] = result
    write_json(output / "metadata.json", metadata)
    predictions = test[["dog_id", "test_num", "start", "activity", "split"]].copy()
    predictions["predicted_activity"] = pred
    predictions.to_csv(output / "test-predictions.csv", index=False)
    print(json.dumps(result), flush=True)
    return result
