import { z } from 'zod';
import { deviceWebSocketUrl } from '@guidesense/protocol';

const finite = z.number().finite();
const coordinate = z.tuple([
  finite.min(-180).max(180),
  finite.min(-90).max(90),
]);
const point = z.object({
  lat: finite.min(-90).max(90),
  lon: finite.min(-180).max(180),
  name: z.string(),
});
const flag = z.enum(['yes', 'no', 'unknown']);
const ring = z.array(coordinate).min(4);
const polygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(ring).min(1),
});
const multiPolygon = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(ring).min(1)).min(1),
});
const geometry = z.union([polygon, multiPolygon]);
const boundary = z.union([
  geometry,
  z.object({
    type: z.literal('Feature'),
    properties: z.record(z.string(), z.unknown()).nullable(),
    geometry,
  }),
]);
export const MetadataSchema = z.object({
  boundary,
  dataDate: z.string(),
  crosswalkCount: finite.int().nonnegative(),
  keyConfigured: z.boolean(),
  demoStart: point.nullable().default(null),
  policy: z.object({
    version: z.string(),
    weights: z.record(z.string(), finite),
  }),
  limitations: z.array(z.string()),
});
export const SearchSchema = z.object({
  places: z.array(
    point.extend({
      id: z.string(),
      address: z.string(),
      inServiceArea: z.boolean(),
    }),
  ),
});
const facility = z.object({
  id: z.string(),
  coordinate,
  signal: flag,
  audibleSignal: flag,
  curbRamp: flag,
  tactilePaving: flag,
  lanes: finite.nullable(),
  dataDate: z.string(),
});
export const CandidateSchema = z.object({
  id: z.string(),
  options: z.array(finite),
  geometry: z.array(coordinate).min(2),
  instructions: z.array(
    z.object({
      id: z.string(),
      coordinate,
      text: z.string(),
      turnType: finite.nullable(),
    }),
  ),
  crossings: z.array(
    z.object({
      id: z.string(),
      coordinate,
      status: z.enum(['matched', 'ambiguous', 'unmatched']),
      facility: facility.nullable(),
      reason: z.string(),
    }),
  ),
  decision: z.enum(['eligible', 'excluded', 'unverified']),
  reason: z.string(),
  distanceM: finite.nonnegative(),
  durationS: finite.nonnegative(),
  score: finite.nonnegative().nullable(),
  penalties: z.array(
    z.object({
      crossingId: z.string(),
      field: z.string(),
      value: flag,
      cost: finite.nonnegative(),
    }),
  ),
  summary: z.object({
    crossingCount: finite.nonnegative(),
    matchedCount: finite.nonnegative(),
    unknownCount: finite.nonnegative(),
  }),
  extraDistanceM: finite.nullable(),
  extraDurationS: finite.nullable(),
});
export const RoutesSchema = z
  .object({
    requestId: z.string(),
    start: point,
    end: point,
    dataDate: z.string(),
    policyVersion: z.string(),
    status: z.enum(['recommended', 'no_eligible_route', 'no_candidates']),
    candidates: z.array(CandidateSchema),
    recommendedId: z.string().nullable(),
    optionErrors: z.array(
      z.object({ option: finite, code: z.string(), message: z.string() }),
    ),
  })
  .superRefine((value, ctx) => {
    const ids = value.candidates.map((candidate) => candidate.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate candidate IDs' });
    if (
      value.recommendedId !== null &&
      !value.candidates.some(
        (c) => c.id === value.recommendedId && c.decision === 'eligible',
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid recommendation' });
    if (value.status === 'recommended' && value.recommendedId === null)
      ctx.addIssue({ code: 'custom', message: 'Missing recommendation' });
  });
export type Metadata = z.infer<typeof MetadataSchema>;
export type Place = z.infer<typeof SearchSchema>['places'][number];
export type Point = z.infer<typeof point>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type Routes = z.infer<typeof RoutesSchema>;
export type Coordinate = z.infer<typeof coordinate>;
export const fieldLabels: Record<string, string> = {
  audibleSignal: '음향신호기',
  curbRamp: '보도턱 낮춤',
  tactilePaving: '점자블록',
  signal: '보행자신호등',
};
export const flagLabels = { yes: '있음', no: '없음', unknown: '미확인' };
export const decisionLabels = {
  eligible: '평가 가능',
  excluded: '제외',
  unverified: '미확인',
};
export function navigationUrl(address: string, path: string) {
  const url = new URL(deviceWebSocketUrl(address, 'dashboard'));
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = `/api/navigation/${path}`;
  url.search = '';
  return url;
}
export async function readResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('서버 응답을 읽을 수 없어요. 다시 조회해 주세요.');
  }
  if (!response.ok) {
    const parsed = z
      .object({ detail: z.object({ message: z.string() }) })
      .safeParse(body);
    throw new Error(
      parsed.success
        ? parsed.data.detail.message
        : `요청을 처리하지 못했어요 (${response.status}).`,
    );
  }
  return body;
}
export function errorText(error: unknown) {
  if (error instanceof z.ZodError)
    return '서버 응답 형식이 올바르지 않아 결과를 표시하지 않았어요.';
  return error instanceof Error
    ? error.message
    : '연결에 실패했어요. 다시 시도해 주세요.';
}
export function distance(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function cumulativeDistances(points: Coordinate[]) {
  const result = [0];
  for (let i = 1; i < points.length; i++)
    result.push(result[i - 1] + distance(points[i - 1], points[i]));
  return result;
}
export function interpolate(
  points: Coordinate[],
  lengths: number[],
  meters: number,
): Coordinate {
  if (!points.length) throw new Error('Empty route');
  if (meters <= 0) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] >= meters) {
      const span = lengths[i] - lengths[i - 1];
      const t = span ? (meters - lengths[i - 1]) / span : 0;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    }
  }
  return points[points.length - 1];
}
// Project each event onto the nearest route segment, retaining distance along the route.
export function eventDistance(
  points: Coordinate[],
  lengths: number[],
  event: Coordinate,
) {
  let best = Infinity;
  let progress = 0;
  const longitudeScale = Math.cos((event[1] * Math.PI) / 180);
  for (let i = 1; i < points.length; i++) {
    const dx = (points[i][0] - points[i - 1][0]) * longitudeScale;
    const dy = points[i][1] - points[i - 1][1];
    const ex = (event[0] - points[i - 1][0]) * longitudeScale;
    const ey = event[1] - points[i - 1][1];
    const t = Math.max(
      0,
      Math.min(1, (ex * dx + ey * dy) / (dx * dx + dy * dy || 1)),
    );
    const residual = (ex - t * dx) ** 2 + (ey - t * dy) ** 2;
    if (residual < best) {
      best = residual;
      progress = lengths[i - 1] + t * (lengths[i] - lengths[i - 1]);
    }
  }
  return progress;
}
