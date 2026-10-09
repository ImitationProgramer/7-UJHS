export type VoiceLevels = { input: number; output: number };
type LevelRef = { current: VoiceLevels };
type Channel = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
};

/** Observe both streams without connecting microphone audio to the speakers. */
export function createAudioLevels(levels: LevelRef) {
  let context: AudioContext | undefined;
  let frame = 0;
  let closed = false;
  let previous = 0;
  const channels: Partial<Record<keyof VoiceLevels, Channel>> = {};
  levels.current = { input: 0, output: 0 };
  try {
    context = new AudioContext();
    void context.resume().catch(() => {});
  } catch {
    // Visualization is optional; unsupported audio analysis must not end a call.
  }
  const tick = (now: number) => {
    if (closed) return;
    const delta = previous ? Math.min(now - previous, 100) : 16;
    previous = now;
    for (const kind of ['input', 'output'] as const) {
      const channel = channels[kind];
      let target = 0;
      if (channel && context?.state === 'running') {
        channel.analyser.getFloatTimeDomainData(channel.samples);
        let sum = 0;
        for (const sample of channel.samples) sum += sample * sample;
        const rms = Math.sqrt(sum / channel.samples.length);
        target = Math.min(1, Math.max(0, (rms - 0.008) * 7));
      }
      const current = levels.current[kind];
      const amount = 1 - Math.exp(-delta / (target > current ? 45 : 180));
      levels.current[kind] = current + (target - current) * amount;
    }
    frame = requestAnimationFrame(tick);
  };
  if (context) frame = requestAnimationFrame(tick);
  return {
    bind(kind: keyof VoiceLevels, stream: MediaStream) {
      if (closed || !context) return;
      channels[kind]?.source.disconnect();
      channels[kind]?.analyser.disconnect();
      delete channels[kind];
      levels.current[kind] = 0;
      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        channels[kind] = {
          source,
          analyser,
          samples: new Float32Array(analyser.fftSize),
        };
        if (context.state === 'suspended')
          void context.resume().catch(() => {});
      } catch {
        // A missing/ended track is silence, not synthetic speech activity.
      }
    },
    close() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(frame);
      for (const channel of Object.values(channels)) {
        channel.source.disconnect();
        channel.analyser.disconnect();
      }
      levels.current = { input: 0, output: 0 };
      if (context && context.state !== 'closed')
        void context.close().catch(() => {});
    },
  };
}
