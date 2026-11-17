import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { describe, expect, it } from "vitest";
import { parseCustomMessageRoutingInput } from "./custom-message-routing-inputs";

describe("custom message routing renderer input", () => {
  it("accepts an explicit local host mode and a batch that follows its default", () => {
    expect(parseCustomMessageRoutingInput({ mode: "thread" })).toEqual({ mode: "thread" });
    expect(parseCustomMessageRoutingInput({ mode: null, agentIds: ["agent-a", "agent-b"] })).toEqual({
      mode: null,
      agentIds: ["agent-a", "agent-b"],
    });
  });

  it.each([
    null,
    {},
    { mode: "unknown" },
    { mode: null },
    { mode: "thread", serverId: "remote" },
    { mode: "thread", agentIds: [] },
    { mode: "thread", agentIds: ["agent-a", "agent-a"] },
    { mode: "thread", agentIds: [""] },
    { mode: "thread", agentIds: [12] },
    { mode: "thread", agentIds: ["a".repeat(INPUT_LIMITS.identifier + 1)] },
    { mode: "thread", agentIds: Array.from({ length: INPUT_LIMITS.agents + 1 }, (_, index) => `agent-${index}`) },
  ])("rejects a malformed or unbounded renderer request: %j", (value) => {
    expect(() => parseCustomMessageRoutingInput(value)).toThrow();
  });
});
