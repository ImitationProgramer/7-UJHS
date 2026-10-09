import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync } from 'node:fs';
const hasReplay =
  existsSync('artifacts/goal3/replay-demo/manifest.json') &&
  existsSync('artifacts/goal3/model/model.joblib');

test('actual canine artifact → saved model → controls, completion and independent dashboards', async ({
  page,
  context,
}) => {
  test.skip(!hasReplay, 'Local canine/model artifacts required');
  test.setTimeout(65000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/diagnostics');
  await page
    .getByRole('button', { name: 'DATASET REPLAY', exact: true })
    .click();
  await expect(page.getByText('IDLE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.getByText('PLAYING', { exact: true })).toBeVisible();
  await expect(page.getByTestId('predicted-label')).toHaveText('—');
  await expect(page.getByTestId('predicted-label')).toHaveText('Walking', {
    timeout: 6000,
  });
  await expect(page.getByTestId('actual-label')).toHaveText('Walking');
  await expect(page.getByTestId('brooch-output')).toContainText('걷기');
  await expect(
    page.getByRole('img', { name: /Acceleration magnitude/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: '⏸ Pause' }).click();
  await expect(page.getByText('PAUSED', { exact: true })).toBeVisible();
  const frozen = await page.getByTestId('replay-time').textContent();
  const count = await page.getByTestId('analysis-count').textContent();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('replay-time')).toHaveText(frozen!);
  await expect(page.getByTestId('analysis-count')).toHaveText(count!);
  await page.screenshot({
    path: 'artifacts/goal4/dashboard-replay.png',
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const other = await context.newPage();
  await other.goto('/diagnostics');
  await other
    .getByRole('button', { name: 'DATASET REPLAY', exact: true })
    .click();
  await expect(other.getByText('IDLE', { exact: true })).toBeVisible();
  await other.close();
  await page.getByRole('button', { name: '▶ Resume', exact: true }).click();
  await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible({
    timeout: 35000,
  });
  await expect(page.getByTestId('analysis-count')).toHaveText('10');
  await expect(page.getByTestId('replay-time')).toHaveText('30.0 / 30.0 s');
  await expect(page.getByTestId('accelerometer-x')).toHaveText('—');
  await expect(page.getByTestId('actual-label')).toHaveText('—');
  await expect(page.getByTestId('predicted-label')).toHaveText('Walking');
  await page.screenshot({
    path: 'artifacts/goal4/dashboard-completed.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '↻ Restart' }).click();
  await expect(page.getByTestId('analysis-count')).toHaveText('0');
  await expect(page.getByTestId('predicted-label')).toHaveText('—');
  await page.getByRole('button', { name: '■ Stop' }).click();
  await expect(page.getByText('STOPPED', { exact: true })).toBeVisible();
  await expect(page.getByTestId('brooch-output')).toContainText('기다립니다');
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.getByText('PLAYING', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'LIVE SENSOR', exact: true }).click();
  await expect(page.getByTestId('latitude')).toHaveText('—');
  await expect(page.getByTestId('accelerometer-x')).toHaveText('—');
  await page
    .getByRole('button', { name: 'DATASET REPLAY', exact: true })
    .click();
  await expect(page.getByText('IDLE', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('recorded transition clip, keyboard/native select, narrow layout', async ({
  page,
}) => {
  test.skip(
    !hasReplay ||
      !existsSync('artifacts/goal4/replay-transition/manifest.json'),
    'Transition artifact required',
  );
  test.setTimeout(45000);
  await page.goto('/diagnostics');
  const mode = page.getByRole('button', {
    name: 'DATASET REPLAY',
    exact: true,
  });
  await mode.focus();
  await page.keyboard.press('Enter');
  const select = page.getByLabel('Recorded clip');
  await expect(select).toBeEnabled();
  await select.focus();
  await page.keyboard.press('Space');
  await page.screenshot({
    path: 'artifacts/goal4/clip-select-open.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await select.selectOption('dog45-transition');
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.getByText('PLAYING', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByTestId('predicted-label')).toHaveText('Walking', {
    timeout: 6000,
  });
  await page.screenshot({
    path: 'artifacts/goal4/dashboard-replay-narrow.png',
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible({
    timeout: 35000,
  });
  await expect(page.getByTestId('actual-label')).toHaveText('Sitting');
  await expect(page.getByTestId('predicted-label')).toHaveText('Sitting');
  await expect(page.getByTestId('brooch-output')).toContainText('앉기');
});

test('real posture misclassification stays visible and brooch follows prediction', async ({
  page,
}) => {
  test.skip(
    !hasReplay || !existsSync('artifacts/goal4/replay-posture/manifest.json'),
    'Posture artifact required',
  );
  await page.goto('/diagnostics');
  await page
    .getByRole('button', { name: 'DATASET REPLAY', exact: true })
    .click();
  await page.getByLabel('Recorded clip').selectOption('dog44-posture');
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.getByTestId('actual-label')).toHaveText('Lying chest', {
    timeout: 6000,
  });
  await expect(page.getByTestId('predicted-label')).toHaveText('Sitting');
  await expect(page.getByTestId('comparison')).toHaveText('불일치 · MISMATCH');
  await expect(page.getByTestId('brooch-output')).toContainText('앉기');
  await page.getByRole('button', { name: '⏸ Pause' }).click();
  await expect(page.getByText('PAUSED', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'artifacts/goal4/dashboard-mismatch.png',
    fullPage: true,
  });
});
