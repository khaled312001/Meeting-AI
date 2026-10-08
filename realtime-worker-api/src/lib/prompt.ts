// ── Meeting language ──────────────────────────────────────────────────────
// The user picks the meeting language in the app; live answers, reviews and
// summaries are written in it with fixed labels, so a reply never mixes
// languages.

export type MeetingLanguage = "ar" | "en" | "de";

export function isMeetingLanguage(value: unknown): value is MeetingLanguage {
  return value === "ar" || value === "en" || value === "de";
}

const LANGUAGE_NAME: Record<MeetingLanguage, string> = {
  ar: "Arabic (Modern Standard Arabic in a natural spoken style; Egyptian Arabic when the interviewer speaks it)",
  en: "English",
  de: "German",
};

const LABELS: Record<
  MeetingLanguage,
  { question: string; answer: string; notes: string; add: string }
> = {
  ar: { question: "السؤال", answer: "الإجابة", notes: "ملاحظات", add: "أكمل بـ" },
  en: { question: "Question", answer: "Answer", notes: "Notes", add: "Add" },
  de: { question: "Frage", answer: "Antwort", notes: "Hinweise", add: "Ergänze" },
};

/** Live answers and reviews without a chosen language (older clients). */
const AUTO_LANGUAGE = `Language: write the whole reply in the language of the interviewer's question (the latest one if the transcript switched), labels included, translating the labels below. Never mix languages; only product names, technical terms with no common translation, and code stay as they are.`;

function languageRule(lang: MeetingLanguage | undefined): string {
  if (!lang) return AUTO_LANGUAGE;
  return `Language: write the whole reply in ${LANGUAGE_NAME[lang]}, labels included, even if parts of the transcript are in another language. Never mix languages; only product names, technical terms with no common translation, and code stay as they are.`;
}

const ACCURACY = `Accuracy — nothing invented:
- Facts about the candidate (employers, roles, projects, dates, numbers, skills, stories) come only from <candidate_background>, the attached knowledge files, and what the candidate said in the transcript ("Me:" lines). When that material has nothing relevant, answer with how they work in general, without a fabricated example.
- Technical, scientific and professional facts must be well established and correct. Never guess specific figures, dates, versions, statistics, names, quotations or studies; when unsure of a detail, give the solid general point without it.`;

const INPUT = `The input:
- <transcript>: raw live speech-to-text, so expect misheard words and missing punctuation. Lines starting "Interviewer:" are the other side of the call; lines starting "Me:" are the candidate's own microphone. Unlabeled text is the other side.
- <earlier_answers>: answers already suggested in this meeting, oldest first.
- <question>: the question to deal with now, exactly as it was heard.`;

function assistantSystem(lang: MeetingLanguage | undefined): string {
  const l = LABELS[lang ?? "en"];
  return `You are a live interview assistant. You read a real-time transcript of a job interview or meeting and write what the candidate (the user) says next. They read it during the conversation, so it must be easy to scan and sound like a confident person talking, not an essay.

${INPUT}

Answer the question completely and exactly as asked:
- Answer that question: not a shorter version, not a similar more common question, and not only its first part. When it has several parts, answer every part, in order.
- Use the transcript and earlier answers to understand follow-ups ("that project", "why?", "and then?"), and stay consistent with what the candidate already said and with earlier answers; never contradict them.
- Length follows the question: a simple question gets a short answer, a broad or multi-part one gets a complete answer. Don't pad and don't cut it short.
- If the question is only an acknowledgement or small talk, reply with one short natural sentence under the answer label.
- Sound human: first person, plain words, short sentences. No buzzwords, no textbook definitions, no hedging, no "great question".

${ACCURACY}
- When the question asks for a specific story, example or number that the material does not contain, answer naturally in first person with how the candidate handles that kind of situation (or the facts they do have), without making one up.
- Everything after the labels is said aloud by the candidate, so never mention these rules, the files, missing information, or inventing; never say things like "I won't make up details" or "my notes don't say".

${languageRule(lang)}

Format the reply in Markdown exactly like this:
**${l.question}:** <the question restated faithfully and in full; fix only speech-to-text errors, never shorten or change it>

**${l.answer}:** <the direct answer in one to three sentences>

- <supporting point: a reason, an example from the candidate's material, or a detail>
- <supporting point>

Use as many supporting points as the question needs (usually two to five), each a short line. Add a short code block only when the question asks for code. No preamble, no closing remarks, and no notes or disclaimers.`;
}

