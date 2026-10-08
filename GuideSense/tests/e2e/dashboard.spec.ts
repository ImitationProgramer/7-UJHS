import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyFrame } from '@guidesense/protocol';

test('synthetic device → real FastAPI → browser values, GPS denial, timeout and reconnect', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('연결됨', { exact: true })).toBeVisible();
  await expect(page.getByText('DISCONNECTED', { exact: true })).toBeVisible();
  await expect(page.getByTestId('accelerometer-x')).toHaveText('—');
  await page.evaluate(async () => {
    const socket = new WebSocket('ws://127.0.0.1:8001/ws/device');
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = reject;
    });
    const state = { socket, timer: 0, x: 0.125, denied: false };
    (window as any).synthetic = state;
    state.timer = window.setInterval(() => {
      const timestamp = Date.now();
      socket.send(
        JSON.stringify({
          type: 'sensor_frame',
          deviceId: 'test-device',
          timestamp,
          accelerometer: { x: state.x, y: 0.5, z: -0.9, timestamp },
          gyroscope: { x: 1.2, y: 2.3, z: 3.4, timestamp },
          location: state.denied
            ? null
            : {
                latitude: 37.123456,
                longitude: 127.234567,
                accuracy: 4.2,
                timestamp,
              },
          sensorStatus: {
            accelerometer: 'ready',
            gyroscope: 'ready',
            location: state.denied ? 'denied' : 'ready',
          },
        }),
      );
    }, 20);
  });
  await expect(page.getByText('CONNECTED', { exact: true })).toBeVisible();
  await expect(page.getByTestId('accelerometer-x')).toHaveText('0.125');
  await expect(page.getByTestId('gyroscope-z')).toHaveText('3.400');
  await expect(page.getByTestId('latitude')).toHaveText('37.123456');
  await expect(page.getByTestId('longitude')).toHaveText('127.234567');
  await expect(page.getByTestId('accuracy')).toHaveText('4.2 m');
  await page.screenshot({
    path: 'artifacts/dashboard-connected.png',
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    (window as any).synthetic.x = -0.875;
  });
  await expect(page.getByTestId('accelerometer-x')).toHaveText('-0.875');
  await page.evaluate(() => {
    (window as any).synthetic.denied = true;
  });
  await expect(page.getByText('권한 거부', { exact: true })).toBeVisible();
  await expect(page.getByTestId('latitude')).toHaveText('—');
  await expect(page.getByText('CONNECTED', { exact: true })).toBeVisible();
  // Producer remains open but silent: stale data must not stay connected.
  await page.evaluate(() => clearInterval((window as any).synthetic.timer));
  await expect(page.getByText('DISCONNECTED', { exact: true })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByTestId('accelerometer-x')).toHaveText('—');
  await expect(page.getByTestId('received-at')).not.toHaveText(
    '아직 수신하지 않음',
  );
  await page.evaluate(() => (window as any).synthetic.socket.close());
  await page.screenshot({
    path: 'artifacts/dashboard-disconnected.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('keyboard validation, narrow layout, reduced motion and backend recovery', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByLabel('Backend 주소');
  await input.fill('not-a-url');
  await input.press('Enter');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByText('http://Mac-IP:8000 형식으로 입력하세요.'),
  ).toBeVisible();
  await input.fill('http://127.0.0.1:65530');
  await page.getByRole('button', { name: '연결 적용' }).click();
  await expect(page.getByText('연결 끊김', { exact: true })).toBeVisible();
  await expect(page.getByText('DISCONNECTED', { exact: true })).toBeVisible();
  await input.fill('http://127.0.0.1:8001');
  await input.press('Enter');
  await expect(page.getByText('연결됨', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollbarColor,
    ),
  ).not.toBe('auto');
  await expect(
    page.getByRole('heading', { name: 'User Brooch Output' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'artifacts/dashboard-narrow.png',
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('silent server heartbeat expires and dashboard reconnects automatically', async ({
  page,
}) => {
  let attempts = 0;
  await page.routeWebSocket('**/ws/dashboard', (socket) => {
    attempts++;
    const frame = emptyFrame('test-heartbeat');
    frame.accelerometer = { x: 0.5, y: 0, z: 0, timestamp: Date.now() };
    frame.sensorStatus.accelerometer = 'ready';
    socket.send(
      JSON.stringify({
        type: 'snapshot',
        deviceId: frame.deviceId,
        status: 'connected',
        lastSensorTimestamp: frame.timestamp,
        lastReceivedAt: Date.now(),
        timeoutMs: 3000,
        frame,
      }),
    );
    // Deliberately no more heartbeats; a frozen transport is not a live device.
  });
  await page.goto('/');
  await expect(page.getByText('CONNECTED', { exact: true })).toBeVisible();
  await expect(page.getByText('DISCONNECTED', { exact: true })).toBeVisible({
    timeout: 6000,
  });
  await expect(page.getByTestId('accelerometer-x')).toHaveText('—');
  await expect.poll(() => attempts).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('CONNECTED', { exact: true })).toBeVisible();
});
