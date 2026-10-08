import { z } from 'zod';
export { colors, radius } from './theme';

export const FRAME_INTERVAL_MS = 20;
export const MOTION_STALE_MS = 1000;
export const LOCATION_STALE_MS = 15000;
export const SENSOR_KEYS = ['accelerometer', 'gyroscope', 'location'] as const;
export type SensorKey = (typeof SENSOR_KEYS)[number];
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const finite = z.number().finite();
export const SensorStatusSchema = z.enum([
  'waiting',
  'ready',
  'denied',
  'unavailable',
  'error',
  'stale',
  'stopped',
]);
export type SensorStatus = z.infer<typeof SensorStatusSchema>;
export const MotionSchema = z.strictObject({
  x: finite,
  y: finite,
  z: finite,
  timestamp,
});
export const LocationSchema = z.strictObject({
  latitude: finite.min(-90).max(90),
  longitude: finite.min(-180).max(180),
  accuracy: finite.nonnegative().nullable(),
  timestamp,
});
export type MotionReading = z.infer<typeof MotionSchema>;
export type LocationReading = z.infer<typeof LocationSchema>;
export const SensorFrameSchema = z
  .strictObject({
    type: z.literal('sensor_frame'),
    deviceId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/),
    timestamp,
    accelerometer: MotionSchema.nullable(),
    gyroscope: MotionSchema.nullable(),
    location: LocationSchema.nullable(),
    sensorStatus: z.strictObject({
      accelerometer: SensorStatusSchema,
      gyroscope: SensorStatusSchema,
      location: SensorStatusSchema,
    }),
  })
  .superRefine((frame, ctx) => {
    for (const key of SENSOR_KEYS) {
      if ((frame[key] !== null) !== (frame.sensorStatus[key] === 'ready')) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Only ready sensors may have a reading',
        });
      }
    }
  });
export type SensorFrame = z.infer<typeof SensorFrameSchema>;
export const SnapshotSchema = z.strictObject({
  source: z.literal('iphone_live').default('iphone_live'),
  type: z.literal('snapshot'),
  deviceId: z.string().nullable(),
  status: z.enum(['connected', 'disconnected']),
  lastSensorTimestamp: timestamp.nullable(),
  lastReceivedAt: timestamp.nullable(),
  timeoutMs: z.number().int().positive(),
  frame: SensorFrameSchema.nullable(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const statusLabels: Record<SensorStatus, string> = {
  waiting: '데이터 대기',
  ready: '수신 중',
  denied: '권한 거부',
  unavailable: '사용 불가',
  error: '센서 오류',
  stale: '데이터 지연',
  stopped: '중지됨',
};

export function deviceWebSocketUrl(
  input: string,
  endpoint: 'device' | 'dashboard',
): string {
  const url = new URL(input.trim());
  if (
    !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('http://Mac-IP:8000 형식의 주소를 입력하세요.');
  }
  if (!['', '/', `/ws/${endpoint}`].includes(url.pathname)) {
    throw new Error('주소에는 기본 호스트와 포트만 입력하세요.');
  }
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  url.pathname = `/ws/${endpoint}`;
  return url.toString();
}

// Pure projection: expired samples become null, never synthetic zero values.
export function freshFrame(frame: SensorFrame, now: number): SensorFrame {
  const next = {
    ...frame,
    timestamp: now,
    sensorStatus: { ...frame.sensorStatus },
  };
  for (const key of SENSOR_KEYS) {
    const value = frame[key];
    const maxAge = key === 'location' ? LOCATION_STALE_MS : MOTION_STALE_MS;
    if (
      value &&
      (now - value.timestamp > maxAge || value.timestamp > now + 1000)
    ) {
      next[key] = null;
      next.sensorStatus[key] = 'stale';
    }
  }
  return next;
}

export function emptyFrame(
  deviceId: string,
  state: SensorStatus = 'waiting',
): SensorFrame {
  return {
    type: 'sensor_frame',
    deviceId,
    timestamp: Date.now(),
    accelerometer: null,
    gyroscope: null,
    location: null,
    sensorStatus: { accelerometer: state, gyroscope: state, location: state },
  };
}
