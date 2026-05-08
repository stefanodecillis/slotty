'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, ShieldCheck, Shield, Monitor } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  changePassword,
  disableTotp,
  enableTotp,
  listSessions,
  revokeOtherSessions,
  securityKeys,
  setupTotp,
  type Session,
  type TotpSetupResponse,
} from '@/lib/api/security';

export default function SecurityPage() {
  const queryClient = useQueryClient();

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // TOTP
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [showEnableDialog, setShowEnableDialog] = useState(false);
  const [totpSetupData, setTotpSetupData] = useState<TotpSetupResponse | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState('');

  // ── Sessions list ──
  const sessionsQuery = useQuery({
    queryKey: securityKeys.sessions(),
    queryFn: listSessions,
  });
  const sessions: Session[] = sessionsQuery.data?.data ?? [];
  const sessionsLoading = sessionsQuery.isLoading;

  const passwordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: (data) => {
      setPasswordSuccess(data.message ?? 'Password changed. Please sign in again.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err) => {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password.');
    },
  });
  const savingPassword = passwordMutation.isPending;

  const totpSetupMutation = useMutation({
    mutationFn: setupTotp,
    onSuccess: (data) => {
      setTotpSetupData(data);
      setShowEnableDialog(true);
    },
  });

  const totpEnableMutation = useMutation({
    mutationFn: enableTotp,
    onSuccess: (data) => {
      setTotpEnabled(true);
      setBackupCodes(data.backupCodes ?? []);
      setShowEnableDialog(false);
      setTotpSetupData(null);
      setTotpCode('');
    },
    onError: (err) => {
      setTotpError(err instanceof Error ? err.message : 'Invalid code.');
    },
  });

  const totpDisableMutation = useMutation({
    mutationFn: disableTotp,
    onSuccess: () => {
      setTotpEnabled(false);
      setBackupCodes([]);
      setShowDisableDialog(false);
      setDisablePassword('');
    },
    onError: (err) => {
      setDisableError(err instanceof Error ? err.message : 'Failed to disable 2FA.');
    },
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: securityKeys.sessions() });
    },
  });

  function handleChangePassword() {
    setPasswordError('');
    setPasswordSuccess('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required.');
      return;
    }
    passwordMutation.mutate({ currentPassword, newPassword, confirmPassword });
  }

  function handleStartTotpSetup() {
    setTotpError('');
    totpSetupMutation.mutate();
  }

  function handleEnableTotp() {
    if (!totpSetupData || !totpCode) return;
    setTotpError('');
    totpEnableMutation.mutate({ secret: totpSetupData.secret, code: totpCode });
  }

  function handleDisableTotp() {
    setDisableError('');
    totpDisableMutation.mutate({ password: disablePassword });
  }

  function handleRevokeAllSessions() {
    if (!confirm('Sign out of all other sessions?')) return;
    revokeSessionsMutation.mutate();
  }

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <Link
        href="/admin/settings"
        className="mb-4 inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to settings
      </Link>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Security</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Password, two-factor authentication, and active sessions.
        </p>
      </header>

      {/* Password */}
      <section>
        <h2 className="text-lg font-semibold text-foreground">Password</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Use a long, unique password. After changing, you'll need to sign in again.
        </p>
        <div className="rounded-lg bg-muted/50 p-6">
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {passwordError && (
              <p className="text-xs text-destructive" role="alert">
                {passwordError}
              </p>
            )}
            {passwordSuccess && (
              <p className="text-xs text-emerald-600">{passwordSuccess}</p>
            )}
            <div className="flex justify-end">
              <Button
                onClick={handleChangePassword}
                disabled={savingPassword}
              >
                {savingPassword ? 'Saving…' : 'Change password'}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 2FA */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-foreground">Two-factor authentication</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Require a 6-digit code from an authenticator app on every sign-in.
        </p>
        <div className="rounded-lg bg-muted/50 p-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    totpEnabled
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-card text-muted-foreground'
                  }`}
                >
                  {totpEnabled ? (
                    <ShieldCheck className="h-5 w-5" />
                  ) : (
                    <Shield className="h-5 w-5" />
                  )}
                </span>
                <div>
                  <p className="text-base font-medium text-foreground">
                    {totpEnabled ? '2FA is enabled' : '2FA is disabled'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {totpEnabled ? 'Your account is protected.' : 'Add an extra layer of security.'}
                  </p>
                </div>
              </div>
              {!totpEnabled ? (
                <Button variant="secondary" onClick={handleStartTotpSetup}>
                  Enable 2FA
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setShowDisableDialog(true)}>
                  Disable
                </Button>
              )}
            </div>

            {backupCodes.length > 0 && (
              <div className="mt-2 rounded-md border border-border bg-card p-4">
                <p className="text-sm font-medium text-foreground">
                  Backup codes — save these now:
                </p>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">
                  Each code can be used once if you lose access to your authenticator.
                </p>
                <div className="grid grid-cols-2 gap-1 rounded-sm bg-muted/50 p-3 font-mono text-xs text-foreground">
                  {backupCodes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Sessions */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-foreground">Active sessions</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Devices currently signed in to your account.
        </p>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {sessionsLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <ul>
              {sessions.map((s, idx) => (
                <li
                  key={s.fullId}
                  className={`flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
                    idx > 0 ? 'border-t border-border' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/50">
                      <Monitor className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div className="flex flex-col">
                      <span className="font-mono text-xs text-foreground">{s.id}</span>
                      <span className="text-xs text-muted-foreground">
                        Expires {new Date(s.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {s.isCurrent && (
                    <span className="self-start rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground sm:self-center">
                      Current
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {otherSessions.length > 0 && (
            <div className="flex justify-end border-t border-border px-5 py-3">
              <Button variant="outline" onClick={handleRevokeAllSessions}>
                Sign out everywhere else
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* TOTP enable dialog */}
      <Dialog open={showEnableDialog} onOpenChange={setShowEnableDialog}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Enable two-factor authentication</DialogTitle>
          <div className="flex flex-col gap-4 pb-4">
            {totpSetupData && (
              <>
                <p className="text-sm text-muted-foreground">
                  Add this account to your authenticator, then enter the 6-digit code below.
                </p>
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Secret key</p>
                  <p className="mt-1 break-all font-mono text-xs text-foreground">
                    {totpSetupData.secret}
                  </p>
                  <p className="mt-3 text-xs font-medium text-muted-foreground">URI</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {totpSetupData.uri}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="totpCode">Verification code</Label>
                  <Input
                    id="totpCode"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="000000"
                    autoComplete="one-time-code"
                  />
                </div>
                {totpError && <p className="text-xs text-destructive">{totpError}</p>}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowEnableDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleEnableTotp} disabled={totpEnableMutation.isPending}>
              Verify and enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TOTP disable dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Disable two-factor authentication</DialogTitle>
          <div className="flex flex-col gap-4 pb-4">
            <p className="text-sm text-muted-foreground">
              Enter your password to confirm.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="disablePassword">Password</Label>
              <Input
                id="disablePassword"
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {disableError && <p className="text-xs text-destructive">{disableError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDisableDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleDisableTotp} disabled={totpDisableMutation.isPending}>
              Disable 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
