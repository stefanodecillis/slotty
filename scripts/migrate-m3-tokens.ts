#!/usr/bin/env bun
/**
 * One-shot migration: M3 token names → shadcn token names.
 * Operates on every .ts/.tsx file under src/. Idempotent: re-running
 * after manual cleanup is safe (it only matches the M3 names that no
 * longer exist post-migration).
 *
 * Usage: bun run scripts/migrate-m3-tokens.ts [--dry]
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', 'src');
const DRY = process.argv.includes('--dry');

// Order matters: longer/more-specific entries before shorter ones so we don't
// partially-replace prefixes.
const REPLACEMENTS: Array<[RegExp, string]> = [
  // ── Color roles ──────────────────────────────────────────────────────────
  // Surface containers (longer first)
  [/\bbg-surface-container-lowest\b/g, 'bg-background'],
  [/\bbg-surface-container-low\b/g, 'bg-muted/50'],
  [/\bbg-surface-container-high\b/g, 'bg-card'],
  [/\bbg-surface-container-highest\b/g, 'bg-accent'],
  [/\bbg-surface-container\b/g, 'bg-muted'],

  // On-* (text on container)
  [/\btext-on-secondary-container\b/g, 'text-secondary-foreground'],
  [/\btext-on-primary-container\b/g, 'text-primary'],
  [/\btext-on-error-container\b/g, 'text-destructive'],
  [/\btext-on-tertiary-container\b/g, 'text-emerald-700'],
  [/\btext-on-surface-variant\b/g, 'text-muted-foreground'],
  [/\btext-on-surface\b/g, 'text-foreground'],
  [/\btext-on-background\b/g, 'text-foreground'],
  [/\btext-on-primary\b/g, 'text-primary-foreground'],
  [/\btext-on-secondary\b/g, 'text-secondary-foreground'],
  [/\btext-on-error\b/g, 'text-destructive-foreground'],
  [/\btext-on-tertiary\b/g, 'text-white'],

  // Containers
  [/\bbg-primary-container\b/g, 'bg-primary/10'],
  [/\bbg-secondary-container\b/g, 'bg-secondary'],
  [/\bbg-tertiary-container\b/g, 'bg-emerald-100'],
  [/\bbg-error-container\b/g, 'bg-destructive/10'],

  // Inverse + scrim
  [/\bbg-inverse-surface\b/g, 'bg-foreground'],
  [/\btext-inverse-on-surface\b/g, 'text-background'],
  [/\btext-inverse-primary\b/g, 'text-primary-foreground'],
  [/\bbg-scrim\b/g, 'bg-black'],

  // Outline
  [/\bborder-outline-variant\b/g, 'border-border'],
  [/\bborder-outline\b/g, 'border-input'],

  // Surface
  [/\bbg-surface\b/g, 'bg-card'],
  [/\bbg-surface-dim\b/g, 'bg-muted'],
  [/\bbg-surface-bright\b/g, 'bg-card'],

  // Error / tertiary
  [/\btext-error\b/g, 'text-destructive'],
  [/\bbg-error\b/g, 'bg-destructive'],
  [/\bborder-error\b/g, 'border-destructive'],
  [/\bring-error\b/g, 'ring-destructive'],
  [/\btext-tertiary\b/g, 'text-emerald-600'],
  [/\bbg-tertiary\b/g, 'bg-emerald-600'],

  // ── Type scale ───────────────────────────────────────────────────────────
  [/\btext-display-l\b/g, 'text-5xl tracking-tight'],
  [/\btext-display-m\b/g, 'text-4xl tracking-tight'],
  [/\btext-display-s\b/g, 'text-3xl font-semibold tracking-tight'],
  [/\btext-headline-l\b/g, 'text-3xl font-semibold'],
  [/\btext-headline-m\b/g, 'text-2xl font-semibold'],
  [/\btext-headline-s\b/g, 'text-xl font-semibold'],
  [/\btext-title-l\b/g, 'text-lg font-semibold'],
  [/\btext-title-m\b/g, 'text-base font-medium'],
  [/\btext-title-s\b/g, 'text-sm font-medium'],
  [/\btext-body-l\b/g, 'text-base'],
  [/\btext-body-m\b/g, 'text-sm'],
  [/\btext-body-s\b/g, 'text-xs'],
  [/\btext-label-l\b/g, 'text-sm font-medium'],
  [/\btext-label-m\b/g, 'text-xs font-medium'],
  [/\btext-label-s\b/g, 'text-xs'],

  // ── Shape scale ──────────────────────────────────────────────────────────
  [/\brounded-shape-xs\b/g, 'rounded-sm'],
  [/\brounded-shape-sm\b/g, 'rounded-md'],
  [/\brounded-shape-md\b/g, 'rounded-lg'],
  [/\brounded-shape-lg\b/g, 'rounded-xl'],
  [/\brounded-shape-xl\b/g, 'rounded-2xl'],
  // Same for top/bottom-only variants
  [/\brounded-t-shape-xs\b/g, 'rounded-t-sm'],
  [/\brounded-t-shape-sm\b/g, 'rounded-t-md'],
  [/\brounded-t-shape-md\b/g, 'rounded-t-lg'],
  [/\brounded-t-shape-lg\b/g, 'rounded-t-xl'],
  [/\brounded-t-shape-xl\b/g, 'rounded-t-2xl'],
  [/\brounded-b-shape-xs\b/g, 'rounded-b-sm'],
  [/\brounded-b-shape-sm\b/g, 'rounded-b-md'],
  [/\brounded-b-shape-md\b/g, 'rounded-b-lg'],
  [/\brounded-b-shape-lg\b/g, 'rounded-b-xl'],
  [/\brounded-b-shape-xl\b/g, 'rounded-b-2xl'],

  // ── Motion easings (the M3-specific ones — leave standard CSS easings alone) ──
  [/\bease-emphasized-decelerate\b/g, 'ease-out'],
  [/\bease-emphasized-accelerate\b/g, 'ease-in'],
  [/\bease-emphasized\b/g, 'ease-out'],
  [/\bease-standard\b/g, 'ease-out'],

  // ── Material Symbols class — leave the icon class in place; agent B
  // will swap the spans for lucide components. The spans look like:
  //   <span className="material-symbols-outlined ..."></span>
  // We DON'T touch them here.
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|css)$/.test(name)) {
      yield full;
    }
  }
}

let totalFiles = 0;
let changedFiles = 0;
let totalReplacements = 0;

for (const file of walk(ROOT)) {
  totalFiles++;
  const original = readFileSync(file, 'utf8');
  let next = original;
  let fileReplacements = 0;
  for (const [regex, replacement] of REPLACEMENTS) {
    const matches = next.match(regex);
    if (matches) {
      fileReplacements += matches.length;
      next = next.replace(regex, replacement);
    }
  }
  if (next !== original) {
    changedFiles++;
    totalReplacements += fileReplacements;
    if (!DRY) writeFileSync(file, next, 'utf8');
    const rel = file.replace(ROOT, 'src');
    console.log(`  ${rel}  (${fileReplacements} replacement${fileReplacements === 1 ? '' : 's'})`);
  }
}

console.log('');
console.log(`Scanned ${totalFiles} files. ${changedFiles} changed. ${totalReplacements} replacements total.`);
if (DRY) console.log('(dry run — no files modified)');
