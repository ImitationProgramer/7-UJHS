"""Synthetic clock/lifecycle tests and explicitly opted-in real artifact tests."""

import asyncio
import json
import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from guidesense_api.main import create_app
from guidesense_api.replay import DEFAULT_CLIPS, ROOT, RecordedClip, ReplayCommand, ReplaySession


class Clock:
    value = 0.0

    def __call__(self):
        return self.value


class SyntheticClip:
    """Test fixture only; never registered in the product catalog."""

    def __init__(self, *_):
        self.manifest = {"start": 100, "is_live": False}
        self.duration, self.finish_at = 6, 6.2
        self.samples = [
            {
                "timestamp": 100 + i / 50,
                "elapsed_seconds": i / 50,
                "accelerometer": {"x": i, "y": 0, "z": 0},
                "gyroscope": {"x": 0, "y": 0, "z": 0},
                "label": ["fixture"],
                "behavior_annotations": {"Behavior_1": "fixture"},
                "window_id": i // 150,
                "window_quality": "VALID",
                "model_prediction": {"predicted_activity": "DO_NOT_SEND"},
            }
            for i in range(300)
        ]
        self.windows = [{"prediction_available_at": 103.2}, {"prediction_available_at": 106.2}]
        self.calls = []

    def infer(self, index):
        self.calls.append(index)
        return {"test_fixture": True, "window_id": index}


def test_clock_pause_resume_stop_restart_and_finish():
    async def run():
        clock = Clock()
        session = ReplaySession({"fixture": Path(".")}, clock=clock, loader=SyntheticClip)
        await session.command(ReplayCommand(action="play", clip_id="fixture"))
        clock.value = 3.19
        await session.advance()
        assert session.prediction is None
        assert session.cursor == 160
        assert all("model_prediction" not in s for s in session.batch)
        assert [s["timestamp"] for s in session.batch] == sorted(
            s["timestamp"] for s in session.batch
        )
        clock.value = 3.2
        await session.advance()
        assert session.clip.calls == [0]
        await session.command(ReplayCommand(action="pause"))
        clock.value = 40
        await session.advance()
        assert session.clip.calls == [0]
        assert session.elapsed == 3.2 and session.batch == []
        await session.command(ReplayCommand(action="resume"))
        clock.value = 43
        await session.advance()
        assert session.state == "COMPLETED"
        assert session.clip.calls == [0, 1]
        assert session.snapshot()["progress"] == 1
        assert session.snapshot()["elapsed_seconds"] == 6
        assert session.latest is None
        clock.value = 100
        await session.advance()
        assert session.clip.calls == [0, 1]
        await session.command(ReplayCommand(action="stop"))
        assert session.prediction is None and session.cursor == 0
        assert session.snapshot()["progress"] == 0
        await session.command(ReplayCommand(action="restart"))
        assert session.state == "PLAYING" and session.prediction is None
        assert session.run_id == 3

    asyncio.run(run())


def test_path_allowlist_and_invalid_command():
    async def run():
        session = ReplaySession()
        with pytest.raises(ValueError):
            await session.command(ReplayCommand(action="play", clip_id="../../etc/passwd"))
        with pytest.raises(ValueError):
            await session.command(ReplayCommand(action="resume"))
        session.fail("test failure")
        assert session.snapshot()["state"] == "ERROR"
        assert session.snapshot()["prediction"] is None

    asyncio.run(run())


def receive_until(socket, state):
    for _ in range(100):
        value = socket.receive_json()
        if value["state"] == state:
            return value
    raise AssertionError(f"Missing state {state}")


def test_missing_artifact_error_and_independent_live_state(tmp_path):
    app = create_app(replay_clips={"missing": tmp_path / "absent"})
    with TestClient(app) as client:
        assert client.get("/api/replays").json()["clips"] == [{"id": "missing", "available": False}]
        with client.websocket_connect("/ws/replay") as replay:
            assert replay.receive_json()["state"] == "IDLE"
            replay.send_json({"action": "play", "clip_id": "missing"})
            error = receive_until(replay, "ERROR")
            assert "파일이 없습니다" in error["error"]
            assert error["source"] == "canine_dataset_replay"
            assert error["prediction"] is None
            assert client.get("/health").json()["acceptedFrames"] == 0
            with client.websocket_connect("/ws/dashboard") as live:
                snap = live.receive_json()
                assert snap["source"] == "iphone_live"
                assert snap["status"] == "disconnected"
            replay.send_json({"action": "stop"})
            assert receive_until(replay, "STOPPED")["error"] is None


def test_two_dashboard_sessions_do_not_control_each_other(monkeypatch):
    from guidesense_api import replay as module

    monkeypatch.setattr(module.ReplaySession, "__init__", _fixture_init)
    with TestClient(create_app()) as client:
        with (
            client.websocket_connect("/ws/replay") as first,
            client.websocket_connect("/ws/replay") as second,
        ):
            first.receive_json()
            second.receive_json()
            first.send_json({"action": "play", "clip_id": "fixture"})
            assert receive_until(first, "PLAYING")["sample_count"] > 0
            assert second.receive_json()["state"] == "IDLE"
            second.send_json({"action": "stop"})
            receive_until(second, "STOPPED")
            assert first.receive_json()["state"] == "PLAYING"


