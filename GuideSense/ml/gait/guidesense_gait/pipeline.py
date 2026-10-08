"""One timestamp-based preprocessing / window / feature implementation for every source."""

from dataclasses import dataclass, field
from fractions import Fraction
from typing import Optional

import numpy as np
from scipy.signal import resample_poly

AXES = ("accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z")
CHANNELS = AXES + ("accel_magnitude", "gyro_magnitude")
STATS = (
    "mean",
    "std",
    "variance",
    "min",
    "max",
    "range",
    "rms",
    "median",
    "p05",
    "p25",
    "p75",
    "p95",
    "energy",
    "mean_square",
)
FEATURE_SCHEMA_VERSION = "guidesense-imu-statistics-v1"
FEATURE_NAMES = tuple(f"{channel}__{stat}" for channel in CHANNELS for stat in STATS)


@dataclass
class IMUSeries:
    t: np.ndarray  # seconds, relative to the source session's origin
    values: np.ndarray  # N x 6; original axes are never replaced by magnitudes
    metadata: dict = field(default_factory=dict)
    sensor_t: Optional[np.ndarray] = None  # N x 2: accel, gyro callback seconds

    def __post_init__(self):
        self.t = np.asarray(self.t, dtype=float)
        self.values = np.asarray(self.values, dtype=float)
        if self.t.ndim != 1 or self.values.shape != (len(self.t), 6):
            raise ValueError("Expected t[N] and values[N,6]")
        if not np.isfinite(self.t).all() or np.any(np.diff(self.t) <= 0):
            raise ValueError(
                "Timestamps must be finite, strictly increasing; do not silently sort/dedup"
            )
        if self.sensor_t is not None:
            self.sensor_t = np.asarray(self.sensor_t, dtype=float)
            if self.sensor_t.shape != (len(self.t), 2):
                raise ValueError("Expected sensor_t[N,2]")

    def subset(self, mask):
        return IMUSeries(
            self.t[mask],
            self.values[mask],
            dict(self.metadata),
            self.sensor_t[mask] if self.sensor_t is not None else None,
        )


@dataclass(frozen=True)
class QualityPolicy:
    duration: float = 3.0
    nominal_rate: float = 50.0
    min_rate: float = 45.0
    max_rate: float = 55.0
    max_gap: float = 0.035  # one missing 50Hz sample creates ~40ms and is rejected
    edge_tolerance: float = 0.04
    max_sensor_skew: float = 0.04


@dataclass
class Window:
    series: IMUSeries
    quality: dict


class InvalidWindow(ValueError):
    pass


def magnitudes(values):
    values = np.asarray(values, dtype=float)
    if values.ndim != 2 or values.shape[1] != 6 or not np.isfinite(values).all():
        raise ValueError("Magnitude requires finite N x 6 IMU values")
    with np.errstate(over="raise", invalid="raise"):
        return np.column_stack(
            (values, np.linalg.norm(values[:, :3], axis=1), np.linalg.norm(values[:, 3:], axis=1))
        )


def resample(series, target_rate=50.0):
    """Time-interpolate onto a measured uniform source grid, then anti-alias and decimate.

    Refuses holes/nonfinite values before interpolation. No extrapolation or row skipping.
    Offline only: Kaiser(beta=5) FIR, scipy resample_poly default 20*max(up,down)+1 taps,
    line padding. Metadata preserves exact preprocessing and unit provenance.
    """
    if len(series.t) < 3 or not np.isfinite(series.values).all():
        raise ValueError("Resampling requires finite data and at least three samples")
    if not np.isfinite(target_rate) or target_rate <= 0:
        raise ValueError("target_rate must be finite and positive")
    dt = np.diff(series.t)
    source_rate = 1.0 / np.median(dt)
    if np.max(dt) > 1.5 / source_rate + 1e-8:
        raise ValueError("Source gap: interpolation across missing samples is forbidden")
    # Measured CSV precision is 0.01 s; rounding removes binary floating-point noise.
    source_rate = round(float(source_rate), 6)
    ratio = Fraction(target_rate / source_rate).limit_denominator(1000)
    if not np.isclose(source_rate * ratio.numerator / ratio.denominator, target_rate, rtol=1e-6):
        raise ValueError("Rate ratio cannot be represented accurately")
    count = int(np.floor((series.t[-1] - series.t[0]) * source_rate + 1e-7)) + 1
    source_t = series.t[0] + np.arange(count) / source_rate
    values = np.column_stack([np.interp(source_t, series.t, series.values[:, i]) for i in range(6)])
    filtered = resample_poly(
        values, ratio.numerator, ratio.denominator, axis=0, window=("kaiser", 5.0), padtype="line"
    )
    target_t = series.t[0] + np.arange(len(filtered)) / target_rate
    keep = target_t <= series.t[-1] + 1e-8
    return IMUSeries(
        target_t[keep],
        filtered[keep],
        {
            **series.metadata,
            "preprocessing": {
                "method": "time_interpolation_polyphase_FIR",
                "source_rate": source_rate,
                "target_rate": target_rate,
                "kaiser_beta": 5.0,
                "up": ratio.numerator,
                "down": ratio.denominator,
                "padding": "line",
                "source_sample_count": len(series.t),
                "gravity_removed": False,
            },
        },
    )


