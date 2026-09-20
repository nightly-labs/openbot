import type { AgentModelOption } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { resolveCreationModel } from "./agent-creation-model";
import { readAgentSelection, writeAgentSelection } from "./agent-selection";

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

describe("agent selection storage", () => {
  it("preserves other servers when saving and clearing a selection", () => {
    let saved = JSON.stringify({ team: "other" });
    const storage = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    };
    writeAgentSelection("local", "sales-outbound", storage);
    expect(readAgentSelection(storage)).toEqual({ team: "other", local: "sales-outbound" });
    writeAgentSelection("local", "", storage);
    expect(readAgentSelection(storage)).toEqual({ team: "other" });
  });

  it.each(["not-json", "[]", "null"])("ignores damaged storage: %s", (value) => {
    expect(readAgentSelection({ getItem: () => value, setItem: vi.fn() })).toEqual({});
  });

  it("ignores invalid entries while keeping valid agent IDs", () => {
    expect(
      readAgentSelection({ getItem: () => JSON.stringify({ local: "chief", team: 42, empty: "" }), setItem: vi.fn() }),
    ).toEqual({ local: "chief" });
  });

  it("tolerates unavailable storage", () => {
    const storage = {
      getItem: () => {
        throw new Error("Unavailable");
      },
      setItem: () => {
        throw new Error("Unavailable");
      },
    };
    expect(readAgentSelection(storage)).toEqual({});
    expect(() => writeAgentSelection("local", "chief", storage)).not.toThrow();
  });

  it("tolerates write failures with readable storage", () => {
    const storage = {
      getItem: () => JSON.stringify({ local: "chief" }),
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    };
    expect(() => writeAgentSelection("local", "sales-outbound", storage)).not.toThrow();
  });
});
