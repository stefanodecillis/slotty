import { Bot } from 'lucide-react';

/**
 * A quiet line under a booking page telling people their AI assistant can
 * use this same link, and pointing assistants that read the rendered page
 * at the machine-readable version.
 */
export function AgentHint({ href }: { href: string }) {
  return (
    <p className="mx-auto flex max-w-xl items-center justify-center gap-1.5 px-6 pb-2 text-center text-xs text-muted-foreground/70">
      <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Using an AI assistant? Give it this link — it can read{' '}
        <a href={href} rel="nofollow" className="underline underline-offset-2 hover:text-muted-foreground">
          booking instructions for assistants
        </a>
        .
      </span>
    </p>
  );
}
