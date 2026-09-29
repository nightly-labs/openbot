import { describe, expect, it } from "vitest";
import { optionalTeamEvent } from "./optional-events";
import { skillsEvent } from "./skills-events-v1";

describe("skills-events-v1", () => {
  it("keeps only the agent id of a skills event", () => {
    expect(skillsEvent({ type: "skills-changed", agentId: "agent-1", skills: [{ name: "private" }] })).toEqual({
      type: "skills-changed",
      agentId: "agent-1",
    });
    expect(optionalTeamEvent({ type: "skills-changed", agentId: "agent-1" })).toEqual({
      type: "skills-changed",
      agentId: "agent-1",
    });
  });

  it("fails closed on a malformed skills event and ignores other events", () => {
    expect(() => skillsEvent({ type: "skills-changed" })).toThrow();
    expect(() => skillsEvent({ type: "skills-changed", agentId: "" })).toThrow();
    expect(() => skillsEvent({ type: "skills-changed", agentId: "a".repeat(129) })).toThrow();
    expect(skillsEvent({ type: "routines-changed", botId: "agent-1" })).toBeNull();
    expect(optionalTeamEvent({ type: "future-optional-event" })).toBeNull();
  });
});
