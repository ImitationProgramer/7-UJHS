import numpy as np
import pandas as pd
import pytest

from guidesense_gait.adapters import from_dataset, from_live_buffer, walking_segment
from guidesense_gait.pipeline import (
    FEATURE_NAMES,
    IMUSeries,
    InvalidWindow,
    analyze_window,
    extract_features,
    magnitudes,
    make_window,
    resample,
    windows,
)


def series(rate=50, seconds=6):
    t = np.arange(round(rate * seconds)) / rate
    return IMUSeries(t, np.tile([3.0, 4, 0, 0, 0, 2], (len(t), 1)))


def test_half_open_time_windows_and_tail():
    s = series(seconds=6.5)
    w = list(windows(s))
    assert [x.quality["sample_count"] for x in w] == [150, 150, 25]
    assert [x.quality["status"] for x in w] == ["VALID", "VALID", "INVALID_WINDOW"]
    assert w[0].series.t[-1] == 2.98 and w[1].series.t[0] == 3
    assert w[0].quality["duration"] == 3
    assert w[0].quality["effective_sampling_rate"] == pytest.approx(50)


def test_irregular_49hz_does_not_require_150_rows():
    s = series(49, 3)
    s.t[1:-1] += np.sin(np.arange(len(s.t) - 2)) * 0.001
    w = make_window(s, 0)
    assert w.quality["status"] == "VALID"
    assert w.quality["sample_count"] == 147
    assert len(extract_features(w)) == 112


@pytest.mark.parametrize(
    "mode", ["missing", "tail", "nan", "inf", "gyro_missing", "gyro_repeated", "skew"]
)
def test_invalid_rejected(mode):
    s = series(seconds=3)
    if mode == "missing":
        s = s.subset(np.arange(len(s.t)) != 70)
    elif mode == "tail":
        s = s.subset(s.t < 2.9)
    elif mode in ("nan", "inf"):
        s.values[40, 0] = float(mode)
    else:
        s.sensor_t = np.column_stack([s.t, s.t])
        if mode == "gyro_missing":
            s.sensor_t[30, 1] = np.nan
        if mode == "gyro_repeated":
            s.sensor_t[30, 1] = s.sensor_t[29, 1]
        if mode == "skew":
            s.sensor_t[:, 1] -= 0.1
    w = make_window(s, 0)
    assert w.quality["status"] == "INVALID_WINDOW"
    assert analyze_window(w)["features"] is None
    with pytest.raises(InvalidWindow):
        extract_features(w)


@pytest.mark.parametrize("t", [[0, 0, 0.02], [0, 0.03, 0.02], [0, float("nan"), 0.02]])
def test_bad_timestamps_never_sorted_or_replaced(t):
    with pytest.raises(ValueError):
        IMUSeries(t, np.ones((3, 6)))


def test_magnitude_features_statistics_and_rotation():
    s = series(seconds=3)
    original = s.values.copy()
    features = extract_features(make_window(s, 0))
    assert tuple(features) == FEATURE_NAMES
    assert features["accel_magnitude__mean"] == 5
    assert features["gyro_magnitude__mean"] == 2
    assert features["accel_x__energy"] == 150 * 9
    assert features["accel_magnitude__mean_square"] == 25
    for key in ["std", "variance", "range"]:
        assert features[f"accel_x__{key}"] == 0
    assert features["accel_x__p05"] == features["accel_x__median"] == 3
    np.testing.assert_array_equal(s.values, original)
    s.values[:, :3] = s.values[:, :3] @ np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1]])
    np.testing.assert_allclose(magnitudes(s.values)[:, -2:], magnitudes(original)[:, -2:])


def test_nonconstant_stats_and_no_nan_zero_fallback():
    s = series(seconds=3)
    s.values[:, 0] = np.arange(150)
    f = extract_features(make_window(s, 0))
    assert f["accel_x__mean"] == 74.5
    assert f["accel_x__variance"] == pytest.approx((150**2 - 1) / 12)
    assert f["accel_x__p25"] == 37.25
    with pytest.raises(ValueError):
        magnitudes([[np.nan] * 6])
    s.values[:, :] = 1e308
    with pytest.raises((FloatingPointError, ValueError)):
        extract_features(make_window(s, 0))


def test_time_resampling_preserves_constant_axes_and_does_not_mutate():
    s = series(100, 6)
    original = s.values.copy()
    r = resample(s)
    assert len(r.t) == 300
    np.testing.assert_allclose(np.diff(r.t), 0.02)
    np.testing.assert_allclose(r.values, s.values[::2], atol=1e-12)
    np.testing.assert_array_equal(s.values, original)
    assert make_window(r, 0).quality["status"] == "VALID"
    assert r.metadata["preprocessing"]["method"] == "time_interpolation_polyphase_FIR"


def test_resampling_attenuates_above_nyquist_and_rejects_gap():
    s = series(100, 6)
    s.values[:, 0] = np.sin(2 * np.pi * 35 * s.t)
    r = resample(s)
    assert np.std(r.values[30:-30, 0]) < 0.01
    s = s.subset(np.arange(len(s.t)) != 40)
    with pytest.raises(ValueError, match="gap"):
        resample(s)


def test_jitter_time_interpolation_and_invalid_resampling():
    s = series(100, 6)
    s.t[1:-1] += 0.0002 * np.sin(np.arange(len(s.t) - 2))
    r = resample(s)
    assert np.diff(r.t).mean() == pytest.approx(0.02)
    s.values[0, 1] = np.nan
    with pytest.raises(ValueError):
        resample(s)


def test_dataset_live_share_identical_feature_order_and_values():
    s = series(50, 3)
    table = pd.DataFrame({"DogID": 16, "TestNum": 1, "t_sec": s.t})
    for i, col in enumerate(["ABack_x", "ABack_y", "ABack_z", "GBack_x", "GBack_y", "GBack_z"]):
        table[col] = s.values[:, i]
    public = from_dataset(table)
    frames = []
    for t, row in zip(s.t, s.values):
        stamp = 1700000000000 + round(t * 1000)
        frame = {"timestamp": stamp}
        for k, v in [("accelerometer", row[:3]), ("gyroscope", row[3:])]:
            frame[k] = dict(zip("xyz", v))
            frame[k]["timestamp"] = stamp
        frames.append(frame)
    live = from_live_buffer(frames)
    a, b = [extract_features(make_window(x, 0)) for x in [public, live]]
    assert tuple(a) == tuple(b) == FEATURE_NAMES and a == b
    assert public.metadata["units"]["gyroscope"] == "UNKNOWN"
    assert live.metadata["units"]["gyroscope"] == "rad/s"


def test_session_boundary_and_separated_walking_bouts():
    table = pd.DataFrame(
        {
            "DogID": [16] * 800,
            "TestNum": [1] * 800,
            "t_sec": np.arange(800) / 100,
            "Task": ["Task walk"] * 800,
            "Behavior_1": ["Walking"] * 300 + ["Standing"] * 200 + ["Walking"] * 300,
            "Behavior_2": ["<undefined>"] * 800,
            "Behavior_3": ["<undefined>"] * 800,
        }
    )
    with pytest.raises(ValueError):
        walking_segment(table)
    table.loc[400:, "TestNum"] = 2
    with pytest.raises(ValueError, match="One dog"):
        from_dataset(table)
