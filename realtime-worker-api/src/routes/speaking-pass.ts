/** The speaking step: one fast model call that makes each line of a live
 *  answer easy to say aloud, before it is shown. It changes words only,
 *  never the shape of the screen.
 *
 *  Code around the call keeps it safe:
 *    - bullet limit: at most 5 bullets per answer (6 for an answer about the
 *      candidate's background), applied to the draft and to the result;
 *    - fact guard: the same numbers and names as the draft, or the draft is
 *      shown;
 *    - shape guard: no answer lost and no line, bullet or sentence added, or
 *      the draft is shown;
 *    - against the candidate's files: a line whose opening phrase was
 *      swapped gets the files' own opening back (a tie such as "For
 *      example," or "At UBS," is never swapped);
 *    - "Here, " opens only the first of several bullets in a row.
 *  One call, no second run. The whole step has a time limit; after it the
 *  draft is shown. */

import Anthropic from "@anthropic-ai/sdk";

export const SPEAKING_PASS_MODEL = "claude-haiku-5-5";
export const SPEAKING_PASS_MAX_TOKENS = 800;
export const SPEAKING_PASS_DEADLINE_MS = 3000;

/** At most this many bullets per answer, or BACKGROUND_BULLETS for an
 *  answer about the candidate's background. */
export const MAX_BULLETS = 5;
export const BACKGROUND_BULLETS = 6;

/** The speaking step's system prompt, as the candidate's developer note
 *  gives it. It holds no job or company of its own beyond its examples. */
export const SPEAKING_PASS_SYSTEM = `You are the speaking step of a live interview assistant. The main model has drafted one answer screen. The candidate reads that screen aloud, live, in English, his second language, while the interviewer listens. Your job is to make each line easy to say, while the screen keeps exactly the shape the main model gave it.

<context>
The answer must sound like one person talking through one thought. When a sentence is cut into pieces and each piece gets its own line, the listener hears a list of loose facts, and the candidate loses the thread while reading. In a real interview on 12 November 2026, splitting short, sound sentences turned every answer into 8 to 11 loose lines. So this step changes words only, never the structure. These rules hold for every employer, every feed and every question.
</context>

<instructions>
Keep the shape:
1. Keep every bullet as one bullet, on its own line, in the same order. A bullet with two sentences stays one bullet with two sentences.
2. Keep every sentence whole. When a sentence has more than 20 words, shorten it inside the same sentence by removing words that carry no fact. The sentence stays in its own bullet.
3. Show at most 5 bullets per answer, or 6 for an answer about the candidate's background. When an answer has more, keep its bold title line, its opening line, its first 5 bullets and its bold closing line. A screen that holds two answers, each under its own bold title line, keeps both answers, each with its own limit.

Fix words only:
4. Replace a word that is hard to say aloud with the everyday word, keeping the meaning.
5. When a sentence opens with "It", "Its", "They", "Their", "This", "That", "These", "Those" or "There" and points to something in another line, put the name of that thing in its place. A pronoun that points to a name inside its own sentence stays.
6. When a line opens with a label, such as "Task:", "The situation was", "Result:" or a part of the question such as "On the one-date question,", remove the label and keep the sentence after it. Keep the words that tie a line to the line before, such as For example, Then, So, After that, Before go-live, Here, At UBS or At McKinsey. Only a label that names a part of a story or of the question is removed.
7. When the draft changed the opening phrase of a line taken from the feed, and the change moves the fact to another project or time, put the feed's own opening phrase back.
8. Keep every name exactly as the draft writes it: products, companies, systems, places and people. A name is never replaced with a description.
9. When a line or a close came from another answer and names a "the" thing that is neither on this screen nor in the question, drop that line. For a dropped close, the screen ends on its last bullet. A line that says I mentioned, or names a thing with the words I mentioned, stays, because it points to an earlier answer on purpose.
10. When a bullet says again what the opening or another bullet already says, drop that bullet. Dropping is the only change; nothing is added in its place.

Keep the facts:
11. Every number, name, tense and employer stays as the draft has it. No fact is added.
</instructions>

<examples>
<example>
<draft>- That launch puts Sentinel where security and AI meet, which is close to my own work.</draft>
<wrong>- That launch puts Thales's licensing platform where security and AI meet.
- That is close to my own work.</wrong>
<right>- That launch puts Sentinel where security and AI meet, which is close to my own work.</right>
<why>Under 20 words, so nothing changes. The name stays, and no line is added.</why>
</example>
<example>
<draft>- In the Credit Suisse migration, I moved about 400,000 debit card customers across four phases.</draft>
<wrong>- In the Credit Suisse migration, I moved about 400,000 debit card customers to UBS.
- I did this in 4 phases.</wrong>
<right>- In the Credit Suisse migration, I moved about 400,000 debit card customers across four phases.</right>
<why>A split leaves a short line with no fact of its own.</why>
</example>
<example>
<draft>- At UBS, I was the one who actually wrote the documentation for my dispute platform completely from scratch, covering the business requirements and the rules.</draft>
<right>- At UBS, I wrote the documentation for my dispute platform from scratch, covering the business requirements and the rules.</right>
<why>Over 20 words, so it is shortened inside the same sentence and stays one bullet.</why>
</example>
<example>
<draft>A screen with an opening and 8 bullets.</draft>
<right>The title line, the opening, bullets 1 to 5 and the close.</right>
<why>The limit is 5 bullets, 6 only for the background answer.</why>
</example>
</examples>

<output_format>
Return the screen in the same format as the draft: the bold title line, the opening line, bullets starting with "- ", and the bold closing line when there is one. Return nothing else.
</output_format>

Before returning, check: every answer on the screen is still there, the number of bullets in each answer is the same or fewer and never above the limit, no line was added, no sentence has more than 20 words, every name and every number in the draft is still there, and no line is only a few words with no fact.`;

