import json

from fastapi.testclient import TestClient

from guidesense_api.main import create_app
from test_pipeline import frame


def test_explicit_capture_lifecycle_privacy_and_measured_rate(tmp_path):
    app = create_app(capture_root=tmp_path)
    with TestClient(app) as client:
        assert client.post("/api/capture/stop").status_code == 409
        assert client.post("/api/capture/start", json={"context": "made_up"}).status_code == 422
        result = client.post("/api/capture/start", json={"context": "human_held_phone"})
        assert result.status_code == 201
        session = tmp_path / result.json()["session_id"]
        assert client.post("/api/capture/start", json={}).status_code == 409
        value = frame()
        with client.websocket_connect("/ws/device") as device:
            with client.websocket_connect("/ws/dashboard") as dashboard:
                for i in range(151):
                    value["timestamp"] = 1700000000000 + i * 20
                    for key in ["accelerometer", "gyroscope"]:
                        value[key]["timestamp"] = value["timestamp"]
                    device.send_json(value)
                for _ in range(200):
                    r = dashboard.receive_json()
                    if r["frame"] and r["frame"]["timestamp"] == value["timestamp"]:
                        break
                else:
                    raise AssertionError("Final frame not received")
        result = client.post("/api/capture/stop")
        metadata = result.json()
        assert metadata["sample_count"] == 151
        assert metadata["status"] == "complete"
        assert metadata["sensors"]["accelerometer"]["observed_sampling_rate"] == 50
        assert metadata["sensors"]["gyroscope"]["observed_sampling_rate"] == 50
        assert metadata["end_timestamp"] >= metadata["start_timestamp"]
        raw = (session / "imu.jsonl").read_text()
        for forbidden in ["location", "latitude", "longitude", "accuracy", "deviceId"]:
            assert forbidden not in raw
        rows = [json.loads(line) for line in raw.splitlines()]
        assert len(rows) == 151 and rows[0]["accelerometer"]["x"] == 0.1
        assert client.get("/api/capture/status").json()["status"] == "idle"
        assert client.post("/api/capture/stop").status_code == 409
        assert json.loads((session / "session.json").read_text()) == metadata


def test_without_start_no_files_and_shutdown_is_interrupted(tmp_path):
    app = create_app(capture_root=tmp_path)
    with TestClient(app) as client:
        app.state.hub.receive(
            __import__(
                "guidesense_api.models", fromlist=["SensorFrame"]
            ).SensorFrame.model_validate(frame())
        )
        assert list(tmp_path.iterdir()) == []
        result = client.post("/api/capture/start", json={}).json()
    metadata = json.loads((tmp_path / result["session_id"] / "session.json").read_text())
    assert metadata["status"] == "interrupted" and metadata["sample_count"] == 0


def test_writer_failure_does_not_break_sensor_relay(tmp_path):
    app = create_app(capture_root=tmp_path)
    with TestClient(app) as client:
        # Root is an existing file, so starting capture must fail cleanly.
        bad = tmp_path / "file"
        bad.write_text("file")
        with TestClient(create_app(capture_root=bad)) as failed:
            assert failed.post("/api/capture/start", json={}).status_code == 503
            assert failed.get("/health").status_code == 200
        assert client.get("/health").status_code == 200


def test_capture_counts_repeated_sensor_samples_separately(tmp_path):
    from guidesense_api.capture import Capture
    from guidesense_api.models import SensorFrame

    capture = Capture(tmp_path, "human_held_phone")
    value = frame()
    for i in range(5):
        value["timestamp"] += 20
        value["accelerometer"]["timestamp"] += 20
        capture.append(SensorFrame.model_validate(value))
    metadata = capture.finish()
    assert metadata["sample_count"] == 5
    assert metadata["sensors"]["gyroscope"]["count"] == 1
    assert metadata["sensors"]["gyroscope"]["non_increasing"] == 4
    assert metadata["sensors"]["gyroscope"]["observed_sampling_rate"] is None


def test_writer_os_error_marks_invalid_without_breaking_append(tmp_path, monkeypatch):
    from pathlib import Path
    from guidesense_api.capture import Capture
    from guidesense_api.models import SensorFrame

    original_open = Path.open

    def failing_open(path, *args, **kwargs):
        if path.name == "imu.jsonl":
            raise OSError("simulated disk error")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", failing_open)
    capture = Capture(tmp_path, "human_held_phone")
    capture.thread.join(timeout=2)
    assert not capture.thread.is_alive()
    capture.append(SensorFrame.model_validate(frame()))
    result = capture.finish()
    assert result["status"] == "invalid" and result["error"] == "CAPTURE_IO_ERROR"


def test_overflow_is_visible_and_stop_drains(tmp_path, monkeypatch):
    import threading
    from guidesense_api.capture import Capture
    from guidesense_api.models import SensorFrame

    gate = threading.Event()
    original_write = Capture._write

    def delayed_write(capture):
        gate.wait(timeout=5)
        original_write(capture)

    monkeypatch.setattr(Capture, "_write", delayed_write)
    capture = Capture(tmp_path, "human_held_phone")
    value = SensorFrame.model_validate(frame())
    for _ in range(4097):
        capture.append(value)
    assert capture.queue.qsize() == 4096 and capture.dropped == 1
    gate.set()
    result = capture.finish()
    assert result["status"] == "invalid" and result["dropped_frames"] == 1
    assert result["sample_count"] == 4096
