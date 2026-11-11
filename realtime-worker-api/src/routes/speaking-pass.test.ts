import assert from "node:assert/strict";
import { test } from "node:test";

import { encoder } from "../lib/http.js";
import { createSpeakingHold } from "./speaking-hold.js";
import {
  passesFactGuard,
  speakingPassSystem,
  runSpeakingPass,
  sentences,
  speakingFailures,
} from "./speaking-pass.js";

const MAIN = `**What I decide alone**
At UBS, as deputy product owner, three decisions are mine alone, and two kinds go up for approval.
- The first alone is each release, because I chair the change forum.
- The second is the AI model, where the data science team builds the models. Their use, thresholds and sign-off are mine.`;

const RESHAPED = `**What I decide alone**
At UBS, I approve every release on my own, because I chair the change forum.
- I also own how the AI model is used, its thresholds and its sign-off.
- The data science team builds the model.`;

test("fact guard: the note's own example passes", () => {
  assert.equal(passesFactGuard(MAIN, RESHAPED), true);
});

test("fact guard: a dropped or changed number fails", () => {
  const main = "I cut drop-off from **38%** to **21%** in 10 weeks.";
  assert.equal(passesFactGuard(main, "I cut drop-off from **38%** to **21%** in ten weeks."), false);
  assert.equal(passesFactGuard(main, "I cut drop-off from **38%** to **20%** in 10 weeks."), false);
  assert.equal(passesFactGuard(main, main), true);
});

test("fact guard: an added number fails", () => {
  assert.equal(passesFactGuard("I led the team.", "I led the team of 12."), false);
});

test("fact guard: a dropped or added name fails, sentence starts and I don't count", () => {
  const main = "At UBS I worked with McKinsey on Visa disputes.";
  assert.equal(passesFactGuard(main, "I worked with McKinsey at UBS on Visa disputes."), true);
  assert.equal(passesFactGuard(main, "At UBS I worked on Visa disputes."), false);
  assert.equal(passesFactGuard(main, "At UBS I worked with McKinsey and Stripe on Visa disputes."), false);
  // A name that moves to the start of a sentence is still there.
  assert.equal(passesFactGuard("I joined UBS in 2019.", "UBS hired me in 2019."), true);
  assert.equal(passesFactGuard("I'm sure. Every week I check.", "I am sure. I check every week."), true);
});

test("fact guard: an empty pass fails", () => {
  assert.equal(passesFactGuard("I led it.", "  "), false);
});

test("sentences: split at . ? ! and line ends, bold stripped, decimals kept", () => {
  assert.deepEqual(sentences("**Title**\nIt grew 1.5 times. Why? Because!"), [
    "Title",
    "It grew 1.5 times.",
    "Why?",
    "Because!",
  ]);
});

test("speaking guard: each pattern in the note is caught", () => {
  const long = "I " + "really ".repeat(20) + "led it.";
  assert.equal(speakingFailures(long).length, 1);
  assert.equal(speakingFailures("There are three decisions I own.").length, 1);
  assert.equal(speakingFailures("- The first is each release.").length, 1);
  assert.equal(speakingFailures("- Second, I chair it.").length, 1);
  assert.equal(speakingFailures("- I chair it, second.").length, 0);
  assert.equal(speakingFailures("My part was the requirements.").length, 1);
  assert.equal(speakingFailures("I led it to release, with the bank's team building it.").length, 1);
  assert.equal(speakingFailures("I led it, with the bank's team.").length, 0);
  assert.equal(speakingFailures("I led it — fast.").length, 1);
  assert.equal(speakingFailures("I led it – fast.").length, 1);
  assert.equal(speakingFailures(RESHAPED).length, 0);
});

test("speaking guard: German words with umlauts count as one word", () => {
  const de = "Ich führe das Team für die Prüfung und plane die Schritte für den Kunden seit drei Jahren in Zürich.";
  assert.equal(speakingFailures(de).length, 0);
});

test("the prompt names the candidate set by the admin", () => {
  assert.match(speakingPassSystem("Test Person"), /live\. Test Person reads each answer/);
  assert.match(speakingPassSystem("  "), /live\. The candidate reads each answer/);
  assert.doesNotMatch(speakingPassSystem("A B"), /\{\{name\}\}/);
});

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

test("pass: a clean reshape is shown", async () => {
  const c = call([RESHAPED]);
  const r = await runSpeakingPass({ apiKey: "x", name: "Test Person", question: "What do you decide?", answer: MAIN, shown: ["earlier"], call: c.fn });
  assert.equal(r.source, "pass");
  assert.equal(r.text, RESHAPED);
  assert.equal(c.seen.length, 1);
  assert.match(c.seen[0], /<question>What do you decide\?<\/question>/);
  assert.match(c.seen[0], /<shown>earlier<\/shown>/);
});

