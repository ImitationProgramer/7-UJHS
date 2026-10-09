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
