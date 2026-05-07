/**
 * scripts/generate-encryption-key.ts
 *
 * Generates cryptographically-random secrets for Slotty:
 *   SLOTTY_ENCRYPTION_KEY  — 32 bytes (AES-256 key), base64-encoded.
 *   SLOTTY_SESSION_SECRET  — 64 bytes (HMAC-SHA512 key), base64-encoded.
 *
 * Usage:
 *   bun run key:generate           # Print to stdout.
 *   bun run key:generate -- --write  # Append to .env (creates from .env.example if missing).
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

// ─── Key generation ──────────────────────────────────────────────────────────

const encryptionKey: string = randomBytes(32).toString("base64");
const sessionSecret: string = randomBytes(64).toString("base64");

const lines: string[] = [
  `SLOTTY_ENCRYPTION_KEY=${encryptionKey}`,
  `SLOTTY_SESSION_SECRET=${sessionSecret}`,
];

// ─── Output ──────────────────────────────────────────────────────────────────

console.log("\nGenerated secrets:\n");
for (const line of lines) {
  console.log(line);
}
console.log();

// ─── Optional --write flag ───────────────────────────────────────────────────

const writeFlag: boolean = process.argv.includes("--write");

if (!writeFlag) {
  console.log(
    "Tip: pass --write to append these values to .env automatically.\n" +
      "     Example: bun run key:generate -- --write"
  );
  process.exit(0);
}

const root: string = join(import.meta.dir, "..");
const envPath: string = join(root, ".env");
const envExamplePath: string = join(root, ".env.example");

// Bootstrap .env from .env.example if it does not yet exist.
if (!existsSync(envPath)) {
  if (existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    console.log("Created .env from .env.example.");
  } else {
    // Create an empty .env so appendFileSync has a target.
    appendFileSync(envPath, "");
    console.log("Created empty .env (no .env.example found).");
  }
}

// Check whether these keys already exist to avoid duplicates.
const existing: string = readFileSync(envPath, "utf-8");

const toAppend: string[] = lines.filter((line) => {
  const key: string = line.split("=")[0]!;
  return !existing.includes(`${key}=`);
});

if (toAppend.length === 0) {
  console.log(
    "SLOTTY_ENCRYPTION_KEY and SLOTTY_SESSION_SECRET already exist in .env — no changes made."
  );
  process.exit(0);
}

// Ensure the file ends with a newline before appending.
const needsNewline: boolean =
  existing.length > 0 && !existing.endsWith("\n");

appendFileSync(
  envPath,
  (needsNewline ? "\n" : "") + toAppend.join("\n") + "\n"
);

for (const line of toAppend) {
  const key: string = line.split("=")[0]!;
  console.log(`Appended ${key} to .env.`);
}
