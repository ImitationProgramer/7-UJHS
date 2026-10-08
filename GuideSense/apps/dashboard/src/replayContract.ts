import { z } from 'zod';
import { deviceWebSocketUrl } from '@guidesense/protocol';

const finite = z.number().finite();
const vector = z.object({ x: finite, y: finite, z: finite });
const quality = z.enum(['VALID', 'INVALID_WINDOW']);
export const ReplaySampleSchema = z.object({
  timestamp: finite,
  elapsed_seconds: finite.nonnegative(),
  accelerometer: vector,
  gyroscope: vector,
  label: z.array(z.string()),
  behavior_annotations: z.record(z.string(), z.string()),
  window_id: z.number().int().nonnegative(),
  window_quality: quality,
});
export const PredictionSchema = z.object({
  window_id: z.number().int().nonnegative(),
  window_start: finite,
  window_end: finite,
  actual_activity: z.string().nullable(),
  predicted_activity: z.string().nullable(),
  window_quality: quality,
  quality_reasons: z.array(z.string()),
  label_reasons: z.array(z.string()),
  model_version: z.string(),
  model_type: z.string(),
  feature_count: z.literal(112),
  inference_executed: z.boolean(),
  offline_precomputed: z.literal(false),
  matches_actual: z.boolean().nullable(),
  matches_saved: z.boolean().nullable(),
});
export const ReplaySnapshotSchema = z.object({
  type: z.literal('replay_snapshot'),
  source: z.literal('canine_dataset_replay'),
  is_live: z.literal(false),
  state: z.enum(['IDLE', 'PLAYING', 'PAUSED', 'STOPPED', 'COMPLETED', 'ERROR']),
  run_id: z.number().int(),
  command_id: z.number().int(),
  clip_id: z.string().nullable(),
  clips: z.array(z.object({ id: z.string(), available: z.boolean() })),
  manifest: z
    .object({
      dataset_source: z.string().url(),
      dog_id: z.number().int(),
      test_num: z.number().int(),
      split: z.string(),
      start: finite,
      end: finite,
      samples: z.number().int(),
      timestamp_basis: z.string(),
      model_version: z.string(),
      license: z.string(),
      license_url: z.string().url(),
      attribution: z.string(),
      changes: z.string(),
    })
    .nullable(),
  elapsed_seconds: finite.nonnegative(),
  duration_seconds: finite.nonnegative(),
  progress: finite.min(0).max(1),
  sample_count: z.number().int().nonnegative(),
  analysis_count: z.number().int().nonnegative(),
  sample: ReplaySampleSchema.nullable(),
  samples: z.array(ReplaySampleSchema),
  prediction: PredictionSchema.nullable(),
  error: z.string().nullable(),
  speed: z.literal(1),
});
export type ReplaySample = z.infer<typeof ReplaySampleSchema>;
export type Prediction = z.infer<typeof PredictionSchema>;
export type ReplaySnapshot = z.infer<typeof ReplaySnapshotSchema>;
export type ReplayAction =
  'play' | 'pause' | 'resume' | 'stop' | 'restart' | 'status';
export function replayUrl(address: string) {
  const url = new URL(deviceWebSocketUrl(address, 'dashboard'));
  url.pathname = '/ws/replay';
  return url.toString();
}
export function broochText(prediction: Prediction | null) {
  if (!prediction?.inference_executed || !prediction.predicted_activity)
    return null;
  const labels: Record<string, string> = {
    Walking: '걷기',
    Trotting: '속보',
    Sitting: '앉기',
    'Lying chest': '가슴을 바닥에 대고 눕기',
    Sniffing: '냄새 맡기',
    Playing: '놀기',
  };
  return `공개된 개의 기록에서 ${labels[prediction.predicted_activity] ?? prediction.predicted_activity} 행동이 분류되었습니다.`;
}
