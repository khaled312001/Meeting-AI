"use client";

import * as React from "react";
import { ArrowLeft, Inbox, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  Pagination,
  Pill,
  RefreshButton,
  SearchInput,
  Segmented,
  Select,
  Textarea,
  useConfirm,
} from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import { adminApi, type SupportThread } from "@/lib/admin-api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDebounced } from "./shared";

const PAGE = 25;
type StatusFilter = "all" | SupportThread["status"];

function statusPill(s: SupportThread["status"]) {
  if (s === "resolved") return <Pill tone="success">Resolved</Pill>;
  if (s === "pending") return <Pill tone="info">Awaiting user</Pill>;
  return <Pill tone="warning">Open</Pill>;
}

export function SupportInboxSection({ onUnreadChange }: { onUnreadChange?: (n: number) => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = React.useState<StatusFilter>("open");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim());
  const [offset, setOffset] = React.useState(0);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [reply, setReply] = React.useState("");
  const [closeAfter, setCloseAfter] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setOffset(0), [status, unreadOnly, q]);

  const threads = useApi(
    (s) =>
      adminApi.supportThreads(
        { limit: PAGE, offset, status: status === "all" ? undefined : status, unreadOnly: unreadOnly || undefined, q: q || undefined },
        s,
      ),
    [offset, status, unreadOnly, q],
    { pollMs: 30_000 },
  );
  const thread = useApi((s) => adminApi.supportThread(activeId!, s), [activeId], { enabled: Boolean(activeId) });

  React.useEffect(() => {
    if (threads.data) onUnreadChange?.(threads.data.totalUnread);
  }, [threads.data, onUnreadChange]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.data]);

  const open = (id: string) => {
    setActiveId(id);
    setReply("");
    setCloseAfter(false);
    thread.setData(null);
    // Opening marks it read server-side; reflect locally.
    threads.setData((prev) =>
      prev
        ? {
            ...prev,
            threads: prev.threads.map((t) => (t.id === id ? { ...t, unreadByAdmin: 0 } : t)),
            totalUnread: Math.max(0, prev.totalUnread - (prev.threads.find((t) => t.id === id)?.unreadByAdmin ? 1 : 0)),
          }
        : prev,
    );
  };

  const send = async () => {
    if (!activeId || !reply.trim()) return;
    setSending(true);
    try {
      await adminApi.supportReply(activeId, reply.trim(), closeAfter);
      setReply("");
      toast.success(closeAfter ? "Reply sent and thread resolved" : "Reply sent");
      void thread.reload();
      void threads.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the reply");
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (s: SupportThread["status"]) => {
    if (!activeId) return;
    try {
      await adminApi.supportStatus(activeId, s);
      void thread.reload();
      void threads.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change status");
    }
  };

  const remove = async () => {
    if (!activeId) return;
    const ok = await confirm({
      title: "Delete this conversation?",
      description: "The thread and all replies are removed for you and the user.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.supportDelete(activeId);
      setActiveId(null);
      toast.success("Conversation deleted");
      void threads.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete");
    }
  };

  const rows = threads.data?.threads ?? [];
  const t = thread.data?.thread;

  return (
    <>
      {dialog}
      <PageHeader
        title="Support inbox"
        description="Messages from users — including people waiting for approval."
        actions={<RefreshButton onClick={() => void threads.reload()} spinning={threads.refreshing} />}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented
          value={status}
          onChange={setStatus}
          ariaLabel="Thread status"
          options={[
            { value: "open", label: "Open" },
            { value: "pending", label: "Awaiting user" },
            { value: "resolved", label: "Resolved" },
            { value: "all", label: "All" },
          ]}
        />
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Unread only
          {threads.data && threads.data.totalUnread > 0 && <Pill tone="accent">{threads.data.totalUnread}</Pill>}
        </label>
        <SearchInput value={search} onChange={setSearch} placeholder="Search messages…" className="sm:ml-auto sm:w-64" />
      </div>
      {threads.error && (
        <div className="mb-4">
          <ErrorBanner message={threads.error} onRetry={threads.reload} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card bodyClassName="p-0" className={cn(activeId && "hidden lg:block")}>
          {threads.loading ? (
            <div className="p-5">
              <LoadingBlock rows={5} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Inbox} title="Inbox zero" description="No conversations match these filters." />
          ) : (
            <>
              <ul className="dash-scroll max-h-[640px] divide-y divide-border-subtle overflow-y-auto">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => open(r.id)}
                      className={cn(
                        "flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-overlay/60",
                        r.id === activeId && "bg-surface-overlay",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {Boolean(r.unreadByAdmin) && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                        <span className={cn("min-w-0 flex-1 truncate text-[13px]", r.unreadByAdmin ? "font-semibold" : "font-medium")}>
                          {r.userName || r.userEmail || "Unknown user"}
                        </span>
                        <span className="shrink-0 text-[11px] text-text-tertiary">{formatRelative(r.updatedAt)}</span>
                      </span>
                      <span className="truncate text-xs text-text-secondary">{r.subject || r.body}</span>
                      <span>{statusPill(r.status)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="px-4 pb-3">
                <Pagination offset={offset} limit={PAGE} total={threads.data?.total ?? 0} onChange={setOffset} />
              </div>
            </>
          )}
        </Card>

        <div className={cn(!activeId && "hidden lg:block")}>
          {!activeId ? (
            <Card>
              <EmptyState icon={Inbox} title="Select a conversation" />
            </Card>
          ) : (
            <Card
              title={t ? t.subject || "Conversation" : "Loading…"}
              description={t ? `${t.userName ? `${t.userName} · ` : ""}${t.userEmail ?? ""} · started ${formatDateTime(t.createdAt)}` : undefined}
              bodyClassName="p-0"
              actions={
                t ? (
                  <>
                    <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setActiveId(null)}>
                      <ArrowLeft className="h-3 w-3" />
                    </Button>
                    <Select
                      value={t.status}
                      onChange={(v) => void changeStatus(v as SupportThread["status"])}
                      ariaLabel="Thread status"
                      className="h-8 text-xs"
                      options={[
                        { value: "open", label: "Open" },
                        { value: "pending", label: "Awaiting user" },
                        { value: "resolved", label: "Resolved" },
                      ]}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void remove()}
                      aria-label="Delete conversation"
                      className="hover:bg-destructive-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : undefined
              }
            >
              {thread.error && (
                <div className="p-4">
                  <ErrorBanner message={thread.error} onRetry={thread.reload} />
                </div>
              )}
              <div className="dash-scroll max-h-[480px] space-y-3 overflow-y-auto p-5">
                {!thread.data ? (
                  <LoadingBlock rows={3} />
                ) : (
                  thread.data.messages.map((m) => {
                    const admin = m.authorType === "admin";
                    return (
                      <div key={m.id} className={cn("flex", admin ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                            admin
                              ? "rounded-br-md bg-accent-muted"
                              : "rounded-bl-md border border-border-subtle bg-surface-overlay",
                          )}
                        >
                          <div className="mb-0.5 text-[11px] font-semibold text-text-secondary">
                            {admin ? m.authorEmail ?? "Admin" : m.userName || m.userEmail || "User"}
                          </div>
                          <div className="whitespace-pre-wrap break-words text-text-primary">{m.body}</div>
                          <div className="mt-1 text-right text-[10px] text-text-tertiary">{formatDateTime(m.createdAt)}</div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>
              <div className="space-y-2 border-t border-border-subtle p-3">
                <Textarea
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
                  }}
                  placeholder="Write a reply…  (Ctrl/⌘ + Enter to send)"
                  maxLength={8000}
                  aria-label="Reply"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={closeAfter}
                      onChange={(e) => setCloseAfter(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                    Mark resolved after sending
                  </label>
                  <Button onClick={() => void send()} disabled={sending || !reply.trim()}>
                    {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                    Send reply
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
