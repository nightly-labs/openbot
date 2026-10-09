import { describe, expect, it } from "vitest";
import event from "./fixtures/quiet-turn-v1/host-event.json";
import { optionalTeamEvent, optionalTeamEventToCurrent } from "./optional-events";
import { quietTurnEvent } from "./quiet-turn-v1";
import { decodeTeamProtocolV6BaseCurrentEvent } from "./v6-base-adapter";

describe("quiet-turn-v1", () => {
  it("projects the optional event and translates it to a local quiet completion", () => {
    const decoded = optionalTeamEvent({ ...event, privateText: "not sent" });
    expect(decoded).toEqual(event);
    if (!decoded) throw new Error("Missing optional completion.");
    expect(optionalTeamEventToCurrent(decoded)).toEqual({ ...event, type: "turn-completed", quiet: true });
    expect(decodeTeamProtocolV6BaseCurrentEvent(event).kind).toBe("unknown");
  });

  it.each([
    { ...event, agentId: null },
    { ...event, threadId: 1 },
    { ...event, turnId: false },
    { ...event, status: null },
    { ...event, origin: "invalid" },
  ])("rejects a malformed optional completion: %j", (value) => {
    expect(() => optionalTeamEvent(value)).toThrow("Invalid quiet turn completion.");
  });

  it("keeps the released acceptance of provider identifiers", () => {
    const value = { ...event, turnId: "a".repeat(129) };
    expect(quietTurnEvent(value)).toEqual(value);
  });

  it("leaves released completions and unknown events to their own decoders", () => {
    expect(quietTurnEvent({ ...event, type: "turn-completed" })).toBeNull();
    expect(optionalTeamEvent({ type: "future-optional-event" })).toBeNull();
  });
});
