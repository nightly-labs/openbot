import type { AgentModelOption } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { decodeAgentStatusFromMain, decodeHermesProfiles, decodeQuitShortcutHint } from "./agent-decoding";

const proModel = {
  provider: "antigravity",
  id: "gemini-4-argon",
  name: "Gemini 4 Argon",
  description: "Gemini model discovered from the local CLI.",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["medium"],
} satisfies AgentModelOption;

describe("decodeHermesProfiles", () => {
  it("keeps canonical default and named profile IDs", () => {
    expect(decodeHermesProfiles(["default", "work-2"])).toEqual(["default", "work-2"]);
  });

  it("refuses invalid or unbounded profile responses", () => {
    for (const value of [null, "default", ["../escape"], ["Work"], [null], Array(4097).fill("default")])
      expect(() => decodeHermesProfiles(value)).toThrow("Invalid Hermes profile response.");
  });
});

function statusWithAccountModels(models: unknown) {
  return {
    phase: "ready",
    cliVersion: null,
    auth: { kind: "unknown" },
    capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
    message: null,
    fullAccess: true,
    providers: [
      {
        id: "antigravity",
        state: "available",
        version: "1.4.5",
        message: null,
        accounts: [
          { id: "default", label: null, email: null, state: "connected", message: null },
          { id: "a0123456789abcdef", label: null, email: null, state: "connected", message: null, models },
        ],
      },
    ],
  };
}

describe("decodeAgentStatusFromMain", () => {
  it("keeps the models of an account after the first", () => {
    const status = statusWithAccountModels([proModel]);

    expect(decodeAgentStatusFromMain(status).providers?.[0]?.accounts?.[1]?.models).toEqual([proModel]);
  });

  it("refuses an account whose model list is not valid", () => {
    for (const models of [proModel, [{ ...proModel, id: "gemini 4" }], [{ ...proModel, provider: "unknown" }]]) {
      expect(() => decodeAgentStatusFromMain(statusWithAccountModels(models))).toThrow(
        "Invalid agent status response.",
      );
    }
  });
});

// Null hides the hint. An empty list shows it with no names: the user guards every quit and no agent works.
describe("decodeQuitShortcutHint", () => {
  it("keeps the hidden hint and the hint with no agents apart", () => {
    expect(decodeQuitShortcutHint(null)).toBeNull();
    expect(decodeQuitShortcutHint([])).toEqual([]);
  });

  it("refuses a value that is not an agent list", () => {
    for (const value of [undefined, {}, [{ id: 1 }]]) {
      expect(() => decodeQuitShortcutHint(value)).toThrow("Invalid agent list response.");
    }
  });
});
