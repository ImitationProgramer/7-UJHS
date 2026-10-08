import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SensorStream,
  type Sources,
  type StreamView,
} from '../apps/mobile/src/stream';

function setup() {
  const remove = vi.fn();
  const callbacks: Array<(value: { x: number; y: number; z: number }) => void> =
    [];
  const sensor = () => ({
    isAvailableAsync: vi.fn(async () => true),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    setUpdateInterval: vi.fn(),
    addListener: vi.fn((callback) => {
      callbacks.push(callback);
      return { remove };
    }),
  });
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onerror: null,
  } as unknown as WebSocket;
  const sources: Sources = {
    accelerometer: sensor(),
    gyroscope: sensor(),
    location: {
      requestPermission: vi.fn(async () => false),
      servicesEnabled: vi.fn(async () => true),
      watch: vi.fn(),
    },
    socket: vi.fn(() => socket),
  };
  const views: StreamView[] = [];
  const stream = new SensorStream('test-device', sources, (view) =>
    views.push(view),
  );
  return { sources, socket, stream, views, callbacks, remove };
}
afterEach(() => vi.useRealTimers());

describe('mobile lifecycle', () => {
  it('streams genuine callback values despite denied GPS and removes subscriptions on stop', async () => {
    vi.useFakeTimers();
    const { stream, socket, callbacks, remove, views } = setup();
    await stream.start('http://localhost:8000');
    socket.onopen?.({} as Event);
    callbacks[0]({ x: 0.2, y: 0.3, z: 0.4 });
    callbacks[1]({ x: 1, y: 2, z: 3 });
    vi.advanceTimersByTime(20);
    callbacks[0]({ x: 0.2, y: 0.3, z: 0.4 });
    const frame = JSON.parse(
      vi.mocked(socket.send).mock.calls.at(-1)![0] as string,
    );
    expect(frame.accelerometer.x).toBe(0.2);
    expect(frame.gyroscope.z).toBe(3);
    expect(frame.location).toBeNull();
    expect(frame.sensorStatus.location).toBe('denied');
    stream.stop();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(socket.close).toHaveBeenCalled();
    const count = vi.mocked(socket.send).mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(socket.send).toHaveBeenCalledTimes(count);
    expect(views.at(-1)?.frame.accelerometer).toBeNull();
  });
  it('cancels a start still waiting on a permission request', async () => {
    const { stream, sources } = setup();
    let resolve!: (value: { granted: boolean }) => void;
    sources.accelerometer.requestPermissionsAsync = () =>
      new Promise((done) => {
        resolve = done;
      });
    const start = stream.start('http://localhost:8000');
    await Promise.resolve();
    stream.stop();
    resolve({ granted: true });
    await start;
    expect(sources.socket).not.toHaveBeenCalled();
    expect(sources.accelerometer.addListener).not.toHaveBeenCalled();
  });
  it('removes a late location watcher when Stop wins the race', async () => {
    const { stream, sources } = setup();
    let resolve!: (value: { remove: () => void }) => void;
    const remove = vi.fn();
    sources.location.requestPermission = async () => true;
    sources.location.watch = () =>
      new Promise((done) => {
        resolve = done;
      });
    await stream.start('http://localhost:8000');
    stream.stop();
    resolve({ remove });
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('marks unavailable sensors explicitly and cleans up a failed connection', async () => {
    vi.useFakeTimers();
    const { stream, sources, views, remove } = setup();
    sources.accelerometer.isAvailableAsync = async () => false;
    await stream.start('http://localhost:8000');
    expect(views.at(-1)?.frame.sensorStatus.accelerometer).toBe('unavailable');
    vi.advanceTimersByTime(8000);
    expect(views.at(-1)?.connection).toBe('disconnected');
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('stops rather than retaining an unbounded socket send queue', async () => {
    vi.useFakeTimers();
    const { stream, socket, views } = setup();
    await stream.start('http://localhost:8000');
    socket.onopen?.({} as Event);
    Object.defineProperty(socket, 'bufferedAmount', { value: 70000 });
    vi.advanceTimersByTime(100);
    expect(views.at(-1)?.connection).toBe('disconnected');
    expect(socket.send).not.toHaveBeenCalled();
  });
  it('sends every native 50Hz sample and falls back to truthful stale status when callbacks stop', async () => {
    vi.useFakeTimers();
    const { stream, socket, callbacks } = setup();
    await stream.start('http://localhost:8000');
    callbacks[1]({ x: 1, y: 2, z: 3 });
    socket.onopen?.({} as Event);
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(20);
      callbacks[0]({ x: i, y: 0, z: 0 });
    }
    expect(socket.send).toHaveBeenCalledTimes(50);
    vi.advanceTimersByTime(1200);
    const frame = JSON.parse(
      vi.mocked(socket.send).mock.calls.at(-1)![0] as string,
    );
    expect(frame.accelerometer).toBeNull();
    expect(frame.sensorStatus.accelerometer).toBe('stale');
    stream.stop();
  });
  it('uses native gyro callbacks when the accelerometer is unavailable', async () => {
    vi.useFakeTimers();
    const { stream, socket, sources, callbacks } = setup();
    sources.accelerometer.isAvailableAsync = async () => false;
    await stream.start('http://localhost:8000');
    socket.onopen?.({} as Event);
    callbacks[0]({ x: 1, y: 2, z: 3 });
    const frame = JSON.parse(vi.mocked(socket.send).mock.calls[0][0] as string);
    expect(frame.accelerometer).toBeNull();
    expect(frame.sensorStatus.accelerometer).toBe('unavailable');
    expect(frame.gyroscope.z).toBe(3);
    stream.stop();
  });
  it('waits for a new gyro sample when callback order changes, without repeating the previous pair', async () => {
    vi.useFakeTimers();
    const { stream, socket, callbacks } = setup();
    await stream.start('http://localhost:8000');
    socket.onopen?.({} as Event);
    callbacks[1]({ x: 2, y: 0, z: 0 });
    callbacks[0]({ x: 1, y: 0, z: 0 });
    vi.advanceTimersByTime(20);
    callbacks[0]({ x: 3, y: 0, z: 0 });
    const before = vi.mocked(socket.send).mock.calls.length;
    vi.advanceTimersByTime(1);
    callbacks[1]({ x: 4, y: 0, z: 0 });
    expect(socket.send).toHaveBeenCalledTimes(before + 1);
    const last = JSON.parse(
      vi.mocked(socket.send).mock.calls.at(-1)![0] as string,
    );
    expect(last.accelerometer.x).toBe(3);
    expect(last.gyroscope.x).toBe(4);
    vi.advanceTimersByTime(19);
    callbacks[0]({ x: 5, y: 0, z: 0 });
    expect(socket.send).toHaveBeenCalledTimes(before + 1);
    stream.stop();
  });
});
