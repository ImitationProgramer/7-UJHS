import { test, expect, type Page, type Route } from '@playwright/test';
import { existsSync } from 'node:fs';
import {
  setup,
  choosePlaces,
  changeDeparture,
  openRouteEvidence,
} from './fixtures/navigation-page';
import { eligible, end, routes, start } from './fixtures/navigation';

const ready =
  existsSync('artifacts/goal4/replay-transition/manifest.json') &&
  existsSync('artifacts/goal3/model/model.joblib');
const reviewedRoutes = {
  ...routes,
  requestId: 'synthetic-remaining-route',
  candidates: [
    { ...eligible, id: 'review-only', distanceM: 177, durationS: 120 },
  ],
  recommendedId: 'review-only',
};
type RouteRequest = { start: typeof start; end: typeof end };

async function beginCompanion(page: Page) {
  await choosePlaces(page);
  await openRouteEvidence(page);
  await page.getByLabel('연결할 데이터').selectOption('replay');
  await expect(
    page.getByRole('button', { name: '동행 재생', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '동행 재생', exact: true }).click();
}

test('real replay rechecks from the simulated current point without replacing the preview', async ({
  page,
}) => {
  test.skip(!ready, 'Trusted canine model/replay assets required');
  await setup(page);
  const requests: RouteRequest[] = [];
  await page.route('**/api/navigation/routes', (route) => {
    requests.push(route.request().postDataJSON() as RouteRequest);
    return route.fulfill({
      json: requests.length === 1 ? routes : reviewedRoutes,
    });
  });
  await beginCompanion(page);
  const review = page.getByRole('region', { name: '이동 중 경로 재검토' });
  await expect(review).toContainText('시설 기준 추천 후보는 177m', {
    timeout: 10000,
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual({ start, end });
  expect(requests[1].end).toEqual(end);
  expect(requests[1].start.name).toBe('Replay 가상 현재 위치');
  expect(requests[1].start.lat).toBeGreaterThan(start.lat);
  expect(requests[1].start.lat).toBeLessThan(end.lat);
  expect(requests[1].start.lon).toBeGreaterThan(start.lon);
  expect(requests[1].start.lon).toBeLessThan(end.lon);
  await expect(review).toContainText(
    '행동에 따른 위험 가중치는 적용하지 않았습니다',
  );
  await expect(
    page.locator('.navigation-candidate-select[aria-pressed="true"]'),
  ).toContainText(/250\s*m/);
  await expect(page.locator('.navigation-candidate')).toHaveCount(2);
  await page
    .getByRole('button', { name: '동행 일시정지', exact: true })
    .click();
});

for (const interruption of ['pause', 'edit'] as const) {
  test(`pending replay route review ignores a late response after ${interruption}`, async ({
    page,
  }) => {
    test.skip(!ready, 'Trusted canine model/replay assets required');
    await setup(page);
    let requestCount = 0;
    let pending: Route | undefined;
    await page.route('**/api/navigation/routes', async (route) => {
      requestCount++;
      if (requestCount === 1) await route.fulfill({ json: routes });
      else pending = route;
    });
    await beginCompanion(page);
    const review = page.getByRole('region', { name: '이동 중 경로 재검토' });
    await expect
      .poll(() => pending !== undefined, { timeout: 10000 })
      .toBe(true);
    await expect(review.getByRole('status')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    if (interruption === 'pause') {
      await page
        .getByRole('button', { name: '동행 일시정지', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: '동행 계속', exact: true }),
      ).toBeVisible();
      await expect(review.getByRole('status')).toHaveAttribute(
        'aria-busy',
        'false',
      );
    } else {
      await changeDeparture(page);
      await expect(review).toHaveCount(0);
    }
    await pending!.fulfill({ json: reviewedRoutes });
    // Let the rejected/aborted response and React updates settle before checking
    // that stale review results cannot repopulate the current journey.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByText(/시설 기준 추천 후보는 177m/)).toHaveCount(0);
    if (interruption === 'pause') {
      await expect(
        page.locator('.navigation-candidate-select[aria-pressed="true"]'),
      ).toContainText(/250\s*m/);
    } else {
      await expect(page.locator('.navigation-candidate')).toHaveCount(0);
    }
  });
}
