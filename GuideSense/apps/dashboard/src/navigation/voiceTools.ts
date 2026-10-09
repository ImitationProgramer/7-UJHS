import { z } from 'zod';
import {
  SearchSchema,
  navigationUrl,
  readResponse,
  type Place,
  type Point,
} from './contract';

export type VoiceTarget = 'start' | 'end';
const target = z.enum(['start', 'end']);
const searchArguments = z.object({
  target,
  query: z.string().trim().min(1).max(120),
});
const selectArguments = z.object({
  target,
  place_id: z.string().min(1).max(200),
});

export function readCurrentLocation(signal: AbortSignal): Promise<Point> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('위치 요청이 취소되었습니다.'));
    if (!globalThis.navigator?.geolocation)
      return reject(
        new Error(
          '현재 위치를 지원하지 않는 브라우저입니다. 출발지를 직접 정해 주세요.',
        ),
      );
    const abort = () => reject(new Error('위치 요청이 취소되었습니다.'));
    signal.addEventListener('abort', abort, { once: true });
    const finish = () => signal.removeEventListener('abort', abort);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        finish();
        if (signal.aborted) return;
        if (
          !Number.isFinite(coords.accuracy) ||
          coords.accuracy > 100 ||
          !Number.isFinite(coords.latitude) ||
          !Number.isFinite(coords.longitude)
        ) {
          reject(
            new Error(
              '현재 위치의 오차가 커서 출발지로 사용하지 못했어요. 출발지를 직접 정해 주세요.',
            ),
          );
          return;
        }
        resolve({
          name: '현재 위치',
          lat: coords.latitude,
          lon: coords.longitude,
        });
      },
      (error) => {
        finish();
        if (signal.aborted) return;
        reject(
          new Error(
            error.code === 1
              ? '위치 사용이 허용되지 않았어요. 출발지를 말하거나 직접 정해 주세요.'
              : '현재 위치를 확인하지 못했어요. 출발지를 말하거나 직접 정해 주세요.',
          ),
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

/** The model may reference search results, never supply coordinates itself. */
export function createVoiceTools(options: {
  address: string;
  signal: AbortSignal;
  demoStart?: Point | null;
  onCandidates: (target: VoiceTarget, places: Place[]) => void;
  onSelect: (target: VoiceTarget, point: Point) => void;
}) {
  const cache: Record<VoiceTarget, Place[]> = { start: [], end: [] };
  const revision = { start: 0, end: 0 };
  const select = (which: VoiceTarget, id: string) => {
    if (options.signal.aborted) return { error: 'session_closed' };
    const place = cache[which].find(
      (item) => item.id === id && item.inServiceArea,
    );
    if (!place)
      return {
        error: 'unknown_place_id',
        message: 'Search again and use an exact returned place_id.',
      };
    options.onSelect(which, {
      name: place.name,
      lat: place.lat,
      lon: place.lon,
    });
    options.onCandidates(which, []);
    return {
      selected: true,
      target: which,
      place_id: place.id,
      name: place.name,
      address: place.address,
    };
  };
  return {
    select,
    invalidate(which: VoiceTarget) {
      revision[which]++;
      cache[which] = [];
      options.onCandidates(which, []);
    },
    async execute(name: string, raw: string): Promise<unknown> {
      if (options.signal.aborted) return { error: 'session_closed' };
      try {
        const args: unknown = JSON.parse(raw);
        if (name === 'end_session') {
          z.object({}).strict().parse(args);
          return { ended: true };
        }
        if (name === 'get_current_location') {
          z.object({}).strict().parse(args);
          const locationRevision = ++revision.start;
          const point =
            options.demoStart ?? (await readCurrentLocation(options.signal));
          if (options.signal.aborted) return { error: 'session_closed' };
          if (revision.start !== locationRevision)
            return { error: 'selection_changed' };
          const response = await fetch(
            navigationUrl(options.address, 'validate-location'),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(point),
              signal: options.signal,
            },
          );
          const location = z
            .object({ inServiceArea: z.boolean() })
            .parse(await readResponse(response));
          if (options.signal.aborted) return { error: 'session_closed' };
          if (revision.start !== locationRevision)
            return { error: 'selection_changed' };
          if (!location.inServiceArea)
            return {
              error: 'outside_service_area',
              message:
                '현재 위치가 성동구 밖이라 출발지로 사용할 수 없어요. 성동구 안에서 출발할 장소를 말해 주세요.',
            };
          cache.start = [];
          options.onCandidates('start', []);
          options.onSelect('start', point);
          return {
            selected: true,
            target: 'start',
            name: point.name,
            source: options.demoStart ? 'demo_location' : 'browser_geolocation',
          };
        }
        if (name === 'select_place') {
          const parsed = selectArguments.parse(args);
          return select(parsed.target, parsed.place_id);
        }
        if (name !== 'search_places') return { error: 'unknown_tool' };
        const parsed = searchArguments.parse(args);
        const searchRevision = ++revision[parsed.target];
        cache[parsed.target] = [];
        options.onCandidates(parsed.target, []);
        const url = navigationUrl(options.address, 'search');
        url.searchParams.set('q', parsed.query);
        const response = await fetch(url, { signal: options.signal });
        const results = SearchSchema.parse(await readResponse(response));
        if (options.signal.aborted) return { error: 'session_closed' };
        if (revision[parsed.target] !== searchRevision)
          return {
            error: 'selection_changed',
            message:
              'The user changed this endpoint. Do not replace it with this outdated search.',
          };
        const places = results.places
          .filter((place) => place.inServiceArea)
          .slice(0, 8);
        cache[parsed.target] = places;
        options.onCandidates(parsed.target, places);
        return {
          target: parsed.target,
          places: places.map(({ id, name: placeName, address }, index) => ({
            number: index + 1,
            place_id: id,
            name: placeName,
            address,
          })),
          instruction:
            places.length > 1
              ? '번호·이름·구분되는 주소를 최대 3개씩 음성으로 읽고 답을 기다리세요. 말로 고른 번호나 이름에 해당하는 최신 place_id로 select_place를 호출하세요. 구분할 수 없으면 추가 단서를 물어 다시 검색하세요. 화면 클릭을 요구하지 마세요.'
              : places.length === 1
                ? '이름과 주소를 음성으로 읽어 맞는지 물어보세요. 말로 확인받으면 select_place를 호출하세요. 화면 클릭을 요구하지 마세요.'
                : '성동구 안에 일치하는 장소가 없습니다. 구체적인 장소명이나 주소를 말로 요청하세요.',
        };
      } catch (error) {
        if (options.signal.aborted) return { error: 'session_closed' };
        return {
          error:
            error instanceof z.ZodError || error instanceof SyntaxError
              ? 'invalid_arguments'
              : name === 'get_current_location'
                ? 'location_failed'
                : 'search_failed',
          message:
            name === 'get_current_location' && error instanceof Error
              ? error.message
              : '장소를 확인하지 못했습니다. 장소명이나 주소를 다시 말해 주세요.',
        };
      }
    },
  };
}
