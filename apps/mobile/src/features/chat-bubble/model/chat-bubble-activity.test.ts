import { describe, expect, it } from "vitest";
import { isBubbleActivityAlive, markBubbleActivityAlive, unmarkBubbleActivityAlive } from "./chat-bubble-activity";

describe("chat bubble activity", () => {
  it("is not alive before the bubble marks its agent", () => {
    expect(isBubbleActivityAlive("server-1", "agent-a")).toBe(false);
  });

  it("is alive while the bubble shows the agent", () => {
    markBubbleActivityAlive("server-2", "agent-a");
    expect(isBubbleActivityAlive("server-2", "agent-a")).toBe(true);
    unmarkBubbleActivityAlive("server-2", "agent-a");
    expect(isBubbleActivityAlive("server-2", "agent-a")).toBe(false);
  });

  it("keeps the agents of different servers apart", () => {
    markBubbleActivityAlive("server-3", "agent-a");
    expect(isBubbleActivityAlive("server-4", "agent-a")).toBe(false);
    expect(isBubbleActivityAlive("server-3", "agent-b")).toBe(false);
    unmarkBubbleActivityAlive("server-4", "agent-a");
    expect(isBubbleActivityAlive("server-3", "agent-a")).toBe(true);
    unmarkBubbleActivityAlive("server-3", "agent-a");
  });
});
