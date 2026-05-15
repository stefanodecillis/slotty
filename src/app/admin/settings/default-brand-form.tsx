'use client';

import React, { useCallback, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { updateDefaultBrand, type SettingsActionResult } from './actions';

interface DefaultBrandFormProps {
  brands: { id: string; name: string; primaryColor: string }[];
  currentDefaultBrandId: string | null;
}

const INITIAL_STATE: SettingsActionResult = { success: false };

export function DefaultBrandForm({ brands, currentDefaultBrandId }: DefaultBrandFormProps) {
  const [brandId, setBrandId] = useState<string>(currentDefaultBrandId ?? '__none__');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData();
      formData.set('brandId', brandId);
      startTransition(async () => {
        const result = await updateDefaultBrand(INITIAL_STATE, formData);
        if (result.success) {
          toast.success('Default brand saved.');
        } else if (result.error) {
          toast.error(result.error);
        }
      });
    },
    [brandId],
  );

  if (brands.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You haven&apos;t created any brands yet.{' '}
        <Link href="/admin/brands" className="text-primary underline-offset-2 hover:underline">
          Create a brand
        </Link>{' '}
        to enable per-event-type branding.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="default-brand">Default brand</Label>
        <Select value={brandId} onValueChange={setBrandId}>
          <SelectTrigger id="default-brand">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No default (unbranded)</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: b.primaryColor }}
                  />
                  {b.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Prefilled on new event types and one-time links. Existing event types are not affected.
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
