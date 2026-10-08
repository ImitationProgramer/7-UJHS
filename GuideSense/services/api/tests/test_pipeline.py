import asyncio
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from guidesense_api.main import SensorHub, create_app
from guidesense_api.models import SensorFrame


def frame():
    now = time.time_ns() // 1_000_000
    return {
        "type": "sensor_frame",
        "deviceId": "test-device",
        "timestamp": now,
        "accelerometer": {"x": 0.1, "y": 0.2, "z": 0.3, "timestamp": now},
        "gyroscope": {"x": 1, "y": 2, "z": 3, "timestamp": now},
        "location": {"latitude": 37.5, "longitude": 127, "accuracy": 3.5, "timestamp": now},
        "sensorStatus": {"accelerometer": "ready", "gyroscope": "ready", "location": "ready"},
    }


def until(socket, predicate):
    for _ in range(30):
        value = socket.receive_json()
        if predicate(value):
            return value
    raise AssertionError("Expected state did not arrive")


def test_real_websocket_broadcast_snapshot_and_timeout():
    with TestClient(create_app(0.15)) as client:
        with client.websocket_connect("/ws/dashboard") as first:
            initial = first.receive_json()
            assert initial["status"] == "disconnected" and initial["frame"] is None
            with client.websocket_connect("/ws/device") as device:
                value = frame()
                device.send_json(value)
                received = until(first, lambda event: event["status"] == "connected")
                assert received["frame"] == value
                assert received["lastSensorTimestamp"] == value["timestamp"]
                assert received["lastReceivedAt"] > 0
                with client.websocket_connect("/ws/dashboard") as second:
                    assert second.receive_json()["frame"] == value
                    value["accelerometer"]["x"] = -4.2
                    device.send_json(value)
                    for dashboard in [first, second]:
                        assert until(
                            dashboard, lambda event: event["frame"]["accelerometer"]["x"] == -4.2
                        )
                # Silent but open socket must also time out.
                expired = until(first, lambda event: event["status"] == "disconnected")
                assert expired["lastSensorTimestamp"] == value["timestamp"]
                device.send_json(value)
                until(first, lambda event: event["status"] == "connected")
            until(first, lambda event: event["status"] == "disconnected")
            assert client.get("/health").json()["acceptedFrames"] == 3


def test_invalid_input_does_not_refresh_last_seen():
    with TestClient(create_app()) as client:
        for invalid in ["not-json", '{"type":"sensor_frame"}']:
            with client.websocket_connect("/ws/device") as device:
                device.send_text(invalid)
                with pytest.raises(WebSocketDisconnect) as error:
                    device.receive_json()
                assert error.value.code == 1008
        health = client.get("/health").json()
        assert health["lastReceivedAt"] is None and health["acceptedFrames"] == 0


def test_null_denied_and_second_device_rejection():
    with TestClient(create_app()) as client:
        with client.websocket_connect("/ws/device") as device:
            value = frame()
            value["location"] = None
            value["sensorStatus"]["location"] = "denied"
            device.send_json(value)
            with client.websocket_connect("/ws/dashboard") as dashboard:
                received = until(dashboard, lambda event: event["frame"] is not None)
                assert received["frame"]["location"] is None
            with client.websocket_connect("/ws/device") as second:
                with pytest.raises(WebSocketDisconnect) as error:
                    second.receive_json()
                assert error.value.code == 1008
            value["deviceId"] = "changed-device"
            device.send_json(value)
            with pytest.raises(WebSocketDisconnect):
                device.receive_json()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value.update(timestamp="123"),
        lambda value: value.update(extra=True),
        lambda value: value["accelerometer"].update(x=float("nan")),
        lambda value: value["location"].update(latitude=91),
        lambda value: value["location"].update(accuracy=-1),
        lambda value: value["sensorStatus"].update(location="denied"),
        lambda value: value.update(location=None),
    ],
)
def test_schema_rejects_untruthful_or_malformed_frames(mutation):
    value = frame()
    mutation(value)
    with pytest.raises(ValidationError):
        SensorFrame.model_validate(value)


def test_slow_dashboard_queue_is_bounded_and_clock_is_server_owned():
    hub = SensorHub(3)
    queue = asyncio.Queue(maxsize=1)
    hub.dashboards.add(queue)
    value = frame()
    value["timestamp"] = 9007199254740991  # Client clock cannot keep it connected forever.
    for i in range(200):
        value["accelerometer"]["x"] = i
        hub.receive(SensorFrame.model_validate(value))
    assert queue.qsize() == 1
    assert queue.get_nowait()["frame"]["accelerometer"]["x"] == 199
    hub.last_received_mono -= 4
    assert hub.snapshot()["status"] == "disconnected"


def test_binary_and_oversized_frames_rejected():
    with TestClient(create_app()) as client:
        for value in [b"binary", " " * 16385]:
            with client.websocket_connect("/ws/device") as device:
                if isinstance(value, bytes):
                    device.send_bytes(value)
                else:
                    device.send_text(value)
                with pytest.raises(WebSocketDisconnect) as error:
                    device.receive_json()
                assert error.value.code == 1009
