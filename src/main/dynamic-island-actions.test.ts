import type { ConversationMessageSender } from "@openbot/contracts/ipc";
import { Effect } from "effect";
// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { type CriticalAction, performDynamicIslandCriticalAction } from "./dynamic-island-actions";

describe("performDynamicIslandCriticalAction", () => {
  it("executes a local prompt answer directly", async () => {
    const { local, remote, run } = harness();
    await run({
      type: "answer-prompt",
      serverId: "local",
      agentId: "chief",
      requestId: "prompt-local",
      answers: { source: ["Official data"] },
    });

    expect(local.respondToPrompt).toHaveBeenCalledWith({
      requestId: "prompt-local",
      answers: { source: ["Official data"] },
    });
    expect(remote.request).not.toHaveBeenCalled();
  });

  it("routes a prompt answer to its remote host", async () => {
    const { local, remote, decoders, run } = harness();
    await run({
      type: "answer-prompt",
      serverId: "server-eu",
      agentId: "research",
      requestId: "prompt-1",
      answers: { source: ["Official data"] },
    });

    expect(remote.request).toHaveBeenCalledWith("server-eu", "/v1/prompts/respond", decoders.decodeVoid, {
      method: "POST",
      body: { requestId: "prompt-1", answers: { source: ["Official data"] } },
    });
    expect(local.respondToPrompt).not.toHaveBeenCalled();
  });

  it("executes local and remote approval decisions", async () => {
    const { local, remote, decoders, run } = harness();
    await run({
      type: "respond-approval",
      serverId: "local",
      agentId: "chief",
      requestId: "approval-local",
      decision: "accept",
    });
    await run({
      type: "respond-approval",
      serverId: "server-eu",
      agentId: "research",
      requestId: "approval-remote",
      decision: "decline",
    });

    expect(local.respondToApproval).toHaveBeenCalledWith({ requestId: "approval-local", decision: "accept" });
    expect(remote.request).toHaveBeenCalledWith("server-eu", "/v1/approvals/respond", decoders.decodeVoid, {
      method: "POST",
      body: { requestId: "approval-remote", decision: "decline" },
    });
  });

  it("sends an island reply as the host user, locally and on the released Team API routes", async () => {
    const { local, remote, decoders, sender, run } = harness();
    const reply = { text: "Use both sources.", clientMessageId: "island-1" };
    await run({ type: "send-message", serverId: "local", agentId: "chief", ...reply });
    await run({ type: "send-message", serverId: "server-eu", agentId: "research", ...reply });

    expect(local.sendMessage).toHaveBeenCalledWith({ agentId: "chief", ...reply }, sender);
    expect(remote.request).toHaveBeenCalledWith(
      "server-eu",
      "/v1/agents/research/messages",
      decoders.decodeQueuedMessageReceipt,
      {
        method: "POST",
        body: { agentId: "research", ...reply, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
    );
  });

  it("stops the named turn locally and on a remote host", async () => {
    const { local, remote, decoders, run } = harness();
    await run({ type: "stop-agent", serverId: "local", agentId: "chief", turnId: "turn-local" });
    await run({ type: "stop-agent", serverId: "server-eu", agentId: "research", turnId: "turn-remote" });

    expect(local.interrupt).toHaveBeenCalledWith("chief", "turn-local");
    expect(remote.request).toHaveBeenCalledWith("server-eu", "/v1/agents/research/interrupt", decoders.decodeVoid, {
      method: "POST",
      body: { turnId: "turn-remote" },
    });
  });
});

function harness() {
  const local = {
    respondToPrompt: vi.fn(() => Effect.void),
    respondToApproval: vi.fn(() => Effect.void),
    sendMessage: vi.fn(() => Effect.void),
    interrupt: vi.fn(() => Effect.void),
  };
  const remote = { request: vi.fn(() => Effect.void) };
  const decoders = { decodeVoid: vi.fn(() => undefined), decodeQueuedMessageReceipt: vi.fn(() => undefined) };
  const sender: ConversationMessageSender = { id: "host-user", name: "Ada" };
  const run = (action: CriticalAction) =>
    Effect.runPromise(performDynamicIslandCriticalAction(action, local, remote, decoders, () => sender));
  return { local, remote, decoders, sender, run };
}
