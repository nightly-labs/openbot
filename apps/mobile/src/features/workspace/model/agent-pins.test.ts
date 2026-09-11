import { describe, expect, it } from "vitest";
import { canToggleAgentPin } from "./agent-pins";

describe("mobile agent pin capacity", () => {
  it("allows the sixteenth pin and rejects a seventeenth pin", () => {
    const pinned = Array.from({ length: 15 }, (_, index) => `agent-${index}`);
    expect(canToggleAgentPin(pinned, "agent-15")).toBe(true);
    pinned.push("agent-15");
    expect(canToggleAgentPin(pinned, "agent-16")).toBe(false);
  });

  it("allows unpinning at or above capacity and pinning after a slot is freed", () => {
    const pinned = Array.from({ length: 17 }, (_, index) => `agent-${index}`);
    expect(canToggleAgentPin(pinned, "agent-0")).toBe(true);
    expect(canToggleAgentPin(pinned, "agent-17")).toBe(false);
    expect(canToggleAgentPin(pinned.slice(2), "agent-17")).toBe(true);
  });
});
