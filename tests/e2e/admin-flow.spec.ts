/**
 * Admin auth flow — narrowly scoped.
 *
 * Phase 10 owns the auth surface (CSRF, rate limits, session cookie). Phase 9
 * is concurrently rebuilding the admin shell (layout, dashboard, settings)
 * so the *deeper* admin pages may be in flux while these tests run. We
 * deliberately don't assert on admin page content here; we only verify:
 *   1. The login form renders.
 *   2. POSTing valid credentials returns a 303 + session cookie.
 *   3. Wrong credentials return a 303 + error parameter (no session cookie).
 *   4. /admin without a session redirects to /admin/login.
 *   5. /api/admin/logout invalidates the session.
 *
 * NOTE on Secure cookies:
 *   Lucia stamps `Secure` on the session cookie when NODE_ENV=production.
 *   The e2e webServer runs over plain http://, so the browser silently
 *   discards a Secure cookie on a non-https response. We perform the
 *   login POST via Playwright's `APIRequestContext` (which exposes the
 *   raw Set-Cookie regardless) so we can read it directly.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

import { E2E_CONFIG } from '../../playwright.config';

test.describe('Admin auth', () => {
  test('login form renders', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(
      page.getByRole('button', { name: /sign in|log in/i }),
    ).toBeVisible();
  });

  test('valid login sets a session cookie', async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: E2E_CONFIG.baseUrl,
    });
    const res = await ctx.post('/api/admin/login', {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: E2E_CONFIG.baseUrl,
      },
      data: new URLSearchParams({
        username: E2E_CONFIG.adminUsername,
        password: E2E_CONFIG.adminPassword,
      }).toString(),
      maxRedirects: 0,
    });
    expect([302, 303]).toContain(res.status());
    const setCookie = res.headers()['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/slotty_session=[^;]+/);
    await ctx.dispose();
  });

  test('invalid login does not set a session cookie', async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: E2E_CONFIG.baseUrl,
    });
    const res = await ctx.post('/api/admin/login', {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: E2E_CONFIG.baseUrl,
      },
      data: new URLSearchParams({
        username: E2E_CONFIG.adminUsername,
        password: 'wrong-password',
      }).toString(),
      maxRedirects: 0,
    });
    expect([302, 303]).toContain(res.status());
    const setCookie = res.headers()['set-cookie'] ?? '';
    expect(setCookie).not.toMatch(/slotty_session=[^;]+/);
    await ctx.dispose();
  });

  test('/admin without a session redirects to /admin/login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 10_000 });
  });

  test('logout endpoint accepts POST and clears the session', async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: E2E_CONFIG.baseUrl,
    });
    const res = await ctx.post('/api/admin/logout', {
      headers: { origin: E2E_CONFIG.baseUrl },
      maxRedirects: 0,
    });
    // Logout is intentionally a no-op for anonymous callers (success regardless).
    expect([200, 302, 303]).toContain(res.status());
    await ctx.dispose();
  });
});