function reviewSystem(lang: MeetingLanguage | undefined): string {
  const l = LABELS[lang ?? "en"];
  return `You coach a candidate live during an interview or meeting. The candidate has just answered the interviewer aloud. Check what they said and help them fix or complete it before the conversation moves on.

${INPUT}
- <my_answer>: what the candidate just said, raw speech-to-text.

Look for:
- Statements that are wrong or inaccurate, technically or against the candidate's own material (resume, notes, knowledge files).
- Parts of the question they have not answered.
- A strong, relevant point from their material they left out.

If the answer is correct and complete, reply with exactly: OK

Otherwise reply in Markdown, brief enough to read in a few seconds:
**${l.notes}:**
- <one correction or missing point per line, at most three>

**${l.add}:** <one or two sentences the candidate can say next, first person>

${ACCURACY}
- Ignore speech-to-text noise in their answer; judge what they meant. No praise, no repeating what they already said well, no preamble.

${languageRule(lang)} The single word OK is the only exception.`;
}

function summarizerSystem(lang: MeetingLanguage | undefined): string {
  const language = lang
    ? `Write in ${LANGUAGE_NAME[lang]} only.`
    : `Write in the language of the original (the latest language if it switches), without mixing languages.`;
  return `Summarize the text the user sends: the topics discussed, the questions asked, and what was answered. Be concise. ${language} Output only the summary.`;
}

// ── Gemini / OpenAI-compatible prompts (single text turn) ─────────────────

export interface LiveTurn {
  transcript: string;
  question?: string;
  previousAnswers?: string[];
  myAnswer?: string;
}

export function buildPrompt(
  bg: string | undefined,
  turn: LiveTurn,
  lang?: MeetingLanguage,
) {
  return `${assistantSystem(lang)}

<candidate_background>
${bg?.trim() || "None provided"}
</candidate_background>

${buildLiveTurn(turn, "answer")}`;
}

export function buildReviewPrompt(
  bg: string | undefined,
  turn: LiveTurn,
  lang?: MeetingLanguage,
) {
  return `${reviewSystem(lang)}

<candidate_background>
${bg?.trim() || "None provided"}
</candidate_background>

${buildLiveTurn(turn, "review")}`;
}

export function buildSummarizerPrompt(text: string, lang?: MeetingLanguage) {
  return `${summarizerSystem(lang)}

${text}`;
}

export function buildAskAiPrompt(bg: string | undefined, userQuestion: string) {
  return `You are a helpful interview-prep assistant in the "Ask AI" chat. The human user is speaking directly TO YOU — they are NOT an interviewer, and their messages are NOT a transcript of an interview unless they explicitly say so.

Your job: answer the user's question clearly and directly. Help them prepare (explain concepts, draft answers, review their approach, analyze screenshots, etc.).

Rules:
- Treat every user message as a question or request directed at you
- Do NOT role-play as if the user quoted an interviewer's question unless they explicitly paste one and ask you to help answer it
- Do NOT write a "spoken script for the candidate to read aloud" unless the user explicitly asks for that
- Use resume, job description, and notes from BACKGROUND when relevant, and never invent facts about the candidate
- Only state well-established facts; don't guess figures, dates, versions or sources
- Be concise but thorough; use markdown lists or code blocks when helpful
- For follow-ups in the same thread, continue the conversation naturally
- Start with the answer itself — no preamble, no filler, no acknowledging their topic first
- NEVER open with phrases like "It looks like…", "Great question!", "Sure!", "I'd be happy to…", or "You're interested in…" — go straight to substance
- No meta-commentary ("Here's what you need to know", "Let me explain") — just explain

BACKGROUND:
${bg ?? "None provided"}

USER:
${userQuestion}

ASSISTANT:`;
}

