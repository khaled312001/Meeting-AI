"use client";

import * as React from "react";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthWizard } from "@/components/auth/auth-wizard";
import { authClient, signOutAndTrack } from "@/lib/auth-client";
import { onSessionExpired } from "@/lib/auth-events";
import { adminApi, AdminApiError, type AdminMe } from "@/lib/admin-api";
import { appHref } from "@/lib/app-href";

type GuardState =
  | { kind: "checking" }
  | { kind: "ok"; me: AdminMe }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base px-4 text-text-primary">
      {children}
    </div>
  );
}

/**
 * Admin panel gate: signed out → sign-in wizard; signed in but not on the
 * admin allow-list (ADMIN_EMAILS / admin_emails) → "not authorized".
 * Account approval is not required for admins.
 */
export function AdminGuard({ children }: { children: (me: AdminMe) => React.ReactNode }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [state, setState] = React.useState<GuardState>({ kind: "checking" });
  const [signedOut, setSignedOut] = React.useState(false);
  // The session hook's first render differs between the static prerender
  // and the browser; render the loader until mounted to avoid a hydration
  // mismatch (same approach as AuthGuard).
  const [mounted, setMounted] = React.useState(false);
  const userId = session?.user.id;

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => onSessionExpired(() => setSignedOut(true)), []);
  React.useEffect(() => {
    const onLogout = () => setSignedOut(true);
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

  React.useEffect(() => {
    if (!userId) return;
    setSignedOut(false);
    setState({ kind: "checking" });
    const controller = new AbortController();
    adminApi
      .me(controller.signal)
      .then((me) => setState({ kind: "ok", me }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof AdminApiError && err.status === 403) setState({ kind: "forbidden" });
        else if (err instanceof AdminApiError && err.status === 401) setSignedOut(true);
        else setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [userId]);

  if (!mounted || isPending) {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </Centered>
    );
  }

  if (!session || signedOut) {
    return (
      <AuthWizard
        initialStep="signin"
        onSuccess={() => {
          setSignedOut(false);
          void refetch();
        }}
      />
    );
  }

  if (state.kind === "checking") {
    return (
      <Centered>
        <div className="flex items-center gap-2 text-[13px] text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking admin access…
        </div>
      </Centered>
    );
  }

  if (state.kind === "forbidden" || state.kind === "error") {
    return (
      <Centered>
        <div className="w-full max-w-md rounded-xl border border-border-subtle bg-surface-raised p-7 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-destructive-muted text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold">
            {state.kind === "forbidden" ? "Admins only" : "Couldn't reach the server"}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
            {state.kind === "forbidden" ? (
              <>
                <span className="font-medium text-text-primary">{session.user.email}</span> isn&apos;t on the admin
                list. Ask an existing admin to add you, or set <code className="text-xs">ADMIN_EMAILS</code> on the
                worker.
              </>
            ) : (
              state.message
            )}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" asChild>
              <a href={appHref("dashboard")}>My dashboard</a>
            </Button>
            <Button variant="ghost" onClick={() => void signOutAndTrack()}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Switch account
            </Button>
          </div>
        </div>
      </Centered>
    );
  }

  return <>{children(state.me)}</>;
}
