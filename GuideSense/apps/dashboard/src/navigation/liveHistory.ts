import type { SensorFrame } from '@guidesense/protocol';
import type { MotionGraphSample } from '../MotionGraph';

export type LiveHistory = {
  deviceId: string | null;
  start: number;
  samples: MotionGraphSample[];
};
export const EMPTY_LIVE_HISTORY: LiveHistory = {
  deviceId: null,
  start: 0,
  samples: [],
};

export function appendLiveFrame(
  previous: LiveHistory,
  frame: SensorFrame | null,
): LiveHistory {
  if (
    !frame ||
    (frame.sensorStatus.accelerometer !== 'ready' &&
      frame.sensorStatus.gyroscope !== 'ready')
  ) {
    return EMPTY_LIVE_HISTORY;
  }
  const timestamp = frame.timestamp / 1000;
  const last = previous.samples.at(-1);
  const reset =
    previous.deviceId !== frame.deviceId ||
    (last && (timestamp < last.timestamp || timestamp - last.timestamp > 1));
  if (!reset && timestamp === last?.timestamp) return previous;
  const history = reset ? [] : previous.samples;
  const sample: MotionGraphSample = {
    timestamp,
    accelerometer:
      frame.sensorStatus.accelerometer === 'ready' ? frame.accelerometer : null,
    gyroscope:
      frame.sensorStatus.gyroscope === 'ready' ? frame.gyroscope : null,
  };
  // A stopped sensor loses its old trace; missing readings are never zero-filled.
  const retained = history
    .filter((item) => item.timestamp >= timestamp - 15)
    .slice(-149)
    .map((item) => ({
      ...item,
      accelerometer: sample.accelerometer ? item.accelerometer : null,
      gyroscope: sample.gyroscope ? item.gyroscope : null,
    }));
  return {
    deviceId: frame.deviceId,
    start: reset || !history.length ? timestamp : previous.start,
    samples: [...retained, sample],
  };
}
