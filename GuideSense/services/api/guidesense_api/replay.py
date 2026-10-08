"""Socket-owned recorded replay; no mutation of the live SensorHub."""

import asyncio
import json
import math
import time
from contextlib import suppress
from pathlib import Path
from typing import Literal, Optional

import anyio
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CLIPS = {
    "dog22-demo": ROOT / "artifacts/goal3/replay-demo",
    "dog45-transition": ROOT / "artifacts/goal4/replay-transition",
    "dog44-posture": ROOT / "artifacts/goal4/replay-posture",
}


class ReplayCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["play", "pause", "resume", "stop", "restart", "status"]
    clip_id: Optional[str] = None
    command_id: int = Field(default=0, ge=0, le=9007199254740991)


class RecordedClip:
    def __init__(self, folder, model_folder):
        # Optional ML dependencies must never prevent the original live API starting.
        import numpy as np
        from guidesense_gait.activity_data import CSV_SHA256, PREPROCESSING_VERSION, GUARD
        from guidesense_gait.activity_model import ActivityModel
        from guidesense_gait.activity_replay import validate_replay
        from guidesense_gait.pipeline import IMUSeries

        self.manifest = m = validate_replay(folder)
        self.model = ActivityModel(model_folder)
        if (
            m["source_sha256"] != CSV_SHA256
            or m["model_sha256"] != self.model.metadata["model_sha256"]
            or m["model_version"] != self.model.metadata["model_version"]
            or m["preprocessing_version"] != PREPROCESSING_VERSION
            or m["sampling_rate"] != 50
            or not 0 < m["end"] - m["start"] <= 300
            or m["timestamp_basis"] != "seconds_since_test_start; not Unix/live time"
        ):
            raise ValueError("Replay/model metadata mismatch")
        expected_split = next(
            (k for k, ids in self.model.metadata["split"].items() if m["dog_id"] in ids),
            "external",
        )
        if m["split"] != expected_split:
            raise ValueError("Replay/model DogID split mismatch")
        self.samples = [
            json.loads(s) for s in (Path(folder) / "samples.jsonl").read_text().splitlines()
        ]
        self.windows = [
            json.loads(s) for s in (Path(folder) / "windows.jsonl").read_text().splitlines()
        ]
        for i, s in enumerate(self.samples):
            if not math.isclose(s["elapsed_seconds"], i / 50, abs_tol=1e-8):
                raise ValueError("Replay elapsed timestamp mismatch")
            for sensor in ("accelerometer", "gyroscope"):
                if set(s[sensor]) != set("xyz") or any(
                    type(v) not in (int, float) or not math.isfinite(v) for v in s[sensor].values()
                ):
                    raise ValueError("Invalid replay sensor schema")
            if s["window_quality"] != self.windows[i // 150]["window_quality"]:
                raise ValueError("Replay window quality mismatch")
        for w in self.windows:
            if w["window_quality"] not in ("VALID", "INVALID_WINDOW") or not math.isclose(
                w["prediction_available_at"], w["window_end"] + GUARD, abs_tol=1e-8
            ):
                raise ValueError("Invalid window quality/timing")
        # These values ALREADY passed Goal 2 FIR at export. Do not filter twice.
        # Annotation and saved predictions never enter the IMUSeries or feature vector.
        self.series = IMUSeries(
            [s["timestamp"] for s in self.samples],
            np.array(
                [
                    [s[k][a] for k in ("accelerometer", "gyroscope") for a in "xyz"]
                    for s in self.samples
                ]
            ),
            {
                "source": "mendeley_vxhx934tbn_v4",
                "units": m["units"],
                "unit_space": m["unit_space"],
                "dataset_version": m["dataset_version"],
                "position": "back",
                "preprocessing_version": m["preprocessing_version"],
                "preprocessing": {"target_rate": 50},
                "dog_id": m["dog_id"],
                "test_num": m["test_num"],
            },
        )
        self.duration = m["end"] - m["start"]
        self.finish_at = self.windows[-1]["prediction_available_at"] - m["start"]

    def infer(self, index):
        from guidesense_gait.pipeline import make_window

        record = self.windows[index]
        window = make_window(self.series, record["window_start"])
        valid = record["window_quality"] == window.quality["status"] == "VALID"
        predicted = self.model.predict_window(window)["predicted_activity"] if valid else None
        actual = record["actual_activity"]
        return {
            "window_id": index,
            "window_start": record["window_start"],
            "window_end": record["window_end"],
            "actual_activity": actual,
            "predicted_activity": predicted,
            "window_quality": "VALID" if valid else "INVALID_WINDOW",
            "quality_reasons": window.quality["reasons"] or record["quality_details"]["reasons"],
            "model_version": self.model.metadata["model_version"],
            "model_type": self.model.metadata["model_type"],
            "feature_count": 112,
            "inference_executed": valid,
            "offline_precomputed": False,
            "matches_actual": predicted == actual if actual and predicted else None,
            "matches_saved": predicted == record["predicted_activity"] if valid else None,
            "label_reasons": record["label_quality"]["reasons"],
        }


class ReplaySession:
    def __init__(self, clips=None, model_folder=None, clock=time.monotonic, loader=RecordedClip):
        self.clips = DEFAULT_CLIPS if clips is None else clips
        self.model_folder = model_folder or ROOT / "artifacts/goal3/model"
        self.clock, self.loader = clock, loader
        self.clip = None
        self.clip_id = None
        self.state = "IDLE"
        self.elapsed = 0.0
        self.anchor = 0.0
        self.cursor = 0
        self.window_cursor = 0
        self.prediction = None
        self.error = None
        self.run_id = 0
        self.command_id = 0
        self.latest = None
        self.batch = []

    def fail(self, message):
        self.state, self.error = "ERROR", message
        self.prediction, self.latest, self.batch = None, None, []
        self.clip = None
        self.elapsed = 0.0
        self.cursor = self.window_cursor = 0
        self.run_id += 1

    async def command(self, command):
        self.command_id = command.command_id
        action = command.action
        if action in ("play", "restart"):
            clip_id = command.clip_id or self.clip_id
            if clip_id not in self.clips:
                raise ValueError("등록되지 않은 replay입니다. 목록에서 clip을 선택하세요.")
            self.clip_id = clip_id
            self.clip = await asyncio.to_thread(self.loader, self.clips[clip_id], self.model_folder)
            self.state, self.error = "PLAYING", None
            self.elapsed = 0.0
            self.anchor = self.clock()
            self.cursor = self.window_cursor = 0
            self.prediction, self.latest, self.batch = None, None, []
            self.run_id += 1
        elif action == "pause" and self.state == "PLAYING":
            self.elapsed = min(self.clock() - self.anchor, self.clip.finish_at)
            self.state = "PAUSED"
        elif action == "resume" and self.state == "PAUSED":
            self.anchor = self.clock() - self.elapsed
            self.state = "PLAYING"
        elif action == "stop":
            self.state, self.error = "STOPPED", None
            self.elapsed = 0.0
            self.cursor = self.window_cursor = 0
            self.prediction, self.latest, self.batch = None, None, []
            self.run_id += 1
        elif action != "status":
            raise ValueError("현재 상태에서 사용할 수 없는 재생 명령입니다.")

    async def advance(self):
        self.batch = []
        if self.state != "PLAYING":
            return
        self.elapsed = min(self.clock() - self.anchor, self.clip.finish_at)
        while self.cursor < len(self.clip.samples):
            s = self.clip.samples[self.cursor]
            if s["elapsed_seconds"] > self.elapsed + 1e-8:
                break
            # Never send precomputed predictions to the UI, including future windows.
            sample = {
                k: s[k]
                for k in (
                    "timestamp",
                    "elapsed_seconds",
                    "accelerometer",
                    "gyroscope",
                    "label",
                    "behavior_annotations",
                    "window_id",
                    "window_quality",
                )
            }
            self.batch.append(sample)
            self.latest = sample
            self.cursor += 1
        while self.window_cursor < len(self.clip.windows):
            record = self.clip.windows[self.window_cursor]
            if (
                record["prediction_available_at"] - self.clip.manifest["start"]
                > self.elapsed + 1e-8
            ):
                break
            self.prediction = await asyncio.to_thread(self.clip.infer, self.window_cursor)
            self.window_cursor += 1
        if self.elapsed >= self.clip.finish_at:
            self.state = "COMPLETED"
            self.latest = None

    def snapshot(self):
        duration = self.clip.duration if self.clip else 0
        return {
            "type": "replay_snapshot",
            "source": "canine_dataset_replay",
            "is_live": False,
            "state": self.state,
            "run_id": self.run_id,
            "command_id": self.command_id,
            "clip_id": self.clip_id,
            "clips": [{"id": k, "available": p.is_dir()} for k, p in self.clips.items()],
            "manifest": self.clip.manifest if self.clip else None,
            "elapsed_seconds": min(self.elapsed, duration),
            "duration_seconds": duration,
            "progress": min(self.elapsed / duration, 1) if duration else 0,
            "sample_count": self.cursor,
            "analysis_count": self.window_cursor,
            "sample": self.latest,
            "samples": self.batch,
            "prediction": self.prediction,
            "error": self.error,
            "speed": 1,
        }


def error_message(exc):
    if isinstance(exc, FileNotFoundError):
        return "Replay 또는 모델 파일이 없습니다. 데모 bundle을 복원하거나 artifact를 준비하세요."
    if isinstance(exc, ImportError):
        return "ML 의존성이 없습니다. ml/gait[model]을 설치한 뒤 다시 재생하세요."
    if isinstance(exc, ValueError):
        return "Replay 검증/명령 오류: " + str(exc)[:200]
    return "Replay 형식 또는 추론 오류입니다. 모델 metadata와 sensor schema를 확인하세요."


def install_replay(app, clips=None, model_folder=None):
    registry = DEFAULT_CLIPS if clips is None else clips
    active = set()

    @app.get("/api/replays")
    async def replay_list():
        return {
            "source": "canine_dataset_replay",
            "clips": [{"id": k, "available": p.is_dir()} for k, p in registry.items()],
        }

    @app.websocket("/ws/replay")
    async def replay_socket(socket: WebSocket):
        await socket.accept()
        if len(active) >= 8:
            await socket.close(code=1013, reason="Replay session capacity reached")
            return
        active.add(socket)
        session = ReplaySession(registry, model_folder)
        lock = asyncio.Lock()

        async def send():
            while True:
                async with lock:
                    try:
                        await session.advance()
                    except Exception as exc:
                        session.fail(error_message(exc))
                    payload = session.snapshot()
                await asyncio.wait_for(socket.send_json(payload), timeout=2)
                await asyncio.sleep(0.1)

        async def receive():
            while True:
                raw = await socket.receive_text()
                async with lock:
                    try:
                        if len(raw.encode()) > 1024:
                            raise ValueError("Replay command too large")
                        await session.command(ReplayCommand.model_validate_json(raw))
                    except Exception as exc:
                        session.fail(error_message(exc))

        tasks = [asyncio.create_task(send()), asyncio.create_task(receive())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            active.discard(socket)
            for task in tasks:
                task.cancel()
            with anyio.CancelScope(shield=True):
                await asyncio.gather(*tasks, return_exceptions=True)
                with suppress(RuntimeError, WebSocketDisconnect, OSError):
                    await socket.close()
