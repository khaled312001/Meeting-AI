/** Shared display labels for the dashboards. */

import { humanizeKey } from "@/lib/format";

const PLAN_LABELS: Record<string, string> = {
  legacy_unlimited: "Unlimited (legacy)",
  free_tier: "Free",
  early_access: "Early access",
  unlimited: "Unlimited",
};

export function planLabel(tier: string | null | undefined): string {
  if (!tier) return "—";
  return PLAN_LABELS[tier] ?? humanizeKey(tier);
}

export function xFormatter(range: string): (t: number) => string {
  return range === "24h" || range === "1h"
    ? (t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}


const ACTION_LABELS: Record<string, string> = {
  completion: "AI answers",
  question_asked: "Questions asked",
  screen_capture: "Screenshots",
  recording_start: "Listening started",
  recording_stop: "Listening stopped",
  session_started: "Sessions started",
  session_ended: "Sessions ended",
  session_resumed: "Sessions resumed",
  session_paused_by_user: "Sessions paused",
  completion_saved: "Answers saved",
  note_create: "Notes saved",
  note_delete: "Notes deleted",
  knowledge_create: "Knowledge files added",
  knowledge_delete: "Knowledge files removed",
  interview_context_update: "Profile updates",
  mode_switched: "Mode switches",
  deepgram_key: "Transcription connections",
  export_markdown: "Exports (Markdown)",
  export_pdf: "Exports (PDF)",
  support_message_create: "Support messages",
};

/** Bookkeeping events (page loads, list fetches) that mean nothing to a user. */
const INTERNAL_ACTIONS = new Set(["interview_context_fetch", "note_list", "announcement_ack"]);

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanizeKey(action);
}

export function isUserFacingAction(action: string): boolean {
  return !INTERNAL_ACTIONS.has(action);
}
