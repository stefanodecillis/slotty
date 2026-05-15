'use client';

/**
 * Square-aspect image cropper with zoom + drag-to-reposition.
 * Wraps `react-easy-crop` in a Radix Dialog and resolves with a square `Blob`
 * the caller can POST. The server re-encodes and EXIF-strips defensively.
 */
import { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { ZoomIn, ZoomOut, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ImageCropperDialogProps {
  /** Object URL of the source image (caller is responsible for revoking it). */
  imageSrc: string;
  /** Output dimensions of the produced square Blob, in pixels. */
  outputSize: number;
  /** MIME type for the produced Blob ('image/webp' for logos, 'image/png' for favicons). */
  outputMime: 'image/webp' | 'image/png';
  title: string;
  description?: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function ImageCropperDialog({
  imageSrc,
  outputSize,
  outputMime,
  title,
  description,
  onCancel,
  onConfirm,
}: ImageCropperDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await exportCroppedBlob({
        imageSrc,
        crop: croppedAreaPixels,
        rotation,
        outputSize,
        outputMime,
      });
      onConfirm(blob);
    } finally {
      setBusy(false);
    }
  };

  function handleOpenChange(next: boolean) {
    if (!next && !busy) onCancel();
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="relative h-72 w-full overflow-hidden rounded-md bg-muted">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={1}
            cropShape="rect"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <ZoomOut className="h-4 w-4 text-muted-foreground" aria-hidden />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="flex-1 accent-primary"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              disabled={busy}
            >
              <RotateCw className="h-4 w-4" />
              Rotate
            </Button>
            <p className="text-xs text-muted-foreground">
              Drag to reposition, scroll or pinch to zoom.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={busy || !croppedAreaPixels}>
            {busy ? 'Processing…' : 'Use this crop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Canvas export
// ─────────────────────────────────────────────────────────────

interface ExportArgs {
  imageSrc: string;
  crop: Area;
  rotation: number;
  outputSize: number;
  outputMime: 'image/webp' | 'image/png';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Convert the cropper's pixel rectangle + rotation into a square Blob.
 * Trade-off: we render at the caller-specified `outputSize` (square) so the
 * upload stays small. The server re-encodes anyway, so an oversized client
 * render only wastes bytes on the wire.
 */
async function exportCroppedBlob({
  imageSrc,
  crop,
  rotation,
  outputSize,
  outputMime,
}: ExportArgs): Promise<Blob> {
  const image = await loadImage(imageSrc);

  // Step 1: render the (possibly rotated) source into a temporary canvas large
  // enough to contain it. This lets us crop straight from "rotated source space"
  // in step 2 without doing the rotation math by hand on the crop rect.
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const bboxWidth = image.width * cos + image.height * sin;
  const bboxHeight = image.width * sin + image.height * cos;

  const rotatedCanvas = document.createElement('canvas');
  rotatedCanvas.width = bboxWidth;
  rotatedCanvas.height = bboxHeight;
  const rotatedCtx = rotatedCanvas.getContext('2d');
  if (!rotatedCtx) throw new Error('Failed to create 2D context');

  rotatedCtx.translate(bboxWidth / 2, bboxHeight / 2);
  rotatedCtx.rotate(rad);
  rotatedCtx.drawImage(image, -image.width / 2, -image.height / 2);

  // Step 2: copy the crop rect from the rotated canvas to the final square,
  // resampling to outputSize × outputSize in one pass.
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outputSize;
  outCanvas.height = outputSize;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Failed to create 2D context');

  outCtx.drawImage(
    rotatedCanvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas export returned null blob'));
      },
      outputMime,
      0.92,
    );
  });
}

// Re-export for tests / callers that want to drive the export independently.
export { exportCroppedBlob };
