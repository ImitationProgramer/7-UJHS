import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1280, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command:
        'services/api/.venv/bin/uvicorn guidesense_api.main:app --app-dir services/api --host 127.0.0.1 --port 8001 --ws-max-size 16384',
      url: 'http://127.0.0.1:8001/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev --workspace @guidesense/dashboard -- --port 5174',
      url: 'http://127.0.0.1:5174',
      env: { VITE_BACKEND_URL: 'http://127.0.0.1:8001' },
      reuseExistingServer: false,
    },
  ],
});