test("pass: a fact change shows the main answer", async () => {
  const c = call([RESHAPED.replace("UBS", "Credit Suisse")]);
  const r = await runSpeakingPass({ apiKey: "x", name: "Test Person", question: "q", answer: MAIN, shown: [], call: c.fn });
  assert.equal(r.source, "main");
  assert.equal(r.text, MAIN);
});

test("pass: speaking failures run it once more, naming the sentences", async () => {
  const first = `${RESHAPED}\n- My part was the sign-off.`;
  const main = `${MAIN}\n- My part was the sign-off.`;
  const c = call([first, RESHAPED.replace("The data", "The data") + "\n- I signed it off."]);
  const r = await runSpeakingPass({ apiKey: "x", name: "Test Person", question: "q", answer: main, shown: [], call: c.fn });
  assert.equal(c.seen.length, 2);
  assert.match(c.seen[1], /- My part was the sign-off\./);
  assert.equal(r.source, "retry");
});

test("pass: a retry that is not better keeps the first pass", async () => {
  const first = `${RESHAPED}\n- My part was the sign-off.`;
  const main = `${MAIN}\n- My part was the sign-off.`;
  const c = call([first, first]);
  const r = await runSpeakingPass({ apiKey: "x", name: "Test Person", question: "q", answer: main, shown: [], call: c.fn });
  assert.equal(r.source, "pass");
  assert.equal(r.text, first);
});

test("pass: past the deadline the best safe version is shown", async () => {
  const slow = async () => new Promise<string>((resolve) => setTimeout(() => resolve(RESHAPED), 200));
  const r = await runSpeakingPass({ apiKey: "x", name: "Test Person", question: "q", answer: MAIN, shown: [], call: slow, deadlineMs: 30 });
  assert.equal(r.source, "main");
  assert.equal(r.reason, "deadline");

  // First pass in time but with failures, retry too slow: the first pass.
  const first = `${RESHAPED}\n- My part was the sign-off.`;
  let n = 0;
  const mixed = async () =>
    n++ === 0 ? first : new Promise<string>((resolve) => setTimeout(() => resolve(RESHAPED), 200));
  const r2 = await runSpeakingPass({
    apiKey: "x", name: "Test Person", question: "q", answer: `${MAIN}\n- My part was the sign-off.`, shown: [], call: mixed, deadlineMs: 50,
  });
  assert.equal(r2.source, "pass");
  assert.equal(r2.text, first);
});

test("pass: a failing model call shows the main answer", async () => {
  const r = await runSpeakingPass({
    apiKey: "x", name: "Test Person", question: "q", answer: MAIN, shown: [],
    call: async () => { throw new Error("boom"); },
  });
  assert.equal(r.source, "main");
  assert.equal(r.text, MAIN);
});

// ── The hold ───────────────────────────────────────────────────────────

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

test("hold: the question line goes through at once, the answer after the pass", async () => {
  const { frames, out } = sink();
  let asked: { question: string; answer: string; shown: string[] } | null = null;
  const hold = createSpeakingHold({
    out, apiKey: "x", name: "Test Person", questionLine: true, question: "heard", shown: ["a1"],
    pass: async (i) => {
      asked = { question: i.question, answer: i.answer, shown: i.shown };
      return { text: "Reshaped.", source: "pass", reason: "clean", ms: 1 };
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
  await hold.finish();
  assert.deepEqual(asked, { question: "Decisions you own", answer: "At UBS, I approve releases.", shown: ["a1"] });
  assert.deepEqual(frames.slice(2), [{ text: "\nReshaped." }, "[DONE]"]);
});

test("hold: an error is passed on and the pass does not run", async () => {
  const { frames, out } = sink();
  let ran = false;
  const hold = createSpeakingHold({
    out, apiKey: "x", name: "Test Person", questionLine: false, question: "q", shown: [],
    pass: async () => { ran = true; return { text: "", source: "main", reason: "", ms: 0 }; },
  });
  await hold.writer.write(sse({ text: "Half an ans" }));
  await hold.writer.write(sse({ error: "Anthropic declined to answer this request." }));
  await hold.finish();
  assert.equal(ran, false);
  assert.deepEqual(frames, [{ error: "Anthropic declined to answer this request." }]);
});

test("hold: without a question line the whole reply is the answer", async () => {
  const { frames, out } = sink();
  const hold = createSpeakingHold({
    out, apiKey: "x", name: "Test Person", questionLine: false, question: "heard q", shown: [],
    pass: async (i) => ({ text: i.answer.toUpperCase(), source: "pass", reason: "clean", ms: 1 }),
  });
  await hold.writer.write(sse({ text: "line one\nline two" }));
  await hold.writer.write(sse("[DONE]"));
  await hold.finish();
  assert.deepEqual(frames, [{ text: "LINE ONE\nLINE TWO" }, "[DONE]"]);
});
