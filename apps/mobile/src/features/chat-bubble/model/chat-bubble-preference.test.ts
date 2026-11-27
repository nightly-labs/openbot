import { describe, expect, it } from "vitest";
import {
  agentBubbleKey,
  bubbleEnabledFor,
  type ChatBubblePreference,
  DEFAULT_CHAT_BUBBLE_PREFERENCE,
  decodeChatBubblePreference,
  resolvedBubbleAgents,
} from "./chat-bubble-preference";

const agents = [
  { id: "agent-a", serverId: "server-1" },
  { id: "agent-b", serverId: "server-1" },
  { id: "agent-a", serverId: "server-2" },
];

function preference(change: Partial<ChatBubblePreference>): ChatBubblePreference {
  return { ...DEFAULT_CHAT_BUBBLE_PREFERENCE, ...change };
}

describe("chat bubble preference", () => {
  it("is off for every agent by default", () => {
    expect(DEFAULT_CHAT_BUBBLE_PREFERENCE).toEqual({ enabled: false, agents: {} });
    expect(bubbleEnabledFor(DEFAULT_CHAT_BUBBLE_PREFERENCE, "server-1", "agent-a")).toBe(false);
    expect(resolvedBubbleAgents(DEFAULT_CHAT_BUBBLE_PREFERENCE, agents)).toEqual([]);
  });

  it("enables every agent when the master setting is on", () => {
    const stored = preference({ enabled: true });
    expect(bubbleEnabledFor(stored, "server-1", "agent-a")).toBe(true);
    expect(bubbleEnabledFor(stored, "server-2", "agent-a")).toBe(true);
    expect(resolvedBubbleAgents(stored, agents)).toEqual(["server-1:agent-a", "server-1:agent-b", "server-2:agent-a"]);
  });

  it("disables one agent with an override while the master setting is on", () => {
    const stored = preference({ enabled: true, agents: { "server-1:agent-a": false } });
    expect(bubbleEnabledFor(stored, "server-1", "agent-a")).toBe(false);
    expect(bubbleEnabledFor(stored, "server-1", "agent-b")).toBe(true);
    expect(bubbleEnabledFor(stored, "server-2", "agent-a")).toBe(true);
    expect(resolvedBubbleAgents(stored, agents)).toEqual(["server-1:agent-b", "server-2:agent-a"]);
  });

  it("keeps every agent off while the master setting is off, also with an override on", () => {
    const stored = preference({ agents: { "server-1:agent-a": true } });
    expect(bubbleEnabledFor(stored, "server-1", "agent-a")).toBe(false);
    expect(resolvedBubbleAgents(stored, agents)).toEqual([]);
  });

  it("names an agent by its server and its id", () => {
    expect(agentBubbleKey("server-1", "agent-a")).toBe("server-1:agent-a");
  });

  it("reads a stored value and ignores a broken one", () => {
    expect(decodeChatBubblePreference('{"enabled":true,"agents":{"server-1:agent-a":false}}')).toEqual({
      enabled: true,
      agents: { "server-1:agent-a": false },
    });
    expect(decodeChatBubblePreference("not json")).toEqual(DEFAULT_CHAT_BUBBLE_PREFERENCE);
    expect(decodeChatBubblePreference(null)).toEqual(DEFAULT_CHAT_BUBBLE_PREFERENCE);
  });
});
