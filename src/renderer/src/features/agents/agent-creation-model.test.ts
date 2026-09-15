import type { AgentModelOption } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { resolveCreationModel } from "./agent-creation-model";

const options: AgentModelOption[] = [
  {
    provider: "codex",
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    provider: "opencode",
    id: "opencode/example-free",
    name: "Example Free",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  },
];

describe("resolveCreationModel", () => {
  it("keeps the saved provider and model while the catalog lists them", () => {
    expect(
      resolveCreationModel(
        { completed: true, preferredProvider: "opencode", preferredModel: "opencode/example-free" },
        options,
      ),
    ).toEqual({ provider: "opencode", model: "opencode/example-free" });
  });

  it("falls back to the saved provider default when the saved model is gone", () => {
    expect(
      resolveCreationModel({ completed: true, preferredProvider: "codex", preferredModel: "gpt-5.6-retired" }, options),
    ).toEqual({ provider: "codex", model: "gpt-5.6-luna" });
  });

  it("moves to the first listed provider when the saved one lists nothing", () => {
    expect(
      resolveCreationModel({ completed: true, preferredProvider: "claude", preferredModel: null }, options),
    ).toEqual({ provider: "codex", model: "gpt-5.6-luna" });
  });

  it("returns null while the catalog is empty", () => {
    expect(resolveCreationModel({ completed: true, preferredProvider: "codex", preferredModel: null }, [])).toBeNull();
  });
});
