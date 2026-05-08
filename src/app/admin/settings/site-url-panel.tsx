'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Info, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { SiteUrlDiagnostic, IssueSeverity } from '@/lib/site-url/diagnose';

interface SiteUrlState {
  override: string | null;
  envValue: string;
  effective: string;
}

const siteUrlKeys = {
  diagnose: ['site-url', 'diagnose'] as const,
  state: ['site-url', 'state'] as const,
};

async function fetchDiagnostic(): Promise<SiteUrlDiagnostic> {
  const res = await fetch('/api/admin/site-url/diagnose', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchState(): Promise<SiteUrlState> {
  const res = await fetch('/api/admin/site-url', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function saveOverride(url: string): Promise<SiteUrlState> {
  const res = await fetch('/api/admin/site-url', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function severityBadge(severity: IssueSeverity) {
  switch (severity) {
    case 'error':
      return <Badge variant="destructive">Error</Badge>;
    case 'warning':
      return <Badge variant="secondary">Warning</Badge>;
    case 'info':
      return <Badge variant="outline">Info</Badge>;
  }
}

function severityIcon(severity: IssueSeverity) {
  const cls = 'h-4 w-4 shrink-0 mt-0.5';
  switch (severity) {
    case 'error':
      return <XCircle className={`${cls} text-destructive`} />;
    case 'warning':
      return <AlertTriangle className={`${cls} text-amber-500`} />;
    case 'info':
      return <Info className={`${cls} text-muted-foreground`} />;
  }
}

interface RowProps {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}

function Row({ label, value, mono = false }: RowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-sm text-foreground' : 'text-sm text-foreground'}>
        {value ?? <span className="text-muted-foreground italic">not sent</span>}
      </span>
    </div>
  );
}

export function SiteUrlPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: siteUrlKeys.diagnose,
    queryFn: fetchDiagnostic,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const stateQuery = useQuery({
    queryKey: siteUrlKeys.state,
    queryFn: fetchState,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const [draft, setDraft] = useState('');

  // Hydrate the input once the override loads. Re-syncs whenever the
  // server-side state changes (e.g. after a successful save).
  useEffect(() => {
    if (stateQuery.data) {
      setDraft(stateQuery.data.override ?? stateQuery.data.envValue);
    }
  }, [stateQuery.data]);

  const saveMutation = useMutation({
    mutationFn: saveOverride,
    onSuccess: (next) => {
      toast.success(
        next.override
          ? 'Public URL override saved'
          : 'Override cleared — falling back to env value',
      );
      queryClient.setQueryData(siteUrlKeys.state, next);
      void queryClient.invalidateQueries({ queryKey: siteUrlKeys.diagnose });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    },
  });

  const data = query.data;
  const reachOk = data?.reachability.ok ?? false;
  const issues = data?.issues ?? [];
  const hasErrors = issues.some((i) => i.severity === 'error');

  const state = stateQuery.data;
  const usingOverride = Boolean(state?.override);
  const dirty = state ? draft.trim() !== (state.override ?? state.envValue) : false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-border bg-background px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Public site URL</p>
          {usingOverride ? (
            <Badge variant="secondary">Override active</Badge>
          ) : (
            <Badge variant="outline">Using env</Badge>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="public-url" className="text-xs">
            URL handed to bookers
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="public-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={state?.envValue ?? 'https://book.example.com'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="font-mono text-sm"
              disabled={!state || saveMutation.isPending}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => saveMutation.mutate(draft.trim())}
                disabled={!state || !dirty || saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              {usingOverride && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveMutation.mutate('')}
                  disabled={saveMutation.isPending}
                  title="Clear override and revert to env value"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Used for invite links, the booker’s manage URL, and the “copy public link” button. <strong className="font-medium text-foreground">Doesn’t change</strong> Google OAuth redirect URI, calendar webhook channel address, or cookie security flags — those still come from <code className="font-mono">SLOTTY_PUBLIC_URL</code> at boot. Update env + restart the container if you change the host the app is actually served from.
        </p>

        {state && (
          <div className="flex flex-col gap-1 rounded-sm bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Effective URL</span>
              <span className="font-mono text-foreground">{state.effective}</span>
            </div>
            <div className="flex justify-between">
              <span>Env value (boot fallback)</span>
              <span className="font-mono">{state.envValue}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Diagnostics check the effective URL above against the live request and the configured upstream.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
          Re-check
        </Button>
      </div>

      {query.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Failed to load diagnostics: {(query.error as Error).message}
        </div>
      )}

      {data && (
        <>
          <div className="rounded-md border border-border bg-background px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              {reachOk ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-sm font-medium text-foreground">
                Reachability
              </span>
              <span className="text-xs text-muted-foreground">
                {reachOk
                  ? `${data.reachability.status} OK · ${data.reachability.durationMs}ms`
                  : data.reachability.error ?? 'unreachable'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Server-side fetch of <code className="font-mono">{data.configured}/api/health</code>.
              If this fails, the configured URL doesn&apos;t round-trip back to this app — check
              DNS, your reverse proxy upstream target, and container networking.
            </p>
          </div>

          <div className="rounded-md border border-border bg-background px-4 py-3">
            <p className="mb-2 text-sm font-medium text-foreground">Forwarded headers</p>
            <Row label="Configured host" value={data.configuredHost} mono />
            <Row label="Configured protocol" value={data.configuredProto} mono />
            <Row label="Host" value={data.observed.host} mono />
            <Row label="X-Forwarded-Host" value={data.observed.xForwardedHost} mono />
            <Row label="X-Forwarded-Proto" value={data.observed.xForwardedProto} mono />
            <Row label="X-Forwarded-For" value={data.observed.xForwardedFor} mono />
            <Row label="Trust proxy" value={data.trustProxy ? 'enabled' : 'disabled'} />
          </div>

          {issues.length > 0 ? (
            <div className="rounded-md border border-border bg-background px-4 py-3">
              <p className="mb-2 text-sm font-medium text-foreground">
                {hasErrors ? 'Issues detected' : 'Notes'}
              </p>
              <ul className="flex flex-col gap-3">
                {issues.map((issue, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    {severityIcon(issue.severity)}
                    <div className="flex flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        {severityBadge(issue.severity)}
                        <span className="text-sm text-foreground">{issue.message}</span>
                      </div>
                      {issue.hint && (
                        <p className="text-xs text-muted-foreground">{issue.hint}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm text-foreground">
                No mismatches detected between configured URL and observed proxy headers.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
