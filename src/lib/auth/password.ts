import { hash as argon2Hash, verify as argon2Verify, type Options } from '@node-rs/argon2';

/**
 * Argon2id parameters tuned for an interactive login on a modest VPS:
 *   memory   64 MiB
 *   passes   3
 *   parallel 4
 * Roughly ~150 ms on commodity hardware. Tweak only with full re-hash.
 *
 * Implementation: @node-rs/argon2 (Rust + napi-rs). Output format is the
 * standard PHC string ($argon2id$...) and is byte-compatible with hashes
 * produced by the older `argon2` C-binding package, so existing stored
 * hashes verify cleanly under the new library.
 *
 * `algorithm` is omitted on purpose: it defaults to Argon2id in
 * @node-rs/argon2, and the exported `Algorithm` is a `const enum` that
 * can't be referenced by value under tsconfig `isolatedModules: true`.
 */
const ARGON2_OPTIONS: Options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, plain);
  } catch {
    return false;
  }
}

export type PasswordStrengthResult = { ok: true } | { ok: false; reason: string };

/**
 * Lowercase common-password blocklist. Short list of frequent picks to give
 * a small amount of bot-resistance — the real defense is the rate limiter.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'password1234',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'iloveyou',
  'admin',
  'admin123',
  'administrator',
  'welcome',
  'welcome1',
  'welcome123',
  'monkey',
  'dragon',
  'letmein',
  'letmein1',
  'letmein123',
  'baseball',
  'football',
  'master',
  'shadow',
  'sunshine',
  'princess',
  'superman',
  'batman',
  'trustno1',
  'starwars',
  'hello123',
  'hello1234',
  'login',
  'login123',
  'changeme',
  'changeme123',
  'default',
  'default123',
  'slotty',
  'slotty123',
  'abc123',
  'abc12345',
  'qazwsx',
  'whatever',
]);

export function validatePasswordStrength(plain: string): PasswordStrengthResult {
  if (plain.trim().length === 0) {
    return { ok: false, reason: 'Password is required.' };
  }
  if (plain.length > 256) {
    return { ok: false, reason: 'Password must be at most 256 characters.' };
  }
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) {
    return { ok: false, reason: 'That password is too common — pick something less obvious.' };
  }
  return { ok: true };
}
