// Explicitly synthetic route/search fixtures; never used by application code.
export const start = { lat: 37.5634, lon: 127.0368, name: '테스트 출발' };
export const end = { lat: 37.5638, lon: 127.039, name: '테스트 도착' };
export const facility = {
  id: 'fixture-crossing',
  coordinate: [127.0378, 37.5636],
  signal: 'yes',
  audibleSignal: 'yes',
  curbRamp: 'yes',
  tactilePaving: 'yes',
  lanes: 2,
  dataDate: '2022-12-15',
};
export const eligible = {
  id: 'eligible',
  options: [0, 30],
  geometry: [
    [start.lon, start.lat],
    [127.0378, 37.5636],
    [end.lon, end.lat],
  ],
  instructions: [
    {
      id: 'i1',
      coordinate: [127.0378, 37.5636],
      text: '테스트 횡단보도를 건너 이동합니다.',
      turnType: 211,
    },
  ],
  crossings: [
    {
      id: 'c1',
      coordinate: [127.0378, 37.5636],
      status: 'matched',
      facility,
      reason: '합성 테스트의 명시적 횡단 선형 일치',
    },
  ],
  decision: 'eligible',
  reason: '테스트 시설 조건 충족',
  distanceM: 250,
  durationS: 210,
  score: 250,
  penalties: [],
  summary: { crossingCount: 1, matchedCount: 1, unknownCount: 0 },
  extraDistanceM: 0,
  extraDurationS: 0,
};
export const excluded = {
  ...eligible,
  id: 'excluded',
  options: [10],
  distanceM: 190,
  durationS: 160,
  geometry: [
    [start.lon, start.lat],
    [127.0376, 37.5639],
    [end.lon, end.lat],
  ],
  decision: 'excluded',
  reason: '보행자신호등 없는 횡단보도가 포함되어 제외했습니다.',
  score: null,
  crossings: [
    { ...eligible.crossings[0], facility: { ...facility, signal: 'no' } },
  ],
  extraDistanceM: null,
  extraDurationS: null,
};
export const routes = {
  requestId: 'synthetic-browser-test',
  start,
  end,
  dataDate: '2022-12-15',
  policyVersion: 'test-v1',
  status: 'recommended',
  candidates: [excluded, eligible],
  recommendedId: 'eligible',
  optionErrors: [],
};
