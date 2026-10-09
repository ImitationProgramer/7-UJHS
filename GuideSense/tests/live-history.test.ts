import { describe, expect, it } from 'vitest';
import { emptyFrame, type SensorFrame } from '@guidesense/protocol';
import {
  appendLiveFrame,
  EMPTY_LIVE_HISTORY,
} from '../apps/dashboard/src/navigation/liveHistory';

function reading(timestamp: number, deviceId = 'phone'): SensorFrame {
  return {
    ...emptyFrame(deviceId),
    timestamp,
    accelerometer: { x: 1, y: 2, z: 3, timestamp },
    gyroscope: { x: 0.1, y: 0.2, z: 0.3, timestamp },
    sensorStatus: {
      accelerometer: 'ready',
      gyroscope: 'ready',
      location: 'stopped',
    },
  };
}

describe('live phone graph history', () => {
  it('retains at most 150 actual samples in the most recent 15 seconds', () => {
    let history = EMPTY_LIVE_HISTORY;
    for (let i = 0; i < 220; i++)
      history = appendLiveFrame(history, reading(100000 + i * 100));
    expect(history.samples).toHaveLength(150);
    expect(history.samples.at(-1)?.accelerometer).toMatchObject({
      x: 1,
      y: 2,
      z: 3,
    });
    expect(
      history.samples.at(-1)!.timestamp - history.samples[0].timestamp,
    ).toBeCloseTo(14.9);
  });
  it('clears disconnected/stopped history and resets on device switch, clock reversal or stream gap', () => {
    const initial = appendLiveFrame(EMPTY_LIVE_HISTORY, reading(100000));
    expect(appendLiveFrame(initial, null)).toEqual(EMPTY_LIVE_HISTORY);
    expect(appendLiveFrame(initial, emptyFrame('phone', 'stopped'))).toEqual(
      EMPTY_LIVE_HISTORY,
    );
    for (const next of [
      reading(100100, 'other'),
      reading(99900),
      reading(102000),
    ]) {
      const history = appendLiveFrame(initial, next);
      expect(history.samples).toHaveLength(1);
      expect(history.start).toBe(next.timestamp / 1000);
    }
  });
  it('drops a stopped sensor trace without inventing zeros or interrupting the other sensor', () => {
    const initial = appendLiveFrame(EMPTY_LIVE_HISTORY, reading(100000));
    const stopped = reading(100100);
    stopped.accelerometer = null;
    stopped.sensorStatus.accelerometer = 'stopped';
    const gap = appendLiveFrame(initial, stopped);
    expect(gap.samples.every((item) => item.accelerometer === null)).toBe(true);
    expect(gap.samples.every((item) => item.gyroscope !== null)).toBe(true);
    const resumed = appendLiveFrame(gap, reading(100200));
    expect(resumed.samples.map((item) => item.accelerometer === null)).toEqual([
      true,
      true,
      false,
    ]);
  });
  it('does not duplicate the same frame', () => {
    const initial = appendLiveFrame(EMPTY_LIVE_HISTORY, reading(100000));
    expect(appendLiveFrame(initial, reading(100000))).toBe(initial);
  });
});
