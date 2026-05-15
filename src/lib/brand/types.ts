import { z } from 'zod';

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const colorField = z
  .string()
  .regex(HEX_COLOR_RE, 'Color must be a 6-digit hex like #4F6CFF');

export const brandUpsertSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(60, 'Name must be 60 characters or fewer'),
  primaryColor: colorField.default('#4F6CFF'),
  accentColor: colorField.default('#4F6CFF'),
});

export type BrandUpsertInput = z.infer<typeof brandUpsertSchema>;

export interface BrandDTO {
  id: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  logoPath: string | null;
  faviconPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandListItem extends BrandDTO {
  isDefault: boolean;
  attachedEventTypes: number;
}