def make_window(series, start, policy=QualityPolicy()):
    if not np.isfinite(start) or policy.duration <= 0 or policy.nominal_rate <= 0:
        raise ValueError("Invalid window configuration")
    end = start + policy.duration
    # half-open intervals: a sample at the end belongs to the next window
    data = series.subset((series.t >= start - 1e-9) & (series.t < end - 1e-9))
    n = len(data.t)
    span = float(data.t[-1] - data.t[0]) if n > 1 else 0.0
    rate = (n - 1) / span if span > 0 else None
    dt = np.diff(data.t)
    reasons = []
    if n < np.ceil(policy.duration * policy.min_rate):
        reasons.append("INSUFFICIENT_SAMPLES")
    if (
        n == 0
        or data.t[0] - start > policy.edge_tolerance + 1e-8
        or end - data.t[-1] > policy.edge_tolerance + 1e-8
    ):
        reasons.append("INCOMPLETE_COVERAGE")
    if rate is None or not policy.min_rate <= rate <= policy.max_rate:
        reasons.append("RATE_OUT_OF_RANGE")
    gaps = int(np.sum(dt > policy.max_gap + 1e-8))
    if gaps:
        reasons.append("GAP_DETECTED")
    if not np.isfinite(data.values).all():
        reasons.append("NONFINITE_OR_MISSING_CHANNEL")
    sensor_quality = {}
    if data.sensor_t is not None:
        for i, name in enumerate(("accelerometer", "gyroscope")):
            t = data.sensor_t[:, i]
            finite = np.isfinite(t).all()
            delta = np.diff(t)
            sspan = float(t[-1] - t[0]) if n > 1 and finite else 0
            srate = (n - 1) / sspan if sspan > 0 else None
            bad = not finite or np.any(delta <= 0) or np.any(delta > policy.max_gap + 1e-8)
            bad |= bool(n and (not finite or np.max(np.abs(t - data.t)) > policy.max_sensor_skew))
            bad |= srate is None or not policy.min_rate <= srate <= policy.max_rate
            if bad:
                reasons.append(f"INVALID_{name.upper()}_TIMING")
            sensor_quality[name] = {
                "effective_sampling_rate": srate,
                "non_increasing": int((delta <= 0).sum()),
                "gap_count": int((delta > policy.max_gap + 1e-8).sum()),
            }
    quality = {
        "status": "INVALID_WINDOW" if reasons else "VALID",
        "reasons": reasons,
        "start": float(start),
        "end": float(end),
        "duration": policy.duration,
        "observed_duration": span,
        "sample_count": n,
        "nominal_sample_count": round(policy.duration * policy.nominal_rate),
        "effective_sampling_rate": rate,
        "gap_count": gaps,
        "max_gap": float(dt.max()) if len(dt) else None,
        "estimated_missing_samples": int(
            np.maximum(np.rint(dt * policy.nominal_rate) - 1, 0).sum()
        ),
        "sensor_timing": sensor_quality,
    }
    return Window(data, quality)


def windows(series, start=None, policy=QualityPolicy()):
    if not len(series.t):
        return
    start = float(series.t[0]) if start is None else start
    count = max(0, int(np.floor((series.t[-1] - start) / policy.duration + 1e-9)) + 1)
    for i in range(count):
        # The incomplete tail is returned as INVALID_WINDOW, never silently promoted.
        yield make_window(series, start + i * policy.duration, policy)


def extract_features(window):
    if window.quality["status"] != "VALID":
        raise InvalidWindow(", ".join(window.quality["reasons"]))
    x = magnitudes(window.series.values)
    features = {}
    with np.errstate(over="raise", invalid="raise"):
        for i, channel in enumerate(CHANNELS):
            v = x[:, i]
            energy = np.sum(v * v)
            values = (
                np.mean(v),
                np.std(v, ddof=0),
                np.var(v, ddof=0),
                np.min(v),
                np.max(v),
                np.ptp(v),
                np.sqrt(np.mean(v * v)),
                np.median(v),
                *np.percentile(v, [5, 25, 75, 95]),
                energy,
                np.mean(v * v),
            )
            features.update(
                {f"{channel}__{stat}": float(value) for stat, value in zip(STATS, values)}
            )
    if tuple(features) != FEATURE_NAMES or not np.isfinite(list(features.values())).all():
        raise ValueError("Invalid feature schema or nonfinite feature; never replace with zero")
    return features


def analyze_window(window):
    return {
        "quality": window.quality,
        "metadata": window.series.metadata,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "features": extract_features(window) if window.quality["status"] == "VALID" else None,
    }
