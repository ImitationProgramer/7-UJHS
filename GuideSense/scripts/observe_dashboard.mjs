// Read-only observation of the real-device dashboard. Never sends test frames.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const report = {
  source: 'Browser at localhost:5173, real API port 8000; no synthetic frames',
  connectedSeen: false,
  gpsDisplayed: false,
  accuracyDisplayed: false,
  motionDisplayChanges: { accelerometer: 0, gyroscope: 0 },
  disconnectedAfterConnected: false,
  valuesClearedAfterDisconnect: false,
  errors: [],
};
page.on('pageerror', (error) => report.errors.push(error.message));
await page.goto('http://localhost:5173');
let previous = {};
let lastLog = 0;
try {
  for (;;) {
    const view = await page.evaluate(() => ({
      connected:
        document.querySelector('.device-state')?.textContent === 'CONNECTED',
      accelerometer: document.querySelector('[data-testid="accelerometer-x"]')
        ?.textContent,
      gyroscope: document.querySelector('[data-testid="gyroscope-z"]')
        ?.textContent,
      latitude: document.querySelector('[data-testid="latitude"]')?.textContent,
      accuracy: document.querySelector('[data-testid="accuracy"]')?.textContent,
    }));
    if (view.connected) {
      report.connectedSeen = true;
      report.gpsDisplayed ||= Boolean(view.latitude && view.latitude !== '—');
      report.accuracyDisplayed ||= Boolean(
        view.accuracy && !view.accuracy.includes('—'),
      );
      for (const key of ['accelerometer', 'gyroscope']) {
        if (
          previous[key] &&
          previous[key] !== '—' &&
          view[key] !== '—' &&
          previous[key] !== view[key]
        ) {
          report.motionDisplayChanges[key]++;
        }
        previous[key] = view[key];
      }
    } else if (report.connectedSeen) {
      report.disconnectedAfterConnected = true;
      report.valuesClearedAfterDisconnect =
        view.accelerometer === '—' &&
        view.gyroscope === '—' &&
        view.latitude === '—';
    }
    await writeFile(
      'artifacts/dashboard-observation.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    if (Date.now() - lastLog > 15000) {
      console.log(JSON.stringify(report));
      lastLog = Date.now();
    }
    await page.waitForTimeout(200);
  }
} finally {
  await browser.close();
}
