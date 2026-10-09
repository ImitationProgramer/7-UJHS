import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setup } from './fixtures/navigation-page';
import { start, end, routes } from './fixtures/navigation';
import {
  mockVoice,
  mockLocation,
  emit,
  callTool,
  mockVoiceEndpoints,
  selectVoicePlace,
} from './fixtures/voice-page';

async function setupVoice(
  page: Page,
  denyMicrophone = false,
  denyLocation = false,
) {
  await mockVoice(page, denyMicrophone);
  await mockLocation(page, denyLocation);
  await mockVoiceEndpoints(page);
  await page.route('**/api/navigation/routes', (route) =>
    route.fulfill({ json: routes }),
  );
  await setup(page, true, false);
}

async function finishVoiceTurn(page: Page) {
  await emit(page, {
    type: 'response.done',
    response: { status: 'completed', output: [] },
  });
}

test('demo departure works without location permission and can be changed by voice', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const demoStart = {
    name: '왕십리역 (시연 위치)',
    lat: 37.56120587,
    lon: 127.03701584,
  };
  await mockVoice(page);
  await mockLocation(page, true);
  await mockVoiceEndpoints(page);
  await setup(page, true, false, demoStart);
  const requests: any[] = [];
  await page.route('**/api/navigation/routes', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: routes });
  });
  await expect(page.locator('.voice-disclosure')).toContainText(
    '가상 기본 출발지: 왕십리역',
  );
  await expect(page.locator('.voice-disclosure')).not.toContainText(
    '위치 권한',
  );
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.locator('.voice-state-listening')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__locationRequests)).toBe(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__voiceTest.sent.some((event: any) =>
          event.item?.content?.some((content: any) =>
            content.text?.includes('시연 모드: 왕십리역'),
          ),
        ),
      ),
    )
    .toBe(true);
  await selectVoicePlace(page, 'end', '서울숲');
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  expect(requests).toEqual([{ start: demoStart, end }]);
  await selectVoicePlace(page, 'start', '출발');
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ start, end });
  await page.waitForTimeout(400);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).__locationRequests)).toBe(0);
});

async function routeMessages(page: Page) {
  return page.evaluate(() =>
    (window as any).__voiceTest.sent
      .filter((event: any) => event.type === 'conversation.item.create')
      .flatMap((event: any) => event.item?.content ?? [])
      .map((content: any) => content.text ?? '')
      .filter((text: string) => text.startsWith('앱의 경로 상황 데이터:')),
  );
}

test('out-of-area current location asks for a spoken departure and preserves the destination', async ({
  page,
}) => {
  await setupVoice(page);
  await page.route('**/api/navigation/validate-location', (route) =>
    route.fulfill({ json: { inServiceArea: false } }),
  );
  const requests: any[] = [];
  await page.route('**/api/navigation/routes', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: routes });
  });
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.locator('.voice-error')).toContainText(
    '현재 위치가 성동구 밖',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__voiceTest.sent.some((event: any) =>
          event.item?.content?.some((item: any) =>
            item.text?.includes('현재 위치가 성동구 밖'),
          ),
        ),
      ),
    )
    .toBe(true);
  await selectVoicePlace(page, 'end', '도착');
  expect(requests).toHaveLength(0);
  await selectVoicePlace(page, 'start', '출발');
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  expect(requests).toEqual([{ start, end }]);
  await expect(page.locator('.voice-error')).toHaveCount(0);
  await finishVoiceTurn(page);
  await expect
    .poll(() => routeMessages(page))
    .toEqual([expect.stringContaining('경로 조회가 끝났습니다')]);
});

test('route rejection is spoken after the active turn and spoken correction recovers', async ({
  page,
}) => {
  await setupVoice(page);
  let attempts = 0;
  await page.route('**/api/navigation/routes', (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 422,
          json: {
            detail: {
              code: 'outside_service_area',
              message:
                '출발지가 성동구 밖에 있어 경로를 찾을 수 없어요. 성동구 안의 출발지를 말해 주세요.',
            },
          },
        })
      : route.fulfill({ json: routes });
  });
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.locator('.voice-state-listening')).toBeVisible();
  await selectVoicePlace(page, 'end', '도착');
  await expect(page.locator('.field-error')).toContainText(
    '출발지가 성동구 밖',
  );
  expect(await routeMessages(page)).toEqual([]);
  await finishVoiceTurn(page);
  await expect
    .poll(() => routeMessages(page))
    .toEqual([expect.stringContaining('경로 조회 실패: 출발지가 성동구 밖')]);
  await finishVoiceTurn(page);
  expect(await routeMessages(page)).toHaveLength(1);
  await selectVoicePlace(page, 'start', '출발');
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  await finishVoiceTurn(page);
  await expect
    .poll(async () => (await routeMessages(page)).at(-1))
    .toContain('경로 조회가 끝났습니다');
  expect(attempts).toBe(2);
});

