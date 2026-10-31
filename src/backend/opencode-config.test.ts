// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type CustomProviderConfig, OPENCODE_PROFILE_CONFIG, openCodeConfigEnv } from "./opencode-config";

// Failure modes: a model whose window is set sends an output budget above what the model allows
// (#4234, an endpoint refused `max_completion_tokens: 32000` for a 16K-output model); the budget
// leaves no room for the prompt inside the window; a large window loses OpenCode's own budget; a
// model with no window loses OpenCode's own defaults; an entry drops the name or its model id.
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
    { id: "mid", name: "Mid", contextWindow: 32_768 },
    { id: "large", name: "Large", contextWindow: 200_000 },
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

  it("leaves room for the prompt inside the window", () => {
    expect(modelEntry("mid").limit).toEqual({ context: 32_768, output: 16_384 });
  });

  it("keeps OpenCode's own budget when the window is large", () => {
    expect(modelEntry("large").limit).toEqual({ context: 200_000, output: 32_000 });
  });

  it("leaves a model with no context window at OpenCode's defaults", () => {
    expect(modelEntry("unknown")).toEqual({ name: "Unknown" });
  });
});
