import assert from "node:assert/strict";
import { test } from "node:test";

import { encoder } from "../lib/http.js";
import { createSpeakingHold } from "./speaking-hold.js";
import {
  buildFeed,
  keepsShape,
  limitBullets,
  passesFactGuard,
  runSpeakingPass,
  SPEAKING_PASS_SYSTEM,
  type SpeakingPassResult,
  screenChecks,
  sentences,
  splitAnswers,
  tidyForSpeaking,
} from "./speaking-pass.js";

const bullets = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `- Point ${from + i} is said in one short sentence here.`).join("\n");

/** One answer screen: title, opening, n bullets, close. */
const screen = (n: number, title = "**How I run a launch**") =>
  `${title}\nAt UBS, I run every launch the same way.\n${bullets(n)}\n**I keep every launch on one plan.**`;

// ── Fact guard ─────────────────────────────────────────────────────────

test("fact guard: a dropped or changed number fails", () => {
  const main = "I cut drop-off from **38%** to **21%** in 10 weeks.";
  assert.equal(passesFactGuard(main, "I cut drop-off from **38%** to **21%** in ten weeks."), false);
  assert.equal(passesFactGuard(main, "I cut drop-off from **38%** to **20%** in 10 weeks."), false);
  assert.equal(passesFactGuard(main, main), true);
});

test("fact guard: an added number fails", () => {
  assert.equal(passesFactGuard("I led the team.", "I led the team of 12."), false);
});

test("fact guard: a name replaced with a description fails, sentence starts and I don't count", () => {
  const main = "- That launch puts Sentinel where security and AI meet, which is close to my own work.";
  assert.equal(passesFactGuard(main, main), true);
  assert.equal(
    passesFactGuard(main, "- That launch puts the licensing platform where security and AI meet, which is close to my own work."),
    false,
  );
  assert.equal(passesFactGuard("I joined UBS in 2019.", "UBS hired me in 2019."), true);
  assert.equal(passesFactGuard("I'm sure. Every week I check.", "I am sure. I check every week."), true);
});

test("fact guard: an empty reply fails", () => {
  assert.equal(passesFactGuard("I led it.", "  "), false);
});

// ── Reading a screen ───────────────────────────────────────────────────

test("sentences: split at . ? ! and line ends, bold stripped, decimals kept", () => {
  assert.deepEqual(sentences("**Title**\nIt grew 1.5 times. Why? Because!"), ["Title", "It grew 1.5 times.", "Why?", "Because!"]);
});

test("answers: a bold line before text is a title, a bold line at the end or before a title is a close", () => {
  const two = `${screen(2, "**First question**")}\n\n${screen(2, "**Second question**")}`;
  const answers = splitAnswers(two);
  assert.equal(answers.length, 2);
  assert.deepEqual(
    answers.map((a) => a.title),
    ["**First question**", "**Second question**"],
  );
  assert.equal(splitAnswers(screen(3)).length, 1);
});

// ── Bullet limit ───────────────────────────────────────────────────────

test("limit: an answer with 8 bullets shows the title, the opening, bullets 1 to 5 and the close", () => {
  const r = limitBullets(screen(8));
  assert.equal(r.text, screen(5));
  assert.equal(r.dropped, 3);
});

test("limit: 5 bullets or fewer stay exactly as they are", () => {
  assert.deepEqual(limitBullets(screen(5)), { text: screen(5), dropped: 0 });
  assert.deepEqual(limitBullets(screen(2)), { text: screen(2), dropped: 0 });
});

test("limit: an answer about the candidate's background may show 6", () => {
  assert.equal(limitBullets(screen(8), "So tell me about yourself.").text, screen(6));
  assert.equal(limitBullets(screen(8, "**My background**")).text, screen(6, "**My background**"));
  assert.equal(limitBullets(screen(8), "Why this role?").text, screen(5));
});

test("limit: two answers on one screen, each with its own limit", () => {
  const two = `${screen(7, "**Why this role**")}\n\n${screen(8, "**About my background**")}`;
  const r = limitBullets(two, "Why this role, and tell me about yourself?");
  assert.equal(r.text, `${screen(5, "**Why this role**")}\n\n${screen(6, "**About my background**")}`);
  assert.equal(r.dropped, 4);
});

test("limit: a part line left with nothing under it goes too", () => {
  const parts = `**Two parts**\nI did both.\n[1/3 Launch]\n${bullets(3)}\n[2/3 Cost]\n${bullets(2, 4)}\n[3/3 Team]\n${bullets(2, 6)}\n**Both landed.**`;
  const r = limitBullets(parts);
  assert.equal(r.text, `**Two parts**\nI did both.\n[1/3 Launch]\n${bullets(3)}\n[2/3 Cost]\n${bullets(2, 4)}\n**Both landed.**`);
  assert.equal(r.dropped, 3);
});

