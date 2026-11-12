/** The speaking pass: one more fast model call that reshapes a live answer
 *  so it can be read aloud on the first try, before it is shown.
 *
 *  Two checks in code keep it safe:
 *    - fact guard: the same numbers and names as the main answer, or the
 *      main answer is shown as it is;
 *    - speaking guard: no long, counted, dashed or hanging sentences; if any
 *      are left, the pass runs once more on them and the version with fewer
 *      failures is shown.
 *  The whole step has a time limit; after it the best version so far that
 *  passed the fact guard is shown, or else the main answer. */

import Anthropic from "@anthropic-ai/sdk";

export const SPEAKING_PASS_MODEL = "claude-haiku-5-5";
export const SPEAKING_PASS_MAX_TOKENS = 800;
export const SPEAKING_PASS_DEADLINE_MS = 3000;

/** The pass's system prompt. The candidate's name is filled in per user
 *  (an admin sets it with the speaking pass), so no name is kept here. */
const SPEAKING_PASS_TEMPLATE = `You reshape interview answers so they can be read aloud live. {{name}} reads each answer from his screen while the interviewer listens. English is his second language. A sentence he cannot say on the first try makes him stop, restart and lose the thread. That costs him more than a missing detail. Your only job is the shape of the sentences. The content stays exactly as it is.

<input>
You receive three things in the user message:
<question> the interviewer's question </question>
<answer> the answer the main model wrote </answer>
<shown> the screens already shown in this interview, oldest first </shown>
</input>

<instructions>
1. Read the answer one sentence at a time and rewrite only the sentences that break a rule below. Leave every other sentence word for word.
2. Give each sentence one subject. Say the subject first, then the verb. When the sentence is about his own work, make the subject "I". When a second person or team appears, give them their own sentence: "I own how the model is used. The data science team builds it."
3. Keep every sentence at 20 words or fewer. Split a long sentence at its natural joint, usually ", and", ", so", ", because" or ", with". Two sentences are the normal result. Every new sentence has its own subject and verb and at least 6 words. Apply this to every sentence, whatever its length: a second subject or a "because" clause becomes its own sentence. Only when the interviewer asked for one sentence, leave that sentence as it is.
4. Say each list once, with three items at most.
5. Say the thing itself, never a count of its parts. Never start a line with "The first", "The second" or "The last".
6. Use plain words he can say at once. Move a phrase that hangs at the end, such as ", end to end" or ", with the team building it", into its own sentence or to the front.
7. Repair any sentence that is broken, such as a verb with no object or an "it" that could mean two things, using only words already in the answer.
8. If a bullet says nearly the same thing as a sentence in <shown>, remove that bullet. Do this only while the answer still keeps its opening and at least two bullets.
9. Keep the language the answer is in. A German answer stays German, with the same rules.
</instructions>

<constraints>
- Keep every fact exactly: every number, name, employer, product, title, tense and limit. These are true facts about a real person, and one changed word can make him say something false in an interview.
- Add nothing: no new fact, reason, step, person, number or claim. Remove no fact, except a bullet removed under instruction 8.
- Keep the screen format: the bold first line, the opening sentence, the bullets starting with "- ", the bold close, and figures in bold such as **70%**.
- Write no "I would", no em dash or en dash, and no colon or semicolon inside a sentence.
- When the answer already follows every rule, return it unchanged.
</constraints>

<examples>
<example>
<answer>**What I decide alone**
At UBS, as deputy product owner, three decisions are mine alone, and two kinds go up for approval.
- The first alone is each release, because I chair the change forum.
- The second is the AI model, where the data science team builds the models. Their use, thresholds and sign-off are mine.</answer>
<reshaped>**What I decide alone**
At UBS, I approve every release on my own, because I chair the change forum.
- I also own how the AI model is used, its thresholds and its sign-off.
- The data science team builds the model.</reshaped>
</example>
<example>
<answer>- On the platform itself, the bank's own development team built, and it reported into my programme.</answer>
<reshaped>- The bank's own development team built the platform. That team reported into my programme.</reshaped>
</example>
<example>
<answer>- My part was writing its requirements and leading it to release, with the bank's own development team building it.</answer>
<reshaped>- I wrote its requirements and led it to release. The bank's own development team built it.</reshaped>
</example>
<example>
<answer>At UBS I own an AI platform for the bank's fraud and dispute specialists, end to end. It brings the evidence on each case into one view, recommends an outcome and drafts the replies, and a specialist signs every decision.</answer>
<reshaped>At UBS I own the whole AI platform for the bank's fraud and dispute specialists. It brings the evidence on each case into one view, recommends an outcome and drafts the replies. A specialist signs every decision.</reshaped>
</example>
<example>
<answer>**What my team says about me**
My team would say I give them real decisions, and I back them.
- Every week I go through the numbers with each team lead, and I coach there.</answer>
<reshaped>**What my team says about me**
My team would say I give them real decisions, and I back them.
- Every week I go through the numbers with each team lead, and I coach there.</reshaped>
<note>Already clean, so it is returned unchanged.</note>
</example>
</examples>

<output_format>
Return only the reshaped answer, in the same screen format, with no tags, notes or comments.
</output_format>

Before you return, check that every number and name from the answer is still there, that no sentence is over 20 words, and that each sentence has one subject.`;

