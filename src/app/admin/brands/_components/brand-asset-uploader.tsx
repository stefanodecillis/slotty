'use client';

/**
 * File picker → cropper → upload mutation, encapsulated in one component.
 * Used twice from `brand-form.tsx` — once for the logo, once for the favicon.
 *
 * Rendering: a square card showing the current asset (or a placeholder), with
 * a "Choose file…" button below. Picking a file opens the cropper dialog;
 * confirming the crop posts a Blob to the upload endpoint.
 */
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImageIcon, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { ImageCropperDialog } from './image-cropper-dialog';

export interface BrandAssetUploaderProps {
  brandId: string;
  /** Form-field label (e.g., "Logo", "Favicon"). */
  label: string;
  /** Helper text shown under the label. */
  helperText?: string;
  /** Current asset path from the server, or null. */
  currentPath: string | null;
  /** Output square dimensions, in pixels. */
  outputSize: number;
  /** Output MIME type — WebP for logos, PNG for favicons. */
  outputMime: 'image/webp' | 'image/png';
  /** Mutation function: (brandId, blob) → server response. */
  upload: (brandId: string, blob: Blob) => Promise<{ logoPath?: string; faviconPath?: string }>;
  /** Called after a successful upload with the new server-supplied path. */
  onUploaded: (path: string) => void;
  /** Display radius — full for logo, square-rounded for favicon. */
  displayShape?: 'circle' | 'square';
}

const MAX_INPUT_SIZE = 5 * 1024 * 1024; // 5 MB before crop; server enforces its own limits after crop

export function BrandAssetUploader({
  brandId,
  label,
  helperText,
  currentPath,
  outputSize,
  outputMime,
  upload,
  onUploaded,
  displayShape = 'circle',
}: BrandAssetUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const [displayPath, setDisplayPath] = useState<string | null>(currentPath);

  const uploadMutation = useMutation({
    mutationFn: (blob: Blob) => upload(brandId, blob),
    onSuccess: (res) => {
      const next = res.logoPath ?? res.faviconPath ?? null;
      if (next) {
        setDisplayPath(next);
        onUploaded(next);
      }
      toast.success(`${label} updated.`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : `${label} upload failed.`);
    },
  });

  function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file.');
      return;
    }
    if (file.size > MAX_INPUT_SIZE) {
      toast.error('Image must be under 5 MB.');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPickedImage(objectUrl);
  }

  function closeCropper() {
    if (pickedImage) URL.revokeObjectURL(pickedImage);
    setPickedImage(null);
  }

  function handleCropConfirm(blob: Blob) {
    uploadMutation.mutate(blob, { onSettled: closeCropper });
  }

  const cacheBusted = displayPath ? `${displayPath}?t=${Date.now()}` : null;
  const previewClass =
    displayShape === 'circle'
      ? 'h-24 w-24 rounded-full'
      : 'h-16 w-16 rounded-md';

  return (
    <div className="flex items-center gap-4">
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden border border-border bg-muted ${previewClass}`}
        aria-label={`${label} preview`}
      >
        {cacheBusted ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cacheBusted} alt={`${label} preview`} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {helperText ? (
            <span className="text-xs text-muted-foreground">{helperText}</span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="self-start"
        >
          <Upload className="h-4 w-4" />
          {displayPath ? 'Replace…' : 'Choose file…'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {pickedImage ? (
        <ImageCropperDialog
          imageSrc={pickedImage}
          outputSize={outputSize}
          outputMime={outputMime}
          title={`Crop ${label.toLowerCase()}`}
          description="Drag to reposition, scroll to zoom. The image will be saved as a square."
          onCancel={closeCropper}
          onConfirm={handleCropConfirm}
        />
      ) : null}
    </div>
  );
}
