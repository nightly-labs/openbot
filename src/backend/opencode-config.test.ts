// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type CustomProviderConfig, OPENCODE_PROFILE_CONFIG, openCodeConfigEnv } from "./opencode-config";

// Failure modes: a model whose window is set sends an output budget above what the model allows
// (#4234, an endpoint refused `max_completion_tokens: 32000` for a 16K-output model); the budget
// leaves no room for the prompt inside the window; a large window loses OpenCode's own budget; a
// model with no window loses OpenCode's own defaults; an odd window leaves a half token in the
// budget; a window just past twice the budget misses the switch to it; an entry drops the name or
// its model id; a saved output cap (#4234's 128K-window model with a 16K cap) wins verbatim where
// the guess stays wrong; a cap without a window is stored but not written.
interface ModelEntry {
  name: string;
  limit?: { context: number; output: number };
}

const ENDPOINT: CustomProviderConfig = {
  id: "mylab",
  name: "My Lab",
  baseUrl: "https://mylab.example/v1",
  apiKey: null,
  headers: [],
  models: [
    { id: "small", name: "Small", contextWindow: 16_384 },
    { id: "odd", name: "Odd", contextWindow: 16_385 },
    { id: "mid", name: "Mid", contextWindow: 32_768 },
    { id: "cap", name: "Cap", contextWindow: 64_001 },
    { id: "large", name: "Large", contextWindow: 200_000 },
    // #4234's corrected repro: a 128K-window model whose real output cap is 16K. Half the window
    // is still 32,000 there, so only the saved cap fixes it.
    { id: "glimmer", name: "Glimmer", contextWindow: 131_072, maxOutput: 16_384 },
    { id: "verbatim", name: "Verbatim", contextWindow: 16_384, maxOutput: 32_768 },
    { id: "onlyout", name: "OnlyOut", maxOutput: 16_384 },
    { id: "unknown", name: "Unknown" },
  ],
};

function modelEntry(modelId: string): ModelEntry {
  const content = openCodeConfigEnv(OPENCODE_PROFILE_CONFIG, () => [ENDPOINT], null).OPENCODE_CONFIG_CONTENT;
  if (content === undefined) throw new Error("the spawn env carries no config content");
  const config: { provider?: Record<string, { models?: Record<string, ModelEntry> }> } = JSON.parse(content);
  const entry = config.provider?.mylab?.models?.[modelId];
  if (entry === undefined) throw new Error(`no config entry for the model ${modelId}`);
  return entry;
}

describe("OpenCode custom model entries", () => {
  it("caps the output budget to what a small window allows", () => {
    expect(modelEntry("small")).toEqual({ name: "Small", limit: { context: 16_384, output: 8_192 } });
  });

  it("rounds the budget down on an odd window", () => {
    expect(modelEntry("odd").limit).toEqual({ context: 16_385, output: 8_192 });
  });

  it("switches to OpenCode's own budget just past half of it", () => {
    // 64,000 would put the window's half exactly on the 32,000 budget, so the first window past
    // the switch is 64,001 — the two sides of the line agree there, with no jump.
    expect(modelEntry("cap").limit).toEqual({ context: 64_001, output: 32_000 });
  });

  it("leaves room for the prompt inside the window", () => {
    expect(modelEntry("mid").limit).toEqual({ context: 32_768, output: 16_384 });
  });

  it("keeps OpenCode's own budget when the window is large", () => {
    expect(modelEntry("large").limit).toEqual({ context: 200_000, output: 32_000 });
  });

  it("leaves a model with no context window at OpenCode's defaults", () => {
    expect(modelEntry("unknown")).toEqual({ name: "Unknown" });
  });

  it("writes a saved output cap verbatim where the guess stays wrong", () => {
    // The guess is min(32000, 65536) = 32000, which the model's 16K cap refuses.
    expect(modelEntry("glimmer")).toEqual({ name: "Glimmer", limit: { context: 131_072, output: 16_384 } });
  });

  it("does not clamp a saved output cap to the budget or the window", () => {
    // The user typed the model's real cap; the guess's ceiling is not OpenBot's to apply to it.
    expect(modelEntry("verbatim")).toEqual({ name: "Verbatim", limit: { context: 16_384, output: 32_768 } });
  });

  it("does not write a saved output cap without a window", () => {
    expect(modelEntry("onlyout")).toEqual({ name: "OnlyOut" });
  });
});
