/**
 * Audit log helper. Best-effort — never throws on failure.
 * Records owner and system actions for security auditing.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface AuditParams {
  userId?: string;
  actor: 'owner' | 'system';
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function recordAudit(params: AuditParams): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: params.userId ?? null,
        actor: params.actor,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadataJson: JSON.stringify(params.metadata ?? {}),
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  } catch (err) {
    // Best-effort: log the failure but never propagate to callers.
    logger.warn(
      { event: 'audit.write_failed', action: params.action, err: String(err) },
      'audit log write failed',
    );
  }
}
