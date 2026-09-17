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

  it("answers commands and file changes for a granted agent", () => {
    expect(shouldAutoApprove(grants("agent-1"), approval("command"))).toBe(true);
    expect(shouldAutoApprove(grants("agent-1"), approval("file-change"))).toBe(true);
  });

  it("still asks an agent that was never granted", () => {
    expect(shouldAutoApprove(grants("agent-2"), approval("command"))).toBe(false);
  });

  // The boundary the product promises: a request to widen what the agent may reach is never one the
  // agent's own standing grant can answer, whatever the user turned on.
  it("always asks before widening filesystem or network access", () => {
    expect(shouldAutoApprove(grants("agent-1"), approval("permissions"))).toBe(false);
    expect(shouldAutoApprove({ autoApproves: () => true }, approval("permissions"))).toBe(false);
  });
});
