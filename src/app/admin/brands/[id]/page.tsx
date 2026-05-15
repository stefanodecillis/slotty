import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';

import { BrandForm } from '../_components/brand-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function BrandEditPage({ params }: PageProps) {
  const user = await requireUserOrRedirect(
    `/admin/login?next=%2Fadmin%2Fbrands%2F${params.id}`,
  );

  const brand = await db.brand.findUnique({
    where: { id: params.id },
    include: { _count: { select: { eventTypes: true } } },
  });

  if (!brand || brand.userId !== user.id) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <Link
        href="/admin/brands"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to brands
      </Link>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{brand.name}</h1>
        <p className="mt-1 text-base text-muted-foreground">Edit brand details and assets.</p>
      </header>
      <BrandForm
        mode="edit"
        brand={{
          id: brand.id,
          name: brand.name,
          primaryColor: brand.primaryColor,
          accentColor: brand.accentColor,
          logoPath: brand.logoPath,
          faviconPath: brand.faviconPath,
          attachedEventTypes: brand._count.eventTypes,
        }}
      />
    </div>
  );
}
