import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendKnowledgeToBackground,
  buildAnthropicBackground,
  buildAnthropicSystemPrompt,
  buildLiveTurn,
} from "./prompt.js";

test("appendKnowledgeToBackground returns bg unchanged without docs", () => {
  assert.equal(appendKnowledgeToBackground("notes", [], 100), "notes");
  assert.equal(appendKnowledgeToBackground(undefined, [], 100), undefined);
});

test("appendKnowledgeToBackground labels files and respects the char budget", () => {
  const out = appendKnowledgeToBackground(
    "bg",
    [
      { fileName: "a.txt", content: "x".repeat(50) },
      { fileName: "b.txt", content: "y".repeat(50) },
    ],
    80,
  )!;
  assert.ok(out.startsWith("bg"));
  assert.ok(out.includes("--- KNOWLEDGE FILE: a.txt ---"));
  assert.ok(out.length - "bg".length <= 80);
});

test("buildAnthropicBackground wraps text and skips blanks", () => {
  assert.equal(buildAnthropicBackground("  "), null);
  assert.equal(
    buildAnthropicBackground("resume"),
    "<candidate_background>\nresume\n</candidate_background>",
  );
});

test("buildAnthropicSystemPrompt selects per-flag instructions", () => {
  assert.match(buildAnthropicSystemPrompt("assistant"), /\*\*Question:\*\*/);
  assert.match(buildAnthropicSystemPrompt("review"), /exactly: OK/);
  assert.match(buildAnthropicSystemPrompt("summarizer"), /end-of-meeting summary/);
  assert.match(buildAnthropicSystemPrompt("ask-ai"), /Ask AI/);
});

test("answerOnly drops the question line so the answer starts at once", () => {
  const p = buildAnthropicSystemPrompt("assistant", "en", true);
  assert.doesNotMatch(p, /\*\*Question:\*\*/);
  assert.match(p, /no restated question/);
});

test("questionLine asks for the question on one clean line first", () => {
  const p = buildAnthropicSystemPrompt("assistant", "en", true, true);
  assert.match(p, /line 1: the question as you understood it/);
  assert.match(p, /Everything after the first line is said aloud/);
  assert.doesNotMatch(p, /no restated question/);
});

test("buildLiveTurn sends the figures said so far", () => {
  const turn = buildLiveTurn(
    { transcript: "t", question: "q?", saidFigures: ["Me: five years", " "] },
    "answer",
  );
  assert.match(turn, /<figures_so_far>\n- Me: five years\n<\/figures_so_far>/);
  assert.doesNotMatch(
    buildLiveTurn({ transcript: "t", question: "q?" }, "answer"),
    /figures_so_far/,
  );
});

test("the interview so far lists every question and answer, numbered", () => {
  const turn = buildLiveTurn(
    {
      transcript: "t",
      question: "q3?",
      previousAnswers: [
        "**Question 1:** Why us?\n\n**Answer:** Because of the role.",
        "**السؤال 2:** ليه؟\n\n**الإجابة:** عشان كده.",
      ],
    },
    "answer",
  );
  assert.match(
    turn,
    /<interview_so_far>\nQ1: Why us\?\nA1: Because of the role\.\n\nQ2: ليه؟\nA2: عشان كده\.\n<\/interview_so_far>/,
  );
});

test("buildAnthropicSystemPrompt fixes the language and its labels", () => {
  const ar = buildAnthropicSystemPrompt("assistant", "ar");
  assert.match(ar, /\*\*السؤال:\*\*/);
  assert.match(ar, /in Arabic/);
  assert.match(buildAnthropicSystemPrompt("assistant", "de"), /\*\*Antwort:\*\*/);
  assert.match(buildAnthropicSystemPrompt("review", "de"), /\*\*Hinweise:\*\*/);
  assert.match(buildAnthropicSystemPrompt("summarizer", "en"), /in English only/);
});

test("buildLiveTurn includes question, earlier answers and my answer", () => {
  const answer = buildLiveTurn(
    { transcript: "t", question: "q?", previousAnswers: ["a1", " "] },
    "answer",
  );
  assert.match(answer, /<question>\nq\?\n<\/question>/);
  assert.match(
    answer,
    /<interview_so_far>\nA1: a1\n<\/interview_so_far>/,
  );
  assert.doesNotMatch(answer, /<my_answer>/);
  const review = buildLiveTurn(
    { transcript: "t", question: "q?", myAnswer: "mine" },
    "review",
  );
  assert.match(review, /<my_answer>\nmine\n<\/my_answer>/);
  assert.doesNotMatch(review, /<interview_so_far>/);
});