export function speakingPassSystem(name: string): string {
  return SPEAKING_PASS_TEMPLATE.replace("{{name}}", name.trim() || "The candidate");
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

// ── Speaking guard ─────────────────────────────────────────────────────

const COUNTED_RE =
  /\b(two|three|four|five) (decisions|kinds|ways|things|checks|parts|points|reasons|steps|levels)\b/i;
/** A sentence that opens with an ordinal, at the start of a line or not,
 *  with or without a bullet or "The". */
const ORDINAL_LINE_RE = /^(?:[-•*]\s+)?(?:the\s+)?(first|second|third|fourth|then|finally|last)\b/i;
const MY_PART_RE = /\bMy (part|task|role|job) (was|is)\b/;
const HANGING_RE = /, with ([^,]*)$/;
const DASH_RE = /[–—]/;

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

function wordCount(sentence: string): number {
  // The note's [A-Za-z0-9%']+, widened to every letter so German words
  // with umlauts count as one word.
  return (sentence.match(/[\p{L}0-9%']+/gu) ?? []).length;
}

/** The interviewer asked for the answer in one sentence: that sentence may
 *  be long, and it is not split. */
export function asksOneSentence(question: string): boolean {
  return /\b(?:one|a single|single|1)\s+sentence\b|\bin a sentence\b/i.test(question);
}

/** Each sentence that breaks a speaking rule, once per rule it breaks. */
export function speakingFailures(text: string, opts: { oneSentence?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    const bare = s.replace(/[.?!]+$/, "");
    if (!opts.oneSentence && wordCount(s) > 20) out.push(s);
    if (COUNTED_RE.test(s)) out.push(s);
    if (ORDINAL_LINE_RE.test(s)) out.push(s);
    if (MY_PART_RE.test(s)) out.push(s);
    const hang = HANGING_RE.exec(bare);
    if (hang && /\p{L}+ing\b/u.test(hang[1])) out.push(s);
    if (DASH_RE.test(s)) out.push(s);
  }
  return out;
}

// ── Tidy in code, against the candidate's files ────────────────────────
// Two things the models keep doing that code can see once it has the files
// the answer is written from (the "feed"):
//   - two feed lines joined into one sentence with ", and" / ", because"…:
//     split back into the two lines;
//   - a "so" / "because" / "which" clause added at the end of a sentence
//     whose words are nowhere in the files: removed.
// Plus one rule that needs no files: a sentence opening with "First",
// "Then" or "Finally" before its subject loses that word.

/** The candidate's files, folded for matching. */
export interface Feed {
  norm: string;
}

/** A feed under this many folded characters is too small to judge by. */
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
  const norm = fold(texts.filter(Boolean).join("\n"));
  return norm.length >= MIN_FEED_CHARS ? { norm: ` ${norm} ` } : null;
}

function inFeed(feed: Feed, text: string): boolean {
  const f = fold(text);
  return !!f && feed.norm.includes(` ${f} `);
}

/** True when no run of four words of `text` is in the files. */
function newToFeed(feed: Feed, text: string): boolean {
  const words = fold(text).split(" ").filter(Boolean);
  if (words.length < 4) return false;
  for (let i = 0; i + 4 <= words.length; i++) {
    if (feed.norm.includes(` ${words.slice(i, i + 4).join(" ")} `)) return false;
  }
  return true;
}

/** Words a sentence can start with as its subject. */
const SUBJECT_START =
  /^(?:I|we|he|she|they|it|my|our|his|her|their|its|the|a|an|this|that|these|those|each|every|one|two|three|four|five|here|there|no|all|most|some|\p{Lu}[\p{L}\p{N}'’&.-]*)\b/u;
const JOINT_RE = /,\s+(and|because|so|but)\s+/gi;
const ADDED_CLAUSE_RE = /^(.*\S),\s+(so|because|which)\s+([^,]+)$/i;
const ORDINAL_WORD_RE =
  /^(First|Second|Third|Then|Finally|Lastly),?\s+(?=(?:I|we|my|our|the|a|an|this|that|it|they|each|every)\b)/i;

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const evenBold = (s: string) => (s.match(/\*\*/g)?.length ?? 0) % 2 === 0;

/** One sentence, tidied. `changed` counts the changes made. */
function tidySentence(
  sentence: string,
  feed: Feed | null,
  oneSentence: boolean,
  changed: { n: number },
): string {
  const end = /[.?!]+$/.exec(sentence)?.[0] ?? "";
  let body = sentence.slice(0, sentence.length - end.length);

  const ordinal = ORDINAL_WORD_RE.exec(body);
  if (ordinal && wordCount(body.slice(ordinal[0].length)) >= 3) {
    body = capitalise(body.slice(ordinal[0].length));
    changed.n++;
  }
  if (!feed) return body + end;

  const added = ADDED_CLAUSE_RE.exec(body);
  if (added && wordCount(added[1]) >= 5 && evenBold(added[1]) && newToFeed(feed, added[3])) {
    body = added[1];
    changed.n++;
  }

  if (!oneSentence && !inFeed(feed, body)) {
    for (const m of body.matchAll(JOINT_RE)) {
      const a = body.slice(0, m.index);
      const b = body.slice((m.index ?? 0) + m[0].length);
      if (wordCount(a) < 5 || wordCount(b) < 5 || !evenBold(a)) continue;
      if (!SUBJECT_START.test(b) || !inFeed(feed, a) || !inFeed(feed, b)) continue;
      changed.n++;
      return `${a}. ${tidySentence(capitalise(b) + (end || "."), feed, oneSentence, changed)}`;
    }
  }
  return body + end;
}

/** The answer with joined feed lines split, added clauses removed and
 *  ordinal openings dropped. Bold lines (title, close) and part lines are
 *  left as they are. */
export function tidyForSpeaking(
  text: string,
  opts: { feed?: Feed | null; oneSentence?: boolean } = {},
): { text: string; changed: number } {
  const changed = { n: 0 };
  const lines = text.split("\n").map((line) => {
    if (/^\s*\*\*[^*]+\*\*\s*$/.test(line) || /^\s*\[\d+\/\d+[^\]]*\]\s*$/.test(line)) return line;
    const lead = /^\s*(?:[-•*]\s+)?/.exec(line)?.[0] ?? "";
    const body = line.slice(lead.length);
    if (!body.trim()) return line;
    const tidied = body
      .split(/(?<=[.?!])\s+/)
      .map((s) => tidySentence(s, opts.feed ?? null, !!opts.oneSentence, changed))
      .join(" ");
    return lead + tidied;
  });
  return { text: lines.join("\n"), changed: changed.n };
}

// ── The pass ───────────────────────────────────────────────────────────

export interface SpeakingPassInput {
  apiKey: string;
  /** The candidate's name, as the prompt names them. */
  name: string;
  question: string;
  answer: string;
  /** Screens already shown in this interview, oldest first. */
  shown: string[];
  /** The candidate's files the answer is written from (see buildFeed). */
  feed?: Feed | null;
  signal?: AbortSignal;
  deadlineMs?: number;
  model?: string;
  /** For tests: the model call. */
  call?: (system: string, user: string, signal: AbortSignal) => Promise<string>;
}

export interface SpeakingPassResult {
  text: string;
  /** main = the main answer as it was; pass = first pass; retry = second. */
  source: "main" | "pass" | "retry";
  reason: string;
  ms: number;
  /** The step finished before its time limit. */
  inTime: boolean;
  /** The fact guard on the first pass; "none" when no pass came back. */
  factGuard: "pass" | "fail" | "none";
  /** Speaking-guard failures in the first pass, and in the text shown. */
  failsFirst: number | null;
  failsShown: number;
  /** Sentences changed in code (split, clause removed, ordinal dropped). */
  tidied: number;
}

function userMessage(question: string, answer: string, shown: string[], failing?: string[]): string {
  const parts = [
    `<question>${question}</question>`,
    `<answer>${answer}</answer>`,
    `<shown>${shown.join("\n\n")}</shown>`,
  ];
  if (failing?.length) {
    parts.push(
      `These sentences still break the rules. Reshape them, and keep everything else as it is:\n${[
        ...new Set(failing),
      ]
        .map((s) => `- ${s}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
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
      throw new Error(`speaking pass stopped: ${msg.stop_reason}`);
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

/** Reshape a live answer for speaking. Never throws: on any failure or
 *  timeout the best safe version is returned (at worst the main answer). */
export async function runSpeakingPass(input: SpeakingPassInput): Promise<SpeakingPassResult> {
  const started = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error("speaking pass deadline")),
    input.deadlineMs ?? SPEAKING_PASS_DEADLINE_MS,
  );
  const signal = anySignal(input.signal ? [deadline.signal, input.signal] : [deadline.signal]);
  const call = input.call ?? anthropicCall(input.apiKey, input.model ?? SPEAKING_PASS_MODEL);
  const main = input.answer;
  const system = speakingPassSystem(input.name);
  const oneSentence = asksOneSentence(input.question);
  const tidy = (text: string) => tidyForSpeaking(text, { feed: input.feed, oneSentence });
  const fails = (text: string) => speakingFailures(text, { oneSentence });
  let factGuard: SpeakingPassResult["factGuard"] = "none";
  let failsFirst: number | null = null;
  // Until a pass passes the fact guard, the main answer (tidied) is the one to show.
  const tidyMain = tidy(main);
  let best = { text: tidyMain.text, source: "main" as SpeakingPassResult["source"], changed: tidyMain.changed };
  const done = (r: { text: string; source: SpeakingPassResult["source"]; reason: string; changed: number }) => {
    clearTimeout(timer);
    return {
      text: r.text,
      source: r.source,
      reason: r.reason,
      ms: Date.now() - started,
      inTime: !deadline.signal.aborted,
      factGuard,
      failsFirst,
      failsShown: fails(r.text).length,
      tidied: r.changed,
    } satisfies SpeakingPassResult;
  };
  // A deadline that fires mid-call rejects at once, not when the call ends.
  const raced = <T>(p: Promise<T>) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    ]);

  try {
    const raw1 = await raced(call(system, userMessage(input.question, main, input.shown), signal));
    if (!passesFactGuard(main, raw1)) {
      factGuard = "fail";
      return done({ ...best, reason: "fact guard" });
    }
    factGuard = "pass";
    const first = tidy(raw1);
    const firstFails = fails(first.text);
    failsFirst = firstFails.length;
    best = { text: first.text, source: "pass", changed: first.changed };
    if (!firstFails.length) return done({ ...best, reason: "clean" });

    const raw2 = await raced(
      call(system, userMessage(input.question, first.text, input.shown, firstFails), signal),
    );
    if (!passesFactGuard(main, raw2)) {
      return done({ ...best, reason: "retry failed the fact guard" });
    }
    const second = tidy(raw2);
    const secondFails = fails(second.text);
    return secondFails.length < firstFails.length
      ? done({
          text: second.text,
          source: "retry",
          changed: second.changed,
          reason: `${secondFails.length} left (was ${firstFails.length})`,
        })
      : done({ ...best, reason: `retry not better (${secondFails.length} vs ${firstFails.length})` });
  } catch (err) {
    const why = deadline.signal.aborted
      ? "deadline"
      : input.signal?.aborted
        ? "client gone"
        : err instanceof Error
          ? err.message.slice(0, 120)
          : "error";
    return done({ ...best, reason: why });
  }
}
