import 'server-only';

import { env } from '@/lib/env';

export interface ObservedRequest {
  host: string | null;
  xForwardedHost: string | null;
  xForwardedProto: string | null;
  xForwardedFor: string | null;
}

export interface ReachabilityResult {
  ok: boolean;
  status: number | null;
  durationMs: number | null;
  error: string | null;
}

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface DiagnosticIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  hint?: string;
}

export interface SiteUrlDiagnostic {
  configured: string;
  configuredHost: string;
  configuredProto: string;
  observed: ObservedRequest;
  trustProxy: boolean;
  reachability: ReachabilityResult;
  issues: DiagnosticIssue[];
}

export function inspectIncomingRequest(headers: Headers): ObservedRequest {
  return {
    host: headers.get('host'),
    xForwardedHost: headers.get('x-forwarded-host'),
    xForwardedProto: headers.get('x-forwarded-proto'),
    xForwardedFor: headers.get('x-forwarded-for'),
  };
}

export async function runReachabilityCheck(configured: string): Promise<ReachabilityResult> {
  const target = `${configured.replace(/\/$/, '')}/api/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const startedAt = Date.now();
  try {
    const res = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface ClassifyInput {
  configured: URL;
  observed: ObservedRequest;
  trustProxy: boolean;
  reachability: ReachabilityResult;
}

/**
 * Classify the deployment state of `SLOTTY_PUBLIC_URL` against the live
 * incoming request and reachability probe, returning human-readable issues
 * for an operator running this app behind a reverse proxy (e.g. Nginx
 * Proxy Manager) on a homeserver.
 *
 * Inputs you can use:
 *   - configured: parsed URL of SLOTTY_PUBLIC_URL (host, protocol, port)
 *   - observed.host:           the Host header on the current admin request
 *   - observed.xForwardedHost: what the reverse proxy claims the client saw
 *   - observed.xForwardedProto: 'http' | 'https' from the proxy
 *   - trustProxy:              whether SLOTTY_TRUST_PROXY is enabled
 *   - reachability.ok / .status / .error: result of fetching configured/api/health
 *
 * Scenarios worth flagging (consider which apply to YOUR NPM setup):
 *   1. Reachability failed — DNS, container networking, or NPM upstream wrong.
 *   2. observed.xForwardedHost is null but trustProxy=true — the proxy isn't
 *      forwarding the header, so CSRF for proxied requests will fail.
 *   3. observed.xForwardedHost differs from configured.host — NPM is forwarding
 *      a different hostname than what's configured (multi-domain misroute).
 *   4. configured.protocol is https but observed.xForwardedProto is http —
 *      proxy isn't terminating TLS the way the configured URL expects.
 *   5. configured uses a non-standard port — likely a leak of the upstream
 *      container port; the public URL should be the externally-visible one.
 *
 * Return an array of issues. Empty array = configuration looks healthy.
 *
 * TODO(you): implement classification. Aim for 5–10 lines of focused logic.
 * Pick the cases that matter for your homeserver+NPM deployment, and write
 * messages an operator can act on (mention the header name, the expected
 * value, and where to look — NPM "Custom locations" / "Forward Hostname",
 * docker-compose env, etc.).
 */
export function classifyMismatch(input: ClassifyInput): DiagnosticIssue[] {
  const { configured, observed, trustProxy, reachability } = input;
  const issues: DiagnosticIssue[] = [];

  // TODO(you): push DiagnosticIssue entries onto `issues` for the scenarios
  // that matter to your deployment. See the JSDoc above for a list of five
  // candidate cases. Aim for 5–10 lines total.
  //
  // Each issue should set:
  //   severity: 'error' | 'warning' | 'info'
  //   code:     short kebab/snake identifier ('reachability-failed', etc.)
  //   message:  one-sentence summary an operator can read at a glance
  //   hint:     (optional) a short, actionable next step ("check NPM
  //             'Forward Hostname' or docker-compose SLOTTY_PUBLIC_URL")
  //
  // Variables already destructured for you:
  //   configured.host / configured.protocol / configured.port
  //   observed.host / observed.xForwardedHost / observed.xForwardedProto
  //   trustProxy
  //   reachability.ok / reachability.status / reachability.error
  void configured;
  void observed;
  void trustProxy;
  void reachability;

  return issues;
}

export async function diagnoseSiteUrl(headers: Headers): Promise<SiteUrlDiagnostic> {
  // Reflect the *effective* URL (DB override falls back to env) — that's
  // what user-facing links resolve to and what the reachability probe
  // should target. The settings UI surfaces the env value separately so
  // the admin can see the boot-time fallback.
  const { getPublicUrl } = await import('./store');
  const configuredRaw = await getPublicUrl();
  const configured = new URL(configuredRaw);
  const observed = inspectIncomingRequest(headers);
  const trustProxy = Boolean(env.SLOTTY_TRUST_PROXY);
  const reachability = await runReachabilityCheck(configuredRaw);
  const issues = classifyMismatch({ configured, observed, trustProxy, reachability });

  return {
    configured: configuredRaw,
    configuredHost: configured.host,
    configuredProto: configured.protocol.replace(/:$/, ''),
    observed,
    trustProxy,
    reachability,
    issues,
  };
}