// ── Shape guard ────────────────────────────────────────────────────────

test("shape guard: no line, bullet or sentence added, and no answer lost", () => {
  const draft = "**Migration**\nI led it.\n- In the Credit Suisse migration, I moved about 400,000 debit card customers across four phases.";
  assert.equal(keepsShape(draft, draft), true);
  // A split into two bullets, or into two sentences in one bullet.
  assert.equal(
    keepsShape(draft, "**Migration**\nI led it.\n- In the Credit Suisse migration, I moved about 400,000 debit card customers to UBS.\n- I did this in 4 phases."),
    false,
  );
  assert.equal(
    keepsShape(draft, "**Migration**\nI led it.\n- In the Credit Suisse migration, I moved about 400,000 customers. I did it in four phases."),
    false,
  );
  // Shortened inside the sentence, or a borrowed line dropped: fine.
  assert.equal(keepsShape(draft, "**Migration**\nI led it.\n- In the Credit Suisse migration, I moved 400,000 customers in four phases."), true);
  assert.equal(keepsShape(`${draft}\n**So the limit keeps the cost down.**`, draft), true);
  // An answer lost.
  assert.equal(keepsShape(`${screen(2, "**A**")}\n\n${screen(2, "**B**")}`, screen(2, "**A**")), false);
});

// ── The candidate's checks, for the log ────────────────────────────────

test("checks: bullets per answer, long sentences, short lines, pronoun openings", () => {
  const text = `**Title**\nIt brings the evidence into one view.\n${bullets(6)}\n- I did this in 4 phases.\n- They sign every case before it closes.\n- There is one view for each case on the screen.\n- I ${"really ".repeat(20)}led it.\n**Done.**`;
  assert.deepEqual(screenChecks(text), { maxBullets: 10, longSentences: 1, shortLines: 0, pronounOpenings: 1 });
  assert.equal(screenChecks("**T**\nI led it.\n- Four phases.").shortLines, 2);
  // "That launch" names its thing; "That is" points back.
  assert.equal(screenChecks("I led the launch.\n- That launch puts Sentinel where security and AI meet.").pronounOpenings, 0);
  assert.equal(screenChecks("I led the launch.\n- That is close to my own work.").pronounOpenings, 1);
});

// ── Word fixes in code, against the files ──────────────────────────────

const FEED = buildFeed([
  `- When the operation moved onto the platform, I designed and ran the training for every agent.
I ran the pricing study with the product team in Zurich.
In 2021, I led the move to one release a month.
In 2023, I led the move to one release a month.
I know the other side of that talk.
At UBS, I am project owner of my platform, and deputy product owner of its core team.`,
  "Background: ".padEnd(400, "x"),
]);

test("tidy: a swapped opening phrase gets the files' own opening back", () => {
  const swapped = "- For my self-service launch, I designed and ran the training for every agent.";
  assert.equal(
    tidyForSpeaking(swapped, { feed: FEED }).text,
    "- When the operation moved onto the platform, I designed and ran the training for every agent.",
  );
  const own = "When the operation moved onto the platform, I designed and ran the training for every agent.";
  assert.equal(tidyForSpeaking(own, { feed: FEED }).text, own);
  assert.equal(tidyForSpeaking(swapped).text, swapped);
});

test("tidy: an opening is left alone when the files give two openings, none, or it is a first clause", () => {
  for (const line of [
    "Back then, I led the move to one release a month.",
    "At UBS, I ran the pricing study with the product team in Zurich.",
    "I sign every release myself, because I chair the change forum.",
  ]) {
    assert.equal(tidyForSpeaking(line, { feed: FEED }).text, line);
  }
});

test("tidy: a label in front of a file line is removed, and a story label before a whole sentence", () => {
  assert.equal(
    tidyForSpeaking("- For positioning, I ran the pricing study with the product team in Zurich.", { feed: FEED }).text,
    "- I ran the pricing study with the product team in Zurich.",
  );
  assert.equal(
    tidyForSpeaking("On the one-date question, I ran the pricing study with the product team in Zurich.", { feed: FEED }).text,
    "I ran the pricing study with the product team in Zurich.",
  );
  assert.equal(
    tidyForSpeaking("- The situation was that the bank had no single view of each case.").text,
    "- The bank had no single view of each case.",
  );
});