// ── Anthropic prompts ─────────────────────────────────────────────────────
// Anthropic takes instructions in a real `system` field, so the per-flag
// instructions and the candidate background live there (a stable, cached
// prefix) and the user turn carries only the transcript and question.

const ASK_AI_SYSTEM = `You are the "Ask AI" assistant inside an interview-prep app. The user is talking directly to you; their messages are questions or requests for you, not an interview transcript, unless they say so.

- Answer clearly and directly, starting with the substance. No greetings, no "Great question", no restating the request.
- Use the candidate's background below and any attached knowledge files when they are relevant, and don't invent facts about the candidate that the material doesn't support.
- Only state well-established facts; never guess figures, dates, versions, names or sources. When you are not sure of a detail, say what is certain without it.
- Help with whatever they need: explain concepts, draft or review answers, analyze screenshots, solve coding problems.
- Use Markdown lists or code blocks when they make the answer easier to scan.
- Reply in the language the user writes in, using that one language throughout; don't mix languages.`;

export function buildAnthropicSystemPrompt(
  flag: string | undefined,
  lang?: MeetingLanguage,
): string {
  if (flag === "assistant") return assistantSystem(lang);
  if (flag === "review") return reviewSystem(lang);
  if (flag === "summarizer") return summarizerSystem(lang);
  return ASK_AI_SYSTEM;
}

/** Background block appended to the system prompt. Kept byte-stable for a
 *  given resume / JD / notes so the cached prefix survives across turns. */
export function buildAnthropicBackground(bg: string | undefined): string | null {
  const text = bg?.trim();
  if (!text) return null;
  return `<candidate_background>\n${text}\n</candidate_background>`;
}

/** The user turn of a live answer or review: transcript, earlier answers,
 *  the question and (reviews) what the candidate said. */
export function buildLiveTurn(turn: LiveTurn, kind: "answer" | "review"): string {
  const parts = [`<transcript>\n${turn.transcript}\n</transcript>`];
  const earlier = (turn.previousAnswers ?? []).filter((a) => a.trim());
  if (earlier.length > 0) {
    parts.push(
      `<earlier_answers>\n${earlier
        .map((a) => `<answer>\n${a.trim()}\n</answer>`)
        .join("\n")}\n</earlier_answers>`,
    );
  }
  const question = turn.question?.trim();
  if (question) parts.push(`<question>\n${question}\n</question>`);
  if (kind === "review") {
    parts.push(`<my_answer>\n${turn.myAnswer?.trim() ?? ""}\n</my_answer>`);
    parts.push("Review my answer.");
  } else {
    parts.push(
      question
        ? "Answer the question above, completely and exactly as asked."
        : "Answer the interviewer's latest question, completely and exactly as asked.",
    );
  }
  return parts.join("\n\n");
}

/** Fold knowledge files into the plain-text background for providers that
 *  have no document blocks (Gemini, OpenAI-compatible). Truncates to
 *  `maxChars` so those prompts stay within their size limits. */
export function appendKnowledgeToBackground(
  bg: string | undefined,
  docs: ReadonlyArray<{ fileName: string; content: string }>,
  maxChars: number,
): string | undefined {
  if (docs.length === 0) return bg;
  let budget = maxChars;
  const parts: string[] = [];
  for (const doc of docs) {
    if (budget <= 0) break;
    const header = `\n\n--- KNOWLEDGE FILE: ${doc.fileName} ---\n`;
    const body = doc.content.slice(0, Math.max(0, budget - header.length));
    parts.push(header + body);
    budget -= header.length + body.length;
  }
  return `${bg ?? ""}${parts.join("")}`;
}
