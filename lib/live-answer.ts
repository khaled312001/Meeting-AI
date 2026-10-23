/** Shared bits of the live answer flow (full and compact surfaces). */

export interface LiveAnswerOptions {
  /** The question to answer, word for word (defaults to the transcript). */
  question?: string;
  /** Replace the current answer instead of keeping it in the history. */
  replace?: boolean;
  /** Update: the whole question asked again, replacing its answer. */
  updated?: boolean;
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

/** A long question as heard, cut to one line while the clean one comes. */
const HEARD_MAX_CHARS = 140;
/** A first line longer than this is not the question line: the model
 *  started with the answer, so it is all shown as the answer. */
const QUESTION_LINE_MAX_CHARS = 400;

function oneLine(question: string): string {
  const text = question.replace(/\s+/g, " ").trim();
  if (text.length <= HEARD_MAX_CHARS) return text;
  const cut = text.slice(0, HEARD_MAX_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${space > 80 ? cut.slice(0, space) : cut}…`;
}

/** The model's question line, without any label or markup it added. */
function cleanQuestionLine(line: string): string {
  return line
    .replace(/\*\*/g, "")
    .replace(/^\s*(question|q|frage|السؤال)\s*\d*\s*[:：]\s*/i, "")
    .replace(/^["'“”«»]+|["'“”«»]+$/g, "")
    .trim();
}

/** The text of a live answer as it streams in (`questionLine` replies):
 *  the heading shows the question as heard, on one line, until the model's
 *  one-line restatement arrives and takes its place; the answer follows. */
export function createLiveAnswer(question: string, lang: string, n?: number) {
  const heard = oneLine(question);
  let reply = "";
  let done = false;
  return {
    push(chunk: string) {
      reply += chunk;
    },
    /** The reply is complete: a single line left is the answer itself. */
    finish() {
      done = true;
    },
    text(): string {
      const body = reply.replace(/^\s+/, "");
      const nl = body.indexOf("\n");
      if (nl < 0) {
        return done || body.length > QUESTION_LINE_MAX_CHARS
          ? answerHeading(heard, lang, n) + body
          : answerHeading(heard, lang, n);
      }
      const line = cleanQuestionLine(body.slice(0, nl));
      const answer = body.slice(nl + 1).replace(/^\s+/, "");
      if (!line || line.length > QUESTION_LINE_MAX_CHARS) {
        return answerHeading(heard, lang, n) + body;
      }
      return answerHeading(line, lang, n) + answer;
    },
  };
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
