"use client";

import { Check, ListTodo, Loader2, Plus, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type GoogleTask, localDateKey } from "@/lib/calendar";
import { cn } from "@/lib/utils";

const VISIBLE = 8;

function dueLabel(due: string): { text: string; overdue: boolean } {
  const today = localDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === today) return { text: "Today", overdue: false };
  if (due === localDateKey(tomorrow))
    return { text: "Tomorrow", overdue: false };
  const [y, m, d] = due.split("-").map(Number);
  const text = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(
    undefined,
    { day: "numeric", month: "short" },
  );
  return { text, overdue: due < today };
}

interface TasksCardProps {
  canUseTasks: boolean;
  tasks: GoogleTask[] | null;
  loading: boolean;
  error: string | null;
  onAdd: (title: string) => Promise<boolean>;
  onComplete: (id: string) => Promise<boolean>;
  onRefresh: () => void;
  onReconnect: () => void;
  className?: string;
}

export function TasksCard({
  canUseTasks,
  tasks,
  loading,
  error,
  onAdd,
  onComplete,
  onRefresh,
  onReconnect,
  className,
}: TasksCardProps) {
  const ids = useId();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      if (await onAdd(title)) setDraft("");
    } finally {
      setAdding(false);
    }
  };

  const complete = (id: string) => {
    setCompleting((s) => new Set(s).add(id));
    // Let the check + strike-through register before the row leaves.
    window.setTimeout(() => {
      void onComplete(id).finally(() =>
        setCompleting((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        }),
      );
    }, 320);
  };

  const list = tasks ?? [];
  const shown = showAll ? list : list.slice(0, VISIBLE);

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className={cn("surface-panel flex min-h-0 flex-col p-3", className)}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-signal-meetings/15 text-signal-meetings">
          <ListTodo className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h3
          id={`${ids}-title`}
          className="m-0 flex-1 text-[12.5px] font-semibold text-text-primary"
        >
          Tasks
        </h3>
        {canUseTasks && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh tasks"
            aria-label="Refresh tasks"
          >
            <RefreshCw
              className={cn("h-3 w-3", loading && "motion-safe:animate-spin")}
            />
          </Button>
        )}
      </div>

      {!canUseTasks ? (
        <div className="rounded-md border border-dashed border-border-default px-3 py-3 text-center">
          <p className="m-0 text-[11.5px] leading-relaxed text-text-tertiary">
            Google Tasks wasn&apos;t allowed when you connected.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2 h-7 text-[11px]"
            onClick={onReconnect}
          >
            Allow Tasks
          </Button>
        </div>
      ) : (
        <>
          <form onSubmit={(e) => void submit(e)} className="flex gap-1.5">
            <Input
              dir="auto"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a task…"
              aria-label="New task"
              maxLength={1024}
              className="h-8 flex-1 text-[12.5px]"
            />
            <Button
              type="submit"
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={!draft.trim() || adding}
              aria-label="Add task"
              title="Add task"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
            </Button>
          </form>

          {error && (
            <p
              role="alert"
              className="m-0 mt-2 text-[11px] text-destructive animate-fade-in-up"
            >
              {error}
            </p>
          )}

          <div className="custom-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto">
            {tasks === null && loading ? (
              <div className="space-y-1.5 py-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-7 animate-skeleton rounded-md" />
                ))}
              </div>
            ) : list.length === 0 ? (
              <p className="m-0 px-1 py-3 text-center text-[11.5px] text-text-tertiary">
                No open tasks. Nice.
              </p>
            ) : (
              <ul className="m-0 list-none space-y-0.5 p-0">
                {shown.map((task, i) => {
                  const done = completing.has(task.id);
                  const due = task.due ? dueLabel(task.due) : null;
                  return (
                    <li
                      key={task.id}
                      className="animate-list-in"
                      style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                    >
                      <div className="group flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-surface-overlay/60">
                        <button
                          type="button"
                          onClick={() => complete(task.id)}
                          disabled={done}
                          aria-label={`Mark "${task.title}" as done`}
                          title="Mark as done"
                          className={cn(
                            "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            done
                              ? "border-success bg-success text-surface-base"
                              : "border-border-strong text-transparent hover:border-success hover:text-success",
                          )}
                        >
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            dir="auto"
                            className={cn(
                              "m-0 text-start text-[12px] leading-snug text-text-primary transition-[color,opacity] duration-300 motion-reduce:transition-none",
                              done &&
                                "text-text-tertiary line-through opacity-60",
                            )}
                          >
                            {task.title}
                          </p>
                          {due && (
                            <span
                              className={cn(
                                "text-[10.5px]",
                                due.overdue
                                  ? "text-destructive"
                                  : "text-text-tertiary",
                              )}
                            >
                              {due.overdue ? "Overdue · " : "Due "}
                              {due.text}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {list.length > VISIBLE && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-1 w-full rounded-md py-1 text-[11px] font-medium text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"
              >
                {showAll ? "Show fewer" : `Show all ${list.length}`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
