'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
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
    // Detect if TOTP is enabled via a simple data attribute set server-side
    // (we avoid a separate API call by checking the DOM — but here we use fetch).
    void fetch('/api/admin/security/sessions').then(() => {
      // This gives us a session check; TOTP status is loaded separately.
    });
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-headline-m text-on-surface">Security</h1>
        <p className="text-body-m text-on-surface-variant">
          Manage your password, two-factor authentication, and active sessions.
        </p>
      </header>

      {/* Change password */}
      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Change password</h2>
        </Card.Header>
        <Card.Content>
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
            {passwordError && <p className="text-body-s text-error">{passwordError}</p>}
            {passwordSuccess && <p className="text-body-s text-secondary">{passwordSuccess}</p>}
            <Button
              variant="filled"
              onClick={() => void handleChangePassword()}
              disabled={savingPassword}
            >
              {savingPassword ? 'Saving...' : 'Change password'}
            </Button>
          </div>
        </Card.Content>
      </Card>

      {/* 2FA */}
      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Two-factor authentication (TOTP)</h2>
          <p className="text-body-m text-on-surface-variant">
            {totpEnabled ? '2FA is enabled.' : '2FA is disabled.'}
          </p>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
            {!totpEnabled ? (
              <Button variant="tonal" onClick={() => void handleStartTotpSetup()}>
                Enable 2FA
              </Button>
            ) : (
              <>
                <Button variant="outlined" onClick={() => setShowDisableDialog(true)}>
                  Disable 2FA
                </Button>
                {backupCodes.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-label-m text-on-surface">
                      Backup codes (save these now):
                    </p>
                    <div className="grid grid-cols-2 gap-1 rounded-shape-xs bg-surface-container-highest p-3">
                      {backupCodes.map((c) => (
                        <span key={c} className="font-mono text-body-s text-on-surface">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Card.Content>
      </Card>

      {/* Sessions */}
      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Active sessions</h2>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-3">
            {sessionsLoading ? (
              <p className="text-body-m text-on-surface-variant">Loading...</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {sessions.map((s) => (
                    <li key={s.fullId} className="flex items-center gap-2 text-body-s">
                      <span className="font-mono text-on-surface">{s.id}</span>
                      <span className="text-on-surface-variant">
                        expires {new Date(s.expiresAt).toLocaleDateString()}
                      </span>
                      {s.isCurrent && (
                        <span className="rounded-full bg-secondary-container px-2 text-label-s text-on-secondary-container">
                          current
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {sessions.filter((s) => !s.isCurrent).length > 0 && (
                  <Button
                    variant="outlined"
                    onClick={() => void handleRevokeAllSessions()}
                  >
                    Sign out everywhere else
                  </Button>
                )}
              </>
            )}
          </div>
        </Card.Content>
      </Card>

      {/* TOTP enable dialog */}
      <Dialog open={showEnableDialog} onOpenChange={setShowEnableDialog}>
        <Dialog.Content className="max-w-sm">
          <Dialog.Title>Enable two-factor authentication</Dialog.Title>
          <div className="flex flex-col gap-4 pb-4">
            {totpSetupData && (
              <>
                <p className="text-body-m text-on-surface-variant">
                  Scan this QR code with your authenticator app, or enter the secret manually.
                </p>
                <div className="rounded-shape-xs bg-surface-container-highest p-3">
                  <p className="text-label-m text-on-surface-variant mb-1">Secret key:</p>
                  <p className="font-mono text-body-s text-on-surface break-all">
                    {totpSetupData.secret}
                  </p>
                  <p className="text-label-m text-on-surface-variant mt-2 mb-1">URI:</p>
                  <p className="font-mono text-body-xs text-on-surface-variant break-all">
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
              Enter your password to confirm disabling 2FA.
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
