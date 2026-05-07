# UI components

shadcn-style primitives, Material You (M3) design language.

This folder is **not a third-party package** — every component lives in your
codebase, you own it, you can edit it. Add variants when you need them, drop
the abstraction when you don't.

## Philosophy

- **shadcn idioms.** `forwardRef`, `cva` for variant systems, `Slot`-backed
  `asChild`, `cn(...)` everywhere, both individual named exports and a
  back-compat namespace object on the components that already had one.
- **Material You styling.** All colors map to M3 system roles
  (`primary`, `surface-container-high`, `outline`, …) defined in
  [`tailwind.config.ts`](../../../tailwind.config.ts) and powered by the
  CSS variables emitted by `src/lib/theme/generate.ts`. Shape (`rounded-shape-*`),
  type scale (`text-headline-m`, `text-body-l`, …), and motion easings
  (`ease-emphasized`, `ease-standard`) likewise come from M3 tokens — no random
  hex values, no shadows outside the elevation tone scale.
- **Accessibility-first primitives** via `@radix-ui/*`.
- **Light, focused.** Every file is a single component (or a small family).
  Most are <150 lines.

## Component overview

| Component        | What it is                                                                 | Notes                                                                                  |
| ---------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Button`         | Pill-shaped action. Variants: `filled` `tonal` `outlined` `text` `elevated`. | `loading` swaps in a spinner; `asChild` lets you wrap a `<Link>`/`<a>`.                  |
| `IconButton`     | 40×40 round icon button. Variants: `standard` `filled` `tonal` `outlined`.   | Pass a Material Symbol name as `children`, or any `<svg>`/ReactNode.                    |
| `Card`           | M3 surface with `Header` / `Title` / `Description` / `Content` / `Actions`.  | Variants: `filled` `outlined` `elevated`.                                              |
| `TextField`      | M3 outlined input with floating label (CSS-driven via `:placeholder-shown`). | Survives autofill, native form submission, uncontrolled use.                           |
| `Input`          | Bare M3 outlined input.                                                    | Pair with `<Label>` for the canonical shadcn pattern.                                  |
| `Textarea`       | Bare M3 outlined textarea.                                                 |                                                                                        |
| `Label`          | Radix-backed `<label>` with `htmlFor` forwarding.                          |                                                                                        |
| `Switch`         | M3 switch (52×32 track, 16/24 thumb).                                      | Pass `label`/`description` to render an inline labeled row.                            |
| `Dialog`         | Radix dialog with M3 scrim, surface-container-high content.                | Use `<DialogContent>` / `<DialogTitle>` / `<DialogDescription>` / `<DialogFooter>`.    |
| `Snackbar`       | Radix-toast-based bottom snackbar with provider + `useSnackbar` hook.      | Variants: `default` `success` `warning` `error`. `Toaster` is a shadcn-style alias.    |
| `Select`         | Radix select with floating-label wrapper + searchable mode.                | Or use the lower-level `<SelectRoot>`/`<SelectTrigger>`/`<SelectContent>` exports.     |
| `NavigationRail` | M3 vertical primary nav (md+ screens).                                     | Active state derived from `usePathname()` unless `item.active` is set explicitly.       |
| `NavigationBar`  | M3 horizontal bottom nav (mobile).                                         | Same active-state semantics.                                                           |
| `Separator`      | Radix-backed thin divider on `outline-variant` tone.                       |                                                                                        |
| `Tooltip`        | Radix tooltip on `inverse-surface` (M3 plain tooltip).                     | Wrap once in `<TooltipProvider>` near the app root.                                    |
| `Tabs`           | Radix tabs with M3 underline indicator.                                    |                                                                                        |
| `Checkbox`       | M3 checkbox (18px rounded square).                                         |                                                                                        |
| `RadioGroup`     | M3 radio group + item.                                                     |                                                                                        |
| `Skeleton`       | `animate-pulse` placeholder on `surface-container-highest`.                |                                                                                        |
| `Badge`          | Status pill. Variants: `default` `outline` `destructive`.                  |                                                                                        |

## Common patterns

### `asChild` for links

`Button`, `IconButton`, `Card`, `NavigationRail.Item`, `NavigationBar.Item`,
and `SnackbarAction` all support `asChild` — the immediate child element
inherits the styles. Don't wrap an `<a>` around a `<Button>`; do this:

```tsx
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

<Button asChild variant="filled">
  <Link href="/admin">Open admin</Link>
</Button>;
```

### Floating-label form (`TextField`)

```tsx
<TextField
  label="Username"
  name="username"
  required
  autoComplete="username"
/>
```

The "floating" detection is CSS-based via `:placeholder-shown` and `:focus`,
so it works correctly with browser autofill and native form submission.

### Bare input + label (`Input` + `Label`)

```tsx
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

<div className="grid gap-2">
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" />
</div>;
```

### Snackbar

```tsx
import { SnackbarProvider, useSnackbar } from '@/components/ui/Snackbar';

// Once near the app root:
<SnackbarProvider>{children}</SnackbarProvider>;

// Anywhere inside:
const { show } = useSnackbar();
show({ message: 'Saved', variant: 'success' });
show({
  message: 'Network error',
  variant: 'error',
  actionLabel: 'Retry',
  onAction: retry,
});
```

`Toaster` is a shadcn-style alias for `SnackbarProvider`. The legacy
`<Snackbar.Provider>` namespace is preserved.

### Card composition

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardActions,
} from '@/components/ui/Card';

<Card variant="elevated">
  <CardHeader>
    <CardTitle>Webhooks</CardTitle>
    <CardDescription>Endpoints that receive booking events.</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardActions>
    <Button variant="text">Cancel</Button>
    <Button>Save</Button>
  </CardActions>
</Card>;
```

The legacy `<Card.Header>` / `<Card.Content>` / `<Card.Actions>` namespace
also works.

### Dialog

```tsx
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/Dialog';

<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogTitle>Cancel booking</DialogTitle>
    <DialogDescription>This cannot be undone.</DialogDescription>
    <DialogFooter>
      <Button variant="text" onClick={() => setOpen(false)}>
        Keep
      </Button>
      <Button onClick={confirm}>Cancel booking</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>;
```

## Adding new components

1. Create `src/components/ui/<Name>.tsx`.
2. `'use client'` if it needs hooks or browser APIs.
3. `import * as React from 'react'`, use `React.forwardRef`, set `displayName`.
4. Use `cva` for any variant system, with explicit `defaultVariants`.
5. Export both the component and its `VariantProps` type when applicable.
6. Re-export from `index.ts`.

Keep the M3 token constraint: only colors / shapes / type-scale / easings
defined in `tailwind.config.ts` — no raw hex, no off-grid radii, no shadow
beyond the elevation tones.
