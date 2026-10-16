"use client";

import {
  CalendarClock,
  ExternalLink,
  Loader2,
  Mic,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  type CalendarEvent,
  PROVIDER_LABEL,
  eventTiming,
  formatDuration,
  formatStartTime,
  formatTimeRange,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

interface MeetingCardProps {
  event: CalendarEvent;
  now: number;
  index: number;
  selected: boolean;
  /** The listening session is already running. */
  assistantLive: boolean;
  starting: boolean;
  onJoin: (event: CalendarEvent) => void;
  onJoinAndStart: (event: CalendarEvent) => void;
  onOpenInCalendar: (event: CalendarEvent) => void;
}

export const MeetingCard = memo(function MeetingCard({
  event,
  now,
  index,
  selected,
  assistantLive,
  starting,
  onJoin,
  onJoinAndStart,
  onOpenInCalendar,
}: MeetingCardProps) {
  const ref = useRef<HTMLLIElement>(null);
  const timing = eventTiming(event, now);
  const isLive = timing.kind === "live";

  useEffect(() => {
    if (!selected) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    ref.current?.scrollIntoView({
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [selected]);

  return (
    <li
      ref={ref}
      className="animate-list-in"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group relative flex flex-col gap-3 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center",
          "transition-[background-color,border-color,box-shadow] duration-200",
          selected
            ? "border-accent/50 bg-accent-muted shadow-[0_0_0_1px_var(--accent-ring)]"
            : "border-border-subtle bg-surface-raised/60 hover:border-border-default hover:bg-surface-overlay/50",
        )}
      >
        {/* Time */}
        <div className="flex shrink-0 items-center gap-2.5 sm:w-[118px] sm:flex-col sm:items-start sm:gap-0.5">
          <span
            className={cn(
              "text-[12.5px] font-semibold tabular-nums",
              isLive ? "text-success" : "text-text-primary",
            )}
            title={formatTimeRange(event)}
          >
            {formatStartTime(event)}
          </span>
          {!event.allDay && (
            <span className="text-[11px] tabular-nums text-text-tertiary">
              {formatDuration(event)}
            </span>
          )}
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {isLive && (
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-success/50 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
            )}
            <p
              dir="auto"
              className="m-0 min-w-0 truncate text-start text-[13px] font-medium text-text-primary"
              title={event.title}
            >
              {event.title}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-tertiary">
            {event.isInterview && (
              <span className="inline-flex items-center gap-1 rounded-md border border-signal-assistant/30 bg-signal-assistant/10 px-1.5 py-px font-medium text-signal-assistant">
                <Sparkles className="h-3 w-3" aria-hidden />
                Interview
              </span>
            )}
            {isLive && (
              <span className="rounded-md border border-success/30 bg-success/10 px-1.5 py-px font-medium text-success">
                Live now
              </span>
            )}
            {timing.kind === "soon" && (
              <span className="rounded-md border border-accent/30 bg-accent-muted px-1.5 py-px font-medium text-accent-text">
                In {timing.minutes} min
              </span>
            )}
            {event.provider ? (
              <span className="inline-flex items-center gap-1">
                <Video className="h-3 w-3" aria-hidden />
                {PROVIDER_LABEL[event.provider]}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3" aria-hidden />
                No join link
              </span>
            )}
            {event.attendees > 1 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" aria-hidden />
                {event.attendees}
              </span>
            )}
            {event.organizer && (
              <span dir="auto" className="max-w-[180px] truncate">
                {event.organizer}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {event.joinUrl ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onJoin(event);
                }}
                title={`Open the ${event.provider ? PROVIDER_LABEL[event.provider] : "meeting"} link in your browser`}
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                Join
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-[11px] shadow-sm shadow-accent/20"
                onClick={(e) => {
                  e.stopPropagation();
                  onJoinAndStart(event);
                }}
                disabled={starting}
                title={
                  assistantLive
                    ? "Open the meeting and go to the assistant (already listening)"
                    : "Open the meeting and start listening with the assistant"
                }
              >
                {starting ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <Mic className="h-3 w-3" aria-hidden />
                )}
                {assistantLive
                  ? "Join & open assistant"
                  : "Join & start assistant"}
              </Button>
            </>
          ) : (
            event.htmlLink && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInCalendar(event);
                }}
                title="Open in Google Calendar"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                Calendar
              </Button>
            )
          )}
        </div>
      </div>
    </li>
  );
});
