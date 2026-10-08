/** Shared bits of the live answer flow (full and compact surfaces). */

export interface LiveAnswerOptions {
  /** The question to answer, word for word (defaults to the transcript). */
  question?: string;
  /** Replace the current answer instead of keeping it in the history. */
  replace?: boolean;
  /** For a review: what the user said aloud. */
  myAnswer?: string;
}

/** Screenshot → answer, in the meeting language. */
export const SCREEN_PROMPT: Record<string, string> = {
  ar: "حلّل لقطة الشاشة هذه. إذا كان فيها سؤال مقابلة أو مسألة برمجية، أجب عنه كاملاً وبدقة. اكتب بالعربية فقط.",
  en: "Analyze this screenshot. If it shows an interview question or a coding problem, answer it completely and accurately. Write in English only.",
  de: "Analysiere diesen Screenshot. Wenn er eine Interviewfrage oder eine Programmieraufgabe zeigt, beantworte sie vollständig und korrekt. Schreibe nur auf Deutsch.",
};

/** A review with nothing to add is just "OK"; text that could still turn
 *  out to be that is held back, so an empty review never shows. */
export function isQuietReview(text: string): boolean {
  return /^(o|ok|ok\.)?$/i.test(text.trim());
}
