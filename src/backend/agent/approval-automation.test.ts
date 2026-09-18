import type { AgentApproval, AgentApprovalKind, AgentPromptQuestion } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { NO_APPROVAL_AUTOMATION, shouldAutoApprove, shouldAutoSkipPrompt } from "./approval-automation";

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

function question(): AgentPromptQuestion {
  return { id: "name", header: "Name", question: "Which file name?", isSecret: false, options: null };
}

function secretQuestion(): AgentPromptQuestion {
  return { id: "key", header: "API key", question: "Paste your API key.", isSecret: true, options: null };
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

describe("shouldAutoSkipPrompt", () => {
  it("leaves a granted agent's question to the agent", () => {
    expect(shouldAutoSkipPrompt(grants("agent-1"), "agent-1", [question()])).toBe(true);
  });

  it("asks an agent that was never granted", () => {
    expect(shouldAutoSkipPrompt(NO_APPROVAL_AUTOMATION, "agent-1", [question()])).toBe(false);
    expect(shouldAutoSkipPrompt(grants("agent-2"), "agent-1", [question()])).toBe(false);
  });

  // An API key or a password exists nowhere but with the user, so skipping it only loses the work.
  it("asks for a secret whatever the user turned on", () => {
    expect(shouldAutoSkipPrompt({ autoApproves: () => true }, "agent-1", [secretQuestion()])).toBe(false);
    expect(shouldAutoSkipPrompt({ autoApproves: () => true }, "agent-1", [question(), secretQuestion()])).toBe(false);
  });
});
