import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'origin.spec.ts', workers: 1, timeout: 45000,
  reporter: 'list', outputDir: '.tmp/results',
  use: { ...devices['Desktop Chrome'], ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
});
