"use client";

import { Check, Copy, ExternalLink, Loader2, Plus, Video } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/copy-text";
import {
  type CalendarEvent,
  type NewCalendarEventInput,
  localDateKey,
  localTimeValue,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

const DURATIONS = [15, 30, 45, 60, 90] as const;

/** Next half hour from now, at least 10 minutes away. */
function defaultStart(): Date {
  const d = new Date(Date.now() + 10 * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() <= 30 ? 30 : 60);
  return d;
}

interface ScheduleMeetingCardProps {
  onCreate: (
    input: NewCalendarEventInput,
  ) => Promise<
    { ok: true; event: CalendarEvent } | { ok: false; error: string }
  >;
  onOpenLink: (url: string) => void;
  className?: string;
}

export function ScheduleMeetingCard({
  onCreate,
  onOpenLink,
  className,
}: ScheduleMeetingCardProps) {
  const ids = useId();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => localDateKey(defaultStart()));
  const [time, setTime] = useState(() => localTimeValue(defaultStart()));
  const [duration, setDuration] = useState<number>(30);
  const [addMeet, setAddMeet] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    event: CalendarEvent;
    copied: boolean;
    wantedMeet: boolean;
  } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const start = new Date(`${date}T${time}`);
    if (!title.trim()) {
      setError("Give the meeting a title.");
      return;
    }
    if (Number.isNaN(start.getTime())) {
      setError("Pick a date and time.");
      return;
    }
    if (start.getTime() < Date.now() - 5 * 60_000) {
      setError("That time has already passed.");
      return;
    }
    setSaving(true);
    try {
      const res = await onCreate({
        title: title.trim(),
        start: start.toISOString(),
        durationMinutes: duration,
        addMeet,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const link = res.event.joinUrl;
      const copied = link ? await copyText(link) : false;
      setCreated({ event: res.event, copied, wantedMeet: addMeet });
      setTitle("");
      const next = defaultStart();
      setDate(localDateKey(next));
      setTime(localTimeValue(next));
    } finally {
      setSaving(false);
    }
  };

  const copyAgain = async () => {
    const link = created?.event.joinUrl;
    if (!link) return;
    const copied = await copyText(link);
    setCreated((c) => (c ? { ...c, copied } : c));
  };

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className={cn("surface-panel p-3", className)}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-muted text-accent-text">
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h3
          id={`${ids}-title`}
          className="m-0 text-[12.5px] font-semibold text-text-primary"
        >
          Schedule a meeting
        </h3>
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-2.5">
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-name`}>Title</Label>
          <Input
            id={`${ids}-name`}
            dir="auto"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Interview with Acme"
            maxLength={300}
            className="h-8 text-[12.5px]"
          />
        </div>

        <div className="grid grid-cols-[1.3fr_1fr] gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-date`}>Date</Label>
            <Input
              id={`${ids}-date`}
              type="date"
              value={date}
              min={localDateKey(new Date())}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 text-[12.5px] [color-scheme:dark]"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-time`}>Time</Label>
            <Input
              id={`${ids}-time`}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-8 text-[12.5px] [color-scheme:dark]"
              required
            />
          </div>
        </div>

        <fieldset className="m-0 space-y-1.5 border-0 p-0">
          <legend className="mb-1.5 text-xs font-medium leading-none text-text-secondary">
            Duration
          </legend>
          <div className="grid grid-cols-5 gap-1 rounded-md border border-border-subtle bg-surface-inset p-0.5">
            {DURATIONS.map((mins) => (
              <label key={mins} className="relative">
                <input
                  type="radio"
                  name={`${ids}-duration`}
                  value={mins}
                  checked={duration === mins}
                  onChange={() => setDuration(mins)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "flex h-7 cursor-pointer items-center justify-center rounded text-[11px] font-medium tabular-nums transition-colors duration-150",
                    "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                    duration === mins
                      ? "bg-accent text-accent-foreground shadow-sm"
                      : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary",
                  )}
                >
                  {mins < 60 ? `${mins} min` : `${mins / 60} h`}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label
          htmlFor={`${ids}-meet`}
          className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-inset px-2.5 py-2"
        >
          <span className="flex items-center gap-2 text-[12px] text-text-secondary">
            <Video className="h-3.5 w-3.5 text-success" aria-hidden />
            Add Google Meet link
          </span>
          <Switch
            id={`${ids}-meet`}
            checked={addMeet}
            onCheckedChange={setAddMeet}
          />
        </label>

        {error && (
          <p
            role="alert"
            className="m-0 rounded-md border border-destructive/30 bg-destructive-muted px-2.5 py-1.5 text-[11.5px] text-destructive animate-fade-in-up"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="sm"
          disabled={saving}
          className="h-8 w-full gap-1.5 text-[12px]"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-3.5 w-3.5" aria-hidden />
          )}
          {saving ? "Creating…" : "Create meeting"}
        </Button>
      </form>

      {created && (
        <div
          role="status"
          className="mt-2.5 rounded-md border border-success/30 bg-success/10 p-2.5 animate-panel-in"
        >
          <p className="m-0 flex items-center gap-1.5 text-[12px] font-medium text-success">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Meeting added to your calendar
          </p>
          {created.event.joinUrl ? (
            <>
              <p
                className="m-0 mt-1.5 truncate font-mono text-[11px] text-text-secondary"
                title={created.event.joinUrl}
              >
                {created.event.joinUrl.replace(/^https:\/\//, "")}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => void copyAgain()}
                >
                  {created.copied ? (
                    <Check className="h-3 w-3" aria-hidden />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden />
                  )}
                  {created.copied ? "Link copied" : "Copy link"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => {
                    const url = created.event.joinUrl;
                    if (url) onOpenLink(url);
                  }}
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Open
                </Button>
              </div>
            </>
          ) : (
            created.wantedMeet && (
              <p className="m-0 mt-1 text-[11px] text-text-tertiary">
                Google is still creating the Meet link; it will show up in the
                list shortly.
              </p>
            )
          )}
        </div>
      )}
    </section>
  );
}
