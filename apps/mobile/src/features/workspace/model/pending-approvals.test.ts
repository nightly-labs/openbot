import type { AgentApproval, AgentEvent, AgentRuntimeApproval, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { approvalIsPartial, dropApproval, type PendingApproval, reducePendingApprovals } from "./pending-approvals";

function approval(requestId: string | number, agentId = "chief", turnId = "turn-1"): AgentApproval {
  return {
    requestId,
    agentId,
    threadId: `thread-${agentId}`,
    turnId,
    kind: "command",
    command: "rm -rf build && bun run build",
    cwd: "/Users/me/project",
    reason: null,
    grantRoot: null,
    permissions: null,
  };
}

function snapshot(pendingApprovals: AgentRuntimeApproval[], attentionComplete = true): AgentEvent {
  const value: AgentRuntimeSnapshot = {
    agents: [],
    activeTurns: [],
    work: [],
    latestMessages: [],
    attentionComplete,
    pendingPrompts: [],
    pendingApprovals,
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
  return { type: "runtime-snapshot", snapshot: value };
}

function reduce(events: AgentEvent[], start: readonly PendingApproval[] = []) {
  return events.reduce(reducePendingApprovals, start);
}

describe("pending approvals on the phone", () => {
  it("keeps one card per request when the host sends the same approval again", () => {
    const next = reduce([
      { type: "approval", approval: approval(7) },
      { type: "approval", approval: approval(7) },
    ]);
    expect(next.map((item) => item.requestId)).toEqual([7]);
  });

  it("drops a request that another device answered, and only that one", () => {
    const start = reduce([
      { type: "approval", approval: approval(7) },
      { type: "approval", approval: approval("8", "builder") },
    ]);
    const next = reduce(
      [
        { type: "agent-input-resolved", kind: "prompt", requestId: 7, agentId: "chief" },
        { type: "agent-input-resolved", kind: "approval", requestId: "7", agentId: "chief" },
      ],
      start,
    );
    expect(next.map((item) => item.requestId)).toEqual(["8"]);
  });

  it("drops the approvals of a turn that ended without an answer", () => {
    const start = reduce([
      { type: "approval", approval: approval(7, "chief", "turn-1") },
      { type: "approval", approval: approval(8, "chief", "turn-2") },
    ]);
    const next = reduce(
      [{ type: "turn-completed", agentId: "chief", threadId: "thread-chief", turnId: "turn-1", status: "interrupted" }],
      start,
    );
    expect(next.map((item) => item.requestId)).toEqual([8]);
  });

  it("takes the host state after a reconnect: stale cards go, missed requests appear", () => {
    const start = reduce([{ type: "approval", approval: approval(7) }]);
    const missed = { ...approval(9, "builder"), truncated: false };
    expect(reduce([snapshot([missed])], start)).toEqual([missed]);
  });

  it("keeps the requests of agents that a partial snapshot does not name", () => {
    const start = reduce([{ type: "approval", approval: approval(7, "builder") }]);
    const other = { ...approval(9, "chief"), truncated: false };
    expect(reduce([snapshot([other], false)], start).map((item) => item.requestId)).toEqual([7, 9]);
  });

  it("offers Allow only for a request the phone has in full", () => {
    const whole = approval(7);
    const cut = { ...approval(7), command: "rm -rf build &&", truncated: true };
    // The event delivered the whole request, so the cut snapshot copy does not replace it.
    const kept = reduce([{ type: "approval", approval: whole }, snapshot([cut])]);
    expect(kept).toEqual([whole]);
    expect(kept.map(approvalIsPartial)).toEqual([false]);
    // After a reconnect, the phone has only the cut copy.
    const reconnected = reduce([snapshot([cut])]);
    expect(reconnected.map(approvalIsPartial)).toEqual([true]);
  });

  it("drops an answered request from its server only", () => {
    const byServer = { home: [approval(7)], office: [approval(7)] };
    expect(dropApproval(byServer, "home", "7")).toEqual({ home: [], office: [approval(7)] });
    expect(dropApproval(byServer, "home", 99)).toBe(byServer);
  });
});