for (const status of ['no_eligible_route', 'no_candidates'] as const) {
  test(`completed ${status} is delivered to voice instead of waiting indefinitely`, async ({
    page,
  }) => {
    await setupVoice(page);
    await page.route('**/api/navigation/routes', (route) =>
      route.fulfill({
        json: {
          ...routes,
          status,
          recommendedId: null,
          candidates:
            status === 'no_candidates'
              ? []
              : routes.candidates.filter(
                  (candidate) => candidate.decision === 'excluded',
                ),
        },
      }),
    );
    await page
      .getByRole('button', { name: '음성으로 입력', exact: true })
      .click();
    await expect(page.locator('.voice-state-listening')).toBeVisible();
    await selectVoicePlace(page, 'end', '도착');
    await expect(page.getByTestId('navigation-map')).toBeVisible();
    await finishVoiceTurn(page);
    await expect
      .poll(async () => (await routeMessages(page)).at(-1))
      .toContain(
        status === 'no_candidates'
          ? '조회된 경로가 없습니다'
          : '추천 경로가 없습니다',
      );
  });
}

test('route timeout is spoken and reconfirming the same destination retries', async ({
  page,
}) => {
  await setupVoice(page);
  await page.clock.install();
  let attempts = 0;
  await page.route('**/api/navigation/routes', (route) => {
    attempts++;
    if (attempts === 1) return;
    return route.fulfill({ json: routes });
  });
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.locator('.voice-state-listening')).toBeVisible();
  await selectVoicePlace(page, 'end', '도착');
  await expect(page.locator('.navigation-loading')).toBeVisible();
  await page.clock.fastForward(25_001);
  await expect(page.locator('.field-error')).toContainText('시간이 초과');
  await finishVoiceTurn(page);
  await expect
    .poll(async () => (await routeMessages(page)).at(-1))
    .toContain('시간이 초과');
  await selectVoicePlace(page, 'end', '도착');
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  expect(attempts).toBe(2);
});

test('spoken candidate selection keeps details folded and needs no candidate click', async ({
  page,
}) => {
  await setupVoice(page);
  const places = [
    {
      ...end,
      id: 'first-place',
      name: '서울숲 첫 번째 입구',
      address: '서울 성동구 성수동1가 1',
      inServiceArea: true,
    },
    {
      ...end,
      id: 'second-place',
      name: '서울숲 두 번째 입구',
      address: '서울 성동구 성수동1가 2',
      inServiceArea: true,
    },
  ];
  await page.route('**/api/navigation/search?*', (route) =>
    route.fulfill({ json: { places } }),
  );
  const requests: unknown[] = [];
  await page.route('**/api/navigation/routes', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: routes });
  });
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.locator('.voice-state-listening')).toBeVisible();
  const search = await callTool(page, 'spoken-search', 'search_places', {
    target: 'end',
    query: '서울숲',
  });
  expect(
    search.places.map((place: { number: number }) => place.number),
  ).toEqual([1, 2]);
  const details = page.locator('.voice-place-details');
  await expect(details.locator('summary')).toBeVisible();
  await expect(details).not.toHaveAttribute('open');
  await expect(details.getByText(places[1].address)).not.toBeVisible();
  await expect(details.getByRole('button')).toHaveCount(0);
  expect(requests).toHaveLength(0);

  // Optional read-only disclosure remains keyboard accessible at narrow widths.
  await page.setViewportSize({ width: 320, height: 900 });
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details.getByText(places[1].address)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(details).not.toHaveAttribute('open');

  await emit(page, {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'second',
    transcript: '두 번째로 해 줘',
  });
  expect(
    await callTool(page, 'spoken-select', 'select_place', {
      target: 'end',
      place_id: search.places[1].place_id,
    }),
  ).toMatchObject({ selected: true });
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  expect(requests).toEqual([
    {
      start: { ...start, name: '현재 위치' },
      end: { name: places[1].name, lat: end.lat, lon: end.lon },
    },
  ]);
  await expect(details).toHaveCount(0);

  // A spoken correction invalidates the previous IDs and starts with folded details.
  await page.route('**/api/navigation/search?*', (route) =>
    route.fulfill({
      json: { places: [{ ...places[0], id: 'corrected-place' }] },
    }),
  );
  await callTool(page, 'correction-search', 'search_places', {
    target: 'end',
    query: '다른 입구',
  });
  await expect(details).not.toHaveAttribute('open');
  expect(
    await callTool(page, 'stale-selection', 'select_place', {
      target: 'end',
      place_id: 'second-place',
    }),
  ).toMatchObject({ error: 'unknown_place_id' });
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '음성 종료', exact: true }).click();
});