// ── Reading a screen ────────────────────────────────────────────────────

const BOLD_LINE_RE = /^\s*\*\*[^*\n]+\*\*[.!?]?\s*$/;
/** A bullet line ("**Title**" is not one: no space after its first "*"). */
const BULLET_RE = /^\s*[-•*]\s+/;
const PART_LINE_RE = /^\s*\[\d+\/\d+[^\]]*\]\s*$/;

function wordCount(sentence: string): number {
  // Every letter counts, so German words with umlauts count as one word.
  return (sentence.match(/[\p{L}0-9%']+/gu) ?? []).length;
}

/** Sentences split at . ? ! (and at line ends, which end a screen line),
 *  with the ** bold markers stripped. */
export function sentences(text: string): string[] {
  return text
    .replace(/\*\*/g, "")
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One answer on the screen: its lines, with which ones are the title, the
 *  bullets and the close. */
interface Answer {
  lines: string[];
  title: string | null;
}

/** The screen cut into its answers. A bold line followed by a line that is
 *  not bold is an answer's title; a bold line followed by nothing or by
 *  another bold line is a close. */
export function splitAnswers(text: string): Answer[] {
  const lines = text.split("\n");
  const nextFilled = (i: number) => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j];
    return null;
  };
  const answers: Answer[] = [];
  let current: Answer = { lines: [], title: null };
  lines.forEach((line, i) => {
    const next = nextFilled(i);
    const isTitle = BOLD_LINE_RE.test(line) && next !== null && !BOLD_LINE_RE.test(next);
    if (isTitle && current.lines.some((l) => l.trim())) {
      answers.push(current);
      current = { lines: [], title: null };
    }
    if (isTitle && current.title === null) current.title = line;
    current.lines.push(line);
  });
  answers.push(current);
  return answers;
}

const BACKGROUND_RE =
  /\b(?:about (?:yourself|you|me)|introduce yourself|(?:your|my) background|who (?:you are|I am)|walk (?:me|us) through your (?:background|cv|resume|résumé|career|experience|profile)|your (?:career|professional) (?:story|journey|path)|über sich|vorstellen)\b/i;

/** An answer about the candidate's background may show one bullet more. */
function bulletLimit(answer: Answer, question: string, onlyAnswer: boolean): number {
  if (answer.title && BACKGROUND_RE.test(answer.title.replace(/\*\*/g, ""))) return BACKGROUND_BULLETS;
  if (onlyAnswer && BACKGROUND_RE.test(question)) return BACKGROUND_BULLETS;
  return MAX_BULLETS;
}

/** Each answer kept to its bullet limit: its title, its opening, its first
 *  bullets and its close. A part line left with nothing under it goes too. */
export function limitBullets(text: string, question = ""): { text: string; dropped: number } {
  const answers = splitAnswers(text);
  let dropped = 0;
  const out = answers.map((answer) => {
    const limit = bulletLimit(answer, question, answers.length === 1);
    const lines = answer.lines;
    const closeAt = (() => {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].trim()) continue;
        return BOLD_LINE_RE.test(lines[i]) && lines[i] !== answer.title ? i : -1;
      }
      return -1;
    })();
    let bullets = 0;
    let cut = false;
    const kept: string[] = [];
    lines.forEach((line, i) => {
      if (i === closeAt || (!line.trim() && i > closeAt && closeAt >= 0)) {
        kept.push(line);
        return;
      }
      if (cut) {
        if (line.trim()) dropped++;
        return;
      }
      if (BULLET_RE.test(line)) {
        if (bullets === limit) {
          cut = true;
          dropped++;
          return;
        }
        bullets++;
      }
      kept.push(line);
    });
    // A part line with no bullet or text left under it.
    const close = closeAt >= 0 ? lines[closeAt] : null;
    const tidy = kept.filter((line, i) => {
      if (!PART_LINE_RE.test(line)) return true;
      const after = kept.slice(i + 1).find((l) => l.trim());
      return after !== undefined && !PART_LINE_RE.test(after) && after !== close;
    });
    dropped += kept.length - tidy.length;
    // No blank lines piled up where bullets were cut.
    return tidy.join("\n").replace(/\n{3,}/g, "\n\n");
  });
  return { text: out.join("\n"), dropped };
}

