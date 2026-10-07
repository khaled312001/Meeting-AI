import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendKnowledgeToBackground,
  buildAnthropicBackground,
  buildAnthropicSystemPrompt,
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
  assert.match(buildAnthropicSystemPrompt("summarizer"), /Summarize/);
  assert.match(buildAnthropicSystemPrompt("ask-ai"), /Ask AI/);
});
