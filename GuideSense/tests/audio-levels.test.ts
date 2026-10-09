import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioLevels } from '../apps/dashboard/src/navigation/audioLevels';

type SampleStream = MediaStream & { amplitude: number };
const stream = (amplitude = 0) => ({ amplitude }) as SampleStream;

class FakeAnalyser {
  fftSize = 256;
  smoothingTimeConstant = 0;
  stream?: SampleStream;
  disconnect = vi.fn();
  getFloatTimeDomainData(values: Float32Array) {
    values.fill(this.stream?.amplitude ?? 0);
  }
}
class FakeSource {
  disconnect = vi.fn();
  constructor(readonly stream: SampleStream) {}
  connect = vi.fn((analyser: FakeAnalyser) => {
    analyser.stream = this.stream;
  });
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = 'suspended';
  destination = { output: true };
  analysers: FakeAnalyser[] = [];
  sources: FakeSource[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  constructor() {
    FakeContext.instances.push(this);
  }
  createAnalyser() {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser;
  }
  createMediaStreamSource(stream: MediaStream) {
    const source = new FakeSource(stream as SampleStream);
    this.sources.push(source);
    return source;
  }
}
let frameId = 0;
let now = 0;
let frames = new Map<number, FrameRequestCallback>();
function advance(count = 30) {
  for (let index = 0; index < count; index++) {
    now += 16;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  }
}
beforeEach(() => {
  FakeContext.instances = [];
  frames = new Map();
  now = 0;
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

describe('voice particle audio levels', () => {
  it('measures microphone and remote samples independently, gates silence, then decays', () => {
    const levels = { current: { input: 0, output: 0 } };
    const meter = createAudioLevels(levels);
    const microphone = stream(0.15);
    const remote = stream(0);
    meter.bind('input', microphone);
    meter.bind('output', remote);
    advance();
    expect(levels.current.input).toBeGreaterThan(0.1);
    expect(levels.current.output).toBe(0);
    const inputPeak = levels.current.input;
    microphone.amplitude = 0;
    remote.amplitude = 0.25;
    advance();
    expect(levels.current.input).toBeLessThan(inputPeak * 0.1);
    expect(levels.current.output).toBeGreaterThan(0.1);
    remote.amplitude = 0.00001;
    advance(120);
    expect(levels.current.output).toBeLessThan(0.001);
    for (const value of Object.values(levels.current)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    const context = FakeContext.instances[0];
    expect(context.resume).toHaveBeenCalled();
    for (const source of context.sources) {
      expect(source.connect).toHaveBeenCalledTimes(1);
      expect(context.analysers).toContain(source.connect.mock.calls[0][0]);
      expect(source.connect).not.toHaveBeenCalledWith(context.destination);
    }
    meter.close();
  });

  it('replaces one stream and releases analysers, sources and animation on close', () => {
    const levels = { current: { input: 0, output: 0 } };
    const meter = createAudioLevels(levels);
    meter.bind('input', stream(0.2));
    meter.bind('output', stream(0.1));
    advance();
    const context = FakeContext.instances[0];
    const oldSource = context.sources[0];
    meter.bind('input', stream(0));
    expect(oldSource.disconnect).toHaveBeenCalled();
    advance(120);
    expect(levels.current.input).toBeLessThan(0.001);
    expect(levels.current.output).toBeGreaterThan(0);
    meter.close();
    expect(levels.current).toEqual({ input: 0, output: 0 });
    expect(frames.size).toBe(0);
    expect(context.close).toHaveBeenCalledTimes(1);
    context.sources.forEach((source) =>
      expect(source.disconnect).toHaveBeenCalled(),
    );
    context.analysers.forEach((analyser) =>
      expect(analyser.disconnect).toHaveBeenCalled(),
    );
    meter.close();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('keeps voice usable if the browser has no Web Audio', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('AudioContext', undefined);
    const levels = { current: { input: 0, output: 0 } };
    const meter = createAudioLevels(levels);
    expect(() => meter.bind('input', stream(0.2))).not.toThrow();
    advance();
    expect(levels.current).toEqual({ input: 0, output: 0 });
    expect(() => meter.close()).not.toThrow();
  });
});
