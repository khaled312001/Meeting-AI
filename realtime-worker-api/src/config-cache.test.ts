import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCustomActive,
  resolveProvider,
} from "./config-cache.js";

function map(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

test("resolveProvider defaults to gemini", () => {
  assert.equal(resolveProvider(new Map()), "gemini");
  assert.equal(resolveProvider(map({ active_provider: "gemini" })), "gemini");
});

test("resolveProvider returns openai when configured", () => {
  assert.equal(resolveProvider(map({ active_provider: "openai" })), "openai");
});

test("resolveProvider treats unknown values as gemini", () => {
  assert.equal(resolveProvider(map({ active_provider: "bogus" })), "gemini");
});

test("isCustomActive false without provider switch even with full creds", () => {
  const creds = {
    custom_model_name: "gpt-4o-mini",
    custom_base_url: "https://api.openai.com/v1",
    custom_api_key: "sk-test",
  };
  assert.equal(isCustomActive(map(creds)), false);
});

test("isCustomActive true only when provider openai AND all creds present", () => {
  const base = {
    active_provider: "openai",
    custom_model_name: "gpt-4o-mini",
    custom_base_url: "https://api.openai.com/v1",
    custom_api_key: "sk-test",
  };
  assert.equal(isCustomActive(map(base)), true);

  for (const missing of Object.keys(base).filter((k) => k !== "active_provider")) {
    const partial = { ...base } as Record<string, string>;
    delete partial[missing];
    assert.equal(
      isCustomActive(map(partial)),
      false,
      `expected false when ${missing} missing`,
    );
  }
});

test("resolveProvider picks anthropic when a key is available and nothing is pinned", () => {
  assert.equal(resolveProvider(new Map(), { anthropicKeyAvailable: true }), "anthropic");
  assert.equal(resolveProvider(new Map(), { anthropicKeyAvailable: false }), "gemini");
});

test("resolveProvider honors an explicit provider over the anthropic default", () => {
  const withKey = { anthropicKeyAvailable: true };
  assert.equal(resolveProvider(map({ active_provider: "gemini" }), withKey), "gemini");
  assert.equal(resolveProvider(map({ active_provider: "openai" }), withKey), "openai");
  assert.equal(resolveProvider(map({ active_provider: "anthropic" })), "anthropic");
});
