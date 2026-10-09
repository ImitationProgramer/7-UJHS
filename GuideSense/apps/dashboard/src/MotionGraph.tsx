import { memo } from 'react';
export type MotionGraphSample = {
  timestamp: number;
  accelerometer: { x: number; y: number; z: number } | null;
  gyroscope: { x: number; y: number; z: number } | null;
};

export const MotionGraph = memo(function MotionGraph({
  samples,
  start,
  windowStart,
  compact = false,
  live = false,
}: {
  samples: MotionGraphSample[];
  start: number;
  windowStart: number;
  compact?: boolean;
  live?: boolean;
}) {
  const left = Math.max(start, (samples.at(-1)?.timestamp ?? start) - 15);
  const right = Math.max(left + 3, samples.at(-1)?.timestamp ?? start + 3);
  const width = compact ? 360 : 640;
  const plotEnd = width - 20;
  const x = (t: number) => 36 + ((t - left) / (right - left)) * (plotEnd - 36);
  return (
    <section className="panel graph" aria-label="Motion Graph">
      <h2>
        {compact ? '움직임 데이터' : 'Motion Graph'}{' '}
        <span className="subtitle">
          {live ? '휴대폰 실시간 센서' : '실제 기록의 움직임'}
        </span>
      </h2>
      <p className="hint">
        {live
          ? '실시간 수신 · 최근 15초 · 화면 10 Hz · 자동 눈금'
          : compact
            ? '공개 기록 재생 · 최근 15초 · 음영: 3초 분석 구간 · 단위 미확인 · 자동 눈금'
            : '최근 15초 · 음영: 현재 3초 수집 Window · 단위 UNKNOWN · 축별 자동 범위'}
      </p>
      {(['accelerometer', 'gyroscope'] as const).map((sensor) => {
        const values = samples.map((s) => {
          const value = s[sensor];
          return value ? Math.hypot(value.x, value.y, value.z) : null;
        });
        const max = Math.max(
          ...values.filter((v): v is number => v !== null),
          0.001,
        );
        const segments: string[][] = [];
        samples.forEach((sample, i) => {
          const value = values[i];
          if (value === null) return;
          if (
            i === 0 ||
            values[i - 1] === null ||
            sample.timestamp - samples[i - 1].timestamp > 1
          ) {
            segments.push([]);
          }
          segments
            .at(-1)!
            .push(`${x(sample.timestamp)},${90 - (value / max) * 64}`);
        });
        const unit = live ? (sensor === 'accelerometer' ? 'g' : 'rad/s') : '';
        const label =
          sensor === 'accelerometer'
            ? 'Acceleration magnitude'
            : 'Gyroscope magnitude';
        return (
          <div key={sensor}>
            <div className="graph-label">
              <span>
                {compact
                  ? sensor === 'accelerometer'
                    ? '가속도 크기'
                    : '각속도 크기'
                  : label}
              </span>
              <span>
                {values.at(-1)?.toFixed(3) ?? '—'}
                {unit && ` ${unit}`}
              </span>
            </div>
            <svg
              viewBox={`0 0 ${width} 120`}
              role="img"
              aria-label={`${label}, 기록 상대초 ${(left - start).toFixed(1)}–${(right - start).toFixed(1)}`}
            >
              {!live && (
                <rect
                  x={Math.max(36, x(windowStart))}
                  y="15"
                  width={Math.max(
                    0,
                    Math.min(plotEnd, x(windowStart + 3)) -
                      Math.max(36, x(windowStart)),
                  )}
                  height="80"
                  className="window-shade"
                />
              )}
              <path d={`M36 15 V95 H${plotEnd}`} className="graph-axis" />
              <text x="1" y="24">
                {max.toFixed(1)}
              </text>
              <text x="20" y="95">
                0
              </text>
              {(segments.length ? segments : [[]]).map((points, index) => (
                <polyline
                  key={index}
                  points={points.join(' ')}
                  className={`trace ${sensor}`}
                />
              ))}
              <text x="36" y="115">
                {(left - start).toFixed(1)}s
              </text>
              <text x={plotEnd} y="115" textAnchor="end">
                {(right - start).toFixed(1)}s
              </text>
            </svg>
          </div>
        );
      })}
    </section>
  );
});
