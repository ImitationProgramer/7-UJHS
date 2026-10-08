import { describe, expect, it } from 'vitest';
import {
  PredictionSchema,
  ReplaySnapshotSchema,
  broochText,
  replayUrl,
} from '../apps/dashboard/src/replayContract';

describe('recorded replay boundaries', () => {
  const prediction = PredictionSchema.parse({
    window_id: 0,
    window_start: 0,
    window_end: 3,
    actual_activity: 'Sitting',
    predicted_activity: 'Lying chest',
    window_quality: 'VALID',
    quality_reasons: [],
    label_reasons: [],
    model_version: 'fixture',
    model_type: 'RandomForestClassifier',
    feature_count: 112,
    inference_executed: true,
    offline_precomputed: false,
    matches_actual: false,
    matches_saved: true,
  });
  it('brooch uses executed prediction even when it disagrees with actual', () => {
    expect(broochText(prediction)).toContain('가슴을 바닥에 대고 눕기');
    expect(broochText(prediction)).not.toContain('앉기');
    expect(broochText(null)).toBeNull();
    expect(broochText({ ...prediction, inference_executed: false })).toBeNull();
  });
  it('rejects precomputed results and a live snapshot', () => {
    expect(
      PredictionSchema.safeParse({ ...prediction, offline_precomputed: true })
        .success,
    ).toBe(false);
    expect(
      ReplaySnapshotSchema.safeParse({
        type: 'snapshot',
        source: 'iphone_live',
      }).success,
    ).toBe(false);
  });
  it('uses a separate endpoint with the established URL safety contract', () => {
    expect(replayUrl('http://localhost:8000')).toBe(
      'ws://localhost:8000/ws/replay',
    );
    expect(() => replayUrl('http://localhost:8000/arbitrary')).toThrow();
    expect(() => replayUrl('http://user:password@localhost')).toThrow();
  });
});
