import { describe, expect, it } from 'vitest';
import { observeReplay } from '../apps/dashboard/src/navigation/companion';
import {
  CandidateSchema,
  cumulativeDistances,
} from '../apps/dashboard/src/navigation/contract';
import type {
  Prediction,
  ReplaySnapshot,
} from '../apps/dashboard/src/replayContract';
import { eligible } from './e2e/fixtures/navigation';

const candidate = CandidateSchema.parse(eligible);
const length = cumulativeDistances(candidate.geometry).at(-1)!;
function snapshot(
  prediction: Partial<Prediction> = {},
  overrides: Partial<ReplaySnapshot> = {},
): ReplaySnapshot {
  return {
    type: 'replay_snapshot',
    source: 'canine_dataset_replay',
    is_live: false,
    state: 'PLAYING',
    run_id: 1,
    command_id: 1,
    clip_id: 'fixture',
    clips: [],
    manifest: {
      dataset_source: 'https://example.com/test',
      dog_id: 1,
      test_num: 1,
      split: 'test',
      start: 100,
      end: 130,
      samples: 3000,
      timestamp_basis: 'fixture',
      model_version: 'fixture',
      license: 'test',
      license_url: 'https://example.com/license',
      attribution: 'Synthetic unit fixture',
      changes: '',
    },
    elapsed_seconds: 29,
    duration_seconds: 30,
    progress: 0.96,
    sample_count: 2900,
    analysis_count: 1,
    sample: null,
    samples: [],
    prediction: {
      window_id: 0,
      window_start: 100,
      window_end: 103,
      actual_activity: 'Walking',
      predicted_activity: 'Walking',
      window_quality: 'VALID',
      quality_reasons: [],
      label_reasons: [],
      model_version: 'fixture',
      model_type: 'RandomForest',
      feature_count: 112,
      inference_executed: true,
      offline_precomputed: false,
      matches_actual: true,
      matches_saved: null,
      ...prediction,
    },
    error: null,
    speed: 1,
    ...overrides,
  };
}

describe('replay association with a simulated journey', () => {
  it('uses inference window time and real polyline length, not delivery time or advertised route length', () => {
    const observation = observeReplay(candidate, snapshot(), null)!;
    expect(observation.elapsedSeconds).toBe(3);
    expect(observation.meters).toBeCloseTo(length * 0.1);
    expect(observation.meters).not.toBe(candidate.distanceM * 0.1);
    expect(observation.context).toMatch(/^가상 경로의 횡단 1에서 약 \d+m$/);
    expect(observation.changed).toBe(false);
  });

  it('deduplicates held and older windows, including paused snapshots', () => {
    const first = observeReplay(candidate, snapshot({ window_id: 2 }), null)!;
    expect(
      observeReplay(
        candidate,
        snapshot({ window_id: 2 }, { state: 'PAUSED' }),
        first,
      ),
    ).toBeNull();
    expect(
      observeReplay(candidate, snapshot({ window_id: 1 }), first),
    ).toBeNull();
    expect(
      observeReplay(
        candidate,
        snapshot({ window_id: 3 }, { state: 'PAUSED' }),
        first,
      )?.windowId,
    ).toBe(3);
  });

  it('accepts the completed final window and clamps projection to route endpoints', () => {
    const final = observeReplay(
      candidate,
      snapshot({ window_end: 140 }, { state: 'COMPLETED' }),
      null,
    )!;
    expect(final.coordinate).toEqual(candidate.geometry.at(-1));
    expect(final.elapsedSeconds).toBe(30);
    const early = observeReplay(candidate, snapshot({ window_end: 90 }), null)!;
    expect(early.coordinate).toEqual(candidate.geometry[0]);
    expect(early.elapsedSeconds).toBe(0);
  });

  it('records a classification transition without asserting danger or health, and preserves mismatch', () => {
    const first = observeReplay(candidate, snapshot(), null)!;
    const next = observeReplay(
      candidate,
      snapshot({
        window_id: 1,
        window_end: 106,
        predicted_activity: 'Sitting',
        matches_actual: false,
      }),
      first,
    )!;
    expect(next).toMatchObject({
      activity: 'Sitting',
      actualActivity: 'Walking',
      changed: true,
      previousActivity: 'Walking',
      matchesActual: false,
    });
    expect(next.context).not.toMatch(/위험|건강|정지|원인/);
  });

  it.each([
    { inference_executed: false },
    { window_quality: 'INVALID_WINDOW' as const },
    { predicted_activity: null },
  ])('invalid inference breaks transition continuity: %o', (invalid) => {
    const first = observeReplay(candidate, snapshot(), null)!;
    const gap = observeReplay(
      candidate,
      snapshot({ ...invalid, window_id: 1 }),
      first,
    )!;
    expect(gap).toMatchObject({
      valid: false,
      activity: null,
      changed: false,
      previousActivity: null,
      matchesActual: null,
    });
    expect(
      observeReplay(
        candidate,
        snapshot({ window_id: 2, predicted_activity: 'Sitting' }),
        gap,
      )?.changed,
    ).toBe(false);
  });

  it('does not infer a transition across missing windows or a different replay run', () => {
    const first = observeReplay(candidate, snapshot(), null)!;
    expect(
      observeReplay(
        candidate,
        snapshot({ window_id: 2, predicted_activity: 'Sitting' }),
        first,
      )?.changed,
    ).toBe(false);
    expect(
      observeReplay(
        candidate,
        snapshot(
          { window_id: 1, predicted_activity: 'Sitting' },
          { run_id: 2 },
        ),
        first,
      )?.changed,
    ).toBe(false);
  });

  it('has no matching score without an annotation and uses distance context without crossings', () => {
    const observation = observeReplay(
      { ...candidate, crossings: [] },
      snapshot({ actual_activity: null }),
      null,
    )!;
    expect(observation.matchesActual).toBeNull();
    expect(observation.context).toBe(
      `출발점에서 ${Math.round(length * 0.1)}m 지점`,
    );
  });

  it('ignores inactive snapshots and missing data', () => {
    for (const state of ['IDLE', 'STOPPED', 'ERROR'] as const)
      expect(
        observeReplay(candidate, snapshot({}, { state }), null),
      ).toBeNull();
    expect(
      observeReplay(candidate, snapshot({}, { manifest: null }), null),
    ).toBeNull();
    expect(
      observeReplay(candidate, snapshot({}, { prediction: null }), null),
    ).toBeNull();
  });
});
