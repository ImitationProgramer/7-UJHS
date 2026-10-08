import asyncio
import os
import time
from contextlib import asynccontextmanager, suppress
from typing import Optional, Literal
from pathlib import Path

import anyio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import ValidationError, BaseModel, ConfigDict

from .capture import Capture
from .replay import install_replay

from .models import SensorFrame, Snapshot


class SensorHub:
    """One producer, many consumers; all mutations run on the same event loop."""

    def __init__(self, timeout_seconds=3.0):
        if not 0.1 <= timeout_seconds <= 60:
            raise ValueError("DEVICE_TIMEOUT_SECONDS must be between 0.1 and 60")
        self.timeout_seconds = timeout_seconds
        self.device: Optional[WebSocket] = None
        self.frame: Optional[SensorFrame] = None
        self.last_received_at: Optional[int] = None
        self.last_received_mono: Optional[float] = None
        self.dashboards: set = set()
        self.accepted_frames = 0
        self.capture = None

    def snapshot(self):
        connected = self.last_received_mono is not None and (
            time.monotonic() - self.last_received_mono < self.timeout_seconds
        )
        return Snapshot(
            deviceId=self.frame.deviceId if self.frame else None,
            status="connected" if connected else "disconnected",
            lastSensorTimestamp=self.frame.timestamp if self.frame else None,
            lastReceivedAt=self.last_received_at,
            timeoutMs=round(self.timeout_seconds * 1000),
            frame=self.frame,
        ).model_dump(mode="json")

    def publish(self):
        snapshot = self.snapshot()
        for queue in self.dashboards:
            # A slow dashboard cannot delay acquisition or grow memory without bound.
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(snapshot)

    def receive(self, frame):
        self.frame = frame
        self.last_received_at = time.time_ns() // 1_000_000
        self.last_received_mono = time.monotonic()
        self.accepted_frames += 1
        if self.capture is not None:
            self.capture.append(frame)
        self.publish()

    async def heartbeat(self):
        while True:
            await asyncio.sleep(min(0.25, self.timeout_seconds / 2))
            self.publish()


class CaptureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context: Literal["human_held_phone", "dog_harness", "unspecified"] = "unspecified"


def create_app(timeout_seconds=None, capture_root=None, replay_clips=None, model_folder=None):
    hub = SensorHub(
        float(os.getenv("DEVICE_TIMEOUT_SECONDS", "3"))
        if timeout_seconds is None
        else timeout_seconds
    )

    capture_root = (
        Path(capture_root)
        if capture_root
        else Path(__file__).resolve().parents[3] / "data" / "captures"
    )
    capture_lock = None

    @asynccontextmanager
    async def lifespan(app):
        nonlocal capture_lock
        capture_lock = asyncio.Lock()
        task = asyncio.create_task(hub.heartbeat())
        yield
        if hub.capture is not None:
            capture, hub.capture = hub.capture, None
            await asyncio.to_thread(capture.finish, True)
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    app = FastAPI(title="GuideSense sensor relay", lifespan=lifespan)
    app.state.hub = hub
    install_replay(app, replay_clips, model_folder)

    @app.post("/api/capture/start", status_code=201)
    async def capture_start(request: CaptureRequest):
        async with capture_lock:
            if hub.capture is not None:
                raise HTTPException(409, "Capture already running")
            try:
                hub.capture = await asyncio.to_thread(Capture, capture_root, request.context)
            except OSError:
                raise HTTPException(503, "Capture storage unavailable")
            return {
                "session_id": hub.capture.session_id,
                "status": "recording",
                "gps_stored": False,
            }

    @app.post("/api/capture/stop")
    async def capture_stop():
        async with capture_lock:
            if hub.capture is None:
                raise HTTPException(409, "No capture running")
            capture, hub.capture = hub.capture, None
            try:
                return await asyncio.to_thread(capture.finish)
            except OSError:
                raise HTTPException(503, "Capture metadata could not be saved")

    @app.get("/api/capture/status")
    async def capture_status():
        capture = hub.capture
        return {
            "status": "recording" if capture else "idle",
            "session_id": capture.session_id if capture else None,
            "sample_count": capture.count if capture else 0,
            "error": capture.error if capture else None,
            "dropped_frames": capture.dropped if capture else 0,
        }

    @app.get("/health")
    async def health():
        snapshot = hub.snapshot()
        return {
            "status": "ok",
            "deviceStatus": snapshot["status"],
            "lastSensorTimestamp": snapshot["lastSensorTimestamp"],
            "lastReceivedAt": hub.last_received_at,
            "acceptedFrames": hub.accepted_frames,
            "dashboardClients": len(hub.dashboards),
            "deviceSocketOpen": hub.device is not None,
        }

    @app.websocket("/ws/device")
    async def device_socket(socket: WebSocket):
        await socket.accept()
        if hub.device is not None:
            await socket.close(code=1008, reason="Another device is already streaming")
            return
        hub.device = socket
        session_device_id = None
        try:
            while True:
                event = await socket.receive()
                if event["type"] == "websocket.disconnect":
                    break
                raw = event.get("text")
                if raw is None or len(raw.encode("utf-8")) > 16384:
                    await socket.close(code=1009, reason="Expected JSON text frame under 16 KiB")
                    break
                try:
                    frame = SensorFrame.model_validate_json(raw)
                except ValidationError:
                    # Do not echo raw payloads (GPS) into errors or logs.
                    await socket.close(code=1008, reason="Invalid sensor frame")
                    break
                if session_device_id is not None and frame.deviceId != session_device_id:
                    await socket.close(code=1008, reason="deviceId changed within session")
                    break
                session_device_id = frame.deviceId
                hub.receive(frame)
        except WebSocketDisconnect:
            pass
        finally:
            if hub.device is socket:
                hub.device = None
            # Freshness expires on monotonic receive time, including Stop Streaming.
            hub.publish()

    @app.websocket("/ws/dashboard")
    async def dashboard_socket(socket: WebSocket):
        await socket.accept()
        queue = asyncio.Queue(maxsize=1)
        hub.dashboards.add(queue)
        queue.put_nowait(hub.snapshot())

        async def send_snapshots():
            while True:
                await asyncio.wait_for(socket.send_json(await queue.get()), timeout=2)

        async def detect_disconnect():
            while True:
                event = await socket.receive()
                if event["type"] == "websocket.disconnect":
                    return

        tasks = [asyncio.create_task(send_snapshots()), asyncio.create_task(detect_disconnect())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            hub.dashboards.discard(queue)
            for task in tasks:
                task.cancel()
            # ASGI cancellation must not interrupt child-task/socket cleanup.
            with anyio.CancelScope(shield=True):
                await asyncio.gather(*tasks, return_exceptions=True)
                with suppress(RuntimeError, WebSocketDisconnect, OSError):
                    await socket.close()

    return app


app = create_app()
