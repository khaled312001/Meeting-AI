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
    /<earlier_answers>\n<answer>\na1\n<\/answer>\n<\/earlier_answers>/,
  );
  assert.doesNotMatch(answer, /<my_answer>/);
  const review = buildLiveTurn(
    { transcript: "t", question: "q?", myAnswer: "mine" },
    "review",
  );
  assert.match(review, /<my_answer>\nmine\n<\/my_answer>/);
  assert.doesNotMatch(review, /<earlier_answers>/);
});
