'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  brandKeys,
  createBrand,
  deleteBrand,
  updateBrand,
  uploadBrandFavicon,
  uploadBrandLogo,
} from '@/lib/api/brands';
import { ApiError } from '@/lib/api/http';

import { BrandAssetUploader } from './brand-asset-uploader';

interface BrandFormProps {
  mode: 'create' | 'edit';
  brand?: {
    id: string;
    name: string;
    primaryColor: string;
    accentColor: string;
    logoPath: string | null;
    faviconPath: string | null;
    attachedEventTypes: number;
  };
}

const SWATCH_HEXES = [
  { hex: '#4F6CFF', name: 'Indigo' },
  { hex: '#0F766E', name: 'Teal' },
  { hex: '#A16207', name: 'Amber' },
  { hex: '#B91C1C', name: 'Crimson' },
  { hex: '#7C3AED', name: 'Violet' },
  { hex: '#0E7490', name: 'Cyan' },
  { hex: '#9333EA', name: 'Purple' },
  { hex: '#475569', name: 'Slate' },
];

function ColorField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  const isPreset = SWATCH_HEXES.some((s) => s.hex.toLowerCase() === value.toLowerCase());
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-3">
        {SWATCH_HEXES.map((s) => {
          const selected = s.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={s.hex}
              type="button"
              aria-label={`Select ${s.name}`}
              aria-pressed={selected}
              title={s.name}
              onClick={() => onChange(s.hex)}
              className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                selected ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : ''
              }`}
              style={{ backgroundColor: s.hex }}
            />
          );
        })}
        <label
          className={`relative inline-flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-input transition-transform hover:scale-110 ${
            !isPreset ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : ''
          }`}
          title="Custom color"
          style={!isPreset ? { backgroundColor: value, borderStyle: 'solid' } : undefined}
        >
          {isPreset ? <span className="text-xs text-muted-foreground">+</span> : null}
          <input
            id={id}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`Custom ${label.toLowerCase()}`}
          />
        </label>
        <Input
          aria-label={`${label} hex`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 font-mono text-xs"
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function BrandForm({ mode, brand }: BrandFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState(brand?.name ?? '');
  const [primaryColor, setPrimaryColor] = useState(brand?.primaryColor ?? '#4F6CFF');
  const [accentColor, setAccentColor] = useState(brand?.accentColor ?? '#4F6CFF');
  const [logoPath, setLogoPath] = useState<string | null>(brand?.logoPath ?? null);
  const [faviconPath, setFaviconPath] = useState<string | null>(brand?.faviconPath ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      mode === 'create'
        ? createBrand({ name, primaryColor, accentColor })
        : updateBrand(brand!.id, { name, primaryColor, accentColor }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: brandKeys.all });
      if (mode === 'create') {
        toast.success('Brand created. Now upload a logo.');
        router.push(`/admin/brands/${res.id}`);
      } else {
        toast.success('Brand saved.');
      }
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const fieldErrors = err.body.issues?.fieldErrors;
        if (fieldErrors) {
          const next: Record<string, string> = {};
          for (const [field, msgs] of Object.entries(fieldErrors)) {
            next[field] = msgs?.[0] ?? 'Invalid value';
          }
          setErrors(next);
        }
        toast.error(err.message);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Save failed.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteBrand(brand!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: brandKeys.all });
      toast.success('Brand deleted.');
      router.push('/admin/brands');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Delete failed.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    saveMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="brand-name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="brand-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus={mode === 'create'}
          placeholder="e.g. Acme"
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name ? (
          <p className="text-xs text-destructive">{errors.name}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Shown in the brand picker on event types.</p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <ColorField
          id="brand-primary"
          label="Primary color"
          value={primaryColor}
          onChange={setPrimaryColor}
          error={errors.primaryColor}
        />
        <ColorField
          id="brand-accent"
          label="Accent color"
          value={accentColor}
          onChange={setAccentColor}
          error={errors.accentColor}
        />
      </div>

      {mode === 'edit' && brand ? (
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-muted/40 p-5">
          <BrandAssetUploader
            brandId={brand.id}
            label="Logo"
            helperText="Square logo. Shown on the booking page when this brand is attached."
            currentPath={logoPath}
            outputSize={512}
            outputMime="image/webp"
            upload={uploadBrandLogo}
            onUploaded={setLogoPath}
            displayShape="circle"
          />
          <BrandAssetUploader
            brandId={brand.id}
            label="Favicon"
            helperText="Browser-tab icon for branded booking pages. 64×64."
            currentPath={faviconPath}
            outputSize={256}
            outputMime="image/png"
            upload={uploadBrandFavicon}
            onUploaded={setFaviconPath}
            displayShape="square"
          />
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Save the brand to upload a logo and favicon.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        {mode === 'edit' && brand ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
            Delete brand
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/admin/brands')}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending
              ? 'Saving…'
              : mode === 'create'
                ? 'Create brand'
                : 'Save changes'}
          </Button>
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this brand?</DialogTitle>
            <DialogDescription>
              {brand && brand.attachedEventTypes > 0
                ? `This brand is used by ${brand.attachedEventTypes} event type${brand.attachedEventTypes === 1 ? '' : 's'}. They'll revert to the unbranded default (user profile + event-type color).`
                : 'This brand has no event types attached. The logo and favicon files will be removed.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete brand'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
