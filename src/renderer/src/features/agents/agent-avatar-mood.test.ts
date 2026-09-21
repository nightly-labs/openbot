import type { AgentApproval, QueueSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { type AgentAvatarMoodsInput, computeAgentAvatarMoods } from "./agent-avatar-mood";

const APPROVAL: AgentApproval = {
  requestId: "approval-1",
  agentId: "agent-1",
  threadId: "thread-1",
  turnId: "turn-1",
  kind: "command",
  command: "ls",
  cwd: null,
  reason: null,
  grantRoot: null,
  permissions: null,
};

const CHANNEL_HOLD: QueueSnapshot = {
  agentId: "agent-1",
  deliveries: [],
  hold: { reason: "channel-task", channelId: "channel-1", channelName: "Standup", agentId: "agent-1" },
};

function moodsOf(overrides: Partial<AgentAvatarMoodsInput>): Record<string, string> {
  return computeAgentAvatarMoods({
    agentIds: ["agent-1"],
    activeTurns: {},
    queues: {},
    failedTurns: {},
    pendingPrompts: {},
    pendingApprovals: {},
    recentReplies: {},
    ...overrides,
  });
}

describe("computeAgentAvatarMoods", () => {
  it("leaves a quiet agent out, so a missing entry reads as idle", () => {
    expect(moodsOf({})).toEqual({});
  });

  it("shows work that is running", () => {
    expect(moodsOf({ activeTurns: { "agent-1": "turn-1" } })).toEqual({ "agent-1": "working" });
  });

  it("shows work the agent is doing in another thread", () => {
    expect(moodsOf({ queues: { "agent-1": CHANNEL_HOLD } })).toEqual({ "agent-1": "working" });
  });

  it("shows a reply nobody has read", () => {
    expect(moodsOf({ recentReplies: { "agent-1": true } })).toEqual({ "agent-1": "responded" });
  });

  it("asks for an answer before it reports the work still running behind it", () => {
    const moods = moodsOf({ pendingApprovals: { "agent-1": APPROVAL }, activeTurns: { "agent-1": "turn-1" } });
    expect(moods).toEqual({ "agent-1": "waiting" });
  });

  it("treats a pending prompt the same way as an approval", () => {
    expect(moodsOf({ pendingPrompts: { "agent-1": { id: "prompt-1" } } })).toEqual({ "agent-1": "waiting" });
  });

  it("reports a failure over the turn and the question that produced it", () => {
    const moods = moodsOf({
      failedTurns: { "agent-1": "turn-1" },
      pendingApprovals: { "agent-1": APPROVAL },
      activeTurns: { "agent-1": "turn-1" },
      recentReplies: { "agent-1": true },
    });
    expect(moods).toEqual({ "agent-1": "failed" });
  });

  it("keeps one agent's mood out of another's", () => {
    const moods = computeAgentAvatarMoods({
      agentIds: ["agent-1", "agent-2"],
      activeTurns: { "agent-1": "turn-1" },
      queues: {},
      failedTurns: { "agent-2": "turn-9" },
      pendingPrompts: {},
      pendingApprovals: {},
      recentReplies: {},
    });
    expect(moods).toEqual({ "agent-1": "working", "agent-2": "failed" });
  });
});
