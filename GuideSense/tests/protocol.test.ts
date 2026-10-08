import { describe, expect, it } from 'vitest';
import {
  emptyFrame,
  freshFrame,
  SensorFrameSchema,
  deviceWebSocketUrl,
} from '@guidesense/protocol';

describe('truthful sensor protocol', () => {
  it('preserves unknown data as null and actual zero as zero', () => {
    const frame = emptyFrame('test-device');
    expect(SensorFrameSchema.parse(frame).accelerometer).toBeNull();
    frame.accelerometer = { x: 0, y: 0, z: 0, timestamp: Date.now() };
    frame.sensorStatus.accelerometer = 'ready';
    expect(SensorFrameSchema.parse(frame).accelerometer?.x).toBe(0);
  });
  it('rejects fake ready, unexpected fields, non-finite numbers and invalid GPS', () => {
    const frame = emptyFrame('test-device');
    expect(
      SensorFrameSchema.safeParse({
        ...frame,
        sensorStatus: { ...frame.sensorStatus, location: 'ready' },
      }).success,
    ).toBe(false);
    expect(SensorFrameSchema.safeParse({ ...frame, extra: true }).success).toBe(
      false,
    );
    expect(
      SensorFrameSchema.safeParse({
        ...frame,
        accelerometer: { x: NaN, y: 0, z: 0, timestamp: 1 },
      }).success,
    ).toBe(false);
    expect(
      SensorFrameSchema.safeParse({
        ...frame,
        location: { latitude: 91, longitude: 0, accuracy: 1, timestamp: 1 },
      }).success,
    ).toBe(false);
  });
  it('expires stale readings without modifying the underlying latest samples', () => {
    const frame = emptyFrame('test-device');
    frame.accelerometer = { x: 1, y: 2, z: 3, timestamp: 1000 };
    frame.location = {
      latitude: 37,
      longitude: 127,
      accuracy: null,
      timestamp: 1000,
    };
    frame.sensorStatus.accelerometer = frame.sensorStatus.location = 'ready';
    const projected = freshFrame(frame, 2500);
    expect(projected.accelerometer).toBeNull();
    expect(projected.sensorStatus.accelerometer).toBe('stale');
    expect(projected.location?.accuracy).toBeNull();
    expect(freshFrame(frame, 17000).location).toBeNull();
    expect(frame.accelerometer).not.toBeNull();
  });
  it('normalizes only supported backend addresses', () => {
    expect(deviceWebSocketUrl(' http://192.168.1.2:8000/ ', 'device')).toBe(
      'ws://192.168.1.2:8000/ws/device',
    );
    expect(deviceWebSocketUrl('https://host.example', 'dashboard')).toBe(
      'wss://host.example/ws/dashboard',
    );
    for (const url of [
      'ftp://host',
      'http://host/path',
      'http://u:p@host',
      'http://host?token=x',
    ]) {
      expect(() => deviceWebSocketUrl(url, 'device')).toThrow();
    }
  });
});
