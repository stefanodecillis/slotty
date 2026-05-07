import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BRAND } from '@/lib/brand';

import { ThemeControls } from './_components/theme-controls';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-label-l text-on-surface-variant">Phase 0</p>
        <h1 className="text-display-m text-on-background">{BRAND.name}</h1>
        <p className="text-body-l text-on-surface-variant">{BRAND.tagline}</p>
      </header>

      <Card variant="filled" className="p-6">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Material You is wired up</h2>
          <p className="mt-1 text-body-m text-on-surface-variant">
            Pick a seed color or toggle the theme — the whole UI re-derives the
            tonal palette from <code className="font-mono">@material/material-color-utilities</code>.
          </p>
        </Card.Header>
        <Card.Content className="mt-4">
          <ThemeControls />
        </Card.Content>
      </Card>

      <Card variant="outlined" className="p-6">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Next steps</h2>
        </Card.Header>
        <Card.Content className="mt-4 space-y-2 text-body-m text-on-surface-variant">
          <p>
            <span className="text-on-surface">/setup</span> — first-run admin
            account creation (Phase 1).
          </p>
          <p>
            <span className="text-on-surface">/admin/calendars</span> — connect
            Google accounts (Phase 3).
          </p>
          <p>
            <span className="text-on-surface">/&lt;event-slug&gt;</span> — public
            booking page (Phase 6).
          </p>
        </Card.Content>
        <Card.Actions className="mt-6 flex justify-end gap-2">
          <a href="https://github.com/slotty/slotty" target="_blank" rel="noreferrer">
            <Button variant="text">GitHub</Button>
          </a>
          <a href="/api/health">
            <Button variant="filled">Health check</Button>
          </a>
        </Card.Actions>
      </Card>
    </main>
  );
}
