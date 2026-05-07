/**
 * Playwright config for Slotty's end-to-end suite.
 *
 * The E2E tests assume:
 *   - A *separate* SQLite database (the `globalSetup` script wipes and seeds
 *     it before any test runs). Configured via SLOTTY_E2E_DATABASE_URL or
 *     defaulted to `file:./tests/e2e/.tmp/slotty-e2e.db`.
 *   - A built and started production server. The webServer block below builds
 *     and starts via `bun run start`. Set `SLOTTY_E2E_REUSE_SERVER=1` to
 *     reuse a server you started yourself (useful while iterating).
 *
 * The Google API will fail because we use mock credentials and pre-seeded
 * encrypted-but-bogus tokens; tests assert that the booking is still created
 * with `needsSync=true` (the documented graceful-degradation behaviour).
 */
import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname);
const DB_URL =
  process.env.SLOTTY_E2E_DATABASE_URL ??
  `file:${resolve(ROOT, 'tests/e2e/.tmp/slotty-e2e.db')}`;

const E2E_PORT = process.env.SLOTTY_E2E_PORT ?? '3010';
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// 32 random bytes (zeros are fine — this is a throwaway test deploy).
const E2E_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
// 64 random bytes.
const E2E_SESSION_SECRET =
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/.report' }]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: resolve(__dirname, 'tests/e2e/globalSetup.ts'),
  webServer: process.env.SLOTTY_E2E_REUSE_SERVER
    ? undefined
    : {
        // We assume the build is up to date — `bun run test:e2e` runs
        // `bun run build` before invoking Playwright.
        command: `bun run start --port ${E2E_PORT}`,
        url: `${E2E_BASE_URL}/api/health`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
          PORT: E2E_PORT,
          SLOTTY_PUBLIC_URL: E2E_BASE_URL,
          SLOTTY_ENCRYPTION_KEY: E2E_ENCRYPTION_KEY,
          SLOTTY_SESSION_SECRET: E2E_SESSION_SECRET,
          SLOTTY_DATABASE_URL: DB_URL,
          SLOTTY_TRUST_PROXY: 'false',
          SLOTTY_LOG_LEVEL: 'warn',
          SLOTTY_GOOGLE_CLIENT_ID: 'test-client-id',
          SLOTTY_GOOGLE_CLIENT_SECRET: 'test-client-secret',
        },
      },
});

// Re-exported so the seed script and test files can pick up the same values.
export const E2E_CONFIG = {
  baseUrl: E2E_BASE_URL,
  databaseUrl: DB_URL,
  encryptionKey: E2E_ENCRYPTION_KEY,
  sessionSecret: E2E_SESSION_SECRET,
  port: E2E_PORT,
  adminUsername: 'admin',
  adminPassword: 'TestPassword!2026',
};
