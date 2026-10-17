/** Real standalone image + isolated proxy. Synthetic fixtures only. No Google traffic. */
import { test, expect } from '@playwright/test';
const origin = process.env.SLOTTY_TEST_ADMIN_ORIGIN ?? 'https://localhost:33322';
const publicOrigin = process.env.SLOTTY_TEST_PUBLIC_ORIGIN ?? 'http://localhost:33321';
const path = (p: string) => `${origin}${p}`;

test('real browser login, root session, admin navigation, Server Action, JSON API, OAuth and logout', async ({ page, context }) => {
  const badAssets: string[] = [];
  page.on('response', r => { if (r.url().includes('/_next/') && r.status() >= 400) badAssets.push(r.url()); });
  await page.goto(path('/admin/profile'));
  await expect(page).toHaveURL(new RegExp(`/admin/login`));
  await expect(page.locator('form')).toHaveAttribute('action', `/api/admin/login`);
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('TestPassword!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(path('/admin/profile'));
  const cookie = (await context.cookies()).find(c => c.name === 'slotty_session');
  expect(cookie).toMatchObject({ path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  await page.getByLabel('Display name').fill('Origin Verified Admin');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved successfully.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Origin Verified Admin');
  // Native Next Link keeps the root path, and navigation hydrates correctly.
  const calendars = page.locator('a').filter({ hasText: /^Calendars$/ }).first();
  await expect(calendars).toHaveAttribute('href', `/admin/calendars`);
  await calendars.click();
  await expect(page).toHaveURL(path('/admin/calendars'));
  const api = await page.request.get(path('/api/admin/event-types'));
  expect(api.status()).toBe(200);
  // Exercise raw fetch from browser code, not merely APIRequestContext.
  const settingsResponse = page.waitForResponse(r => new URL(r.url()).pathname === `/api/admin/site-url` && r.request().method() === 'GET');
  await page.goto(path('/admin/settings'));
  expect((await settingsResponse).status()).toBe(200);
  await expect(page.getByLabel('URL handed to bookers')).toHaveValue(publicOrigin);
  await expect(page.getByText('Used for invite links', { exact: false })).toBeVisible();
  // OAuth consent is inspected without following to Google.
  const consent = await page.request.get(path('/api/admin/calendars/connect'), { maxRedirects: 0 });
  expect(consent.status()).toBe(303);
  const google = new URL(consent.headers()['location']!);
  expect(google.hostname).toBe('accounts.google.com');
  expect(google.searchParams.get('redirect_uri')).toBe(path('/api/admin/calendars/callback'));
  expect(google.searchParams.get('state')).toBeTruthy();
  const state = (await context.cookies()).find(c => c.name === 'slotty_oauth_state');
  expect(state).toMatchObject({ path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  const callback = await page.request.get(path(`/api/admin/calendars/callback?error=access_denied&state=${encodeURIComponent(google.searchParams.get('state')!)}`), { maxRedirects: 0 });
  expect(callback.status()).toBe(303);
  expect(callback.headers()['location']).toContain(path('/admin/calendars'));
  expect((await context.cookies()).find(c => c.name === 'slotty_oauth_state')).toBeUndefined();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(path('/admin/login'));
  expect((await context.cookies()).find(c => c.name === 'slotty_session')?.value ?? '').toBe('');
  // Existing API auth adapter throws Response and Next returns 500; don't fix unrelated policy here.
  expect((await page.request.get(path('/api/admin/event-types'))).ok()).toBe(false);
  await page.goto(path('/admin/profile'));
  await expect(page).toHaveURL(new RegExp(`/admin/login`));
  expect(badAssets).toEqual([]);
});

test('public root/deep links, real booking UI slot fetch, and admin deny', async ({ page, request }) => {
  await page.goto(`${publicOrigin}/`);
  const link = page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'E2E Quick chat' }) });
  await expect(link).toHaveAttribute('href', `/quick-chat`);
  const response = page.waitForResponse(r => r.url().includes('/api/public/event-types/quick-chat/slots') && r.status() === 200)
    .then(async r => ({ url: r.url(), body: await r.json() }));
  await link.click();
  await expect(page).toHaveURL(`${publicOrigin}/quick-chat`);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Quick chat' })).toBeVisible();
  const slots = await response;
  expect(new URL(slots.url).pathname).toBe(`/api/public/event-types/quick-chat/slots`);
  expect(slots.body.days).toBeInstanceOf(Array);
  await page.goto(`${publicOrigin}/quick-chat`);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Quick chat' })).toBeVisible();
  for (const p of ['/admin', '/api/admin/event-types', '/setup', '/api/setup']) {
    expect((await request.get(`${publicOrigin}${p}`)).status()).toBe(403);
  }
  expect((await request.get(`${publicOrigin}/api/health`)).status()).toBe(200);
});


test('booking management deep link, ICS, reschedule Link and cancellation API', async ({ page, request }) => {
  const from = new Date(Date.now() + 7 * 86400000);
  const to = new Date(from.getTime() + 7 * 86400000);
  const slots = await request.get(`${publicOrigin}/api/public/event-types/quick-chat/slots`, {
    params: { from: from.toISOString(), to: to.toISOString(), tz: 'UTC' },
  });
  expect(slots.ok()).toBe(true);
  const body = await slots.json();
  const slot = body.days.flatMap((d: { slots: { startUtc: string }[] }) => d.slots)[0];
  expect(slot).toBeTruthy();
  const created = await request.post(`${publicOrigin}/api/public/bookings`, { data: {
    eventTypeSlug: 'quick-chat', startAt: slot.startUtc,
    bookerName: 'Origin Booker', bookerEmail: 'origin@example.com', bookerTimezone: 'UTC',
  }});
  expect(created.ok(), await created.text()).toBe(true);
  const booking = await created.json();
  // Returned links stay on the public origin, not the private admin origin.
  expect(booking.manageUrl).toBe(`${publicOrigin}/b/${booking.id}?t=${booking.rescheduleToken}`);
  await page.goto(booking.manageUrl);
  await expect(page.getByText('Origin Booker')).toBeVisible();
  const icsLink = page.getByRole('link', { name: 'Add to calendar' });
  await expect(icsLink).toHaveAttribute('href', `/api/public/bookings/${booking.id}/ics?t=${booking.rescheduleToken}`);
  const ics = await request.get(`${publicOrigin}${await icsLink.getAttribute('href')}`);
  expect(ics.ok()).toBe(true);
  expect(await ics.text()).toContain('BEGIN:VCALENDAR');
  const reschedule = page.getByRole('link', { name: 'Reschedule', exact: true });
  await expect(reschedule).toHaveAttribute('href', `/b/${booking.id}/reschedule?t=${booking.rescheduleToken}`);
  await reschedule.click();
  await expect(page).toHaveURL(`${publicOrigin}/b/${booking.id}/reschedule?t=${booking.rescheduleToken}`);
  const cancelled = await request.post(`${publicOrigin}/api/public/bookings/${booking.id}/cancel?t=${booking.cancelToken}`, { data: { reason: 'Synthetic test complete' } });
  expect(cancelled.ok()).toBe(true);
});
