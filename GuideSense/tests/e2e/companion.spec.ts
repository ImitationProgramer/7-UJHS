import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync } from 'node:fs';
import {
  setup,
  choosePlaces,
  changeDeparture,
} from './fixtures/navigation-page';
import { routes } from './fixtures/navigation';
const ready =
  existsSync('artifacts/goal4/replay-transition/manifest.json') &&
  existsSync('artifacts/goal3/model/model.joblib');

test('real canine inference follows synthetic route, final transition is retained, export/reset/320px', async ({
  page,
}) => {
  test.skip(!ready, 'Trusted canine model/replay assets required');
  test.setTimeout(65000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  await page.route('**/api/navigation/routes', (route) =>
    route.fulfill({ json: routes }),
  );
  await choosePlaces(page);
  await page.getByLabel('연결할 데이터').selectOption('replay');
  await expect(
    page.getByRole('button', { name: '동행 재생', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '동행 재생', exact: true }).click();
  await expect(page.getByTestId('companion-predicted')).toHaveText('걷기', {
    timeout: 7000,
  });
  await expect(page.getByTestId('companion-count')).toHaveText('1');
  const trace = page
    .getByTestId('companion-motion')
    .locator('.trace.accelerometer');
  await expect
    .poll(async () => (await trace.getAttribute('points'))?.length ?? 0)
    .toBeGreaterThan(100);
  await expect(page.getByTestId('companion-motion').locator('svg')).toHaveCount(
    2,
  );
  await page
    .getByRole('button', { name: '동행 일시정지', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '동행 계속', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('navigation-panel')).toHaveClass(
    /is-immersive/,
  );
  await page.screenshot({
    path: 'artifacts/navigation-live/immersive-replay.png',
  });
  await expect(page.getByLabel('공개 개 행동 기록')).not.toBeVisible();
  const time = await page.getByTestId('companion-time').textContent();
  const frozenPoints = await trace.getAttribute('points');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('companion-time')).toHaveText(time!);
  await expect(trace).toHaveAttribute('points', frozenPoints!);
  await page.setViewportSize({ width: 320, height: 900 });
  await expect
    .poll(() =>
      page
        .locator('.demo-telemetry')
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/navigation-live/immersive-replay-320.png',
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('button', { name: '동행 계속', exact: true }).click();
  await expect(page.getByTestId('companion-predicted')).toHaveText('앉기', {
    timeout: 35000,
  });
  await expect(page.getByTestId('companion-count')).toHaveText('10');
  await expect(page.getByTestId('companion-changes')).toHaveText('1');
  await expect(
    page.getByText('재생 완료 · 마지막 분석까지 반영했어요.'),
  ).toBeVisible();
  await expect(page.locator('.companion-map-event')).toHaveCount(1);
  await page.getByRole('button', { name: '전체 화면 나가기' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '기록 저장', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(exported.association).toBe(
    'simulated_by_replay_progress_not_recorded_GPS',
  );
  expect(exported.observations).toHaveLength(10);
  expect(exported.observations.at(-1)).toMatchObject({
    activity: 'Sitting',
    changed: true,
    elapsedSeconds: 30,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/companion-320.png',
    fullPage: true,
  });
  await changeDeparture(page);
  await expect(page.getByTestId('companion-count')).toHaveCount(0);
  await expect(page.locator('.companion-map-event')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('real model mismatch stays visible and exiting during restart stays outside fullscreen', async ({
  page,
}) => {
  test.skip(!ready, 'Trusted canine model/replay assets required');
  await setup(page);
  await page.route('**/api/navigation/routes', (route) =>
    route.fulfill({ json: routes }),
  );
  await choosePlaces(page);
  await page.getByLabel('연결할 데이터').selectOption('replay');
  await page.getByLabel('공개 개 행동 기록').selectOption('dog44-posture');
  await page.getByRole('button', { name: '동행 재생', exact: true }).click();
  await expect(page.getByTestId('companion-predicted')).toHaveText('앉기', {
    timeout: 7000,
  });
  await expect(page.getByTestId('companion-actual')).toHaveText(
    '가슴을 바닥에 대고 눕기',
  );
  await expect(page.getByText('분류 불일치', { exact: true })).toBeVisible();
  await expect(page.getByTestId('companion-changes')).toHaveText('0');
  // Exercise a delayed restart acknowledgement after the user has exited.
  await page.evaluate(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === 'string' && JSON.parse(data).action === 'restart') {
        window.setTimeout(() => send.call(this, data), 400);
      } else send.call(this, data);
    };
  });
  await page
    .getByRole('button', { name: '동행 처음부터', exact: true })
    .click();
  await expect(page.getByTestId('companion-count')).toHaveText('0');
  await expect(
    page.getByTestId('companion-motion').locator('.trace.accelerometer'),
  ).toHaveAttribute('points', '');
  await page.getByRole('button', { name: '전체 화면 나가기' }).click();
  await expect(
    page.getByRole('button', { name: '동행 일시정지', exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId('navigation-panel')).not.toHaveClass(
    /is-immersive/,
  );
  await page
    .getByRole('button', {
      name: '행동 연결 켜짐 · 경로만 보기로 전환',
      exact: true,
    })
    .click();
  await expect(page.getByTestId('companion-count')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '이동 시작', exact: true }),
  ).toBeEnabled();
});
