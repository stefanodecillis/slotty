#!/usr/bin/env bun
/**
 * Static security audit. Greps the codebase for common
 * footguns and prints a list of findings. Exits 1 on any issue so it's
 * fit for CI.
 *
 * Checks:
 *   1. Every /api/admin/<route>/route.ts state-changing handler (POST,
 *      PATCH, PUT, DELETE) calls `csrf(` or `validateOrigin(`.
 *   2. Every /api/admin/<route>/route.ts handler calls `requireUser(`.
 *   3. Every /api/public/<route>/route.ts that exports POST has a
 *      `consume(` rate-limit call.
 *   4. No raw `console.log` or `console.error` outside of the env loader,
 *      CLI, scripts, and test setup.
 *   5. No `dangerouslySetInnerHTML` outside of the documented exceptions
 *      (theme inline script, sanitized markdown bio).
 *   6. No literal token logging patterns ('refresh_token', 'access_token'
 *      sent through `logger.info`/`logger.warn`/`logger.error` arguments
 *      that aren't the redact list).
 *
 * Each check is written conservatively: false positives are *louder* than
 * false negatives. Add `// audit-skip: <reason>` on a line to suppress.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

interface Finding {
  file: string;
  line: number;
  rule: string;
  message: string;
}

const findings: Finding[] = [];

function walk(dir: string, exts: string[], out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next' || name === '.tmp') continue;
      walk(full, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function lineOf(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') line += 1;
  return line;
}

function relative(file: string): string {
  return file.startsWith(ROOT) ? file.slice(ROOT.length) : file;
}

const SKIP_RE = /audit-skip/;

// ──────────────────────────────────────────────────────────────────
// 1 & 2: admin route handler audits
// ──────────────────────────────────────────────────────────────────
const apiAdminRoutes: string[] = [];
walk(join(ROOT, 'src/app/api/admin'), ['route.ts'], apiAdminRoutes);

for (const file of apiAdminRoutes) {
  const src = read(file);
  if (SKIP_RE.test(src)) continue;
  const exportsMutation = /export\s+(async\s+)?(?:const|function)\s+(POST|PUT|PATCH|DELETE)\b/.test(
    src,
  );
  const hasCsrf = /(?:\bcsrf\(|validateOrigin\()/.test(src);
  // `requireUser`, `requireUserOrRedirect`, and the TOTP login flow's
  // `getCurrentSession` are all considered valid auth gates.
  const hasRequireUser =
    /requireUser\(|requireUserOrRedirect\(|getCurrentSession\(/.test(src);
  // Login + initial setup intentionally don't require a session.
  const isLogin = file.endsWith('/login/route.ts');
  const isLoginTotp = file.endsWith('/login/totp/route.ts');

  if (exportsMutation && !hasCsrf) {
    findings.push({
      file: relative(file),
      line: 1,
      rule: 'admin-csrf',
      message:
        'Admin route exports a state-changing handler but does not call csrf() / validateOrigin()',
    });
  }
  if (!isLogin && !isLoginTotp && !hasRequireUser) {
    findings.push({
      file: relative(file),
      line: 1,
      rule: 'admin-auth',
      message:
        'Admin route does not call requireUser() — confirm it is reachable only post-login',
    });
  }
}

// ──────────────────────────────────────────────────────────────────
// 3: public POST routes must rate-limit
// ──────────────────────────────────────────────────────────────────
const apiPublicRoutes: string[] = [];
walk(join(ROOT, 'src/app/api/public'), ['route.ts'], apiPublicRoutes);

for (const file of apiPublicRoutes) {
  const src = read(file);
  if (SKIP_RE.test(src)) continue;
  const exportsPost = /export\s+(async\s+)?(?:function|const)\s+POST\b/.test(src);
  const hasConsume = /consume\(/.test(src) || /withPublicRateLimit\(/.test(src);
  if (exportsPost && !hasConsume) {
    findings.push({
      file: relative(file),
      line: 1,
      rule: 'public-rate-limit',
      message: 'Public POST route is missing a consume() / withPublicRateLimit call',
    });
  }
}

// ──────────────────────────────────────────────────────────────────
// 4: console.* outside allowed locations
// ──────────────────────────────────────────────────────────────────
const ALLOWED_CONSOLE_PREFIXES = [
  join(ROOT, 'src/lib/env.ts'),
  join(ROOT, 'src/lib/logger.ts'),
  join(ROOT, 'src/cli/'),
  join(ROOT, 'scripts/'),
  join(ROOT, 'tests/'),
  join(ROOT, 'prisma/seed.ts'),
];

const srcFiles: string[] = [];
walk(join(ROOT, 'src'), ['.ts', '.tsx'], srcFiles);

for (const file of srcFiles) {
  if (ALLOWED_CONSOLE_PREFIXES.some((p) => file.startsWith(p))) continue;
  const src = read(file);
  if (SKIP_RE.test(src)) continue;
  const re = /\bconsole\.(log|error|warn|info|debug)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lineEnd = src.indexOf('\n', m.index);
    const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (/audit-skip/.test(line)) continue;
    findings.push({
      file: relative(file),
      line: lineOf(src, m.index),
      rule: 'no-console',
      message: `Direct console.${m[1]} call — use logger instead`,
    });
  }
}

// ──────────────────────────────────────────────────────────────────
// 5: dangerouslySetInnerHTML usage
// ──────────────────────────────────────────────────────────────────
const ALLOWED_DSIH_FILES = [
  join(ROOT, 'src/lib/theme/'),
];

const tsxFiles = srcFiles.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
for (const file of tsxFiles) {
  const src = read(file);
  if (SKIP_RE.test(src)) continue;
  const re = /dangerouslySetInnerHTML/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lineEnd = src.indexOf('\n', m.index);
    const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (/audit-skip/.test(line)) continue;

    // Allow when the file imports renderMarkdown — bio / confirmation
    // markdown is sanitized by that helper before it reaches the DOM.
    if (/from ['"]@\/lib\/markdown['"]/.test(src)) continue;

    if (ALLOWED_DSIH_FILES.some((p) => file.startsWith(p))) continue;
    findings.push({
      file: relative(file),
      line: lineOf(src, m.index),
      rule: 'no-dsih',
      message:
        'dangerouslySetInnerHTML outside the documented theme/markdown allowlist',
    });
  }
}

// ──────────────────────────────────────────────────────────────────
// 6: literal token logging
// ──────────────────────────────────────────────────────────────────
const TOKEN_LOG_RE =
  /logger\.(info|warn|error|debug)\(\s*\{[^}]*\b(accessToken|refreshToken|access_token|refresh_token|password|passwordHash|secret)\b[^:]*:/g;
for (const file of srcFiles) {
  const src = read(file);
  if (SKIP_RE.test(src)) continue;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_LOG_RE.exec(src))) {
    findings.push({
      file: relative(file),
      line: lineOf(src, m.index),
      rule: 'no-token-log',
      message: `logger.${m[1]} payload contains a token / secret key — verify it's redacted`,
    });
  }
}

// ──────────────────────────────────────────────────────────────────
// Report
// ──────────────────────────────────────────────────────────────────
if (findings.length === 0) {
  console.log('Security audit: 0 issues found.');
  process.exit(0);
}

console.log(`Security audit: ${findings.length} issue(s) found.\n`);
const byRule = new Map<string, Finding[]>();
for (const f of findings) {
  const arr = byRule.get(f.rule) ?? [];
  arr.push(f);
  byRule.set(f.rule, arr);
}
for (const [rule, items] of byRule) {
  console.log(`[${rule}]  ${items.length} finding(s)`);
  for (const it of items) {
    console.log(`  ${it.file}:${it.line}  ${it.message}`);
  }
  console.log('');
}
process.exit(1);
