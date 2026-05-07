/**
 * Audit log unit tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit';

async function clearAuditLogs() {
  await db.auditLog.deleteMany({});
}

describe('recordAudit', () => {
  beforeEach(async () => {
    await clearAuditLogs();
  });

  afterEach(async () => {
    await clearAuditLogs();
  });

  it('writes an audit log entry to the database', async () => {
    await recordAudit({
      actor: 'owner',
      action: 'login',
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });

    const logs = await db.auditLog.findMany({ where: { action: 'login' } });
    expect(logs.length).toBe(1);
    expect(logs[0]!.actor).toBe('owner');
    expect(logs[0]!.action).toBe('login');
    expect(logs[0]!.ip).toBe('127.0.0.1');
  });

  it('writes metadata as JSON', async () => {
    await recordAudit({
      actor: 'system',
      action: 'event_type.create',
      targetType: 'EventType',
      targetId: 'abc123',
      metadata: { title: 'Test Meeting', slug: 'test-meeting' },
    });

    const logs = await db.auditLog.findMany({ where: { action: 'event_type.create' } });
    expect(logs.length).toBe(1);
    const meta = JSON.parse(logs[0]!.metadataJson) as Record<string, unknown>;
    expect(meta.title).toBe('Test Meeting');
    expect(meta.slug).toBe('test-meeting');
  });

  it('does not throw when the database operation fails', async () => {
    // Simulate a DB error by passing an extremely long string that would
    // normally be fine (SQLite is flexible), so instead we test that
    // recordAudit itself doesn't throw by monkeypatching.
    const originalCreate = db.auditLog.create.bind(db.auditLog);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.auditLog as any).create = async () => { throw new Error('Simulated DB failure'); };

    // Should not throw.
    await expect(recordAudit({ actor: 'owner', action: 'test.action' })).resolves.toBeUndefined();

    // Restore.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.auditLog as any).create = originalCreate;
  });

  it('accepts optional userId', async () => {
    await recordAudit({
      userId: 'user-123',
      actor: 'owner',
      action: 'settings.update',
    });

    const logs = await db.auditLog.findMany({ where: { userId: 'user-123' } });
    expect(logs.length).toBe(1);
    expect(logs[0]!.userId).toBe('user-123');
  });
});
