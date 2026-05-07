/**
 * Load test for the public slots endpoint.
 *
 * Hits `/api/public/event-types/<slug>/slots` for a configurable duration at a
 * configurable concurrency, then prints latency percentiles and asserts that
 * p95 < 300 ms (the project spec's target for the booking hot path).
 *
 * Usage:
 *   bun run test:load
 *   SLOTTY_LOAD_URL=https://book.example.com SLOTTY_LOAD_SLUG=quick-chat bun run test:load
 *   SLOTTY_LOAD_DURATION=10 SLOTTY_LOAD_CONNECTIONS=50 bun run test:load
 *
 * Prereqs:
 *   - The target server must be running and reachable. CI does NOT run this
 *     by default — it's a developer / pre-release tool.
 *   - The slug must point at a real event type with availability in the
 *     queried window (default: today → today+30d in UTC).
 *
 * Limit caveat: The slots endpoint is rate-limited to 60 RPM/IP. On a single
 * client IP, autocannon will saturate the bucket within seconds. To run a
 * meaningful load test, either:
 *   (a) Set SLOTTY_TRUST_PROXY=false on the server so the limiter ignores
 *       X-Forwarded-For, then this script's "spoof" header has no effect (the
 *       limiter falls back to "unknown" and counts every request as same-key).
 *       In that case you'll observe the rate limit behaviour, which is also
 *       informative.
 *   (b) Set SLOTTY_TRUST_PROXY=true and let autocannon vary the X-Forwarded-For
 *       header on each request (default below).
 *   (c) Set SLOTTY_LOAD_BYPASS_LIMIT=1 and pre-bump the limiter capacity in
 *       a debug build.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — `autocannon` ships JS only; we only need the result shape
//                    locally below, so a wholesale `any` is fine for a tool.
import autocannon from 'autocannon';

const URL_BASE = process.env.SLOTTY_LOAD_URL ?? 'http://127.0.0.1:3010';
const SLUG = process.env.SLOTTY_LOAD_SLUG ?? 'quick-chat';
const DURATION_SEC = Number(process.env.SLOTTY_LOAD_DURATION ?? 30);
const CONNECTIONS = Number(process.env.SLOTTY_LOAD_CONNECTIONS ?? 100);
const PIPELINING = Number(process.env.SLOTTY_LOAD_PIPELINING ?? 1);
const P95_BUDGET_MS = Number(process.env.SLOTTY_LOAD_P95_BUDGET_MS ?? 300);

function isoOffsetDays(d: number): string {
  const dt = new Date();
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString();
}

const from = isoOffsetDays(0);
const to = isoOffsetDays(30);
const path = `/api/public/event-types/${encodeURIComponent(SLUG)}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=UTC`;

let counter = 0;
function spoofIp(): string {
  // 10.x.x.x — RFC1918, plenty of unique values to evade per-IP buckets
  // when the server has SLOTTY_TRUST_PROXY=true.
  counter += 1;
  const a = (counter >> 16) & 0xff;
  const b = (counter >> 8) & 0xff;
  const c = counter & 0xff;
  return `10.${a}.${b}.${c}`;
}

console.log(`Loading ${URL_BASE}${path}`);
console.log(`  duration=${DURATION_SEC}s  connections=${CONNECTIONS}  pipelining=${PIPELINING}`);

async function main(): Promise<void> {
  const result = await autocannon({
    url: `${URL_BASE}${path}`,
    duration: DURATION_SEC,
    connections: CONNECTIONS,
    pipelining: PIPELINING,
    setupClient(client: { setHeaders: (h: Record<string, string>) => void }) {
      // autocannon's headers are static once the client is set up; we vary
      // X-Forwarded-For across clients to spread the per-IP bucket. The
      // limiter still kicks in at 60/min/IP, but with 100 distinct IPs we
      // should comfortably saturate up to 100 * 60 = 6000 RPM.
      client.setHeaders({
        'X-Forwarded-For': spoofIp(),
        Accept: 'application/json',
      });
    },
  });

  console.log('\n--- Summary ---');
  console.log(`Requests:    ${result.requests.total}  (${result.requests.average.toFixed(1)}/s)`);
  console.log(`2xx:         ${result['2xx'] ?? 0}`);
  console.log(`non-2xx:     ${result.non2xx ?? 0}`);
  console.log(`Errors:      ${result.errors}  Timeouts: ${result.timeouts}`);
  console.log(
    `Latency:     p50=${result.latency.p50}ms  p90=${result.latency.p90}ms  p95=${result.latency.p97_5}ms (autocannon's 97.5% — closest to spec p95)  p99=${result.latency.p99}ms`,
  );
  console.log(`Throughput:  ${(result.throughput.average / 1024).toFixed(1)} KB/s`);

  // autocannon doesn't export p95 directly; we use p97_5 as a strict surrogate.
  const p95 = result.latency.p97_5;
  if (p95 > P95_BUDGET_MS) {
    console.error(
      `\nFAIL: p97.5 latency ${p95}ms exceeds budget of ${P95_BUDGET_MS}ms.`,
    );
    process.exit(1);
  } else {
    console.log(`\nPASS: p97.5 latency ${p95}ms within ${P95_BUDGET_MS}ms budget.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
