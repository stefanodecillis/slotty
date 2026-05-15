import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { requireUserOrRedirect } from '@/lib/auth/session';

import { BrandForm } from '../_components/brand-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'New brand' };

export default async function NewBrandPage() {
  await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fbrands%2Fnew');

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
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">New brand</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Set a name and colors first; you&apos;ll upload a logo and favicon on the next step.
        </p>
      </header>
      <BrandForm mode="create" />
    </div>
  );
}
