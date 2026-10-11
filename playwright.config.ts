import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://localhost:8787' },
  webServer: {
    command: 'npm run build && npm run dev -- --port 8787',
    url: 'http://localhost:8787/api/status',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [
    {
      name: 'phone',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } },
    },
  ],
});
