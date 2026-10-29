/** The meeting's languages: what is listened for, and what answers are
 *  written in. Listening on Auto hears Arabic (its dialects too), English
 *  and German, also switching inside one sentence; answers on Auto follow
 *  the question's language. Either can be set to one language instead. */

export type MeetingLanguage = "ar" | "en" | "de";
/** What transcription listens for: one language, or all three ("auto"). */
export type ListenLanguage = "auto" | MeetingLanguage;
/** What answers are written in: one language, or the question's ("auto"). */
export type AnswerLanguage = "auto" | MeetingLanguage;

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

/** Auto first, then each language. */
export const LANGUAGE_CHOICES: ReadonlyArray<{
  id: ListenLanguage;
  short: string;
  label: string;
}> = [{ id: "auto", short: "Auto", label: "Automatic" }, ...MEETING_LANGUAGES];

export const DEFAULT_LISTEN_LANGUAGE: ListenLanguage = "auto";
export const DEFAULT_ANSWER_LANGUAGE: AnswerLanguage = "auto";

// A new key, so everyone starts on Auto once; a language picked after
// that is kept.
const LISTEN_KEY = "meeting-ai-listen-language";
const ANSWER_KEY = "meeting-ai-answer-language";

export function isMeetingLanguage(value: unknown): value is MeetingLanguage {
  return value === "ar" || value === "en" || value === "de";
}

function isChoice(value: unknown): value is ListenLanguage {
  return value === "auto" || isMeetingLanguage(value);
}

function read(key: string, fallback: ListenLanguage): ListenLanguage {
  try {
    const stored = localStorage.getItem(key);
    return isChoice(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: ListenLanguage): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the choice still applies for this session */
  }
}

export const readListenLanguage = () => read(LISTEN_KEY, DEFAULT_LISTEN_LANGUAGE);
export const writeListenLanguage = (l: ListenLanguage) => write(LISTEN_KEY, l);
export const readAnswerLanguage = (): AnswerLanguage =>
  read(ANSWER_KEY, DEFAULT_ANSWER_LANGUAGE);
export const writeAnswerLanguage = (l: AnswerLanguage) => write(ANSWER_KEY, l);

/** The language answers are asked for in: the one chosen for answers, else
 *  the one listened for; undefined when both are Auto (the question's). */
export function replyLanguage(
  answer: AnswerLanguage,
  listen: ListenLanguage,
): MeetingLanguage | undefined {
  if (answer !== "auto") return answer;
  return listen !== "auto" ? listen : undefined;
}

const GERMAN_RE = /[äöüß]|\b(?:und|nicht|ist|das|wir|ich|sie|der|die|mit|für)\b/giu;

/** The language most of `text` is in, for labels and file names when the
 *  language is Auto. */
export function guessLanguage(text: string): MeetingLanguage {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return "en";
  const arabic = letters.filter((c) => /\p{Script=Arabic}/u.test(c)).length;
  if (arabic / letters.length > 0.3) return "ar";
  const words = text.split(/\s+/).filter(Boolean).length;
  return (text.match(GERMAN_RE) ?? []).length / words > 0.08 ? "de" : "en";
}

/** Deepgram's language setting. Auto is its multilingual model, which
 *  follows a speaker switching languages mid-sentence. */
export function deepgramLanguage(language: ListenLanguage): string {
  return language === "auto" ? "multi" : language;
}
