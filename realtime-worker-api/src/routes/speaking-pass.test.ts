import assert from "node:assert/strict";
import { test } from "node:test";

import { encoder } from "../lib/http.js";
import { createSpeakingHold } from "./speaking-hold.js";
import {
  asksOneSentence,
  buildFeed,
  passesFactGuard,
  tidyForSpeaking,
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

// ── Defects of 12 November: tidy against the files, wider guard, log ───

/** Feed lines from the defect note, plus padding so the feed is big enough. */
const FEED = buildFeed([
  `I know the other side of that talk.
At UBS, I am project owner of my platform, and deputy product owner of its core team.
At UBS, I change people on their own cycle rather than on my calendar.
One switch day puts every call on one day.
Here, a software vendor sells the right to use its software. The licence sets what the customer may use.
At UBS, acceptance criteria are written with the business and signed before an item enters a sprint.
I approve every release on my own, because I chair the change forum.
My team would say I give them real decisions, and I back them.
- When the operation moved onto the platform, I designed and ran the training for every agent.
- **For my self-service launch,** I cut call volume by a third.
I ran the pricing study with the product team in Zurich.
In 2021, I led the move to one release a month.
In 2023, I led the move to one release a month.`,
  "Background: ".padEnd(400, "x"),
]);

test("tidy: two feed lines joined into one sentence are split again", () => {
  const q14 = "I know the other side of that talk, because I am project owner of my platform, and deputy product owner of its core team.";
  assert.equal(
    tidyForSpeaking(q14, { feed: FEED }).text,
    "I know the other side of that talk. I am project owner of my platform, and deputy product owner of its core team.",
  );
  const q7 = "- I change people on their own cycle rather than on my calendar, because one switch day puts every call on one day.";
  assert.equal(
    tidyForSpeaking(q7, { feed: FEED }).text,
    "- I change people on their own cycle rather than on my calendar. One switch day puts every call on one day.",
  );
  const q1 = "Here, a software vendor sells the right to use its software, and the licence sets what the customer may use.";
  assert.equal(
    tidyForSpeaking(q1, { feed: FEED }).text,
    "Here, a software vendor sells the right to use its software. The licence sets what the customer may use.",
  );
});

test("tidy: a feed line as written is left whole", () => {
  for (const line of [
    "At UBS, I am project owner of my platform, and deputy product owner of its core team.",
    "My team would say I give them real decisions, and I back them.",
    "I approve every release on my own, because I chair the change forum.",
  ]) {
    assert.deepEqual(tidyForSpeaking(line, { feed: FEED }), { text: line, changed: 0 });
  }
});

test("tidy: an added clause whose words are not in the files is removed", () => {
  const q14 = "- Acceptance criteria are written with the business and signed before an item enters a sprint, so the argument happens before the build.";
  assert.equal(
    tidyForSpeaking(q14, { feed: FEED }).text,
    "- Acceptance criteria are written with the business and signed before an item enters a sprint.",
  );
  // A reason that is in the files stays.
  const kept = "I sign every release myself, because I chair the change forum.";
  assert.equal(tidyForSpeaking(kept, { feed: FEED }).text, kept);
});

test("tidy: nothing is split or removed without files, or for a one-sentence question", () => {
  const q1 = "Here, a software vendor sells the right to use its software, and the licence sets what the customer may use.";
  assert.equal(tidyForSpeaking(q1).text, q1);
  assert.equal(tidyForSpeaking(q1, { feed: FEED, oneSentence: true }).text, q1);
  assert.equal(buildFeed(["too short"]), null);
});

test("tidy: an opening First, Then or Finally before the subject is dropped", () => {
  const q11 = "First I read adoption every week.\n- Then I read the calls from the floor.\n- Finally, I read revenue against plan.";
  assert.equal(
    tidyForSpeaking(q11).text,
    "I read adoption every week.\n- I read the calls from the floor.\n- I read revenue against plan.",
  );
  // Bold title and close lines are left alone.
  assert.equal(tidyForSpeaking("**First I read adoption**").text, "**First I read adoption**");
});

test("speaking guard: First, Then and counted openings anywhere, one-sentence questions", () => {
  assert.equal(speakingFailures("First I read adoption.").length, 1);
  assert.equal(speakingFailures("I read it. Then I read the calls.").length, 1);
  assert.equal(speakingFailures("- the second is revenue.").length, 1);
  assert.equal(speakingFailures("Finally, I read revenue.").length, 1);
  assert.equal(
    speakingFailures("My work across countries, and my AI work at Meta, are two parts we have not covered.").length,
    1,
  );
  assert.equal(speakingFailures("I weigh three things before I hire.").length, 1);
  const long = "I " + "really ".repeat(20) + "led it.";
  assert.equal(asksOneSentence("Describe yourself in one sentence."), true);
  assert.equal(asksOneSentence("Tell me about a project."), false);
  assert.equal(speakingFailures(long, { oneSentence: true }).length, 0);
});

test("pass: the result says whether it ran in time and what the guards found", async () => {
  const clean = await runSpeakingPass({ apiKey: "x", name: "T", question: "q", answer: MAIN, shown: [], call: call([RESHAPED]).fn });
  assert.equal(clean.inTime, true);
  assert.equal(clean.factGuard, "pass");
  assert.equal(clean.failsFirst, 0);
  assert.equal(clean.failsShown, 0);

  const bad = await runSpeakingPass({ apiKey: "x", name: "T", question: "q", answer: MAIN, shown: [], call: call([RESHAPED.replace("UBS", "HSBC")]).fn });
  assert.equal(bad.factGuard, "fail");
  assert.ok(bad.failsShown > 0); // the main answer, with its counted opening

  const slow = async () => new Promise<string>((resolve) => setTimeout(() => resolve(RESHAPED), 200));
  const late = await runSpeakingPass({ apiKey: "x", name: "T", question: "q", answer: MAIN, shown: [], call: slow, deadlineMs: 30 });
  assert.equal(late.inTime, false);
  assert.equal(late.factGuard, "none");
});

test("pass: the shown text is tidied against the files too", async () => {
  const joined =
    "**Talking to the business**\nI know the other side of that talk, because I am project owner of my platform, and deputy product owner of its core team.";
  // The pass joins it again: the code splits it once more.
  const r = await runSpeakingPass({ apiKey: "x", name: "T", question: "q", answer: joined, shown: [], feed: FEED, call: call([joined, joined]).fn });
  assert.equal(
    r.text,
    "**Talking to the business**\nI know the other side of that talk. I am project owner of my platform, and deputy product owner of its core team.",
  );
  assert.equal(r.tidied, 2);
  assert.equal(r.failsShown, 0);
});

test("pass: an added clause is gone before the pass sees the answer", async () => {
  const added =
    "- Acceptance criteria are written with the business and signed before an item enters a sprint, so the argument happens before the build.";
  const c = call(["- Acceptance criteria are written with the business and signed before an item enters a sprint."]);
  const r = await runSpeakingPass({ apiKey: "x", name: "T", question: "q", answer: added, shown: [], feed: FEED, call: c.fn });
  assert.doesNotMatch(c.seen[0], /argument/);
  assert.doesNotMatch(r.text, /argument/);
  assert.equal(r.factGuard, "pass");
});

// ── Notes for the developer of 12 November ─────────────────────────────

test("tidy: a swapped opening phrase gets the files' own opening back", () => {
  const screen = "- For my self-service launch, I designed and ran the training for every agent.";
  assert.equal(
    tidyForSpeaking(screen, { feed: FEED }).text,
    "- When the operation moved onto the platform, I designed and ran the training for every agent.",
  );
  // The files' own opening, or no files: left alone.
  const own = "When the operation moved onto the platform, I designed and ran the training for every agent.";
  assert.equal(tidyForSpeaking(own, { feed: FEED }).text, own);
  assert.equal(tidyForSpeaking(screen).text, screen);
});

test("tidy: an opening is not changed when the files give it two openings or none", () => {
  const two = "Back then, I led the move to one release a month.";
  assert.equal(tidyForSpeaking(two, { feed: FEED }).text, two);
  const added = "At UBS, I ran the pricing study with the product team in Zurich.";
  assert.equal(tidyForSpeaking(added, { feed: FEED }).text, added);
  // A first clause before a comma is not an opening phrase.
  const clause = "I sign every release myself, because I chair the change forum.";
  assert.equal(tidyForSpeaking(clause, { feed: FEED }).text, clause);
});

test("tidy: a label in front of a feed line is removed", () => {
  assert.equal(
    tidyForSpeaking("- For positioning, I ran the pricing study with the product team in Zurich.", { feed: FEED }).text,
    "- I ran the pricing study with the product team in Zurich.",
  );
  assert.equal(
    tidyForSpeaking("On the one-date question, I ran the pricing study with the product team in Zurich.", { feed: FEED }).text,
    "I ran the pricing study with the product team in Zurich.",
  );
});

test("tidy: a story label before a whole sentence is removed", () => {
  assert.equal(
    tidyForSpeaking("- The situation was that the bank had no single view of each case.").text,
    "- The bank had no single view of each case.",
  );
  const to = "The task was to cut the time to a decision.";
  assert.equal(tidyForSpeaking(to).text, to); // no sentence after it: the guard sends it back
});

test("speaking guard: a pronoun opening that points back, and story labels", () => {
  assert.equal(speakingFailures("**Title**\nIt brings the evidence into one view.").length, 0);
  assert.equal(speakingFailures("I own the platform.\nIt brings the evidence into one view.").length, 1);
  assert.equal(speakingFailures("I own the platform. Its users sign every case.").length, 1);
  assert.equal(speakingFailures("I own the platform.\n- They sign every case.").length, 1);
  assert.equal(speakingFailures("I own the platform.\n- There is one view for each case.").length, 0);
  assert.equal(speakingFailures("I own the platform.\n- There I built one view for each case.").length, 1);
  assert.equal(speakingFailures("I own the platform, and it brings the evidence into one view.").length, 0);
  assert.equal(speakingFailures("The task was to cut the time to a decision.").length, 1);
  assert.equal(speakingFailures("- The situation was a backlog of cases.").length, 1);
});

test("the pass prompt carries the new rules", () => {
  const p = speakingPassSystem("T");
  assert.match(p, /10\. Every sentence must make sense on its own screen line/);
  assert.match(p, /11\. Remove a label at the front of a line/);
  assert.match(p, /12\. Every "the" thing in a bullet or in the close/);
  assert.doesNotMatch(p, /replies\. It brings/);
});

/** The log fields a stub pass result needs. */
const LOG = { inTime: true, factGuard: "pass", failsFirst: 0, failsShown: 0, tidied: 0 } as const;

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
      return { text: "Reshaped.", source: "pass", reason: "clean", ms: 1, ...LOG };
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
    pass: async () => { ran = true; return { text: "", source: "main", reason: "", ms: 0, ...LOG }; },
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
    pass: async (i) => ({ text: i.answer.toUpperCase(), source: "pass", reason: "clean", ms: 1, ...LOG }),
  });
  await hold.writer.write(sse({ text: "line one\nline two" }));
  await hold.writer.write(sse("[DONE]"));
  await hold.finish();
  assert.deepEqual(frames, [{ text: "LINE ONE\nLINE TWO" }, "[DONE]"]);
});
