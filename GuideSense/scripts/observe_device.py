"""Observe the real relay without sending synthetic device data or persisting GPS coordinates."""

import asyncio
import json
import time
from pathlib import Path

from websockets.asyncio.client import connect


async def main():
    report = {
        "source": "Live /ws/dashboard on port 8000; observer sends no sensor frames",
        "uniqueFrames": 0,
        "motionChanges": {"accelerometer": 0, "gyroscope": 0},
        "gpsFrames": 0,
        "gpsAccuracyPresent": False,
        "states": [],
        "firstReceivedAt": None,
        "lastReceivedAt": None,
    }
    previous = {}
    last_timestamp = None
    last_log = 0
    output = Path("artifacts/device-observation.json")
    output.parent.mkdir(exist_ok=True)
    async with connect("ws://127.0.0.1:8000/ws/dashboard") as socket:
        async for message in socket:
            snapshot = json.loads(message)
            state = snapshot["status"]
            if not report["states"] or report["states"][-1]["status"] != state:
                report["states"].append(
                    {"status": state, "observedAt": round(time.time() * 1000)}
                )
                print("State:", state, flush=True)
            frame = snapshot["frame"]
            if frame and frame["timestamp"] != last_timestamp:
                last_timestamp = frame["timestamp"]
                report["uniqueFrames"] += 1
                report["firstReceivedAt"] = (
                    report["firstReceivedAt"] or snapshot["lastReceivedAt"]
                )
                report["lastReceivedAt"] = snapshot["lastReceivedAt"]
                for key in ["accelerometer", "gyroscope"]:
                    reading = frame[key]
                    if reading:
                        vector = [reading[axis] for axis in "xyz"]
                        if key in previous and previous[key] != vector:
                            report["motionChanges"][key] += 1
                        previous[key] = vector
                if frame["location"]:
                    report["gpsFrames"] += 1
                    report["gpsAccuracyPresent"] |= (
                        frame["location"]["accuracy"] is not None
                    )
            output.write_text(json.dumps(report, indent=2) + "\n")
            if time.monotonic() - last_log > 10:
                print(json.dumps(report), flush=True)
                last_log = time.monotonic()


if __name__ == "__main__":
    asyncio.run(main())
