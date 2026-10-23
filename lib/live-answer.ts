/** Shared bits of the live answer flow (full and compact surfaces). */

export interface LiveAnswerOptions {
  /** The question to answer, word for word (defaults to the transcript). */
  question?: string;
  /** Replace the current answer instead of keeping it in the history. */
  replace?: boolean;
  /** For a review: what the user said aloud. */
  myAnswer?: string;
}

/** Labels of a live answer (the server's prompt uses the same ones). */
const ANSWER_LABELS: Record<string, { question: string; answer: string }> = {
  ar: { question: "السؤال", answer: "الإجابة" },
  en: { question: "Question", answer: "Answer" },
  de: { question: "Frage", answer: "Antwort" },
};

/** Shown the moment a live answer starts: the question as heard, with its
 *  number in the meeting. The model then writes only the answer after it
 *  (`answerOnly`), so the answer itself starts sooner. */
export function answerHeading(
  question: string,
  lang: string,
  n?: number,
): string {
  const l = ANSWER_LABELS[lang] ?? ANSWER_LABELS.en;
  const label = n ? `${l.question} ${n}` : l.question;
  return `**${label}:** ${question.trim()}\n\n**${l.answer}:** `;
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
