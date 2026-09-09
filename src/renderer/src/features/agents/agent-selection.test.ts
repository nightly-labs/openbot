import { describe, expect, it, vi } from "vitest";
import { readAgentSelection, writeAgentSelection } from "./agent-selection";

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
