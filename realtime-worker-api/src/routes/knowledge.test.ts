import assert from "node:assert/strict";
import { test } from "node:test";

import { instructionsBlock, splitInstructionDocs } from "./knowledge.js";

test("instruction files are split from the material", () => {
  const docs = [
    { fileName: "Munzer_AI_Feed_v6.md", content: "feed" },
    { fileName: "Munzer_AI_Instructions_v6.md", content: " rules " },
    { fileName: "تعليمات.md", content: "قواعد" },
  ];
  const { instructions, material } = splitInstructionDocs(docs);
  assert.deepEqual(
    instructions.map((d) => d.fileName),
    ["Munzer_AI_Instructions_v6.md", "تعليمات.md"],
  );
  assert.deepEqual(material.map((d) => d.fileName), ["Munzer_AI_Feed_v6.md"]);
  assert.match(
    instructionsBlock(instructions),
    /^<candidate_instructions file="Munzer_AI_Instructions_v6.md">\nrules\n<\/candidate_instructions>/,
  );
});
