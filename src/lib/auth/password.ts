import argon2 from 'argon2';

/**
 * Argon2id parameters tuned for an interactive login on a modest VPS:
 *   memory   64 MiB
 *   passes   3
 *   parallel 4
 * Roughly ~150 ms on commodity hardware. Tweak only with full re-hash.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
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
  if (plain.length < 12) {
    return { ok: false, reason: 'Password must be at least 12 characters long.' };
  }
  if (!/[A-Z]/.test(plain)) {
    return { ok: false, reason: 'Password must include an uppercase letter.' };
  }
  if (!/[a-z]/.test(plain)) {
    return { ok: false, reason: 'Password must include a lowercase letter.' };
  }
  if (!/[0-9]/.test(plain)) {
    return { ok: false, reason: 'Password must include a digit.' };
  }
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) {
    return { ok: false, reason: 'Password is too common. Choose something less guessable.' };
  }
  return { ok: true };
}