test('spoken end-session releases microphone and connection without a button click', async ({
  page,
}) => {
  await setupVoice(page);
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.locator('.voice-state-listening')).toBeVisible();
  expect(
    await callTool(page, 'bad-end', 'end_session', { invalid: true }),
  ).toMatchObject({ error: 'invalid_arguments' });
  await expect(page.locator('.voice-state-listening')).toBeVisible();
  expect(await callTool(page, 'spoken-end', 'end_session', {})).toEqual({
    ended: true,
  });
  await expect(
    page.getByRole('button', { name: '음성으로 입력', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const { stoppedTracks, closedPeers, closedChannels } = (window as any)
        .__voiceTest;
      return { stoppedTracks, closedPeers, closedChannels };
    }),
  ).toEqual({ stoppedTracks: 1, closedPeers: 1, closedChannels: 1 });
});

test('voice tools accept only searched places and stop releases microphone', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setupVoice(page);
  const requests: unknown[] = [];
  await page.route('**/api/navigation/routes', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: routes });
  });
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.getByText(/듣고 있어요/).first()).toBeVisible();
  const invalid = await callTool(page, 'unknown', 'select_place', {
    target: 'end',
    place_id: 'made-up-place',
  });
  expect(invalid.selected).not.toBe(true);
  expect(requests).toHaveLength(0);
  expect((await selectVoicePlace(page, 'start', '출발')).selected).toBe(true);
  expect((await selectVoicePlace(page, 'end', '도착')).selected).toBe(true);
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  expect(requests).toEqual([{ start, end }]);
  await emit(page, {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'spoken',
    transcript: '출발에서 도착으로 갈래',
  });
  await emit(page, {
    type: 'response.output_audio_transcript.done',
    item_id: 'answer',
    transcript: '출발지와 도착지를 설정했어요.',
  });
  await page.getByText('대화 내용 보기', { exact: true }).click();
  await expect(
    page.getByText('출발에서 도착으로 갈래', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('출발지와 도착지를 설정했어요.', { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '음성 종료', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '음성으로 입력', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const { microphoneRequests, stoppedTracks, closedPeers, closedChannels } =
        (window as any).__voiceTest;
      return { microphoneRequests, stoppedTracks, closedPeers, closedChannels };
    }),
  ).toEqual({
    microphoneRequests: 1,
    stoppedTracks: 1,
    closedPeers: 1,
    closedChannels: 1,
  });
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  expect(errors).toEqual([]);
});

test('denied microphone permission displays error and retry button without fabricated routes', async ({
  page,
}) => {
  await setupVoice(page, true);
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    '마이크 사용이 허용되지 않았어요',
  );
  await expect(
    page.getByRole('button', { name: '음성으로 입력', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('navigation-map')).not.toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__voiceTest.closedPeers),
  ).toBe(1);
});

test('destination-only voice uses current location and reveals a route exactly once without manual submission', async ({
  page,
}) => {
  await setupVoice(page);
  const requests: unknown[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/navigation/routes', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: routes });
  });
  await expect(page.getByTestId('navigation-map')).not.toBeVisible();
  await expect(page.getByTestId('live-motion')).not.toBeVisible();
  await expect(page.getByLabel('출발지', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__locationRequests)).toBe(0);
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.getByText(/듣고 있어요/).first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).__locationRequests)).toBe(1);
  await emit(page, {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'destination-only',
    transcript: '서울숲으로 갈래',
  });
  expect((await selectVoicePlace(page, 'end', '서울숲')).selected).toBe(true);
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  await expect(page.getByTestId('live-motion')).toBeVisible();
  expect(requests).toEqual([{ start: { ...start, name: '현재 위치' }, end }]);
  expect((await selectVoicePlace(page, 'end', '서울숲')).selected).toBe(true);
  await page.waitForTimeout(300);
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '음성 종료', exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).__voiceTest.stoppedTracks),
  ).toBe(1);
  expect(errors).toEqual([]);
});

