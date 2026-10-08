"""Explicit, bounded IMU-only capture; disk I/O never blocks the relay loop."""

import json
import queue
import threading
import time
import uuid
from pathlib import Path


class Capture:
    def __init__(self, root: Path, context: str):
        self.session_id = str(uuid.uuid4())
        self.path = root / self.session_id
        self.path.mkdir(parents=True, mode=0o700)
        self.start_timestamp = time.time_ns() // 1_000_000
        self.context = context
        self.queue = queue.Queue(maxsize=4096)
        self.error = None
        self.dropped = 0
        self.count = 0
        self.sensors = {
            k: {"count": 0, "first": None, "last": None, "non_increasing": 0}
            for k in ("accelerometer", "gyroscope")
        }
        self._write_metadata("recording")
        self.thread = threading.Thread(target=self._write, daemon=True)
        self.thread.start()

    def append(self, frame):
        # Strict allowlist: no location, device ID, or location status can enter the queue.
        sample = {"timestamp": frame.timestamp}
        for key in self.sensors:
            reading = getattr(frame, key)
            sample[key] = reading.model_dump() if reading else None
        try:
            self.queue.put_nowait(sample)
        except queue.Full:
            self.dropped += 1

    def _write(self):
        try:
            with (self.path / "imu.jsonl").open("x") as out:
                while True:
                    sample = self.queue.get()
                    if sample is None:
                        break
                    out.write(json.dumps(sample, allow_nan=False, separators=(",", ":")) + "\n")
                    self.count += 1
                    for key, stats in self.sensors.items():
                        reading = sample[key]
                        if reading is None:
                            continue
                        timestamp = reading["timestamp"]
                        if stats["last"] is not None and timestamp <= stats["last"]:
                            stats["non_increasing"] += 1
                            continue
                        stats["count"] += 1
                        if stats["first"] is None:
                            stats["first"] = timestamp
                        stats["last"] = timestamp
        except OSError:
            self.error = "CAPTURE_IO_ERROR"

    def _write_metadata(self, status, end=None):
        rates = {}
        for key, s in self.sensors.items():
            span = (s["last"] - s["first"]) / 1000 if s["count"] > 1 else 0
            rates[key] = {
                **s,
                "observed_sampling_rate": (s["count"] - 1) / span if span > 0 else None,
            }
        metadata = {
            "schema_version": 1,
            "session_id": self.session_id,
            "source": "iphone_imu",
            "context": self.context,
            "start_timestamp": self.start_timestamp,
            "end_timestamp": end,
            "timestamp_unit": "unix_ms_js_callback",
            "sample_count": self.count,
            "sensors": rates,
            "units": {"acceleration": "g", "gyroscope": "rad/s"},
            "status": status,
            "dropped_frames": self.dropped,
            "error": self.error,
            "gps_stored": False,
        }
        temp = self.path / "session.json.tmp"
        temp.write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n")
        temp.replace(self.path / "session.json")
        return metadata

    def finish(self, interrupted=False):
        end = time.time_ns() // 1_000_000
        # A failed writer must not deadlock Stop on a full queue.
        while self.thread.is_alive():
            try:
                self.queue.put(None, timeout=0.1)
                break
            except queue.Full:
                continue
        self.thread.join()
        status = (
            "invalid"
            if self.error or self.dropped
            else "interrupted"
            if interrupted
            else "complete"
        )
        return self._write_metadata(status, end)
