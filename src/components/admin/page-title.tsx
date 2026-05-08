'use client';

import { usePathname } from 'next/navigation';
import { resolvePageLabel } from './admin-nav-items';

export function AdminPageTitle() {
  const pathname = usePathname() ?? '';
  const label = resolvePageLabel(pathname);
  return (
    <h1 className="truncate text-base font-semibold md:text-lg" aria-label="Current page">
      {label}
    </h1>
  );
}