test('denied current location permits an explicit spoken departure', async ({
  page,
}) => {
  await setupVoice(page, false, true);
  const requests: unknown[] = [];
  await page.route('**/api/navigation/routes', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: routes });
  });
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    '위치 사용이 허용되지 않았어요',
  );
  expect(requests).toHaveLength(0);
  await selectVoicePlace(page, 'start', '출발');
  await selectVoicePlace(page, 'end', '도착');
  await expect(page.getByTestId('navigation-map')).toBeVisible();
  expect(requests).toEqual([{ start, end }]);
});

test('missing server key never requests microphone access', async ({
  page,
}) => {
  await setupVoice(page);
  await page.route('**/api/navigation/voice/status', (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'API 키가 아직 설정되지 않았어요',
  );
  expect(
    await page.evaluate(() => (window as any).__voiceTest.microphoneRequests),
  ).toBe(0);
});

test('changing a spoken endpoint invalidates a late initial route response', async ({
  page,
}) => {
  await setupVoice(page);
  let pending: import('@playwright/test').Route | undefined;
  await page.route('**/api/navigation/routes', (route) => {
    pending = route;
  });
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.getByText(/듣고 있어요/).first()).toBeVisible();
  await selectVoicePlace(page, 'end', '도착');
  await expect.poll(() => Boolean(pending)).toBe(true);
  // Setting departure equal to destination invalidates the old trip, with no
  // replacement route possible until the user supplies a distinct endpoint.
  await selectVoicePlace(page, 'start', '도착');
  await pending!.fulfill({ json: routes });
  await page.waitForTimeout(200);
  await expect(page.getByTestId('navigation-map')).not.toBeVisible();
  await expect(page.getByTestId('live-motion')).not.toBeVisible();
  await expect(page.locator('.navigation-candidate')).toHaveCount(0);
  await finishVoiceTurn(page);
  await expect
    .poll(() => routeMessages(page))
    .toEqual([expect.stringContaining('출발지와 도착지가 같아서')]);
});

test('browser audio analyser reads both generated input and remote streams and releases them', async ({
  page,
}) => {
  await setupVoice(page);
  // Generated test tones only: no microphone, OpenAI call, or audible output.
  await page.evaluate(async () => {
    const modulePath = '/src/navigation/audioLevels.ts';
    const { createAudioLevels } = await import(modulePath);
    const context = new AudioContext();
    await context.resume();
    const makeTone = (frequency: number) => {
      const tone = context.createOscillator();
      tone.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = 0.12;
      const target = context.createMediaStreamDestination();
      tone.connect(gain).connect(target);
      tone.start();
      return { tone, target };
    };
    const input = makeTone(220);
    const output = makeTone(440);
    const levels = { current: { input: 0, output: 0 } };
    const meter = createAudioLevels(levels);
    meter.bind('input', input.target.stream);
    meter.bind('output', output.target.stream);
    Object.assign(window, {
      __audioParticleTest: { levels, meter, context, input, output },
    });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__audioParticleTest.levels.current.input,
      ),
    )
    .toBeGreaterThan(0.1);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__audioParticleTest.levels.current.output,
      ),
    )
    .toBeGreaterThan(0.1);
  await page.evaluate(() =>
    (window as any).__audioParticleTest.input.tone.stop(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__audioParticleTest.levels.current.input,
      ),
    )
    .toBeLessThan(0.005);
  expect(
    await page.evaluate(
      () => (window as any).__audioParticleTest.levels.current.output,
    ),
  ).toBeGreaterThan(0.1);
  await page.evaluate(async () => {
    const { meter, output, input, context } = (window as any)
      .__audioParticleTest;
    meter.close();
    output.tone.stop();
    [
      ...input.target.stream.getTracks(),
      ...output.target.stream.getTracks(),
    ].forEach((track) => track.stop());
    await context.close();
  });
  expect(
    await page.evaluate(
      () => (window as any).__audioParticleTest.levels.current,
    ),
  ).toEqual({ input: 0, output: 0 });
});
