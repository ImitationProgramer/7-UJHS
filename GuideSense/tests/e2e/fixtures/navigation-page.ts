import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { start, end } from './navigation';
import {
  mockVoice,
  mockLocation,
  mockVoiceEndpoints,
  selectVoicePlace,
} from './voice-page';

const boundary = JSON.parse(
  readFileSync('data/navigation/seongdong.geojson', 'utf8'),
);
export async function setup(page: Page, configured = true, voice = true) {
  // Deterministic local test: don't request public map tiles during automation.
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.route('**/api/navigation/metadata', (route) =>
    route.fulfill({
      json: {
        boundary,
        dataDate: '2022-12-15',
        crosswalkCount: 987,
        keyConfigured: configured,
        policy: {
          version: 'test-v1',
          weights: { audibleSignal: 300, curbRamp: 150, tactilePaving: 100 },
        },
        limitations: ['합성 API 응답으로 UI 동작을 확인하는 테스트입니다.'],
      },
    }),
  );
  await page.route('**/api/navigation/search?*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    const point = q?.includes('출발') ? start : end;
    return route.fulfill({
      json: {
        places: [
          {
            ...point,
            id: point.name,
            address: '서울특별시 성동구 테스트 주소',
            inServiceArea: true,
          },
        ],
      },
    });
  });
  if (voice) {
    await mockVoice(page);
    await mockLocation(page);
    await mockVoiceEndpoints(page);
  }
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '음성으로 입력', exact: true }),
  ).toBeVisible();
}
export async function choosePlaces(page: Page) {
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(page.getByText(/듣고 있어요/).first()).toBeVisible();
  await selectVoicePlace(page, 'start', '출발');
  await selectVoicePlace(page, 'end', '도착');
}
export async function changeDeparture(page: Page) {
  await selectVoicePlace(page, 'start', '다른 위치');
}

export async function openRouteEvidence(page: Page) {
  const details = page.locator('.voice-route-evidence');
  await expect(details).toBeVisible();
  if ((await details.getAttribute('open')) === null) {
    await details.locator('summary').first().click();
  }
}
