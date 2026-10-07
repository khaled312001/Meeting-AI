"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, Field, Pill, Textarea } from "../ui";
import type { AdminUser } from "@/lib/admin-api";

export function userStatusPill(u: Pick<AdminUser, "isApproved" | "isBanned">) {
  if (u.isBanned) return <Pill tone="danger">Banned</Pill>;
  if (!u.isApproved) return <Pill tone="warning" dot>Pending</Pill>;
  return <Pill tone="success">Approved</Pill>;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Dialog asking for an optional ban reason. Resolves null when cancelled. */
export function useBanReason() {
  const [state, setState] = React.useState<{ count: number; resolve: (r: string | null) => void } | null>(null);
  const [reason, setReason] = React.useState("");
  const ask = React.useCallback(
    (count: number) =>
      new Promise<string | null>((resolve) => {
        setReason("");
        setState({ count, resolve });
      }),
    [],
  );
  const close = (r: string | null) => {
    state?.resolve(r);
    setState(null);
  };
  const dialog = (
    <Dialog
      open={state !== null}
      onClose={() => close(null)}
      title={state && state.count > 1 ? `Ban ${state.count} users?` : "Ban this user?"}
      description="They'll be signed out immediately and can't use the app until unbanned."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => close(reason.trim())}>
            Ban
          </Button>
        </>
      }
    >
      <Field label="Reason (optional, shown to the user)" htmlFor="ban-reason">
        <Textarea
          id="ban-reason"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Violated terms of use"
        />
      </Field>
    </Dialog>
  );
  return { ask, dialog };
}

