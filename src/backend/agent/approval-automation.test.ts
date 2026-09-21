import type { AgentApproval, AgentApprovalKind } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { NO_APPROVAL_AUTOMATION, shouldAutoApprove } from "./approval-automation";

function approval(kind: AgentApprovalKind, agentId = "agent-1"): AgentApproval {
  return {
    requestId: "request-1",
    agentId,
    threadId: "thread-1",
    turnId: "turn-1",
    kind,
    command: kind === "command" ? "ls" : null,
    cwd: null,
    reason: null,
    grantRoot: null,
    permissions: kind === "permissions" ? { fileSystem: { read: ["/"], write: [] }, network: true } : null,
  };
}

const grants = (...agentIds: string[]) => ({ autoApproves: (agentId: string) => agentIds.includes(agentId) });

describe("shouldAutoApprove", () => {
  it("asks about everything without a grant", () => {
    expect(shouldAutoApprove(NO_APPROVAL_AUTOMATION, approval("command"))).toBe(false);
    expect(shouldAutoApprove(NO_APPROVAL_AUTOMATION, approval("file-change"))).toBe(false);
  });

  it("answers every kind of approval for a granted agent", () => {
    expect(shouldAutoApprove(grants("agent-1"), approval("command"))).toBe(true);
    expect(shouldAutoApprove(grants("agent-1"), approval("file-change"))).toBe(true);
    // An agent asks to widen its reach before it can do the work the grant was given for.
    expect(shouldAutoApprove(grants("agent-1"), approval("permissions"))).toBe(true);
  });

  it("still asks an agent that was never granted", () => {
    expect(shouldAutoApprove(grants("agent-2"), approval("command"))).toBe(false);
    expect(shouldAutoApprove(grants("agent-2"), approval("permissions"))).toBe(false);
  });
});
