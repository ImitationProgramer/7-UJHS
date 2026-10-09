import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setup, choosePlaces } from './fixtures/navigation-page';
import { routes } from './fixtures/navigation';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 320, height: 900 },
]) {
  test(`movement fills the viewport and docks motion in the bottom third at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page);
    await page.route('**/api/navigation/routes', (route) =>
      route.fulfill({ json: routes }),
    );
    await choosePlaces(page);
    await page.getByRole('button', { name: '이동 시작', exact: true }).click();
    const main = page.getByTestId('navigation-panel');
    await expect(main).toHaveClass(/is-immersive/);
    await page.getByRole('button', { name: '일시정지', exact: true }).click();
    await expect(main).toHaveClass(/is-immersive/);
    await expect
      .poll(() =>
        page
          .locator('.demo-telemetry')
          .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
      )
      .toBe(600);
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        map: box('.navigation-map-stage'),
        dock: box('.demo-telemetry'),
        canvas: box('.voice-particles'),
      };
    });
    expect(geometry.map).toEqual({ x: 0, y: 0, ...viewport });
    expect(geometry.canvas).toEqual({ x: 0, y: 0, ...viewport });
    expect(geometry.dock.height).toBeCloseTo(300, 0);
    expect(
      (await page.locator('.navigation-simulation').boundingBox())!.height,
    ).toBeLessThan(180);
    await expect(page.getByTestId('live-motion').locator('svg')).toHaveCount(2);
    // All particles must reach the perimeter; no second orb remains over the map.
    await expect
      .poll(() =>
        page.locator('.voice-particles').evaluate((el) => {
          const canvas = el as HTMLCanvasElement;
          const { width: w, height: h } = canvas;
          const pixels = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
          const sides = [0, 0, 0, 0];
          let center = 0;
          const margin = (40 * w) / innerWidth;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              if (!pixels[(y * w + x) * 4 + 3]) continue;
              if (y < margin) sides[0]++;
              else if (y > h - margin) sides[2]++;
              else if (x < margin) sides[3]++;
              else if (x > w - margin) sides[1]++;
              else center++;
            }
          return center === 0 && sides.every((n) => n > 100);
        }),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => {
        const state = (window as any).__voiceTest;
        return [
          state.microphoneRequests,
          state.closedPeers,
          state.stoppedTracks,
        ];
      }),
    ).toEqual([1, 0, 0]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `artifacts/navigation-live/immersive-${viewport.width}.png`,
    });
    await page.getByRole('button', { name: '전체 화면 나가기' }).click();
    await expect(main).not.toHaveClass(/is-immersive/);
    await expect(
      page.getByRole('button', { name: '음성 종료', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('reduced motion draws a static perimeter and Escape restores the page', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await page.route('**/api/navigation/routes', (route) =>
    route.fulfill({ json: routes }),
  );
  await choosePlaces(page);
  await page.getByRole('button', { name: '이동 시작', exact: true }).click();
  await expect(page.getByTestId('navigation-panel')).toHaveClass(
    /is-immersive/,
  );
  const snapshot = () =>
    page
      .locator('.voice-particles')
      .evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(100);
  const first = await snapshot();
  await page.waitForTimeout(150);
  expect(await snapshot()).toBe(first);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('navigation-panel')).not.toHaveClass(
    /is-immersive/,
  );
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    'hidden',
  );
});
