from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

Timestamp = Annotated[int, Field(strict=True, gt=0, le=9007199254740991)]
Number = Annotated[float, Field(strict=True, allow_inf_nan=False)]
SensorStatus = Literal["waiting", "ready", "denied", "unavailable", "error", "stale", "stopped"]


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MotionReading(WireModel):
    x: Number
    y: Number
    z: Number
    timestamp: Timestamp


class LocationReading(WireModel):
    latitude: Annotated[Number, Field(ge=-90, le=90)]
    longitude: Annotated[Number, Field(ge=-180, le=180)]
    accuracy: Optional[Annotated[Number, Field(ge=0)]]
    timestamp: Timestamp


class SensorStatuses(WireModel):
    accelerometer: SensorStatus
    gyroscope: SensorStatus
    location: SensorStatus


class SensorFrame(WireModel):
    type: Literal["sensor_frame"]
    deviceId: Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")]
    timestamp: Timestamp
    accelerometer: Optional[MotionReading]
    gyroscope: Optional[MotionReading]
    location: Optional[LocationReading]
    sensorStatus: SensorStatuses

    @model_validator(mode="after")
    def require_truthful_status(self):
        for key in ("accelerometer", "gyroscope", "location"):
            if (getattr(self, key) is not None) != (getattr(self.sensorStatus, key) == "ready"):
                raise ValueError("Only ready sensors may have a reading")
        return self


class Snapshot(WireModel):
    source: Literal["iphone_live"] = "iphone_live"
    type: Literal["snapshot"] = "snapshot"
    deviceId: Optional[str]
    status: Literal["connected", "disconnected"]
    lastSensorTimestamp: Optional[Timestamp]
    lastReceivedAt: Optional[Timestamp]
    timeoutMs: int
    frame: Optional[SensorFrame]
