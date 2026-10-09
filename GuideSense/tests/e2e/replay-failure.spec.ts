import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

test('missing artifact, invalid sensor schema, actual API shutdown and recovery', async ({
  page,
}) => {
  test.skip(
    !existsSync('artifacts/goal3/model/model.joblib'),
    'Local model required',
  );
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const temp = mkdtempSync(join(tmpdir(), 'guidesense-replay-e2e-'));
  const clip = join(temp, 'clip');
  let server: ChildProcess | undefined;
  const start = async () => {
    server = spawn(
      'services/api/.venv/bin/python',
      [
        '-c',
        'import os,uvicorn; from pathlib import Path; from guidesense_api.main import create_app; uvicorn.run(create_app(replay_clips={"dog22-demo":Path(os.environ["REPLAY_TEST_CLIP"])}),host="127.0.0.1",port=8002,log_level="warning")',
      ],
      {
        env: {
          ...process.env,
          PYTHONPATH: resolve('services/api'),
          REPLAY_TEST_CLIP: clip,
        },
        stdio: 'ignore',
      },
    );
    await expect
      .poll(async () => {
        try {
          return (await fetch('http://127.0.0.1:8002/health')).ok;
        } catch {
          return false;
        }
      })
      .toBe(true);
  };
  const stop = async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise<void>((done) =>
        server!.once('exit', () => done()),
      );
      server.kill('SIGTERM');
      await exited;
    }
  };
  const restore = () =>
    cpSync('artifacts/goal3/replay-demo', clip, { recursive: true });
  try {
    await start();
    await page.goto('/diagnostics');
    await page.getByLabel('Backend 주소').fill('http://127.0.0.1:8002');
    await page.getByRole('button', { name: '연결 적용' }).click();
    await page
      .getByRole('button', { name: 'DATASET REPLAY', exact: true })
      .click();
    await page.getByRole('button', { name: '▶ Play', exact: true }).click();
    await expect(page.getByText('ERROR', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Replay 또는 모델 파일이 없습니다/),
    ).toBeVisible();
    restore();
    await page.getByRole('button', { name: '▶ Play', exact: true }).click();
    await expect(page.getByTestId('predicted-label')).toHaveText('Walking', {
      timeout: 6000,
    });
    await page.getByRole('button', { name: '■ Stop' }).click();
    await expect(page.getByTestId('predicted-label')).toHaveText('—');
    const file = join(clip, 'samples.jsonl');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const bad = JSON.parse(lines[0]);
    bad.accelerometer.extra_axis = 1;
    lines[0] = JSON.stringify(bad);
    writeFileSync(file, lines.join('\n') + '\n');
    const manifestFile = join(clip, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    manifest.files['samples.jsonl'] = createHash('sha256')
      .update(readFileSync(file))
      .digest('hex');
    writeFileSync(manifestFile, JSON.stringify(manifest));
    await page.getByRole('button', { name: '▶ Play', exact: true }).click();
    await expect(page.getByText('ERROR', { exact: true })).toBeVisible();
    await expect(page.getByText(/Invalid replay sensor schema/)).toBeVisible();
    await expect(page.getByTestId('predicted-label')).toHaveText('—');
    await page.screenshot({
      path: 'artifacts/goal4/dashboard-schema-error.png',
      fullPage: true,
    });
    restore();
    await page.getByRole('button', { name: '▶ Play', exact: true }).click();
    await expect(page.getByTestId('predicted-label')).toHaveText('Walking', {
      timeout: 6000,
    });
    await stop();
    await expect(page.getByText('UNAVAILABLE', { exact: true })).toBeVisible();
    await expect(page.getByTestId('predicted-label')).toHaveText('—');
    await expect(page.getByTestId('accelerometer-x')).toHaveText('—');
    await start();
    await expect(page.getByText('IDLE', { exact: true })).toBeVisible({
      timeout: 12000,
    });
    await expect(page.getByTestId('predicted-label')).toHaveText('—');
    await page.getByRole('button', { name: '▶ Play', exact: true }).click();
    await expect(page.getByTestId('predicted-label')).toHaveText('Walking', {
      timeout: 6000,
    });
    expect(errors).toEqual([]);
  } finally {
    await stop();
    rmSync(temp, { recursive: true, force: true });
  }
});
