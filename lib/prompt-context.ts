/** Build the interview background block from notes + resume/JD. */

export interface BuildContextBlockArgs {
  resumeText?: string | null;
  jobDescription?: string | null;
  existingBg?: string;
}

/** Server cap on the background block (MAX_BG_CHARS in the worker). */
export const MAX_CONTEXT_CHARS = 100_000;
const MAX_NOTES_CHARS = 40_000;
const MAX_RESUME_CHARS = 30_000;
const MAX_JD_CHARS = 20_000;

export function buildContextBlock({
  resumeText,
  jobDescription,
  existingBg = "",
}: BuildContextBlockArgs): string {
  const parts: string[] = [];
  // Labelled so the model treats notes as the candidate's own priorities.
  // Each part is capped so the block always fits the server limit.
  const base = existingBg.trim().slice(0, MAX_NOTES_CHARS);
  if (base) parts.push(`--- INTERVIEW NOTES (candidate's focus and talking points) ---\n${base}`);

  const resume = resumeText?.trim().slice(0, MAX_RESUME_CHARS);
  if (resume) {
    parts.push(`\n\n--- RESUME ---\n${resume}`);
  }

  const jd = jobDescription?.trim().slice(0, MAX_JD_CHARS);
  if (jd) {
    parts.push(`\n\n--- JOB DESCRIPTION ---\n${jd}`);
  }

  return parts.join("").slice(0, MAX_CONTEXT_CHARS);
}

export function hasAttachedContext(fields: {
  resumeText?: string | null;
  jobDescription?: string | null;
}): boolean {
  return !!(fields.resumeText?.trim() || fields.jobDescription?.trim());
}
