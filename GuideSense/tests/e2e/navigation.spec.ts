import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  setup,
  choosePlaces,
  changeDeparture,
  openRouteEvidence,
} from './fixtures/navigation-page';
import { start, end, routes, excluded } from './fixtures/navigation';
import { selectVoicePlace } from './fixtures/voice-page';

test('search → facilities comparison → simulation, endpoint edits clear stale results; 320px and accessibility', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let requestBody: unknown;
  await setup(page);
  await page.route('**/api/navigation/routes', (route) => {
    requestBody = route.request().postDataJSON();
    return route.fulfill({ json: routes });
  });
  await choosePlaces(page);
  await openRouteEvidence(page);
  await expect(
    page.getByRole('heading', { name: '시설 데이터 기준 추천' }),
  ).toBeVisible();
  expect(requestBody).toEqual({ start, end });
  await expect(page.getByText(excluded.reason, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /경로 2 추천/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '이동 시작', exact: true }).click();
  await expect
    .poll(() => page.locator('#navigation-progress').getAttribute('value'))
    .not.toBe('0');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.screenshot({
    path: 'artifacts/navigation-comparison.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '전체 화면 나가기' }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = document
          .querySelector('[data-testid="navigation-map"]')!
          .getBoundingClientRect();
        const preview = document
          .querySelector('.navigation-simulation')!
          .getBoundingClientRect();
        const markers = [...document.querySelectorAll('.navigation-pin')];
        return (
          markers.length === 2 &&
          markers.every((marker) => {
            const box = marker.getBoundingClientRect();
            return (
              box.left >= map.left &&
              box.right <= map.right &&
              box.top >= map.top &&
              box.bottom <= map.bottom &&
              map.bottom <= preview.top
            );
          })
        );
      }),
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/navigation-320.png',
    fullPage: true,
  });
  await changeDeparture(page);
  await expect(
    page.getByRole('heading', { name: '시설 데이터 기준 추천' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '이동 시작', exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('excluded-only result never offers simulation; request error does not retain prior result', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/navigation/routes', (route) =>
    route.fulfill({
      json: {
        ...routes,
        status: 'no_eligible_route',
        recommendedId: null,
        candidates: [excluded],
      },
    }),
  );
  await choosePlaces(page);
  await openRouteEvidence(page);
  await expect(
    page.getByRole('heading', { name: '조건을 확인한 추천 경로가 없어요' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '이동 시작', exact: true }),
  ).toBeDisabled();
  await page.route('**/api/navigation/routes', (route) =>
    route.fulfill({
      status: 503,
      json: { detail: { message: '테스트: 경로 서비스 연결 실패' } },
    }),
  );
  await page.route('**/api/navigation/search?*', (route) =>
    route.fulfill({
      json: {
        places: [
          {
            ...end,
            name: '새 도착',
            id: 'new-end',
            address: '테스트 주소',
            inServiceArea: true,
          },
        ],
      },
    }),
  );
  await selectVoicePlace(page, 'end', '새 도착');
  await expect(page.getByText('테스트: 경로 서비스 연결 실패')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '조건을 확인한 추천 경로가 없어요' }),
  ).toHaveCount(0);
});

test('missing TMAP key displays configuration state and never fabricates a route', async ({
  page,
}) => {
  await setup(page, false);
  let requests = 0;
  await page.route('**/api/navigation/routes', (route) => {
    requests++;
    return route.fulfill({ json: routes });
  });
  await expect(page.getByText('TMAP 연결이 필요해요')).toBeVisible();
  await choosePlaces(page);
  await expect(page.getByTestId('navigation-map')).not.toBeVisible();
  expect(requests).toBe(0);
  await expect(page.locator('.navigation-candidate')).toHaveCount(0);
});

test('standalone entry and guidance dialog retain keyboard focus', async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByText('어디로 갈까요?', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'LIVE SENSOR' })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Backend 주소')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: '안내 기준', exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
