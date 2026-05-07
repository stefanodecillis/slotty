'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Dialog } from '@/components/ui/Dialog';

interface Session {
  id: string;
  fullId: string;
  expiresAt: string;
  isCurrent: boolean;
}

export default function SecurityPage() {
  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // TOTP
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [showEnableDialog, setShowEnableDialog] = useState(false);
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState('');

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch('/api/admin/security/sessions');
      if (res.ok) {
        const data = await res.json() as { data: Session[] };
        setSessions(data.data);
      }
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function handleChangePassword() {
    setPasswordError('');
    setPasswordSuccess('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required.');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch('/api/admin/security/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) {
        setPasswordError(data.error ?? 'Failed to change password.');
        return;
      }
      setPasswordSuccess(data.message ?? 'Password changed. Please sign in again.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleStartTotpSetup() {
    setTotpError('');
    const res = await fetch('/api/admin/security/totp/setup', { method: 'POST' });
    if (res.ok) {
      const data = await res.json() as { secret: string; uri: string };
      setTotpSetupData(data);
      setShowEnableDialog(true);
    }
  }

  async function handleEnableTotp() {
    if (!totpSetupData || !totpCode) return;
    setTotpError('');
    const res = await fetch('/api/admin/security/totp/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: totpSetupData.secret, code: totpCode }),
    });
    const data = await res.json() as { error?: string; backupCodes?: string[] };
    if (!res.ok) {
      setTotpError(data.error ?? 'Invalid code.');
      return;
    }
    setTotpEnabled(true);
    setBackupCodes(data.backupCodes ?? []);
    setShowEnableDialog(false);
    setTotpSetupData(null);
    setTotpCode('');
  }

  async function handleDisableTotp() {
    setDisableError('');
    const res = await fetch('/api/admin/security/totp/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: disablePassword }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) {
      setDisableError(data.error ?? 'Failed to disable 2FA.');
      return;
    }
    setTotpEnabled(false);
    setBackupCodes([]);
    setShowDisableDialog(false);
    setDisablePassword('');
  }

  async function handleRevokeAllSessions() {
    if (!confirm('Sign out of all other sessions?')) return;
    await fetch('/api/admin/security/sessions', { method: 'DELETE' });
    await loadSessions();
  }

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <Link
        href="/admin/settings"
        className="mb-4 inline-flex w-fit items-center gap-1 text-label-l text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Back to settings
      </Link>

      <header className="mb-8">
        <h1 className="text-display-s text-on-background">Security</h1>
        <p className="mt-1 text-body-l text-on-surface-variant">
          Password, two-factor authentication, and active sessions.
        </p>
      </header>

      {/* Password */}
      <section>
        <h2 className="text-title-l text-on-surface">Password</h2>
        <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
          Use a long, unique password. After changing, you'll need to sign in again.
        </p>
        <div className="rounded-shape-md bg-surface-container-low p-6">
          <div className="flex flex-col gap-4">
            <TextField
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(v) => setCurrentPassword(v)}
              autoComplete="current-password"
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(v) => setNewPassword(v)}
              autoComplete="new-password"
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(v) => setConfirmPassword(v)}
              autoComplete="new-password"
            />
            {passwordError && (
              <p className="text-body-s text-error" role="alert">
                {passwordError}
              </p>
            )}
            {passwordSuccess && (
              <p className="text-body-s text-tertiary">{passwordSuccess}</p>
            )}
            <div className="flex justify-end">
              <Button
                variant="filled"
                onClick={() => void handleChangePassword()}
                loading={savingPassword}
                disabled={savingPassword}
              >
                Change password
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 2FA */}
      <section className="mt-12">
        <h2 className="text-title-l text-on-surface">Two-factor authentication</h2>
        <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
          Require a 6-digit code from an authenticator app on every sign-in.
        </p>
        <div className="rounded-shape-md bg-surface-container-low p-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    totpEnabled
                      ? 'bg-tertiary-container text-on-tertiary-container'
                      : 'bg-surface-container-high text-on-surface-variant'
                  }`}
                >
                  <span className="material-symbols-outlined">
                    {totpEnabled ? 'verified_user' : 'shield'}
                  </span>
                </span>
                <div>
                  <p className="text-title-m text-on-surface">
                    {totpEnabled ? '2FA is enabled' : '2FA is disabled'}
                  </p>
                  <p className="text-body-s text-on-surface-variant">
                    {totpEnabled ? 'Your account is protected.' : 'Add an extra layer of security.'}
                  </p>
                </div>
              </div>
              {!totpEnabled ? (
                <Button variant="tonal" onClick={() => void handleStartTotpSetup()}>
                  Enable 2FA
                </Button>
              ) : (
                <Button variant="outlined" onClick={() => setShowDisableDialog(true)}>
                  Disable
                </Button>
              )}
            </div>

            {backupCodes.length > 0 && (
              <div className="mt-2 rounded-shape-sm border border-outline-variant bg-surface p-4">
                <p className="text-label-l text-on-surface">
                  Backup codes — save these now:
                </p>
                <p className="mb-3 mt-1 text-body-s text-on-surface-variant">
                  Each code can be used once if you lose access to your authenticator.
                </p>
                <div className="grid grid-cols-2 gap-1 rounded-shape-xs bg-surface-container-low p-3 font-mono text-body-s text-on-surface">
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
        <h2 className="text-title-l text-on-surface">Active sessions</h2>
        <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
          Devices currently signed in to your account.
        </p>
        <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface">
          {sessionsLoading ? (
            <p className="p-6 text-body-m text-on-surface-variant">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="p-6 text-body-m text-on-surface-variant">No active sessions.</p>
          ) : (
            <ul>
              {sessions.map((s, idx) => (
                <li
                  key={s.fullId}
                  className={`flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
                    idx > 0 ? 'border-t border-outline-variant' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-low">
                      <span className="material-symbols-outlined text-on-surface-variant">
                        devices
                      </span>
                    </span>
                    <div className="flex flex-col">
                      <span className="font-mono text-body-s text-on-surface">{s.id}</span>
                      <span className="text-body-s text-on-surface-variant">
                        Expires {new Date(s.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {s.isCurrent && (
                    <span className="self-start rounded-full bg-secondary-container px-3 py-1 text-label-m text-on-secondary-container sm:self-center">
                      Current
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {otherSessions.length > 0 && (
            <div className="flex justify-end border-t border-outline-variant px-5 py-3">
              <Button variant="outlined" onClick={() => void handleRevokeAllSessions()}>
                Sign out everywhere else
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* TOTP enable dialog */}
      <Dialog open={showEnableDialog} onOpenChange={setShowEnableDialog}>
        <Dialog.Content className="max-w-sm">
          <Dialog.Title>Enable two-factor authentication</Dialog.Title>
          <div className="flex flex-col gap-4 pb-4">
            {totpSetupData && (
              <>
                <p className="text-body-m text-on-surface-variant">
                  Add this account to your authenticator, then enter the 6-digit code below.
                </p>
                <div className="rounded-shape-sm bg-surface-container-low p-3">
                  <p className="text-label-m text-on-surface-variant">Secret key</p>
                  <p className="mt-1 break-all font-mono text-body-s text-on-surface">
                    {totpSetupData.secret}
                  </p>
                  <p className="mt-3 text-label-m text-on-surface-variant">URI</p>
                  <p className="mt-1 break-all font-mono text-body-s text-on-surface-variant">
                    {totpSetupData.uri}
                  </p>
                </div>
                <TextField
                  label="Verification code"
                  value={totpCode}
                  onChange={(v) => setTotpCode(v)}
                  placeholder="000000"
                  autoComplete="one-time-code"
                />
                {totpError && <p className="text-body-s text-error">{totpError}</p>}
              </>
            )}
          </div>
          <Dialog.Actions>
            <Button variant="text" onClick={() => setShowEnableDialog(false)}>
              Cancel
            </Button>
            <Button variant="filled" onClick={() => void handleEnableTotp()}>
              Verify and enable
            </Button>
          </Dialog.Actions>
        </Dialog.Content>
      </Dialog>

      {/* TOTP disable dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <Dialog.Content className="max-w-sm">
          <Dialog.Title>Disable two-factor authentication</Dialog.Title>
          <div className="flex flex-col gap-4 pb-4">
            <p className="text-body-m text-on-surface-variant">
              Enter your password to confirm.
            </p>
            <TextField
              label="Password"
              type="password"
              value={disablePassword}
              onChange={(v) => setDisablePassword(v)}
              autoComplete="current-password"
            />
            {disableError && <p className="text-body-s text-error">{disableError}</p>}
          </div>
          <Dialog.Actions>
            <Button variant="text" onClick={() => setShowDisableDialog(false)}>
              Cancel
            </Button>
            <Button variant="filled" onClick={() => void handleDisableTotp()}>
              Disable 2FA
            </Button>
          </Dialog.Actions>
        </Dialog.Content>
      </Dialog>
    </div>
  );
}