// ── Checks on what is shown (for the log) ──────────────────────────────

/** A sentence that opens with a pronoun standing for something said before
 *  it: "It…", "They…", "That is…", "Those are…". "That launch…" names its
 *  thing, and "There is…" says nothing back, so they pass. */
const PRONOUN_OPEN_RE =
  /^(?:[-•*]\s+)?(?:(?:It|Its|They|Their)\b|(?:This|That|These|Those) (?:is|are|was|were|has|have|had|means|meant|makes|made|gives|gave|keeps|kept)\b|There\b(?!\s+(?:is|are|was|were|will|has|have|had)\b|['’]s\b))/;

export interface ScreenChecks {
  /** The most bullets in one answer. */
  maxBullets: number;
  /** Sentences of more than 20 words. */
  longSentences: number;
  /** Lines of under 5 words that are not a title, close or part line. */
  shortLines: number;
  /** Sentences after the first that open with a pronoun pointing back. */
  pronounOpenings: number;
}

/** What the candidate's checks count on a screen. */
export function screenChecks(text: string): ScreenChecks {
  const answers = splitAnswers(text);
  const maxBullets = Math.max(0, ...answers.map((a) => a.lines.filter((l) => BULLET_RE.test(l)).length));
  let longSentences = 0;
  let shortLines = 0;
  let pronounOpenings = 0;
  let before = 0;
  for (const line of text.split("\n")) {
    if (!line.trim() || BOLD_LINE_RE.test(line) || PART_LINE_RE.test(line)) continue;
    if (wordCount(line) < 5) shortLines++;
    for (const s of sentences(line)) {
      if (wordCount(s) > 20) longSentences++;
      if (before > 0 && PRONOUN_OPEN_RE.test(s)) pronounOpenings++;
      before++;
    }
  }
  return { maxBullets, longSentences, shortLines, pronounOpenings };
}

// ── Fact guard ─────────────────────────────────────────────────────────

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

function numbers(text: string): Set<string> {
  return new Set(text.match(NUMBER_RE) ?? []);
}

/** Capitalised words that are not "I" (or "I'm", "I've"…) and not the first
 *  word of a sentence, a line or a bullet. */
function names(text: string): Set<string> {
  const out = new Set<string>();
  const plain = text.replace(/\*\*/g, "");
  for (const line of plain.split("\n")) {
    const body = line.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "");
    for (const sentence of body.split(/(?<=[.?!])\s+/)) {
      const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’&.-]*/gu) ?? [];
      words.forEach((raw, i) => {
        const w = raw.replace(/[.'’-]+$/, "");
        if (i === 0 || !/^\p{Lu}/u.test(w)) return;
        if (/^I(?:['’]\p{L}+)?$/u.test(w)) return;
        out.add(w);
      });
    }
  }
  return out;
}

function hasWord(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, "u").test(text);
}

/** True when the pass kept every number and name, and added none. */
export function passesFactGuard(main: string, pass: string): boolean {
  if (!pass.trim()) return false;
  const a = numbers(main);
  const b = numbers(pass);
  for (const n of a) if (!b.has(n)) return false;
  for (const n of b) if (!a.has(n)) return false;
  const plainMain = main.replace(/\*\*/g, "");
  const plainPass = pass.replace(/\*\*/g, "");
  for (const w of names(main)) if (!hasWord(plainPass, w)) return false;
  for (const w of names(pass)) if (!hasWord(plainMain, w)) return false;
  return true;
}

// ── Shape guard ────────────────────────────────────────────────────────

/** True when the pass kept the draft's shape: every answer still there, and
 *  no line, bullet or sentence added. (Fewer is allowed: a borrowed line
 *  may be dropped.) */
export function keepsShape(draft: string, pass: string): boolean {
  const filled = (t: string) => t.split("\n").filter((l) => l.trim()).length;
  const bullets = (t: string) => t.split("\n").filter((l) => BULLET_RE.test(l)).length;
  const titles = (t: string) => splitAnswers(t).filter((a) => a.title).length;
  return (
    titles(pass) === titles(draft) &&
    filled(pass) <= filled(draft) &&
    bullets(pass) <= bullets(draft) &&
    sentences(pass).length <= sentences(draft).length
  );
}

// ── Against the candidate's files ──────────────────────────────────────
// One word fix that code can make once it has the files the answer is
// written from (the "feed"): the opening phrase of a feed line swapped for
// another ("For my self-service launch," for "When the operation moved
// onto the platform,") gets the feed's own opening back. Words that tie a
// line to the one before ("For example,", "Then,", "At UBS,") are kept.
// And two that need no files: "The situation was that" before a whole
// sentence is removed, and "Here, " is dropped from a bullet when the
// bullet right above also opens with it.

/** The candidate's files, folded for matching. */
export interface Feed {
  /** Every sentence of the files, as written and folded. */
  sentences: Array<{ raw: string; fold: string }>;
}

/** A feed under this many characters is too small to judge by. */
const MIN_FEED_CHARS = 300;

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}%']+/gu, " ")
    .trim();
}

export function buildFeed(texts: Array<string | null | undefined>): Feed | null {
  const all = texts.filter(Boolean).join("\n");
  if (fold(all).length < MIN_FEED_CHARS) return null;
  const feedSentences = all
    .split("\n")
    .map((line) => line.replace(/\*\*/g, "").replace(/^\s*(?:[-•*>]|\d+[.)])\s+/, ""))
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((raw) => raw.trim().replace(/[.?!]+$/, ""))
    .filter((raw) => wordCount(raw) >= 5)
    .map((raw) => ({ raw, fold: fold(raw) }));
  return { sentences: feedSentences };
}

/** Words a sentence can start with as its subject. */
const SUBJECT_START =
  /^(?:I|we|he|she|they|it|my|our|his|her|their|its|the|a|an|this|that|these|those|each|every|one|two|three|four|five|here|there|no|all|most|some|\p{Lu}[\p{L}\p{N}'’&.-]*)\b/u;
/** An opening that ties a line to the line before ("For example,",
 *  "Then,", "At UBS,"): kept as the model wrote it. */
const TIE_RE =
  /^(?:for example|for instance|then|so|after that|before that|before go-live|after go-live|here|also|and|but|now|today|in short|in practice|in fact|at \p{Lu}[\p{L}\p{N}&.'’-]*(?: \p{Lu}[\p{L}\p{N}&.'’-]*)*)$/iu;
/** A bullet opening with "Here, ". */
const HERE_BULLET_RE = /^(\s*[-•*]\s+)Here,\s+(?=\S)/;
/** "The situation was that …": the sentence after it stands alone. */
const STORY_THAT_RE = /^The (?:task|situation|challenge|context|background|goal) (?:was|is) that\s+/i;
const OPENING_RE = /^([^,]{2,80}),\s+(.+)$/;

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The sentence with the opening phrase the files give its line, when the
 *  main model swapped that opening for another or put a label there. Null
 *  when nothing is to change or the files do not say for sure. */
function feedOpening(feed: Feed, body: string): string | null {
  const m = OPENING_RE.exec(body);
  if (!m || m[1].includes("**")) return null;
  const [, opening, rest] = m;
  if (wordCount(opening) > 8 || wordCount(rest) < 5) return null;
  // Words that tie a line to the line before are never swapped.
  if (TIE_RE.test(opening.trim())) return null;
  // An opening phrase leads into a sentence with its own subject; a first
  // clause ("I chair it, because…") is not one.
  if (/^(?:I|we|he|she|they|it|my|our)\b/i.test(opening) || !SUBJECT_START.test(rest)) return null;
  const want = fold(rest);
  // Every opening the files give this line ("" when it has none).
  const found = new Map<string, string>();
  for (const s of feed.sentences) {
    if (s.fold === want) {
      found.set("", "");
      continue;
    }
    if (!s.fold.endsWith(` ${want}`)) continue;
    for (let i = s.raw.indexOf(","); i >= 0; i = s.raw.indexOf(",", i + 1)) {
      if (fold(s.raw.slice(i + 1)) === want) {
        const own = s.raw.slice(0, i).trim();
        found.set(fold(own), own);
        break;
      }
    }
  }
  if (found.size !== 1) return null;
  const [[ownFold, own]] = [...found];
  // The files give no opening (a tie or label the model put there stays:
  // the step's prompt decides on labels), or the same one.
  if (!ownFold || ownFold === fold(opening)) return null;
  return `${capitalise(own)}, ${rest}`;
}

/** One sentence with its words fixed. `changed` counts the fixes. */
function tidySentence(sentence: string, feed: Feed | null, changed: { n: number }): string {
  const end = /[.?!]+$/.exec(sentence)?.[0] ?? "";
  let body = sentence.slice(0, sentence.length - end.length);
  const story = STORY_THAT_RE.exec(body);
  const told = story ? body.slice(story[0].length) : "";
  if (story && SUBJECT_START.test(told) && wordCount(told) >= 4) {
    body = capitalise(told);
    changed.n++;
  }
  const opened = feed ? feedOpening(feed, body) : null;
  if (opened !== null) {
    body = opened;
    changed.n++;
  }
  return body + end;
}

/** The screen with the word fixes made in code. Every line and sentence
 *  stays where it is; bold lines (title, close) and part lines are left
 *  as they are. */
export function tidyForSpeaking(text: string, opts: { feed?: Feed | null } = {}): { text: string; changed: number } {
  const changed = { n: 0 };
  const written = text.split("\n");
  const lines = written.map((line, i) => {
    // "Here, " opens only the first of several bullets in a row.
    if (i > 0 && HERE_BULLET_RE.test(line) && HERE_BULLET_RE.test(written[i - 1])) {
      line = line.replace(HERE_BULLET_RE, "$1");
      const lead = /^\s*[-•*]\s+/.exec(line)?.[0] ?? "";
      line = lead + capitalise(line.slice(lead.length));
      changed.n++;
    }
    if (BOLD_LINE_RE.test(line) || PART_LINE_RE.test(line)) return line;
    const lead = /^\s*(?:[-•*]\s+)?/.exec(line)?.[0] ?? "";
    const body = line.slice(lead.length);
    if (!body.trim()) return line;
    return (
      lead +
      body
        .split(/(?<=[.?!])(\s+)/)
        .map((part) => (/^\s+$/.test(part) ? part : tidySentence(part, opts.feed ?? null, changed)))
        .join("")
    );
  });
  return { text: lines.join("\n"), changed: changed.n };
}

// ── The step ───────────────────────────────────────────────────────────

export interface SpeakingPassInput {
  apiKey: string;
  question: string;
  /** The main model's draft of the screen. */
  answer: string;
  /** The candidate's files the answer is written from (see buildFeed). */
  feed?: Feed | null;
  signal?: AbortSignal;
  deadlineMs?: number;
  model?: string;
  /** For tests: the model call. */
  call?: (system: string, user: string, signal: AbortSignal) => Promise<string>;
}

export interface SpeakingPassResult {
  /** The screen to show. */
  text: string;
  /** main = the draft (with the code fixes); pass = the speaking step. */
  source: "main" | "pass";
  reason: string;
  ms: number;
  /** The step finished before its time limit. */
  inTime: boolean;
  /** The guards on the step's reply; "none" when no reply came back. */
  factGuard: "pass" | "fail" | "none";
  shapeGuard: "pass" | "fail" | "none";
  /** Word fixes made in code (opening put back, label removed). */
  tidied: number;
  /** Bullets (and their part lines) cut by the limit. */
  bulletsDropped: number;
  /** The candidate's checks, counted on the screen shown. */
  checks: ScreenChecks;
  /** The three versions, for the log: the main model's draft as it came,
   *  the speaking step's reply as it came (null when none), and the
   *  screen shown. */
  draft: string;
  passReply: string | null;
}

function userMessage(question: string, draft: string): string {
  return `<question>${question}</question>\n\n<draft>${draft}</draft>`;
}

function anthropicCall(apiKey: string, model: string) {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return async (system: string, user: string, signal: AbortSignal) => {
    // Temperature is left out: Claude Haiku 5.5 rejects any value but the
    // default. Thinking is off, so the reply starts at once.
    const msg = await client.beta.messages.create(
      {
        model,
        max_tokens: SPEAKING_PASS_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
      },
      { signal },
    );
    if (msg.stop_reason === "max_tokens" || msg.stop_reason === "refusal") {
      throw new Error(`speaking step stopped: ${msg.stop_reason}`);
    }
    return msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  };
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(signals);
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) c.abort(s.reason);
    else s.addEventListener("abort", () => c.abort(s.reason), { once: true });
  }
  return c.signal;
}

