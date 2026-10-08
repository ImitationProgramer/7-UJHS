"""Strict offline model contract. No model is applied to the live sensor relay."""

import json
from pathlib import Path

import joblib
import numpy as np
import sklearn

from .activity_data import (
    CSV_SHA256,
    DATASET_VERSION,
    PREPROCESSING_VERSION,
    UNIT_SPACE,
    UNITS,
    assert_split,
    sha256,
)
from .pipeline import FEATURE_NAMES, FEATURE_SCHEMA_VERSION, extract_features

MODEL_VERSION = "goal3-v1"


def validate_metadata(meta):
    expected = {
        "model_version": MODEL_VERSION,
        "dataset_version": DATASET_VERSION,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_order": list(FEATURE_NAMES),
        "preprocessing_version": PREPROCESSING_VERSION,
        "sampling_rate": 50,
        "window_duration": 3,
        "units": UNITS,
        "unit_space": UNIT_SPACE,
        "sensor_position": "back",
        "source_sha256": CSV_SHA256,
    }
    if any(meta.get(k) != v for k, v in expected.items()):
        raise ValueError("Incompatible model metadata/schema/units/preprocessing")
    required = (
        "split",
        "classes",
        "source_sha256",
        "features_sha256",
        "model_sha256",
        "evaluation_metrics",
        "hyperparameters",
        "library_versions",
        "seed",
        "training_windows",
        "model_type",
    )
    if any(k not in meta for k in required):
        raise ValueError("Incomplete model metadata")
    assert_split(meta["split"], [d for ids in meta["split"].values() for d in ids])
    if len(meta["classes"]) < 2 or len(set(meta["classes"])) != len(meta["classes"]):
        raise ValueError("Invalid model classes")
    if meta["library_versions"]["scikit-learn"] != sklearn.__version__:
        raise ValueError("scikit-learn version mismatch; use the pinned model environment")


def compatibility(window, feature_schema=FEATURE_SCHEMA_VERSION, feature_order=FEATURE_NAMES):
    """Physical compatibility and canine validation are separate from equal feature shape."""
    meta = window.series.metadata
    if (
        feature_schema != FEATURE_SCHEMA_VERSION
        or tuple(feature_order) != FEATURE_NAMES
        or window.quality.get("status") != "VALID"
    ):
        return {"status": "INVALID", "reason": "schema or window quality"}
    if meta.get("source") == "iphone_imu":
        if meta.get("units") != {"acceleration": "g", "gyroscope": "rad/s"}:
            return {"status": "INVALID", "reason": "invalid iPhone units"}
        return {
            "status": "UNVALIDATED",
            "reason": "no canine harness/domain validation; no inference",
            "model_unit_compatible": False,
        }
    if (
        meta.get("source") != "mendeley_vxhx934tbn_v4"
        or meta.get("units") != UNITS
        or meta.get("unit_space") != UNIT_SPACE
        or meta.get("dataset_version") != DATASET_VERSION
        or meta.get("position") != "back"
        or meta.get("preprocessing_version") != PREPROCESSING_VERSION
        or meta.get("preprocessing", {}).get("target_rate") != 50
        or window.quality.get("duration") != 3
        or len(window.series.t) != 150
    ):
        return {"status": "INVALID", "reason": "source, units, preprocessing, or shape mismatch"}
    return {"status": "SUPPORTED", "reason": "audited public canine dataset native unit space"}


class ActivityModel:
    def __init__(self, folder):
        folder = Path(folder)
        self.metadata = json.loads((folder / "metadata.json").read_text())
        validate_metadata(self.metadata)
        if sha256(folder / "model.joblib") != self.metadata["model_sha256"]:
            raise ValueError("Model checksum mismatch")
        # Only load locally generated trusted artifacts; joblib/pickle can execute code.
        self.estimator = joblib.load(folder / "model.joblib")
        if self.estimator.n_features_in_ != len(FEATURE_NAMES) or set(
            self.estimator.classes_
        ) != set(self.metadata["classes"]):
            raise ValueError("Serialized estimator disagrees with metadata")
        if (
            type(self.estimator).__name__ != self.metadata["model_type"]
            or self.estimator.get_params() != self.metadata["hyperparameters"]
        ):
            raise ValueError("Serialized estimator parameters disagree with metadata")

    def predict_features(
        self,
        features,
        *,
        feature_schema,
        units,
        unit_space,
        source,
        preprocessing_version,
        window_quality,
    ):
        if (
            feature_schema != FEATURE_SCHEMA_VERSION
            or tuple(features) != FEATURE_NAMES
            or units != UNITS
            or unit_space != UNIT_SPACE
            or source != "mendeley_vxhx934tbn_v4"
            or preprocessing_version != PREPROCESSING_VERSION
            or window_quality != "VALID"
        ):
            raise ValueError("INVALID model input contract")
        x = np.asarray(list(features.values()), dtype=float)
        if x.shape != (112,) or not np.isfinite(x).all():
            raise ValueError("INVALID feature values")
        return str(self.estimator.predict(x.reshape(1, -1))[0])

    def predict_window(self, window):
        check = compatibility(window)
        if check["status"] != "SUPPORTED":
            raise ValueError(check["status"] + ": " + check["reason"])
        meta = window.series.metadata
        predicted = self.predict_features(
            extract_features(window),
            feature_schema=FEATURE_SCHEMA_VERSION,
            units=meta["units"],
            unit_space=meta["unit_space"],
            source=meta["source"],
            preprocessing_version=meta["preprocessing_version"],
            window_quality=window.quality["status"],
        )
        dog = meta["dog_id"]
        split = next((k for k, ids in self.metadata["split"].items() if dog in ids), "external")
        return {
            "source": "public_canine_dataset",
            "recording_mode": "DATASET_REPLAY",
            "model_version": self.metadata["model_version"],
            "dog_id": dog,
            "test_num": meta["test_num"],
            "split": split,
            "predicted_activity": predicted,
            "window_quality": "VALID",
            "compatibility": "SUPPORTED",
            "window_start": window.quality["start"],
            "window_end": window.quality["end"],
        }
