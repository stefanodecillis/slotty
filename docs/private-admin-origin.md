# Separate private admin origin (root paths)

Set at runtime, using the standard single Docker image:

```dotenv
SLOTTY_PUBLIC_URL=https://book.example.com
SLOTTY_ADMIN_ORIGIN=https://slotty.example.com
```

The optional admin setting must be an HTTP(S) origin (an optional trailing slash
is accepted), without credentials, a subpath, query, or fragment. If omitted,
admin redirects, OAuth callbacks, and cookie security fall back to
`SLOTTY_PUBLIC_URL`, preserving existing deployments. No build arguments or
path prefixes are needed. Cookies remain host-only with `Path=/`.

Google's authorized callback must exactly match
`https://slotty.example.com/api/admin/calendars/callback`. Private routing must
allow the authenticated browser to reach that address; Google's browser redirect
does not require a public admin endpoint. Existing grants do not need relinking.

Public booking/manage URLs and Google webhook channels continue using the public
base. The cosmetic site URL override does not change either OAuth or webhooks.

Group-poll participants are outside the private network, so their optional
Google free/busy import uses a separate callback on the public base:
`https://book.example.com/api/public/polls/google/callback`. Register it as a
second authorized redirect URI and keep `/api/public/polls/*` reachable on the
public proxy. It requires an HTTPS public URL on a real domain; otherwise the
import is hidden and participants answer by hand.
This setting is not an access-control boundary: restrict `/admin`, `/api/admin`
and setup endpoints on the public reverse proxy, and expose the admin hostname
only to the private network. Existing CSRF policy is unchanged.

## Isolated verification

`bash scripts/verify-private-admin.sh --build` builds the standard image and runs
real Chromium tests against an isolated synthetic SQLite deployment behind a
local TLS proxy. Without `--build`, it tests the existing candidate image.
Only loopback ports 33321/33322 are published; the app network has no Internet
egress. No production environment, database, Google calls, or routing is used.
The Compose project is torn down on exit. These specs live outside `tests/e2e`,
so the regular E2E suite does not discover them. Ports and image can be overridden
with `SLOTTY_TEST_PUBLIC_PORT`, `SLOTTY_TEST_ADMIN_PORT`, `SLOTTY_TEST_IMAGE`.
