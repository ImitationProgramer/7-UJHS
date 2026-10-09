import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceTools } from '../apps/dashboard/src/navigation/voiceTools';
const place = {
  id: 'station',
  name: '왕십리역',
  address: '성동구 왕십리광장로',
  lat: 37.56,
  lon: 127.03,
  inServiceArea: true,
};
function setup(demoStart?: { name: string; lat: number; lon: number }) {
  const controller = new AbortController();
  const onSelect = vi.fn();
  const onCandidates = vi.fn();
  const tools = createVoiceTools({
    address: 'http://localhost:8000',
    signal: controller.signal,
    demoStart,
    onSelect,
    onCandidates,
  });
  return { tools, controller, onSelect, onCandidates };
}
afterEach(() => vi.unstubAllGlobals());
describe('voice place selection boundary', () => {
  it('numbers only eligible candidates in the same order presented to the user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            places: [
              { ...place, id: 'outside', inServiceArea: false },
              place,
              { ...place, id: 'second', name: '왕십리역 2번 출구' },
            ],
          }),
        ),
      ),
    );
    const { tools, onSelect, onCandidates } = setup();
    const result = await tools.execute(
      'search_places',
      JSON.stringify({ target: 'end', query: '왕십리역' }),
    );
    expect(result).toMatchObject({
      places: [
        { number: 1, place_id: 'station' },
        { number: 2, place_id: 'second' },
      ],
    });
    expect(onCandidates).toHaveBeenLastCalledWith('end', [
      place,
      { ...place, id: 'second', name: '왕십리역 2번 출구' },
    ]);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('accepts only an empty end-session command and rejects it after stop', async () => {
    const { tools, controller } = setup();
    expect(
      await tools.execute('end_session', '{"unexpected":true}'),
    ).toMatchObject({ error: 'invalid_arguments' });
    expect(await tools.execute('end_session', '{}')).toEqual({ ended: true });
    controller.abort();
    expect(await tools.execute('end_session', '{}')).toMatchObject({
      error: 'session_closed',
    });
  });
  it('only selects exact in-area results for the searched target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            places: [place, { ...place, id: 'outside', inServiceArea: false }],
          }),
        ),
      ),
    );
    const { tools, onSelect } = setup();
    expect(
      await tools.execute(
        'select_place',
        JSON.stringify({ target: 'start', place_id: place.id }),
      ),
    ).toMatchObject({ error: 'unknown_place_id' });
    expect(
      await tools.execute(
        'search_places',
        JSON.stringify({ target: 'start', query: '왕십리' }),
      ),
    ).toMatchObject({ places: [{ place_id: place.id }] });
    expect(
      await tools.execute(
        'select_place',
        JSON.stringify({ target: 'end', place_id: place.id }),
      ),
    ).toMatchObject({ error: 'unknown_place_id' });
    expect(
      await tools.execute(
        'select_place',
        JSON.stringify({ target: 'start', place_id: 'outside' }),
      ),
    ).toMatchObject({ error: 'unknown_place_id' });
    await tools.execute(
      'select_place',
      JSON.stringify({ target: 'start', place_id: place.id, lat: 0, lon: 0 }),
    );
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('start', {
      name: place.name,
      lat: place.lat,
      lon: place.lon,
    });
  });
  it('discards search completion after a manual endpoint change', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const { tools, onSelect } = setup();
    const pending = tools.execute(
      'search_places',
      JSON.stringify({ target: 'start', query: '왕십리' }),
    );
    tools.invalidate('start');
    resolve(new Response(JSON.stringify({ places: [place] })));
    expect(await pending).toMatchObject({ error: 'selection_changed' });
    expect(tools.select('start', place.id)).toMatchObject({
      error: 'unknown_place_id',
    });
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('never selects or publishes search results after stop', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const { tools, controller, onCandidates, onSelect } = setup();
    const pending = tools.execute(
      'search_places',
      JSON.stringify({ target: 'end', query: '서울숲' }),
    );
    controller.abort();
    resolve(new Response(JSON.stringify({ places: [place] })));
    expect(await pending).toMatchObject({ error: 'session_closed' });
    expect(tools.select('end', place.id)).toMatchObject({
      error: 'session_closed',
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCandidates).toHaveBeenCalledExactlyOnceWith('end', []);
  });
  it('rejects malformed tool arguments', async () => {
    const { tools, onSelect } = setup();
    expect(await tools.execute('search_places', '{')).toMatchObject({
      error: 'invalid_arguments',
    });
    expect(
      await tools.execute(
        'select_place',
        JSON.stringify({ target: 'middle', place_id: place.id }),
      ),
    ).toMatchObject({ error: 'invalid_arguments' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('current location voice tool', () => {
  it('uses the configured demo departure without requesting real geolocation', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ inServiceArea: true })),
        ),
    );
    const demoStart = {
      name: '왕십리역 (시연 위치)',
      lat: 37.56120587,
      lon: 127.03701584,
    };
    const { tools, onSelect } = setup(demoStart);
    expect(await tools.execute('get_current_location', '{}')).toMatchObject({
      selected: true,
      source: 'demo_location',
      name: demoStart.name,
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('start', demoStart);
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string),
    ).toEqual(demoStart);
  });
  function locationMock() {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ inServiceArea: true })),
        ),
    );
    let success!: PositionCallback;
    let failure!: PositionErrorCallback;
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn((ok, fail) => {
          success = ok;
          failure = fail;
        }),
      },
    });
    return {
      success: (accuracy = 20) =>
        success({
          coords: { latitude: 37.56, longitude: 127.03, accuracy },
        } as GeolocationPosition),
      failure: () => failure({ code: 1 } as GeolocationPositionError),
    };
  }
  it('selects browser coordinates as departure without model supplied coordinates', async () => {
    const location = locationMock();
    const { tools, onSelect } = setup();
    const result = tools.execute('get_current_location', '{}');
    location.success();
    expect(await result).toMatchObject({ selected: true, target: 'start' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('start', {
      name: '현재 위치',
      lat: 37.56,
      lon: 127.03,
    });
  });
  it.each(['denied', 'inaccurate', 'stopped', 'changed'])(
    'does not apply location after %s',
    async (condition) => {
      const location = locationMock();
      const { tools, controller, onSelect } = setup();
      const pending = tools.execute('get_current_location', '{}');
      if (condition === 'stopped') controller.abort();
      if (condition === 'changed') tools.invalidate('start');
      if (condition === 'denied') location.failure();
      else location.success(condition === 'inaccurate' ? 200 : 20);
      expect(await pending).toHaveProperty('error');
      expect(onSelect).not.toHaveBeenCalled();
    },
  );
  it('does not select an out-of-area current location', async () => {
    const location = locationMock();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ inServiceArea: false })),
        ),
    );
    const { tools, onSelect } = setup();
    const pending = tools.execute('get_current_location', '{}');
    location.success();
    expect(await pending).toMatchObject({ error: 'outside_service_area' });
    expect(onSelect).not.toHaveBeenCalled();
  });
  it.each(['stopped', 'changed'])(
    'ignores location validation after %s',
    async (condition) => {
      const location = locationMock();
      let resolve!: (response: Response) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((done) => {
              resolve = done;
            }),
        ),
      );
      const { tools, controller, onSelect } = setup();
      const pending = tools.execute('get_current_location', '{}');
      location.success();
      await vi.waitFor(() => expect(resolve).toBeDefined());
      if (condition === 'stopped') controller.abort();
      else tools.invalidate('start');
      resolve(new Response(JSON.stringify({ inServiceArea: true })));
      expect(await pending).toHaveProperty('error');
      expect(onSelect).not.toHaveBeenCalled();
    },
  );
});
