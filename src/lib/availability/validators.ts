import { z } from 'zod';
import { IANAZone } from 'luxon';

// ──────────────────────────────────────────────────
// Timezone validation
// ──────────────────────────────────────────────────

export const timezoneSchema = z
  .string()
  .min(1, 'Timezone is required')
  .refine((tz) => IANAZone.isValidZone(tz), {
    message: 'Invalid IANA timezone identifier',
  });

// ──────────────────────────────────────────────────
// Single rule schema (no cross-rule checks here)
// ──────────────────────────────────────────────────

export const singleRuleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((r) => r.endMinute > r.startMinute, {
    message: 'endMinute must be greater than startMinute',
    path: ['endMinute'],
  });

export type RuleInput = z.infer<typeof singleRuleSchema>;

// ──────────────────────────────────────────────────
// Weekly rules array: validates non-overlap per weekday
// ──────────────────────────────────────────────────

export const weeklyRulesSchema = z
  .array(singleRuleSchema)
  .superRefine((rules, ctx) => {
    // Group by weekday
    const byWeekday = new Map<number, Array<{ startMinute: number; endMinute: number; index: number }>>();
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule) continue;
      const bucket = byWeekday.get(rule.weekday) ?? [];
      bucket.push({ startMinute: rule.startMinute, endMinute: rule.endMinute, index: i });
      byWeekday.set(rule.weekday, bucket);
    }

    for (const [, dayRules] of byWeekday) {
      // Sort by start
      const sorted = [...dayRules].sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (!prev || !curr) continue;
        if (curr.startMinute < prev.endMinute) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Rules on weekday ${curr.index} overlap with rule at index ${prev.index}`,
            path: [curr.index, 'startMinute'],
          });
        }
      }
    }
  });

// ──────────────────────────────────────────────────
// Date override schema
// ──────────────────────────────────────────────────

export const dateOverrideSchema = z
  .object({
    isBlocked: z.boolean(),
    startMinute: z.number().int().min(0).max(1439).optional(),
    endMinute: z.number().int().min(1).max(1440).optional(),
    label: z.string().max(255).optional(),
  })
  .refine(
    (o) => {
      if (!o.isBlocked && (o.startMinute !== undefined || o.endMinute !== undefined)) {
        if (o.startMinute === undefined || o.endMinute === undefined) return false;
        return o.endMinute > o.startMinute;
      }
      return true;
    },
    {
      message: 'endMinute must be greater than startMinute for custom-hours override',
      path: ['endMinute'],
    },
  );

export type DateOverrideInput = z.infer<typeof dateOverrideSchema>;