_original_init = ReplaySession.__init__


def _fixture_init(self, *_):
    _original_init(self, {"fixture": Path(".")}, loader=SyntheticClip)


real_data = pytest.mark.skipif(
    os.getenv("GUIDESENSE_REAL_DATA") != "1", reason="local recorded artifacts opt-in"
)


@real_data
@pytest.mark.parametrize("clip_id", list(DEFAULT_CLIPS))
def test_real_saved_model_all_windows_and_truth_separation(clip_id):
    clip = RecordedClip(DEFAULT_CLIPS[clip_id], ROOT / "artifacts/goal3/model")
    assert len(clip.samples) == round(clip.duration * 50)
    assert clip.model.estimator.n_features_in_ == 112
    results = [clip.infer(i) for i in range(len(clip.windows))]
    assert all(r["matches_saved"] for r in results)
    assert all(r["inference_executed"] and not r["offline_precomputed"] for r in results)
    assert results[0]["actual_activity"] == (
        "Lying chest" if clip_id == "dog44-posture" else "Walking"
    )
    original_prediction = results[0]["predicted_activity"]
    # Altering truth cannot alter sensor features or the executed prediction.
    clip.windows[0]["actual_activity"] = (
        "Walking" if original_prediction != "Walking" else "Sitting"
    )
    altered = clip.infer(0)
    assert (
        altered["predicted_activity"] == original_prediction and altered["matches_actual"] is False
    )
    clip.windows[0]["window_quality"] = "INVALID_WINDOW"
    clip.model.predict_window = lambda _: pytest.fail("INVALID_WINDOW reached model")
    assert clip.infer(0)["inference_executed"] is False
    assert clip.infer(0)["predicted_activity"] is None


@real_data
@pytest.mark.parametrize(
    "fault",
    [
        "timestamp",
        "elapsed",
        "axis",
        "provenance",
        "model_hash",
        "preprocessing",
        "split",
        "quality",
    ],
)
def test_corrupt_recorded_contract_rejected_even_with_updated_file_hash(tmp_path, fault):
    from guidesense_gait.activity_data import sha256

    folder = tmp_path / "replay"
    shutil.copytree(DEFAULT_CLIPS["dog22-demo"], folder)
    m = json.loads((folder / "manifest.json").read_text())
    samples = [json.loads(s) for s in (folder / "samples.jsonl").read_text().splitlines()]
    if fault == "timestamp":
        samples[1]["timestamp"] = samples[0]["timestamp"]
    if fault == "elapsed":
        samples[1]["elapsed_seconds"] = 999
    if fault == "axis":
        samples[0]["accelerometer"]["w"] = 0
    if fault == "provenance":
        samples[0]["dog_id"] = 26
    if fault == "model_hash":
        m["model_sha256"] = "wrong"
    if fault == "preprocessing":
        m["preprocessing_version"] = "wrong"
    if fault == "split":
        m["split"] = "validation"
    if fault == "quality":
        samples[0]["window_quality"] = "INVALID_WINDOW"
    (folder / "samples.jsonl").write_text("\n".join(json.dumps(s) for s in samples) + "\n")
    m["files"]["samples.jsonl"] = sha256(folder / "samples.jsonl")
    (folder / "manifest.json").write_text(json.dumps(m))
    with pytest.raises((ValueError, KeyError)):
        RecordedClip(folder, ROOT / "artifacts/goal3/model")


@real_data
def test_missing_model_and_metadata_mismatch(tmp_path):
    with pytest.raises(FileNotFoundError):
        RecordedClip(DEFAULT_CLIPS["dog22-demo"], tmp_path)
    m = json.loads((ROOT / "artifacts/goal3/model/metadata.json").read_text())
    m["feature_order"] = m["feature_order"][::-1]
    (tmp_path / "metadata.json").write_text(json.dumps(m))
    with pytest.raises(ValueError, match="metadata"):
        RecordedClip(DEFAULT_CLIPS["dog22-demo"], tmp_path)


def test_live_remains_available_without_ml_dependencies(monkeypatch, tmp_path):
    import sys

    monkeypatch.setitem(sys.modules, "guidesense_gait.activity_model", None)
    with TestClient(create_app(replay_clips={"demo": tmp_path})) as client:
        assert client.get("/health").json()["status"] == "ok"
        with client.websocket_connect("/ws/dashboard") as live:
            assert live.receive_json()["source"] == "iphone_live"
        with client.websocket_connect("/ws/replay") as replay:
            replay.receive_json()
            replay.send_json({"action": "play", "clip_id": "demo"})
            assert "ML 의존성" in receive_until(replay, "ERROR")["error"]
        assert client.get("/health").json()["status"] == "ok"
