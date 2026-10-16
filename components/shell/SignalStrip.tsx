"use client";

import type { TabType } from "@/components/TabContext";
import { cn } from "@/lib/utils";

interface SignalStripProps {
  activeTab: TabType;
  className?: string;
}

const signalColors: Record<TabType, string> = {
  assistant: "bg-signal-assistant",
  "ask-ai": "bg-signal-ask",
  notes: "bg-signal-notes",
  meetings: "bg-signal-meetings",
};

export function SignalStrip({ activeTab, className }: SignalStripProps) {
  return (
    <div
      className={cn(
        "h-0.5 w-full shrink-0",
        signalColors[activeTab],
        className,
      )}
      aria-hidden
    />
  );
}
