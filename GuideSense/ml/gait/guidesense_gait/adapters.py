"""Source mapping only. Windowing, magnitudes and feature extraction live in pipeline.py."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .pipeline import IMUSeries

BEHAVIORS = ["Behavior_1", "Behavior_2", "Behavior_3"]


def read_dog_session(path, dog, test, position="back"):
    if position not in ("back", "neck"):
        raise ValueError("position must be back or neck")
    chunks = []
    for chunk in pd.read_csv(path, chunksize=250_000, keep_default_na=False):
        selected = chunk[(chunk.DogID == dog) & (chunk.TestNum == test)]
        if len(selected):
            chunks.append(selected)
    if not chunks:
        raise ValueError("DogID/TestNum not found")
    return pd.concat(chunks, ignore_index=True)


def from_dataset(table, position="back"):
    if position not in ("back", "neck"):
        raise ValueError("position must be back or neck")
    if len(table[["DogID", "TestNum"]].drop_duplicates()) != 1:
        raise ValueError("One dog/test per series; never mix session boundaries")
    suffix = position.title()
    columns = [f"{sensor}{suffix}_{axis}" for sensor in "AG" for axis in "xyz"]
    return IMUSeries(
        table.t_sec.to_numpy(),
        table[columns].to_numpy(dtype=float),
        {
            "source": "mendeley_vxhx934tbn_v4",
            "dog_id": int(table.DogID.iloc[0]),
            "test_num": int(table.TestNum.iloc[0]),
            "position": position,
            "units": {"acceleration": "UNKNOWN", "gyroscope": "UNKNOWN"},
            "timestamp": "seconds_since_test_start",
            "raw_columns": columns,
            "orientation": "sensor_local_axes; anatomical mapping not established",
            "gravity_removed": False,
        },
    )


def walking_segment(table, minimum_duration=4.0):
    """First uninterrupted Walking annotation run with unchanged Task/behavior tuple.

    Never filter arbitrary walking rows and concatenate separated bouts.
    """
    labels = ["DogID", "TestNum", "Task"] + BEHAVIORS
    boundary = table[labels].ne(table[labels].shift()).any(axis=1)
    boundary |= table.t_sec.diff().sub(0.01).abs().gt(1e-6)
    for _, group in table.groupby(boundary.cumsum(), sort=False):
        if (group[BEHAVIORS].iloc[0] == "Walking").any() and group.t_sec.iloc[
            -1
        ] - group.t_sec.iloc[0] >= minimum_duration:
            return group
    raise ValueError("No uninterrupted annotated Walking segment long enough")


def from_live_buffer(frames, metadata=None):
    frames = list(frames)
    if not frames:
        raise ValueError("Empty live buffer")
    origin = frames[0]["timestamp"]
    t, values, sensor_t = [], [], []
    for frame in frames:
        t.append((frame["timestamp"] - origin) / 1000)
        row, times = [], []
        for sensor in ("accelerometer", "gyroscope"):
            reading = frame.get(sensor)
            row.extend([reading[axis] for axis in "xyz"] if reading else [np.nan] * 3)
            times.append((reading["timestamp"] - origin) / 1000 if reading else np.nan)
        values.append(row)
        sensor_t.append(times)
    return IMUSeries(
        t,
        values,
        {
            **(metadata or {}),
            "source": "iphone_imu",
            "units": {"acceleration": "g", "gyroscope": "rad/s"},
            "timestamp": "relative_seconds_from_unix_ms_js_callback",
            "origin_unix_ms": origin,
            "position": "prototype; see capture context",
            "orientation": "iPhone device axes",
            "gravity_removed": False,
            "resampled": False,
        },
        sensor_t,
    )


def read_capture(path):
    path = Path(path)
    metadata = json.loads((path / "session.json").read_text())
    if metadata["status"] != "complete" or metadata["dropped_frames"] or metadata["error"]:
        raise ValueError("Capture is not complete/lossless; inspect session metadata")
    with (path / "imu.jsonl").open() as source:
        frames = [json.loads(line) for line in source]
    if len(frames) != metadata["sample_count"]:
        raise ValueError("Capture file count does not match metadata")
    return from_live_buffer(
        frames, {"session_id": metadata["session_id"], "context": metadata["context"]}
    )
