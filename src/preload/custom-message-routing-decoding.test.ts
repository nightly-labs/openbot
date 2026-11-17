import { describe, expect, it } from "vitest";
import { decodeLocalCustomMessageRouting } from "./custom-message-routing-decoding";

describe("custom message routing FromMain", () => {
  it("keeps local Thread and explicit follow-default values", () => {
    expect(
      decodeLocalCustomMessageRouting({
        available: true,
        defaultMode: "thread",
        agents: { "agent-a": null, "agent-b": "queue" },
      }),
    ).toEqual({ available: true, defaultMode: "thread", agents: { "agent-a": null, "agent-b": "queue" } });
  });

  it.each([
    null,
    {},
    { available: "true", defaultMode: "queue", agents: {} },
    { available: true, defaultMode: "unknown", agents: {} },
    { available: true, defaultMode: "thread", agents: [] },
    { available: true, defaultMode: "queue", agents: { "agent-a": "unknown" } },
    { available: true, defaultMode: "queue", agents: { "": null } },
  ])("does not expose a malformed main result: %j", (value) => {
    expect(() => decodeLocalCustomMessageRouting(value)).toThrow();
  });

  it("keeps prototype-like data keys without changing the returned record prototype", () => {
    const settings = decodeLocalCustomMessageRouting(
      JSON.parse('{"available":true,"defaultMode":"queue","agents":{"__proto__":"thread"}}'),
    );
    expect(Object.getPrototypeOf(settings.agents)).toBe(Object.prototype);
    expect(Object.hasOwn(settings.agents, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(settings.agents, "__proto__")?.value).toBe("thread");
  });
});
