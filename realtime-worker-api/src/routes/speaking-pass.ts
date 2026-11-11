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
3. Keep every sentence at 20 words or fewer. Split a long sentence at its natural joint, usually ", and", ", so", ", because" or ", with". Two sentences are the normal result. Every new sentence has its own subject and verb and at least 6 words.
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
const ORDINAL_LINE_RE = /^- (The )?(first|second|third|fourth|last)\b/i;
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

/** Each sentence that breaks a speaking rule, once per rule it breaks. */
export function speakingFailures(text: string): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    const bare = s.replace(/[.?!]+$/, "");
    if (wordCount(s) > 20) out.push(s);
    if (COUNTED_RE.test(s)) out.push(s);
    if (ORDINAL_LINE_RE.test(s)) out.push(s);
    if (MY_PART_RE.test(s)) out.push(s);
    const hang = HANGING_RE.exec(bare);
    if (hang && /\p{L}+ing\b/u.test(hang[1])) out.push(s);
    if (DASH_RE.test(s)) out.push(s);
  }
  return out;
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
  let best: SpeakingPassResult = { text: main, source: "main", reason: "", ms: 0 };
  const done = (r: Omit<SpeakingPassResult, "ms">): SpeakingPassResult => {
    clearTimeout(timer);
    return { ...r, ms: Date.now() - started };
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
    const first = await raced(call(system, userMessage(input.question, main, input.shown), signal));
    if (!passesFactGuard(main, first)) {
      return done({ text: main, source: "main", reason: "fact guard" });
    }
    const firstFails = speakingFailures(first);
    best = { text: first, source: "pass", reason: firstFails.length ? "" : "clean", ms: 0 };
    if (!firstFails.length) return done({ text: first, source: "pass", reason: "clean" });

    const second = await raced(
      call(system, userMessage(input.question, first, input.shown, firstFails), signal),
    );
    if (!passesFactGuard(main, second)) {
      return done({ text: first, source: "pass", reason: "retry failed the fact guard" });
    }
    const secondFails = speakingFailures(second);
    return secondFails.length < firstFails.length
      ? done({ text: second, source: "retry", reason: `${secondFails.length} left (was ${firstFails.length})` })
      : done({ text: first, source: "pass", reason: `retry not better (${secondFails.length} vs ${firstFails.length})` });
  } catch (err) {
    const why = deadline.signal.aborted
      ? "deadline"
      : input.signal?.aborted
        ? "client gone"
        : err instanceof Error
          ? err.message.slice(0, 120)
          : "error";
    return done({ text: best.text, source: best.source, reason: why });
  }
}
