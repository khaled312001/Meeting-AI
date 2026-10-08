/** The language the meeting is held in. Transcription and answers both
 *  stick to it, so a turn never mixes languages. */

export type MeetingLanguage = "ar" | "en" | "de";

export const MEETING_LANGUAGES: ReadonlyArray<{
  id: MeetingLanguage;
  /** Short button label. */
  short: string;
  /** Name in the language itself. */
  label: string;
}> = [
  { id: "ar", short: "ع", label: "العربية" },
  { id: "en", short: "EN", label: "English" },
  { id: "de", short: "DE", label: "Deutsch" },
];

export const DEFAULT_MEETING_LANGUAGE: MeetingLanguage = "en";

const STORAGE_KEY = "meeting-ai-language";

export function isMeetingLanguage(value: unknown): value is MeetingLanguage {
  return value === "ar" || value === "en" || value === "de";
}

export function readMeetingLanguage(): MeetingLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isMeetingLanguage(stored) ? stored : DEFAULT_MEETING_LANGUAGE;
  } catch {
    return DEFAULT_MEETING_LANGUAGE;
  }
}

export function writeMeetingLanguage(language: MeetingLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* storage unavailable — the choice still applies for this session */
  }
}
