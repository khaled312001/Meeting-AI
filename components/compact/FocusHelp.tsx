"use client";

/** What each button in focus mode does, opened with the ? button. */

import {
  Camera,
  ChevronUp,
  Eraser,
  Maximize2,
  MessageSquare,
  Mic,
  MoreVertical,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { focusGlass } from "./FocusBar";

const ITEMS: Array<{ icon: ReactNode; name: string; does: string }> = [
  {
    icon: <Play className="h-3 w-3 fill-current" />,
    name: "Start / End",
    does: "Start or stop listening to the call.",
  },
  {
    icon: <Sparkles className="h-3.5 w-3.5" />,
    name: "Answer  (Ctrl+Enter)",
    does: "Answer now, with everything heard since the last answer.",
  },
  {
    icon: <RefreshCw className="h-3.5 w-3.5" />,
    name: "Update",
    does: "The question went on: answer all of it again, in place of the current answer.",
  },
  {
    icon: <Square className="h-3 w-3 fill-current" />,
    name: "Stop",
    does: "Stop the answer being written.",
  },
  {
    icon: <Camera className="h-3.5 w-3.5" />,
    name: "Screenshot",
    does: "Answer what is on your screen, e.g. a coding task.",
  },
  {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    name: "Chat",
    does: "Type your own question to the AI.",
  },
  {
    icon: <span className="text-[10px] font-semibold">Hear</span>,
    name: "Auto · ع · EN · DE",
    does: "The language it listens for. Auto hears Arabic, English and German, also mixed.",
  },
  {
    icon: <span className="text-[10px] font-semibold">Ans</span>,
    name: "Answers: …",
    does: "The language answers are written in. Auto follows the question.",
  },
  {
    icon: <Zap className="h-3.5 w-3.5" />,
    name: "Auto / Manual",
    does: "Auto answers each question by itself; Manual only when you press Answer.",
  },
  {
    icon: <Mic className="h-3.5 w-3.5" />,
    name: "Me",
    does: "Also transcribe your own microphone (starts with the next Start).",
  },
  {
    icon: <Maximize2 className="h-3.5 w-3.5" />,
    name: "Full view",
    does: "Open the large window: transcript, files and settings.",
  },
  {
    icon: <MoreVertical className="h-3.5 w-3.5" />,
    name: "More",
    does: "Notes & files for this interview, summary, save the answer, clear everything.",
  },
  {
    icon: <Eraser className="h-3.5 w-3.5" />,
    name: "Clear text",
    does: "Clear the transcript; the answers stay.",
  },
  {
    icon: <ChevronUp className="h-3.5 w-3.5" />,
    name: "Hide / show",
    does: "Fold the answer panel away or bring it back.",
  },
];

export function FocusHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      data-clickable
      className={cn(
        "mx-auto mt-1.5 w-[calc(100%-1rem)] max-w-[860px] rounded-2xl px-3 py-2",
        focusGlass,
      )}
    >
      <div className="mb-1.5 flex items-center">
        <p className="text-[11px] font-semibold text-text-primary">
          What each button does
        </p>
        <button
          type="button"
          onClick={onClose}
          title="Close this guide"
          aria-label="Close this guide"
          className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full text-text-tertiary hover:bg-white/10 hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="custom-scrollbar grid max-h-[236px] gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item.name} className="flex min-w-0 items-start gap-2 text-[11px] leading-snug">
            <span className="mt-0.5 inline-flex h-4 min-w-6 shrink-0 items-center justify-center text-accent-text">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="font-semibold text-text-primary">{item.name}</span>
              <span className="text-text-secondary"> — {item.does}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
