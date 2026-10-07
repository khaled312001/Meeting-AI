"use client";

import * as React from "react";
import { ArrowLeft, LifeBuoy, Loader2, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, EmptyState, ErrorBanner, Field, LoadingBlock, PageHeader, Pill, Textarea } from "../ui";
import { useToast } from "../toast";
import { useSupportMessages } from "@/hooks/useSupportMessages";
import type { SupportMessage } from "@/lib/types";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

function statusPill(status: string) {
  if (status === "resolved") return <Pill tone="success">Resolved</Pill>;
  if (status === "pending") return <Pill tone="info">Replied</Pill>;
  return <Pill tone="warning">Open</Pill>;
}

export function SupportSection() {
  const toast = useToast();
  const support = useSupportMessages({ enabled: true, pollMs: 30_000 });
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [composing, setComposing] = React.useState(false);
  const [messages, setMessages] = React.useState<SupportMessage[] | null>(null);
  const [loadingThread, setLoadingThread] = React.useState(false);
  const [reply, setReply] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);

  const { refresh, fetchThread, markThreadRead } = support;

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const threads = React.useMemo(
    () => [...support.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [support.threads],
  );
  const active = threads.find((t) => t.id === activeId) ?? null;

  const openThread = React.useCallback(
    async (id: string) => {
      setComposing(false);
      setActiveId(id);
      setLoadingThread(true);
      setMessages(null);
      const data = await fetchThread(id);
      setMessages(data?.messages ?? []);
      setLoadingThread(false);
      void markThreadRead(id);
    },
    [fetchThread, markThreadRead],
  );

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const sendReply = async () => {
    if (!activeId || !reply.trim()) return;
    setSending(true);
    const created = await support.send({ body: reply.trim(), parentId: activeId });
    setSending(false);
    if (created) {
      setReply("");
      setMessages((prev) => [...(prev ?? []), created]);
      void refresh();
    } else {
      toast.error("Couldn't send your reply");
    }
  };

  const createThread = async () => {
    if (!body.trim()) return;
    setSending(true);
    const created = await support.send({ body: body.trim(), subject: subject.trim() || undefined });
    setSending(false);
    if (created) {
      setSubject("");
      setBody("");
      toast.success("Message sent — we'll reply here.");
      void openThread(created.id);
    } else {
      toast.error("Couldn't send your message");
    }
  };

  const showDetail = composing || activeId !== null;

  return (
    <>
      <PageHeader
        title="Support"
        description="Questions, plan upgrades or problems — message the team and get replies right here."
        actions={
          <Button
            onClick={() => {
              setComposing(true);
              setActiveId(null);
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New request
          </Button>
        }
      />

      {support.error && (
        <div className="mb-4">
          <ErrorBanner message={support.error} onRetry={() => void refresh()} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card bodyClassName="p-0" className={cn(showDetail && "hidden lg:block")}>
          {support.isLoading && threads.length === 0 ? (
            <div className="p-5">
              <LoadingBlock rows={4} />
            </div>
          ) : threads.length === 0 ? (
            <EmptyState
              icon={LifeBuoy}
              title="No conversations yet"
              description="Start one with “New request”."
            />
          ) : (
            <ul className="dash-scroll max-h-[600px] divide-y divide-border-subtle overflow-y-auto">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void openThread(t.id)}
                    className={cn(
                      "flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-overlay/60",
                      t.id === activeId && "bg-surface-overlay",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {t.unreadByUser && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
                        {t.subject || t.body.slice(0, 60)}
                      </span>
                      {statusPill(t.status)}
                    </span>
                    <span className="truncate text-xs text-text-tertiary">{t.body}</span>
                    <span className="text-[11px] text-text-tertiary">{formatRelative(t.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className={cn(!showDetail && "hidden lg:block")}>
          {composing ? (
            <Card
              title="New request"
              actions={
                <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setComposing(false)}>
                  <ArrowLeft className="mr-1 h-3 w-3" /> Back
                </Button>
              }
            >
              <div className="space-y-4">
                <Field label="Subject" htmlFor="sup-subject">
                  <Input
                    id="sup-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Upgrade my plan"
                    maxLength={200}
                  />
                </Field>
                <Field label="Message" htmlFor="sup-body">
                  <Textarea
                    id="sup-body"
                    rows={8}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="How can we help?"
                    maxLength={8000}
                  />
                </Field>
                <div className="flex justify-end">
                  <Button onClick={() => void createThread()} disabled={sending || !body.trim()}>
                    {sending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </Card>
          ) : active ? (
            <Card
              title={active.subject || "Conversation"}
              description={`Started ${formatDateTime(active.createdAt)}`}
              actions={
                <>
                  {statusPill(active.status)}
                  <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setActiveId(null)}>
                    <ArrowLeft className="mr-1 h-3 w-3" /> Back
                  </Button>
                </>
              }
              bodyClassName="p-0"
            >
              <div className="dash-scroll max-h-[460px] space-y-3 overflow-y-auto p-5">
                {loadingThread || !messages ? (
                  <LoadingBlock rows={3} />
                ) : (
                  messages.map((m) => {
                    const mine = m.authorType === "user";
                    return (
                      <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                            mine
                              ? "rounded-br-md bg-accent-muted text-text-primary"
                              : "rounded-bl-md border border-border-subtle bg-surface-overlay text-text-primary",
                          )}
                        >
                          {!mine && <div className="mb-0.5 text-[11px] font-semibold text-accent-text">Support team</div>}
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          <div className="mt-1 text-right text-[10px] text-text-tertiary">
                            {formatDateTime(m.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>
              <div className="flex items-end gap-2 border-t border-border-subtle p-3">
                <Textarea
                  rows={2}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendReply();
                  }}
                  placeholder="Write a reply…  (Ctrl/⌘ + Enter to send)"
                  maxLength={8000}
                  aria-label="Reply"
                />
                <Button onClick={() => void sendReply()} disabled={sending || !reply.trim()} aria-label="Send reply">
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={LifeBuoy}
                title="Select a conversation"
                description="Pick a thread on the left or start a new request."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
