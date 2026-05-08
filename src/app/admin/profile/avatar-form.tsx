'use client';

import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { User } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AvatarFormProps {
  currentAvatarPath: string | null;
  userId: string;
}

export function AvatarForm({ currentAvatarPath, userId }: AvatarFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    currentAvatarPath ?? null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file.');
        return;
      }
      if (file.size > 1 * 1024 * 1024) {
        toast.error('Image must be under 1 MB.');
        return;
      }

      // Show immediate preview
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);

      const formData = new FormData();
      formData.set('avatar', file);

      setIsUploading(true);
      try {
        const res = await fetch('/api/admin/profile/avatar', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error ?? 'Upload failed.');
          setPreview(null);
          return;
        }

        const data = (await res.json()) as { avatarUrl?: string };
        setAvatarUrl(data.avatarUrl ?? null);
        setPreview(null);
        toast.success('Avatar updated.');
      } catch {
        toast.error('Upload failed. Please try again.');
        setPreview(null);
      } finally {
        setIsUploading(false);
        URL.revokeObjectURL(objectUrl);
      }
    },
    [],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const displaySrc = preview ?? avatarUrl;

  // Cache-bust the URL so the browser re-fetches after upload.
  const cacheBustedSrc = displaySrc
    ? `${displaySrc}?t=${Date.now()}`
    : null;

  return (
    <div className="flex flex-col items-stretch gap-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload avatar — click or drag an image here"
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={[
          'flex cursor-pointer flex-col items-center justify-center gap-4',
          'rounded-lg border-2 border-dashed px-6 py-8',
          'transition-colors duration-200 ease-out',
          isDragging
            ? 'border-primary bg-primary/[0.08]'
            : 'border-border hover:border-primary hover:bg-primary/[0.04]',
        ].join(' ')}
      >
        {cacheBustedSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cacheBustedSrc}
            alt={`Avatar for user ${userId}`}
            width={140}
            height={140}
            className="h-32 w-32 rounded-full object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-full bg-secondary">
            <User className="h-14 w-14 text-secondary-foreground" />
          </div>
        )}
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-medium text-foreground">
            {isUploading ? 'Uploading…' : 'Click or drag to upload'}
          </p>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, WebP or GIF · max 1 MB
          </p>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        className="w-full"
      >
        Choose file
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