/** Run the speaking step on a live answer. Never throws: on any failure or
 *  timeout the draft is shown, with the bullet limit and the code fixes. */
export async function runSpeakingPass(input: SpeakingPassInput): Promise<SpeakingPassResult> {
  const started = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error("speaking step deadline")),
    input.deadlineMs ?? SPEAKING_PASS_DEADLINE_MS,
  );
  const signal = anySignal(input.signal ? [deadline.signal, input.signal] : [deadline.signal]);
  const call = input.call ?? anthropicCall(input.apiKey, input.model ?? SPEAKING_PASS_MODEL);

  // The draft, kept to the bullet limit and with the code fixes: what the
  // step works on, what its reply is checked against, and what is shown
  // when the step fails.
  const limited = limitBullets(input.answer, input.question);
  const fixed = tidyForSpeaking(limited.text, { feed: input.feed });
  const draft = fixed.text;

  let factGuard: SpeakingPassResult["factGuard"] = "none";
  let shapeGuard: SpeakingPassResult["shapeGuard"] = "none";
  let passReply: string | null = null;
  const done = (text: string, source: SpeakingPassResult["source"], reason: string, tidied: number, dropped: number) => {
    clearTimeout(timer);
    return {
      text,
      source,
      reason,
      ms: Date.now() - started,
      inTime: !deadline.signal.aborted,
      factGuard,
      shapeGuard,
      tidied,
      bulletsDropped: dropped,
      checks: screenChecks(text),
      draft: input.answer,
      passReply,
    } satisfies SpeakingPassResult;
  };
  const showDraft = (reason: string) => done(draft, "main", reason, fixed.changed, limited.dropped);

  try {
    const reply = await Promise.race([
      call(SPEAKING_PASS_SYSTEM, userMessage(input.question, draft), signal),
      new Promise<never>((_, reject) => {
        // A deadline that fires mid-call rejects at once, not when the call ends.
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    ]);
    passReply = reply;
    factGuard = passesFactGuard(draft, reply) ? "pass" : "fail";
    shapeGuard = keepsShape(draft, reply) ? "pass" : "fail";
    if (factGuard === "fail") return showDraft("fact guard");
    if (shapeGuard === "fail") return showDraft("shape guard");
    // The limit and the code fixes again, on the step's reply.
    const limitedReply = limitBullets(reply, input.question);
    const fixedReply = tidyForSpeaking(limitedReply.text, { feed: input.feed });
    return done(
      fixedReply.text,
      "pass",
      "ok",
      fixed.changed + fixedReply.changed,
      limited.dropped + limitedReply.dropped,
    );
  } catch (err) {
    const why = deadline.signal.aborted
      ? "deadline"
      : input.signal?.aborted
        ? "client gone"
        : err instanceof Error
          ? err.message.slice(0, 120)
          : "error";
    return showDraft(why);
  }
}
