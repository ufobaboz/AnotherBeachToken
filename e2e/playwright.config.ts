import { defineConfig } from '@playwright/test';

// Default DEV: per policy le scritture da automazioni vivono solo li'.
const APP_URL = process.env.APP_URL || 'https://anotherbeachproject-dev.sovereto.workers.dev';

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalTeardown: './globalTeardown.ts',
  use: {
    baseURL: APP_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
