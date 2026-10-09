import type { ReplaySnapshot } from '../replayContract';
import {
  cumulativeDistances,
  eventDistance,
  interpolate,
  type Candidate,
  type Coordinate,
} from './contract';

export const behaviorLabels: Record<string, string> = {
  Walking: '걷기',
  Trotting: '속보',
  Standing: '서 있기',
  Sitting: '앉기',
  'Lying chest': '가슴을 바닥에 대고 눕기',
  Sniffing: '냄새 맡기',
  Playing: '놀기',
};

export type JourneyObservation = {
  id: string;
  windowId: number;
  elapsedSeconds: number;
  meters: number;
  coordinate: Coordinate;
  activity: string | null;
  actualActivity: string | null;
  valid: boolean;
  changed: boolean;
  previousActivity: string | null;
  context: string;
  matchesActual: boolean | null;
};

/** Associates replay time with a virtual route position, never measured GPS. */
export function observeReplay(
  candidate: Candidate,
  snapshot: ReplaySnapshot,
  previous: JourneyObservation | null,
): JourneyObservation | null {
  const { manifest, prediction } = snapshot;
  if (
    !manifest ||
    !prediction ||
    ['IDLE', 'STOPPED', 'ERROR'].includes(snapshot.state) ||
    (previous && prediction.window_id <= previous.windowId)
  )
    return null;

  const duration = manifest.end - manifest.start;
  if (duration <= 0) return null;
  const elapsedSeconds = Math.max(
    0,
    Math.min(duration, prediction.window_end - manifest.start),
  );
  const lengths = cumulativeDistances(candidate.geometry);
  const meters = (elapsedSeconds / duration) * lengths[lengths.length - 1];
  const valid = Boolean(
    prediction.inference_executed &&
    prediction.window_quality === 'VALID' &&
    prediction.predicted_activity,
  );
  const activity = valid ? prediction.predicted_activity : null;
  const prefix = `${candidate.id}:${snapshot.run_id}:`;
  const contiguous = Boolean(
    valid &&
    previous?.valid &&
    previous.id.startsWith(prefix) &&
    prediction.window_id === previous.windowId + 1,
  );
  const previousActivity = contiguous ? previous!.activity : null;
  const crossings = candidate.crossings.map((crossing, index) => ({
    index,
    distance: Math.abs(
      eventDistance(candidate.geometry, lengths, crossing.coordinate) - meters,
    ),
  }));
  const nearest = crossings.sort((a, b) => a.distance - b.distance)[0];

  return {
    id: `${prefix}${prediction.window_id}`,
    windowId: prediction.window_id,
    elapsedSeconds,
    meters,
    coordinate: interpolate(candidate.geometry, lengths, meters),
    activity,
    actualActivity: prediction.actual_activity,
    valid,
    changed: contiguous && activity !== previousActivity,
    previousActivity,
    context: nearest
      ? `가상 경로의 횡단 ${nearest.index + 1}에서 약 ${Math.round(nearest.distance)}m`
      : `출발점에서 ${Math.round(meters)}m 지점`,
    matchesActual:
      valid && prediction.actual_activity !== null
        ? activity === prediction.actual_activity
        : null,
  };
}
