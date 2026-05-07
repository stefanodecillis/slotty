/**
 * Daily backup job: copies the SQLite database to backups/ and prunes old files.
 * This reuses the logic from scripts/backup.ts but exports it as a callable function
 * so the job scheduler can invoke it without spawning a child process.
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

import { logger } from '@/lib/logger';

const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

function parseBackupDate(filename: string): Date | null {
  const match = filename.match(
    /^slotty-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.db$/,
  );
  if (!match) return null;
  const parts = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const [year, month, day, hour, minute, second] = parts;
  return new Date(year, month - 1, day, hour, minute, second);
}

function isoWeek(d: Date): string {
  const tmp = new Date(d.valueOf());
  tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7));
  const yearStart = new Date(tmp.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((tmp.valueOf() - yearStart.valueOf()) / 86_400_000 + 1) / 7);
  return `${tmp.getFullYear()}-W${pad(weekNo)}`;
}

function walCheckpoint(dbPath: string): void {
  try {
    execFileSync('sqlite3', [dbPath, 'PRAGMA wal_checkpoint(FULL);'], { stdio: 'pipe' });
  } catch {
    // sqlite3 CLI not available — skip.
  }
}

interface BackupEntry {
  filename: string;
  date: Date;
}

function pruneBackups(dir: string, keepDaily: number, keepWeekly: number): void {
  const entries: BackupEntry[] = readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ filename: f, date: parseBackupDate(f) }))
    .filter((e): e is BackupEntry => e.date !== null)
    .sort((a, b) => b.date.valueOf() - a.date.valueOf());

  const keep = new Set<string>();

  for (const entry of entries.slice(0, keepDaily)) {
    keep.add(entry.filename);
  }

  const weeksSeen = new Map<string, string>();
  for (const entry of entries) {
    const week = isoWeek(entry.date);
    if (!weeksSeen.has(week)) weeksSeen.set(week, entry.filename);
    if (weeksSeen.size >= keepWeekly) break;
  }
  for (const filename of weeksSeen.values()) {
    keep.add(filename);
  }

  for (const entry of entries) {
    if (!keep.has(entry.filename)) {
      try {
        unlinkSync(join(dir, entry.filename));
        logger.debug({ event: 'backup.pruned', filename: entry.filename }, 'pruned old backup');
      } catch (err) {
        logger.warn({ event: 'backup.prune_error', filename: entry.filename, err }, 'prune failed');
      }
    }
  }
}

export async function runDailyBackup(): Promise<void> {
  const root = process.cwd();
  const dbPath = join(root, 'data', 'slotty.db');
  const backupsDir = join(root, 'backups');

  if (!existsSync(dbPath)) {
    logger.error({ event: 'backup.db_missing', dbPath }, 'database not found for backup');
    throw new Error(`Database not found at: ${dbPath}`);
  }

  if (!existsSync(backupsDir)) {
    mkdirSync(backupsDir, { recursive: true });
  }

  walCheckpoint(dbPath);

  const timestamp = formatTimestamp(new Date());
  const destFilename = `slotty-${timestamp}.db`;
  const destPath = join(backupsDir, destFilename);

  copyFileSync(dbPath, destPath);

  const sizeBytes = statSync(destPath).size;
  logger.info(
    { event: 'backup.created', filename: destFilename, sizeBytes },
    'daily backup created',
  );

  // Also copy WAL and SHM files if they exist.
  for (const suffix of ['-wal', '-shm']) {
    const src = `${dbPath}${suffix}`;
    if (existsSync(src)) {
      copyFileSync(src, `${destPath}${suffix}`);
    }
  }

  pruneBackups(backupsDir, KEEP_DAILY, KEEP_WEEKLY);
}
