import {
  statusLabels,
  type MotionReading,
  type SensorStatus,
} from '@guidesense/protocol';
export function MotionPanel({
  title,
  unit,
  status,
  value,
  recorded = false,
}: {
  title: string;
  unit: string;
  status: SensorStatus;
  value: Pick<MotionReading, 'x' | 'y' | 'z'> | null;
  recorded?: boolean;
}) {
  return (
    <section className="panel sensor" aria-label={title}>
      <div className="panel-heading">
        <h2>{title}</h2>
        <span className="unit">{unit}</span>
      </div>
      <p className="sensor-status">
        {recorded
          ? value
            ? '기록된 센서값'
            : '현재 기록값 없음'
          : statusLabels[status]}
      </p>
      <dl className="axes">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis}>
            <dt>{axis.toUpperCase()}</dt>
            <dd data-testid={`${title.toLowerCase()}-${axis}`}>
              {value?.[axis] == null ? '—' : value[axis].toFixed(3)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
