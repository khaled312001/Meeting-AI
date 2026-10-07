"use client";

import * as React from "react";
import { Laptop, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, Field, KeyValue, LoadingBlock, PageHeader, Pill, useConfirm } from "../ui";
import { useToast } from "../toast";
import { authClient, signOutAndTrack } from "@/lib/auth-client";
import { formatDate, formatRelative } from "@/lib/format";

interface DeviceSession {
  id: string;
  token: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function describeAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const app = /Electron/i.test(ua) ? "Desktop app" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
  return os ? `${app} on ${os}` : app;
}

export function AccountSection({
  user,
  currentSessionId,
}: {
  user: { name?: string | null; email?: string | null; createdAt?: Date | string | null };
  currentSessionId?: string;
}) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [name, setName] = React.useState(user.name ?? "");
  const [savingName, setSavingName] = React.useState(false);

  const [currentPw, setCurrentPw] = React.useState("");
  const [newPw, setNewPw] = React.useState("");
  const [confirmPw, setConfirmPw] = React.useState("");
  const [pwError, setPwError] = React.useState<string | null>(null);
  const [savingPw, setSavingPw] = React.useState(false);

  const [devices, setDevices] = React.useState<DeviceSession[] | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const loadDevices = React.useCallback(async () => {
    const res = await authClient.listSessions();
    setDevices((res.data as DeviceSession[] | null) ?? []);
  }, []);

  React.useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const saveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    const res = await authClient.updateUser({ name: name.trim() });
    setSavingName(false);
    if (res.error) toast.error(res.error.message || "Couldn't update your name");
    else toast.success("Name updated");
  };

  const changePassword = async () => {
    setPwError(null);
    if (newPw.length < 8) return setPwError("Use at least 8 characters.");
    if (newPw !== confirmPw) return setPwError("The new passwords don't match.");
    setSavingPw(true);
    const res = await authClient.changePassword({
      currentPassword: currentPw,
      newPassword: newPw,
      revokeOtherSessions: true,
    });
    setSavingPw(false);
    if (res.error) {
      setPwError(res.error.message || "Couldn't change your password");
      return;
    }
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    toast.success("Password changed. Other devices were signed out.");
    void loadDevices();
  };

  const revoke = async (d: DeviceSession) => {
    setRevoking(d.id);
    const res = await authClient.revokeSession({ token: d.token });
    setRevoking(null);
    if (res.error) toast.error(res.error.message || "Couldn't sign out that device");
    else {
      setDevices((prev) => prev?.filter((x) => x.id !== d.id) ?? null);
      toast.success("Device signed out");
    }
  };

  const revokeOthers = async () => {
    const ok = await confirm({
      title: "Sign out all other devices?",
      description: "Every other browser and desktop app signed in to your account will need to sign in again.",
      confirmLabel: "Sign out others",
      destructive: true,
    });
    if (!ok) return;
    const res = await authClient.revokeOtherSessions();
    if (res.error) toast.error(res.error.message || "Couldn't sign out other devices");
    else {
      toast.success("Other devices signed out");
      void loadDevices();
    }
  };

  const others = (devices ?? []).filter((d) => d.id !== currentSessionId);

  return (
    <>
      {dialog}
      <PageHeader title="Account" description="Your profile, password and signed-in devices." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <div className="space-y-4">
            <KeyValue
              items={[
                { label: "Email", value: user.email ?? "—" },
                { label: "Member since", value: formatDate(user.createdAt ?? null) },
              ]}
            />
            <Field label="Display name" htmlFor="acc-name">
              <div className="flex gap-2">
                <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
                <Button
                  variant="secondary"
                  onClick={() => void saveName()}
                  disabled={savingName || !name.trim() || name.trim() === (user.name ?? "")}
                >
                  {savingName && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
                </Button>
              </div>
            </Field>
          </div>
        </Card>

        <Card title="Password" description="Changing it signs out your other devices.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <Field label="Current password" htmlFor="acc-cur">
              <Input
                id="acc-cur"
                type="password"
                autoComplete="current-password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New password" htmlFor="acc-new">
                <Input
                  id="acc-new"
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="acc-confirm">
                <Input
                  id="acc-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                />
              </Field>
            </div>
            {pwError && <p className="text-xs text-destructive">{pwError}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={savingPw || !currentPw || !newPw}>
                {savingPw && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Change password
              </Button>
            </div>
          </form>
        </Card>

        <Card
          className="lg:col-span-2"
          title="Signed-in devices"
          actions={
            others.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => void revokeOthers()}>
                Sign out other devices
              </Button>
            ) : undefined
          }
          bodyClassName="p-0"
        >
          {devices === null ? (
            <div className="p-5">
              <LoadingBlock rows={2} />
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {devices.map((d) => {
                const current = d.id === currentSessionId;
                return (
                  <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-overlay text-text-tertiary">
                      <Laptop className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
                        {describeAgent(d.userAgent)}
                        {current && (
                          <Pill tone="success" dot>
                            This device
                          </Pill>
                        )}
                      </div>
                      <div className="text-xs text-text-tertiary">
                        {d.ipAddress || "Unknown IP"} · active {formatRelative(d.updatedAt as string)}
                      </div>
                    </div>
                    {!current && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoking === d.id}
                        onClick={() => void revoke(d)}
                        className="hover:bg-destructive-muted hover:text-destructive"
                      >
                        Sign out
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-accent-text" />
              <div>
                <div className="text-[13px] font-medium text-text-primary">Sign out of this device</div>
                <div className="text-xs text-text-tertiary">You can sign back in any time.</div>
              </div>
            </div>
            <Button variant="outline" onClick={() => void signOutAndTrack()}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
