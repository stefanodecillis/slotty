/**
 * scripts/backup.ts
 *
 * Creates a timestamped backup of the Slotty SQLite database and prunes old
 * backups according to a retention policy:
 *   - Keep the most recent 7 daily backups.
 *   - Keep the most recent 4 weekly backups (one per calendar week).
 *
 * Usage:
 *   bun run scripts/backup.ts
 *
 * The backup strategy uses a plain file copy after issuing a WAL checkpoint so
 * that the copy is consistent.  This is safe for a single-writer SQLite setup.
 * Phase 2 will wire this script into the in-process job scheduler.
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ─── Paths ───────────────────────────────────────────────────────────────────

const root: string = join(import.meta.dir, "..");
const dbPath: string = join(root, "data", "slotty.db");
const backupsDir: string = join(root, "backups");

// ─── Retention policy ────────────────────────────────────────────────────────

const KEEP_DAILY: number = 7;
const KEEP_WEEKLY: number = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Zero-pad a number to two digits. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date as YYYY-MM-DDTHH-MM-SS (filesystem-safe ISO-like). */
function formatTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

/**
 * Parse the ISO-like timestamp embedded in a backup filename and return a Date.
 * Returns null if the filename does not match the expected pattern.
 */
function parseBackupDate(filename: string): Date | null {
  // Expected pattern: slotty-YYYY-MM-DDTHH-MM-SS.db
  const match = filename.match(
    /^slotty-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.db$/
  );
  if (!match) return null;
  const parts = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const [year, month, day, hour, minute, second] = parts;
  return new Date(year, month - 1, day, hour, minute, second);
}

/** ISO week number (Monday-based) for a given date. */
function isoWeek(d: Date): string {
  const tmp = new Date(d.valueOf());
  // Set to nearest Thursday (makes the week number well-defined across years).
  tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7));
  const yearStart = new Date(tmp.getFullYear(), 0, 1);
  const weekNo = Math.ceil(
    ((tmp.valueOf() - yearStart.valueOf()) / 86_400_000 + 1) / 7
  );
  return `${tmp.getFullYear()}-W${pad(weekNo)}`;
}

// ─── WAL checkpoint ──────────────────────────────────────────────────────────

/**
 * Issue a WAL checkpoint so that all committed pages are flushed to the main
 * database file before we copy it.  Uses the sqlite3 CLI if available;
 * silently skips the checkpoint if it is not installed (the copy will still be
 * consistent for a quiescent database).
 *
 * Uses execFileSync (not execSync) so the database path is passed as a
 * separate argument and never interpolated into a shell command string.
 */
function walCheckpoint(path: string): void {
  try {
    execFileSync("sqlite3", [path, "PRAGMA wal_checkpoint(FULL);"], {
      stdio: "pipe",
    });
    console.log("WAL checkpoint completed.");
  } catch {
    console.warn(
      "sqlite3 CLI not found — skipping WAL checkpoint. " +
        "The backup may not include the very latest WAL pages if the DB is active."
    );
  }
}

// ─── Pruning ─────────────────────────────────────────────────────────────────

interface BackupEntry {
  filename: string;
  date: Date;
}

/**
 * Remove old backups, keeping:
 *   - the `keepDaily` most-recent daily backups, and
 *   - the `keepWeekly` most-recent weekly backups (one per ISO week).
 */
function pruneBackups(
  dir: string,
  keepDaily: number,
  keepWeekly: number
): { kept: string[]; deleted: string[] } {
  const entries: BackupEntry[] = readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ filename: f, date: parseBackupDate(f) }))
    .filter((e): e is BackupEntry => e.date !== null)
    .sort((a, b) => b.date.valueOf() - a.date.valueOf()); // newest first

  const keep = new Set<string>();

  // Daily: keep the N most-recent backups regardless of calendar day.
  for (const entry of entries.slice(0, keepDaily)) {
    keep.add(entry.filename);
  }

  // Weekly: keep one backup per ISO week up to keepWeekly distinct weeks.
  const weeksSeen = new Map<string, string>(); // week key -> filename
  for (const entry of entries) {
    const week = isoWeek(entry.date);
    if (!weeksSeen.has(week)) {
      weeksSeen.set(week, entry.filename);
    }
    if (weeksSeen.size >= keepWeekly) break;
  }
  for (const filename of weeksSeen.values()) {
    keep.add(filename);
  }

  const kept: string[] = [];
  const deleted: string[] = [];

  for (const entry of entries) {
    if (keep.has(entry.filename)) {
      kept.push(entry.filename);
    } else {
      unlinkSync(join(dir, entry.filename));
      deleted.push(entry.filename);
    }
  }

  return { kept, deleted };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  // Validate source database exists.
  if (!existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`);
    console.error(
      "Ensure the data/ directory is mounted and the database has been initialised."
    );
    process.exit(1);
  }

  // Ensure backups directory exists.
  mkdirSync(backupsDir, { recursive: true });

  // Checkpoint WAL to flush pending writes to the main file.
  walCheckpoint(dbPath);

  // Construct destination filename.
  const timestamp: string = formatTimestamp(new Date());
  const destFilename: string = `slotty-${timestamp}.db`;
  const destPath: string = join(backupsDir, destFilename);

  // Copy the database file.
  copyFileSync(dbPath, destPath);

  const sizeBytes: number = statSync(destPath).size;
  const sizeKb: string = (sizeBytes / 1024).toFixed(1);
  console.log(`Backup created: backups/${destFilename} (${sizeKb} KB)`);

  // Also copy WAL and SHM files if they exist (for completeness).
  for (const suffix of ["-wal", "-shm"]) {
    const src = `${dbPath}${suffix}`;
    if (existsSync(src)) {
      const dest = `${destPath}${suffix}`;
      copyFileSync(src, dest);
      console.log(`  Copied: backups/${destFilename}${suffix}`);
    }
  }

  // Prune old backups.
  const { kept, deleted } = pruneBackups(backupsDir, KEEP_DAILY, KEEP_WEEKLY);

  console.log(`\nRetention summary (daily=${KEEP_DAILY}, weekly=${KEEP_WEEKLY}):`);
  console.log(`  Kept   : ${kept.length} backup(s)`);
  if (deleted.length > 0) {
    console.log(`  Deleted: ${deleted.length} backup(s)`);
    for (const f of deleted) {
      console.log(`    - ${f}`);
    }
  } else {
    console.log("  Deleted: none");
  }

  console.log("\nBackup complete.");
}

main();
