# Slotty

A self-hosted, single-user scheduling app — like Calendly, but yours.

Connect multiple Google Workspace calendars, share a public booking link, and let bookers pick a slot that's automatically respected across every calendar you own. Confirmed bookings land on the right calendar with a working Google Meet link.

- Single binary deploy (one Docker container, one volume, one `.env`)
- Material You design — pick a brand color, the whole UI re-themes
- Public booking page works on mobile, fast, accessible
- Never double-books across multiple Google accounts
- Designed to sit behind a reverse proxy (Caddy / Nginx / Traefik)

> **Status:** Phase 0 (skeleton). The data model and design system are scaffolded; subsequent phases add auth, Google integration, public booking flow, and notifications.

---

## Table of contents

1. [Quick start (Docker)](#quick-start-docker)
2. [Local development](#local-development)
3. [Environment variables](#environment-variables)
4. [Generating secrets](#generating-secrets)
5. [Google OAuth setup](#google-oauth-setup)
6. [SMTP / email](#smtp--email)
7. [Reverse proxy](#reverse-proxy)
8. [First-run setup](#first-run-setup)
9. [Backups](#backups)
10. [Architecture](#architecture)
11. [Troubleshooting](#troubleshooting)
12. [License](#license)

---

## Quick start (Docker)

The fastest way to get running. Assumes you have Docker + a reverse proxy (Caddy in the example below) on a server with a public DNS record.

```bash
# 1. Clone and prepare config
git clone https://github.com/slotty/slotty.git
cd slotty
cp .env.example .env

# 2. Generate the two required secrets and write them into .env
bun run scripts/generate-encryption-key.ts --write
#   (or, without bun installed, run the equivalent openssl commands shown below)

# 3. Edit .env — at minimum set:
#    SLOTTY_PUBLIC_URL=https://book.example.com
#    SLOTTY_GOOGLE_CLIENT_ID=...     (see "Google OAuth setup")
#    SLOTTY_GOOGLE_CLIENT_SECRET=...
#    SLOTTY_SMTP_*                   (see "SMTP / email")

# 4. Boot the app
cp docker-compose.example.yml docker-compose.yml
docker compose up -d

# 5. Point Caddy (or Nginx/Traefik) at 127.0.0.1:3000
cp Caddyfile.example /etc/caddy/Caddyfile      # adjust domain + IP allowlist for /admin
sudo systemctl reload caddy

# 6. Visit https://book.example.com/setup to create your admin account.
```

**Without bun installed**, you can generate the secrets with `openssl`:

```bash
echo "SLOTTY_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "SLOTTY_SESSION_SECRET=$(openssl rand -base64 64)" >> .env
```

---

## Local development

Slotty uses [Bun](https://bun.sh) for tooling and Node 20+ as the runtime (Next.js prod server runs on Node).

```bash
# Install Bun if you don't have it
curl -fsSL https://bun.sh/install | bash

# Install Node 20 if you don't have it (use nvm or fnm)
nvm install 20

# Install deps
bun install

# Configure .env
cp .env.example .env
bun run scripts/generate-encryption-key.ts --write

# Apply database migrations (creates data/slotty.db)
bunx prisma migrate dev

# Start the dev server
bun run dev
# → http://localhost:3000
```

Then visit <http://localhost:3000/setup> to create the admin account.

### Useful scripts

| Command | What it does |
|---|---|
| `bun run dev` | Next.js dev server (Bun runtime) on port 3000 |
| `bun run build` | Production build (`prisma generate && next build`) |
| `bun run start` | Production server (Node runtime) |
| `bun run lint` | ESLint |
| `bun run typecheck` | `tsc --noEmit` with strict + `noUncheckedIndexedAccess` |
| `bun test` | Unit + integration tests via Bun's test runner |
| `bun run db:migrate` | Create + apply a new Prisma migration |
| `bun run db:studio` | Open Prisma Studio (GUI for the DB) |
| `bun run key:generate` | Print fresh `SLOTTY_ENCRYPTION_KEY` + `SLOTTY_SESSION_SECRET`. Add `--write` to append to `.env` |
| `bun run theme:generate '#FF5733'` | Print the M3 CSS variables for a given seed color |
| `bun run cli reset-password` | Emergency admin password reset (Phase 1) |

---

## Environment variables

Set these in `.env` (loaded by Next.js automatically) or in your container env. They are validated at startup — the app refuses to boot if any required var is missing or weak.

### Required

| Variable | Description |
|---|---|
| `SLOTTY_PUBLIC_URL` | Public URL where Slotty is reachable (no trailing slash). E.g. `https://book.example.com`. Used to construct OAuth callback URLs and email links. |
| `SLOTTY_ENCRYPTION_KEY` | **32 random bytes, base64-encoded.** Encrypts OAuth tokens, SMTP passwords, TOTP secrets at rest. The app refuses to start if this is missing or decodes to fewer than 32 bytes. **Rotating this invalidates every encrypted secret in the DB.** |
| `SLOTTY_SESSION_SECRET` | ≥ 32 character random string. Used to sign session cookies. |
| `SLOTTY_DATABASE_URL` | DB connection string. Default: `file:../data/slotty.db` (SQLite — Prisma resolves relative paths from `prisma/`, so `../data/` puts the file at the project root). For Postgres: `postgresql://user:pass@host:5432/slotty`. |

### Required for Google calendar integration

| Variable | Description |
|---|---|
| `SLOTTY_GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console. See [Google OAuth setup](#google-oauth-setup). |
| `SLOTTY_GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret. |

### Required for sending email (confirmations, reminders, cancellations)

| Variable | Description |
|---|---|
| `SLOTTY_SMTP_HOST` | SMTP server host. |
| `SLOTTY_SMTP_PORT` | SMTP port. `587` (STARTTLS) or `465` (SMTPS). |
| `SLOTTY_SMTP_USER` | SMTP username. |
| `SLOTTY_SMTP_PASS` | SMTP password (encrypted at rest if changed via admin UI). |
| `SLOTTY_SMTP_FROM` | From-address, e.g. `Slotty <noreply@example.com>`. |

### Optional

| Variable | Default | Description |
|---|---|---|
| `SLOTTY_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `SLOTTY_TURNSTILE_SITE_KEY` | unset | Cloudflare Turnstile site key. If both Turnstile vars are set, the public booking form requires a captcha. |
| `SLOTTY_TURNSTILE_SECRET` | unset | Turnstile secret key. |
| `SLOTTY_SENTRY_DSN` | unset | If set, unhandled errors are reported to Sentry. |
| `SLOTTY_TRUST_PROXY` | `true` | Honor `X-Forwarded-For` / `X-Forwarded-Proto` from the reverse proxy. Disable only if you expose Slotty directly. |

---

## Generating secrets

Both `SLOTTY_ENCRYPTION_KEY` and `SLOTTY_SESSION_SECRET` must be cryptographically random. **Never reuse a key between environments.**

```bash
# With Bun installed
bun run key:generate                # prints to stdout
bun run key:generate --write        # appends to .env (creates from .env.example if missing)

# Without Bun
openssl rand -base64 32             # SLOTTY_ENCRYPTION_KEY
openssl rand -base64 64             # SLOTTY_SESSION_SECRET
```

If you ever lose `SLOTTY_ENCRYPTION_KEY`, every connected Google account will need to be re-authenticated and the SMTP password re-entered. Bookings, schedules, and event types are not affected.

---

## Google OAuth setup

Slotty needs OAuth credentials to read your calendars and create events.

1. Go to <https://console.cloud.google.com/projectcreate> and create a new project (or pick an existing one).
2. **Enable APIs:** APIs & Services → Library → enable **Google Calendar API**.
3. **OAuth consent screen:**
   - User type: *External* (works for personal Gmail too) or *Internal* (Workspace only).
   - App name: `Slotty` (or whatever you prefer).
   - Add yourself as a Test user.
   - Scopes: add
     - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
     - `https://www.googleapis.com/auth/calendar.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
4. **Credentials → Create Credentials → OAuth client ID:**
   - Application type: **Web application**.
   - Authorized redirect URIs: `${SLOTTY_PUBLIC_URL}/api/admin/calendars/callback`
     (e.g. `https://book.example.com/api/admin/calendars/callback`)
5. Copy the **Client ID** and **Client secret** into your `.env`:
   ```
   SLOTTY_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   SLOTTY_GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```
6. Restart Slotty.

You can connect multiple Google accounts (e.g., one per job) from **Admin → Calendars** once Phase 3 is shipped.

---

## SMTP / email

Slotty doesn't send marketing email — only transactional messages tied to bookings (confirmations, reminders, reschedules, cancellations). Any SMTP relay works:

- **Postmark / SendGrid / Mailgun / Amazon SES** — provide host, port 587, API user + key.
- **Personal mailbox** (Gmail with App Password, Fastmail, etc.) — fine for low volume.
- **Self-hosted** (Postfix, Maddy) — also works.

Test it from **Admin → Settings → Email → Send test email** once Phase 2 is shipped.

---

## Reverse proxy

The container listens on plain HTTP. **Always run it behind a reverse proxy that terminates TLS.** Examples:

### Caddy (recommended for simplicity)

`Caddyfile.example` ships with the repo. The key idea:

```caddy
book.example.com {
    @admin path /admin* /api/admin/*
    @admin_allowed remote_ip 192.168.0.0/16 100.64.0.0/10
    handle @admin {
        @blocked not remote_ip 192.168.0.0/16 100.64.0.0/10
        respond @blocked 403
        reverse_proxy 127.0.0.1:3000
    }

    # /api/webhooks/google must remain reachable from Google's IPs.
    reverse_proxy 127.0.0.1:3000
}
```

Edit the IP ranges to match your home / VPN / Tailscale CIDR.

### Nginx

```nginx
location /admin {
    allow 192.168.0.0/16;
    allow 100.64.0.0/10;
    deny all;
    proxy_pass http://127.0.0.1:3000;
}
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Traefik

Use the `ipWhiteList` middleware on the `/admin` router. Webhooks at `/api/webhooks/*` should not have the middleware applied.

> **Why allowlist `/admin`?** It's a single-user app — there's no reason for the rest of the internet to even see the login page. Browser-based attacks on the admin panel become trivially blocked. This complements (does not replace) the in-app password + 2FA auth.

---

## First-run setup

1. Visit `https://<your-domain>/setup` from an allowlisted IP.
2. Create your admin account (username + password ≥ 12 chars, mixed character classes).
3. Sign in at `/admin/login`.
4. Connect your Google accounts at `/admin/calendars`.
5. Configure your default schedule at `/admin/availability`.
6. Create your first event type at `/admin/event-types`.
7. Share your booking link: `https://<your-domain>/<event-slug>`.

The `/setup` route 404s once an admin account exists. To recover from a forgotten password without database access, run:

```bash
docker exec -it slotty bun run cli reset-password <username>
```

---

## Backups

Daily SQLite snapshots are written to `backups/` inside the volume (kept: 7 daily + 4 weekly). You can also:

- Click **Admin → Settings → Backup → Download snapshot** (single SQLite file).
- Click **Admin → Settings → Backup → Export all data** (ZIP with JSON tables + per-booking ICS files).

For off-host backups, just `cp` (or `rclone copy`) the `data/` and `backups/` directories from your volume to wherever you keep durable storage.

---

## Architecture

Single Next.js process. SQLite for storage. In-process job worker for reminders, watch-channel renewal, and webhook delivery — no Redis, no message broker.

```
Browser ──► Caddy ──► Next.js (App Router)
                       │
                       ├─ Public site (/, /<slug>, /b/<id>)
                       ├─ /admin/* (auth-gated)
                       ├─ /api/public/* (rate-limited)
                       ├─ /api/admin/*  (session-gated)
                       └─ /api/webhooks/google (Google → us)
                       │
                       ├─► Prisma → SQLite (./data/slotty.db)
                       ├─► Job worker (in-process, 5s poll)
                       │     • renew watch channels
                       │     • incremental Google sync
                       │     • send reminder emails
                       │     • outgoing webhook delivery
                       │     • daily backup
                       │
                       └─► googleapis (with token refresh wrapper)
```

**Material You** drives the visual language. The owner picks one seed color (default `#4F6CFF`, settable in **Admin → Branding**); `@material/material-color-utilities` generates the full M3 palette (~25 color roles) for both light and dark schemes. CSS variables are written under `:root` and `[data-theme="dark"]`, and Tailwind references them via `bg-primary`, `text-on-surface`, `rounded-shape-lg`, etc. There's no FOUC: theme is applied via inline `<script>` before hydration.

For a deeper architectural overview, see the implementation plan in `.planning/` (or whichever path your fork keeps it in).

---

## Troubleshooting

**App won't start: `Invalid environment configuration`**
You're missing one of the required env vars or your `SLOTTY_ENCRYPTION_KEY` doesn't decode to 32 bytes. Run `bun run key:generate` and update `.env`.

**Can't connect Google account: `redirect_uri_mismatch`**
The redirect URI configured in Google Cloud Console must exactly match `${SLOTTY_PUBLIC_URL}/api/admin/calendars/callback`. Check for `http` vs `https`, trailing slash, and exact host.

**Booking page is empty / no slots**
- Make sure your default schedule has at least one weekly rule.
- Verify the event type is not archived or hidden.
- Check **Admin → Calendars** — every Busy calendar should show a recent successful sync.

**Push notifications not arriving from Google**
Watch channels require a publicly reachable HTTPS URL for `/api/webhooks/google`. If you're testing locally, use `ngrok http 3000` or Cloudflare Tunnel. The fallback poll every 10 minutes will pick up missed events anyway.

**`/admin` returns 403**
Your reverse proxy is blocking your IP. Update the allowlist CIDRs in your Caddyfile / Nginx config and reload.

**Slot disappears for 30 seconds after a booking, then reappears**
Slot computation is cached for 30 s. After a booking, the cache invalidates within seconds. If a slot reappears, that means a Google event got cancelled — confirm in your calendar.

**SQLite "database is locked"**
Make sure you don't have multiple Slotty processes pointing at the same DB file. The container should be the only writer.

---

## License

Slotty is licensed under [AGPL-3.0-or-later](LICENSE). If you modify Slotty and run it as a network service, you must make your modified source available to users of that service.
