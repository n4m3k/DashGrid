import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:18080', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm start',
    env: { PORT: '18080', DATABASE_PATH: ':memory:', DASHGRID_API_KEY: '' },
    url: 'http://127.0.0.1:18080/api/health',
    reuseExistingServer: false,
  },
});
