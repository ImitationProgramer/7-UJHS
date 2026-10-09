import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setup, choosePlaces } from './fixtures/navigation-page';
import { routes } from './fixtures/navigation';

test('phone stream reaches navigation graph and disconnect clears stale values', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/navigation/routes', (route) =>
    route.fulfill({ json: routes }),
  );
  await choosePlaces(page);
  await expect(page.getByLabel('연결할 데이터')).toHaveValue('live');
  await page.evaluate(async () => {
    const socket = new WebSocket('ws://127.0.0.1:8001/ws/device');
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = reject;
    });
    const state = { socket, timer: 0 };
    (window as any).testPhone = state;
    state.timer = window.setInterval(() => {
      const timestamp = Date.now();
      socket.send(
        JSON.stringify({
          type: 'sensor_frame',
          deviceId: 'synthetic-phone-navigation',
          timestamp,
          accelerometer: { x: 0.1, y: 0.2, z: 0.9, timestamp },
          gyroscope: { x: 0.2, y: 0.3, z: 0.1, timestamp },
          location: null,
          sensorStatus: {
            accelerometer: 'ready',
            gyroscope: 'ready',
            location: 'denied',
          },
        }),
      );
    }, 50);
  });
  const graph = page.locator('.live-companion .trace.accelerometer');
  await expect
    .poll(async () => (await graph.getAttribute('points'))?.length ?? 0)
    .toBeGreaterThan(50);
  await expect(page.getByTestId('live-device-id')).toHaveText(
    'synthetic-phone-navigation',
  );
  await expect(page.getByTestId('live-device-status')).toHaveText(
    '휴대폰 연결됨',
  );
  await page.getByRole('button', { name: '이동 시작', exact: true }).click();
  await expect(page.getByTestId('navigation-panel')).toHaveClass(
    /is-immersive/,
  );
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const before = await graph.getAttribute('points');
  await expect.poll(() => graph.getAttribute('points')).not.toBe(before);
  await page.setViewportSize({ width: 320, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/navigation-live/phone-graph-test.png',
    fullPage: true,
  });
  await page.evaluate(() => {
    clearInterval((window as any).testPhone.timer);
    (window as any).testPhone.socket.close();
  });
  await expect(graph).toHaveAttribute('points', '', { timeout: 6000 });
});
