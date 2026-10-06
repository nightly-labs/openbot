import { describe, expect, it } from "vitest";
import { modelsAfterOpenCodeDiscoveryFailure, OPENCODE_FREE_MODEL_FALLBACKS } from "./provider-models";

describe("provider model fallbacks", () => {
  it("keeps the current free OpenCode catalog available when discovery fails", () => {
    expect(OPENCODE_FREE_MODEL_FALLBACKS.map((model) => model.id)).toEqual([
      "opencode/big-pickle",
      "opencode/ling-3.0-flash-fin-free",
      "opencode/longcat-2.5-preview-free",
      "opencode/mimo-v2.6-flash-free",
      "opencode/muse-spark-1.3-contributor-free",
      "opencode/nemotron-3-ultra-free",
      "opencode/nemotron-3.5-lightning-free",
      "opencode/space-bunny-free",
    ]);
  });

  it("uses the known free tier when discovery fails before finding any OpenCode models", () => {
    expect(modelsAfterOpenCodeDiscoveryFailure([])).toEqual(OPENCODE_FREE_MODEL_FALLBACKS);
    const previous = [
      {
        provider: "opencode" as const,
        id: "opencode/previous-free-model",
        name: "Previously discovered free model",
        description: "Previously discovered free model.",
        defaultReasoningEffort: "medium" as const,
        supportedReasoningEfforts: ["medium" as const],
      },
    ];
    expect(modelsAfterOpenCodeDiscoveryFailure(previous)).toEqual(previous);
  });
});