test("tidy: never splits a sentence or adds a line", () => {
  const joined =
    "I know the other side of that talk, because I am project owner of my platform, and deputy product owner of its core team.";
  assert.deepEqual(tidyForSpeaking(joined, { feed: FEED }), { text: joined, changed: 0 });
  const two = "- First I read adoption every week. Then I read the calls.";
  assert.deepEqual(tidyForSpeaking(two, { feed: FEED }), { text: two, changed: 0 });
});

// ── The prompt ─────────────────────────────────────────────────────────

test("the prompt is the note's own: shape kept, words fixed, facts kept", () => {
  assert.match(SPEAKING_PASS_SYSTEM, /^You are the speaking step of a live interview assistant\./);
  assert.match(SPEAKING_PASS_SYSTEM, /1\. Keep every bullet as one bullet, on its own line, in the same order\./);
  assert.match(SPEAKING_PASS_SYSTEM, /3\. Show at most 5 bullets per answer, or 6 for an answer about the candidate's background\./);
  assert.match(SPEAKING_PASS_SYSTEM, /10\. Every number, name, tense and employer stays as the draft has it\. No fact is added\./);
  assert.match(SPEAKING_PASS_SYSTEM, /no line is only a few words with no fact\.$/);
  assert.doesNotMatch(SPEAKING_PASS_SYSTEM, /\{\{name\}\}|becomes its own sentence/);
});

// ── The step ───────────────────────────────────────────────────────────

const call = (replies: string[]) => {
  const seen: string[] = [];
  return {
    seen,
    fn: async (_system: string, user: string) => {
      seen.push(user);
      const r = replies.shift();
      if (r === undefined) throw new Error("no reply");
      return r;
    },
  };
};

const DRAFT = `**Writing the documentation**
I wrote it for my own platform.
- At UBS, I was the one who actually wrote the documentation for my dispute platform completely from scratch, covering the business requirements and the rules.
- That launch puts Sentinel where security and AI meet, which is close to my own work.
**The documentation is mine.**`;
const FIXED = DRAFT.replace(
  "I was the one who actually wrote the documentation for my dispute platform completely from scratch",
  "I wrote the documentation for my dispute platform from scratch",
);

test("step: a reply that keeps the shape and the facts is shown, after one call", async () => {
  const c = call([FIXED]);
  const r = await runSpeakingPass({ apiKey: "x", question: "Who wrote it?", answer: DRAFT, call: c.fn });
  assert.equal(r.source, "pass");
  assert.equal(r.text, FIXED);
  assert.equal(c.seen.length, 1);
  assert.equal(c.seen[0], `<question>Who wrote it?</question>\n\n<draft>${DRAFT}</draft>`);
  assert.equal(r.factGuard, "pass");
  assert.equal(r.shapeGuard, "pass");
  assert.equal(r.inTime, true);
  assert.equal(r.draft, DRAFT);
  assert.equal(r.passReply, FIXED);
  assert.equal(r.checks.longSentences, 0);
});

test("step: a reply that splits a bullet shows the draft, and there is no second run", async () => {
  const split = DRAFT.replace(
    "- That launch puts Sentinel where security and AI meet, which is close to my own work.",
    "- That launch puts Sentinel where security and AI meet.\n- That is close to my own work.",
  );
  const c = call([split, FIXED]);
  const r = await runSpeakingPass({ apiKey: "x", question: "q", answer: DRAFT, call: c.fn });
  assert.equal(r.source, "main");
  assert.equal(r.reason, "shape guard");
  assert.equal(r.shapeGuard, "fail");
  assert.equal(r.text, DRAFT);
  assert.equal(c.seen.length, 1);
});

test("step: a name replaced with a description shows the draft", async () => {
  const r = await runSpeakingPass({
    apiKey: "x", question: "q", answer: DRAFT,
    call: call([DRAFT.replace("Sentinel", "the licensing platform")]).fn,
  });
  assert.equal(r.source, "main");
  assert.equal(r.factGuard, "fail");
  assert.equal(r.text, DRAFT);
});

test("step: the bullet limit applies to what the step sees and to what is shown", async () => {
  const c = call([screen(5)]);
  const r = await runSpeakingPass({ apiKey: "x", question: "How do you run a launch?", answer: screen(8), call: c.fn });
  assert.match(c.seen[0], /Point 5 is/);
  assert.doesNotMatch(c.seen[0], /Point 6 is/);
  assert.equal(r.text, screen(5));
  assert.equal(r.bulletsDropped, 3);
  assert.equal(r.checks.maxBullets, 5);
  assert.equal(r.draft, screen(8));
});

test("step: past the deadline or on an error the draft is shown, kept to the limit", async () => {
  const slow = async () => new Promise<string>((resolve) => setTimeout(() => resolve(screen(5)), 200));
  const late = await runSpeakingPass({ apiKey: "x", question: "q", answer: screen(8), call: slow, deadlineMs: 30 });
  assert.equal(late.source, "main");
  assert.equal(late.reason, "deadline");
  assert.equal(late.inTime, false);
  assert.equal(late.factGuard, "none");
  assert.equal(late.text, screen(5));
  assert.equal(late.passReply, null);

  const failed = await runSpeakingPass({
    apiKey: "x", question: "q", answer: DRAFT,
    call: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(failed.source, "main");
  assert.equal(failed.text, DRAFT);
});

test("step: the files' own opening is put back on what is shown", async () => {
  const swapped = "**Training**\nI ran it.\n- For my self-service launch, I designed and ran the training for every agent.";
  const r = await runSpeakingPass({ apiKey: "x", question: "q", answer: swapped, feed: FEED, call: call([swapped]).fn });
  assert.equal(
    r.text,
    "**Training**\nI ran it.\n- When the operation moved onto the platform, I designed and ran the training for every agent.",
  );
  assert.ok(r.tidied >= 1);
});

// ── The hold ───────────────────────────────────────────────────────────

const stub = (text: string, source: SpeakingPassResult["source"] = "pass"): SpeakingPassResult => ({
  text, source, reason: "ok", ms: 1, inTime: true, factGuard: "pass", shapeGuard: "pass", tidied: 0, bulletsDropped: 0,
  checks: { maxBullets: 0, longSentences: 0, shortLines: 0, pronounOpenings: 0 }, draft: "", passReply: null,
});

function sink() {
  const frames: unknown[] = [];
  const out = {
    write: async (chunk: Uint8Array) => {
      for (const part of new TextDecoder().decode(chunk).split("\n\n")) {
        const raw = part.replace(/^data:\s*/, "").trim();
        if (!raw) continue;
        frames.push(raw === "[DONE]" ? "[DONE]" : JSON.parse(raw));
      }
    },
  } as unknown as WritableStreamDefaultWriter<Uint8Array>;
  return { frames, out };
}

const sse = (p: unknown) => encoder.encode(`data: ${typeof p === "string" ? p : JSON.stringify(p)}\n\n`);

test("hold: the question line goes through at once, the answer after the step", async () => {
  const { frames, out } = sink();
  let asked: { question: string; answer: string } | null = null;
  const hold = createSpeakingHold({
    out, apiKey: "x", questionLine: true, question: "heard",
    pass: async (i) => {
      asked = { question: i.question, answer: i.answer };
      return stub("Fixed.");
    },
  });
  await hold.writer.write(sse({ text: "**Decis" }));
  assert.equal(frames.length, 0);
  await hold.writer.write(sse({ text: "ions you own**\n\nAt UBS" }));
  assert.deepEqual(frames, [{ text: "**Decisions you own**\n" }]);
  await hold.writer.write(sse({ citation: { documentTitle: "Feed" } }));
  await hold.writer.write(sse({ text: ", I approve releases." }));
  await hold.writer.write(sse("[DONE]"));
  assert.equal(frames.length, 2);
  const held = await hold.finish();
  assert.deepEqual(asked, { question: "Decisions you own", answer: "At UBS, I approve releases." });
  assert.equal(held?.questionLine, "**Decisions you own**");
  assert.deepEqual(frames.slice(2), [{ text: "\nFixed." }, "[DONE]"]);
});

test("hold: an error is passed on and the step does not run", async () => {
  const { frames, out } = sink();
  let ran = false;
  const hold = createSpeakingHold({
    out, apiKey: "x", questionLine: false, question: "q",
    pass: async () => {
      ran = true;
      return stub("", "main");
    },
  });
  await hold.writer.write(sse({ text: "Half an ans" }));
  await hold.writer.write(sse({ error: "Anthropic declined to answer this request." }));
  assert.equal(await hold.finish(), null);
  assert.equal(ran, false);
  assert.deepEqual(frames, [{ error: "Anthropic declined to answer this request." }]);
});

test("hold: without a question line the whole reply is the answer", async () => {
  const { frames, out } = sink();
  const hold = createSpeakingHold({
    out, apiKey: "x", questionLine: false, question: "heard q",
    pass: async (i) => stub(i.answer.toUpperCase()),
  });
  await hold.writer.write(sse({ text: "line one\nline two" }));
  await hold.writer.write(sse("[DONE]"));
  const held = await hold.finish();
  assert.equal(held?.questionLine, "");
  assert.deepEqual(frames, [{ text: "LINE ONE\nLINE TWO" }, "[DONE]"]);
});
