import { memo } from 'react';
import type { ReplaySample } from './replayContract';

export const MotionGraph = memo(function MotionGraph({
  samples,
  start,
  windowStart,
}: {
  samples: ReplaySample[];
  start: number;
  windowStart: number;
}) {
  const left = Math.max(start, (samples.at(-1)?.timestamp ?? start) - 15);
  const right = Math.max(left + 3, samples.at(-1)?.timestamp ?? start + 3);
  const x = (t: number) => 36 + ((t - left) / (right - left)) * 584;
  return (
    <section className="panel graph" aria-label="Motion Graph">
      <h2>
        Motion Graph <span className="subtitle">실제 기록의 움직임</span>
      </h2>
      <p className="hint">
        최근 15초 · 음영: 현재 3초 수집 Window · 단위 UNKNOWN · 축별 자동 범위
      </p>
      {(['accelerometer', 'gyroscope'] as const).map((sensor) => {
        const values = samples.map((s) =>
          Math.hypot(s[sensor].x, s[sensor].y, s[sensor].z),
        );
        const max = Math.max(...values, 0.001);
        const points = samples
          .map((s, i) => `${x(s.timestamp)},${90 - (values[i] / max) * 64}`)
          .join(' ');
        const label =
          sensor === 'accelerometer'
            ? 'Acceleration magnitude'
            : 'Gyroscope magnitude';
        return (
          <div key={sensor}>
            <div className="graph-label">
              <span>{label}</span>
              <span>
                {values.length ? values[values.length - 1].toFixed(3) : '—'}
              </span>
            </div>
            <svg
              viewBox="0 0 640 120"
              role="img"
              aria-label={`${label}, 기록 상대초 ${left.toFixed(1)}–${right.toFixed(1)}`}
            >
              <rect
                x={Math.max(36, x(windowStart))}
                y="15"
                width={Math.max(
                  0,
                  Math.min(620, x(windowStart + 3)) -
                    Math.max(36, x(windowStart)),
                )}
                height="80"
                className="window-shade"
              />
              <path d="M36 15 V95 H620" className="graph-axis" />
              <text x="1" y="24">
                {max.toFixed(1)}
              </text>
              <text x="20" y="95">
                0
              </text>
              <polyline points={points} className={`trace ${sensor}`} />
              <text x="36" y="115">
                {(left - start).toFixed(1)}s
              </text>
              <text x="575" y="115">
                {(right - start).toFixed(1)}s
              </text>
            </svg>
          </div>
        );
      })}
    </section>
  );
});
