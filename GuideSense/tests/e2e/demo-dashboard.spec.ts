import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setup, choosePlaces } from './fixtures/navigation-page';
import { routes } from './fixtures/navigation';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 320, height: 900 },
]) {
  test(`voice-first demo reveals map then movement below it at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page);
    await expect(
      page.getByRole('button', { name: '음성으로 입력', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('출발지', { exact: true })).toHaveCount(0);
    await expect(page.getByText('직접 설정', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('도착지', { exact: true })).not.toBeVisible();
    await expect(page.getByTestId('navigation-map')).not.toBeVisible();
    await expect(page.getByTestId('live-motion')).not.toBeVisible();
    await page.screenshot({
      path: `artifacts/navigation-live/voice-stage-initial-${viewport.width}.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.route('**/api/navigation/routes', (route) =>
      route.fulfill({ json: routes }),
    );
    await choosePlaces(page);
    await expect(page.locator('.voice-stage')).toHaveClass(/has-journey/);
    await expect(page.getByTestId('navigation-map')).toBeVisible();
    await expect(page.getByTestId('live-motion')).toBeVisible();
    await expect(page.getByLabel('연결할 데이터')).toHaveValue('live');
    await expect(page.getByTestId('companion-predicted')).toHaveCount(0);
    await expect(page.locator('.demo-route-column')).toHaveCSS('opacity', '1');
    await expect(page.locator('.demo-telemetry')).toHaveCSS('opacity', '1');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = document
            .querySelector('[data-testid="navigation-map"]')!
            .getBoundingClientRect();
          const data = document
            .querySelector('.demo-telemetry')!
            .getBoundingClientRect();
          return data.top >= map.bottom;
        }),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `artifacts/navigation-live/voice-stage-${viewport.width}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test('route and telemetry use staggered S-curve movement, with reduced motion respected', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/navigation/routes', (route) =>
    route.fulfill({ json: routes }),
  );
  await choosePlaces(page);
  await expect(page.locator('.voice-stage')).toHaveClass(/has-journey/);
  const animation = await page.evaluate(() => {
    const inspect = (selector: string) => {
      const element = document.querySelector(selector)!;
      const style = getComputedStyle(element);
      return {
        name: style.animationName,
        duration: parseFloat(style.animationDuration),
        delay: parseFloat(style.animationDelay),
        easing: style.animationTimingFunction,
        keyframes: element
          .getAnimations()
          .flatMap((item) => (item.effect as KeyframeEffect).getKeyframes()),
      };
    };
    return {
      map: inspect('.demo-route-column'),
      data: inspect('.demo-telemetry'),
    };
  });
  expect(animation.map.name).not.toBe('none');
  expect(animation.map.duration).toBeGreaterThan(0.4);
  expect(animation.map.easing).toMatch(/cubic-bezier/);
  expect(animation.data.delay).toBeGreaterThan(animation.map.delay);
  expect(
    animation.map.keyframes.some(
      (frame) =>
        typeof frame.transform === 'string' &&
        frame.transform.includes('translate'),
    ),
  ).toBe(true);
  expect(
    animation.map.keyframes.some((frame) => Number(frame.opacity) === 0),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const selector of ['.demo-route-column', '.demo-telemetry']) {
    const motion = await page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        duration: parseFloat(style.animationDuration),
        delay: parseFloat(style.animationDelay),
      };
    });
    expect(motion.duration).toBeLessThanOrEqual(0.01);
    expect(motion.delay).toBeLessThanOrEqual(0.01);
  }
});

test('particle cloud animates without intercepting voice input and becomes static for reduced motion', async ({
  page,
}) => {
  await setup(page);
  const cloud = page.locator('canvas.voice-particles');
  await expect(cloud).toHaveAttribute('aria-hidden', 'true');
  expect(
    await cloud.evaluate((element) => getComputedStyle(element).pointerEvents),
  ).toBe('none');
  const snapshot = () =>
    cloud.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  const first = await snapshot();
  await expect.poll(snapshot).not.toBe(first);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const still = await snapshot();
  await page.waitForTimeout(200);
  expect(await snapshot()).toBe(still);
  await page
    .getByRole('button', { name: '음성으로 입력', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '음성 종료', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '음성 종료', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(snapshot).not.toBe(still);
});

test('hover grows the cloud control without introducing a grey button disc', async ({
  page,
}) => {
  await setup(page);
  const button = page.getByRole('button', {
    name: '음성으로 입력',
    exact: true,
  });
  await page.mouse.move(0, 0);
  const resting = await button.boundingBox();
  expect(resting).not.toBeNull();
  await button.hover();
  await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(button).toHaveCSS('box-shadow', 'none');
  await expect
    .poll(async () => (await button.boundingBox())!.width)
    .toBeGreaterThan(resting!.width * 1.02);
  await page.screenshot({
    path: 'artifacts/navigation-live/voice-fluid-hover.png',
    fullPage: true,
  });
  await page.mouse.move(0, 0);
  await expect
    .poll(async () =>
      Math.abs((await button.boundingBox())!.width - resting!.width),
    )
    .toBeLessThan(1);
});
