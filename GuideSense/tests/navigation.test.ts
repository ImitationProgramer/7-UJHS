import { describe, expect, it } from 'vitest';
import {
  CandidateSchema,
  RoutesSchema,
  cumulativeDistances,
  distance,
  eventDistance,
  interpolate,
  navigationUrl,
  type Coordinate,
} from '../apps/dashboard/src/navigation/contract';

const geometry: Coordinate[] = [
  [127.01, 37.55],
  [127.0101, 37.55],
  [127.012, 37.55],
];
const candidate = CandidateSchema.parse({
  id: 'route',
  options: [0],
  geometry,
  instructions: [],
  crossings: [],
  decision: 'eligible',
  reason: 'test',
  distanceM: 180,
  durationS: 180,
  score: 180,
  penalties: [],
  summary: { crossingCount: 0, matchedCount: 0, unknownCount: 0 },
  extraDistanceM: 0,
  extraDurationS: 0,
});
const result = {
  requestId: 'test',
  start: { lat: 37.55, lon: 127.01, name: 'start' },
  end: { lat: 37.55, lon: 127.012, name: 'end' },
  dataDate: '2022-12-15',
  policyVersion: 'test',
  status: 'recommended',
  candidates: [candidate],
  recommendedId: 'route',
  optionErrors: [],
};
describe('navigation data boundaries and simulation', () => {
  it('interpolates by traveled distance rather than vertex count', () => {
    const lengths = cumulativeDistances(geometry);
    const total = lengths.at(-1)!;
    const midpoint = interpolate(geometry, lengths, total / 2);
    expect(midpoint[0]).toBeCloseTo(127.011, 5);
    expect(midpoint[1]).toBe(37.55);
    expect(interpolate(geometry, lengths, 1e6)).toEqual(geometry[2]);
    expect(interpolate(geometry, lengths, -1)).toEqual(geometry[0]);
  });
  it('projects events along segments instead of snapping to sparse vertices', () => {
    const lengths = cumulativeDistances(geometry);
    expect(eventDistance(geometry, lengths, [127.011, 37.55001])).toBeCloseTo(
      lengths.at(-1)! / 2,
      1,
    );
  });
  it('handles duplicate vertices without NaN or simulation jumps', () => {
    const points = [geometry[0], geometry[0], geometry[2]];
    const lengths = cumulativeDistances(points);
    expect(interpolate(points, lengths, lengths.at(-1)! / 2)[0]).toBeCloseTo(
      127.011,
    );
    expect(distance(geometry[0], geometry[0])).toBe(0);
  });
  it('rejects recommendation pointing to excluded or missing candidate', () => {
    expect(RoutesSchema.safeParse(result).success).toBe(true);
    expect(
      RoutesSchema.safeParse({ ...result, recommendedId: 'missing' }).success,
    ).toBe(false);
    expect(
      RoutesSchema.safeParse({
        ...result,
        candidates: [{ ...candidate, decision: 'excluded' }],
      }).success,
    ).toBe(false);
    expect(
      RoutesSchema.safeParse({ ...result, candidates: [candidate, candidate] })
        .success,
    ).toBe(false);
  });
  it('rejects malformed coordinates and finite-distance violations before rendering', () => {
    expect(
      CandidateSchema.safeParse({
        ...candidate,
        geometry: [
          [37.5, 127],
          [37.6, 127],
        ],
      }).success,
    ).toBe(false);
    expect(
      CandidateSchema.safeParse({ ...candidate, distanceM: NaN }).success,
    ).toBe(false);
    expect(
      CandidateSchema.safeParse({ ...candidate, geometry: [geometry[0]] })
        .success,
    ).toBe(false);
  });
  it('uses configured server with the existing URL safety contract', () => {
    expect(navigationUrl('https://example.com:8443', 'routes').toString()).toBe(
      'https://example.com:8443/api/navigation/routes',
    );
    expect(() =>
      navigationUrl('https://user:pass@example.com', 'routes'),
    ).toThrow();
    expect(() =>
      navigationUrl('https://example.com/arbitrary', 'routes'),
    ).toThrow();
  });
});
