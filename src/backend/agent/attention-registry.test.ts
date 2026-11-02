// @vitest-environment node

import type { AgentApproval, AgentEvent, ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { AgentClient } from "../agent-client";
import type { AppServerRequest } from "../protocol";
import { AttentionRegistry, type HostedSiteApprovals } from "./attention-registry";
import type { ConversationRuntime } from "./conversation-runtime";
import type { HostedSiteApprovalTarget, HostedSiteMutationContext } from "./hosted-site-coordinator";

// Failure modes: a turn that ends, a lost client, or a provider cancel drops a native approval
// without answering the provider's request (#4165), and an ACP client waits for the answer forever;
// a cleanup answers a client that no longer runs; a built-in tool's own `decide` waiter is answered
// twice; a hosted site cleared by a cleanup never reaches its resolver. Every dropped approval must
// still emit its `agent-input-resolved` event, because the UI removes its card on that event alone.
const SNAPSHOT: ConversationSnapshot = {
  agentId: "agent-1",
  threadId: "t1",
  activeTurnId: null,
  revision: 0,
  messages: [],
};

function makeRegistry(hostedSites?: Partial<HostedSiteApprovals>): {
  registry: AttentionRegistry;
  events: AgentEvent[];
} {
  const events: AgentEvent[] = [];
  const conversation: Pick<
    ConversationRuntime,
    "agentForThread" | "emitConversation" | "ensureSnapshot" | "publicThreadId"
  > = {
    agentForThread: (threadId) => (threadId === "t1" ? "agent-1" : undefined),
    publicThreadId: () => "public-1",
    ensureSnapshot: () => SNAPSHOT,
    emitConversation: () => {},
  };
  const registry = new AttentionRegistry({
    conversation,
    browser: { listTabs: () => [], beginTakeover: () => Effect.void, endTakeover: () => {} },
    hostedSites: {
      prepareApproval: hostedSites?.prepareApproval ?? (() => Effect.die("not used in these tests")),
      resolveApproval: hostedSites?.resolveApproval ?? (() => Effect.die("not used in these tests")),
    },
    routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
    emit: (event) => events.push(event),
    emitError: () => {},
    emitRuntimeSnapshot: () => {},
  });
  return { registry, events };
}

function stubClient(running: boolean): { client: AgentClient; replies: { id: string | number; result: unknown }[] } {
  const replies: { id: string | number; result: unknown }[] = [];
  const client: AgentClient = {
    provider: "opencode",
    running,
    start: () => {},
    stop: () => Effect.void,
    request: () => Effect.die("not used in these tests"),
    notify: () => {},
    respond: (id, result) => replies.push({ id, result }),
    respondError: () => {},
    on: () => client,
    once: () => client,
    off: () => client,
  };
  return { client, replies };
}

function surfaceCommandApproval(registry: AttentionRegistry, client: AgentClient): void {
  const request: AppServerRequest = {
    method: "execCommandApproval",
    id: 7,
    params: { threadId: "t1", turnId: "turn-1", command: "rm -rf build", cwd: "/tmp" },
  };
  registry.surfaceApproval(client, request, "command");
}

function approvalFixture(): AgentApproval {
  return {
    requestId: 7,
    agentId: "agent-1",
    threadId: "public-1",
    turnId: "turn-1",
    kind: "command",
    command: "rm -rf build",
    cwd: "/tmp",
    reason: null,
    grantRoot: null,
    permissions: null,
  };
}

const RESOLVED_EVENT = { type: "agent-input-resolved", kind: "approval", requestId: 7, agentId: "agent-1" };
const DECLINE = [
  { id: 7, result: { decision: { denied: { rejection: "This approval request is no longer pending." } } } },
];

describe("AttentionRegistry approval cleanup", () => {
  it("answers the provider's approval request when the turn clears it", () => {
    const { registry, events } = makeRegistry();
    const { client, replies } = stubClient(true);
    surfaceCommandApproval(registry, client);

    registry.clearForTurn("t1", "turn-1");

    expect(replies).toEqual(DECLINE);
    expect(events).toContainEqual(RESOLVED_EVENT);
  });

  it("answers nothing for a client that no longer runs, but still resolves the card", () => {
    const { registry, events } = makeRegistry();
    const { client, replies } = stubClient(false);
    surfaceCommandApproval(registry, client);

    expect(() => registry.clearForTurn("t1", "turn-1")).not.toThrow();
    expect(replies).toEqual([]);
    expect(events).toContainEqual(RESOLVED_EVENT);
  });

  it("clearApprovals answers the provider the same way", () => {
    const { registry, events } = makeRegistry();
    const { client, replies } = stubClient(true);
    surfaceCommandApproval(registry, client);

    registry.clearApprovals();

    expect(replies).toEqual(DECLINE);
    expect(events).toContainEqual(RESOLVED_EVENT);
  });

  it("cancelRequest answers the provider the same way", () => {
    const { registry, events } = makeRegistry();
    const { client, replies } = stubClient(true);
    surfaceCommandApproval(registry, client);

    registry.cancelRequest(client, 7);

    expect(replies).toEqual(DECLINE);
    expect(events).toContainEqual(RESOLVED_EVENT);
  });

  it("gives a built-in tool's decide waiter cancel instead of a second answer", async () => {
    const { registry, events } = makeRegistry();
    const { client, replies } = stubClient(true);
    const request: AppServerRequest = {
      method: "openbot/tool-approval",
      id: 7,
      params: { threadId: "t1", turnId: "turn-1" },
    };
    const decision = Effect.runPromise(registry.awaitToolApproval(client, request, approvalFixture()));
    await vi.waitFor(() => expect(registry.hasAttentionFor("agent-1")).toBe(true));

    registry.clearForTurn("t1", "turn-1");

    await expect(decision).resolves.toBe("cancel");
    expect(replies).toEqual([]);
    expect(events).toContainEqual(RESOLVED_EVENT);
  });

  it("sends a cleared hosted site approval through its resolver", async () => {
    const mutation: HostedSiteMutationContext = {
      agentId: "agent-1",
      operationId: "op-1",
      action: "publish",
      params: {
        threadId: "t1",
        turnId: "turn-1",
        callId: "call-1",
        namespace: null,
        tool: "publish_site",
        arguments: {},
      },
      eventDetails: { siteId: "site-1", title: "Site", hostname: null, url: null },
    };
    const approval: AgentApproval = { ...approvalFixture(), kind: "permissions", command: null };
    const resolved: { mutation: HostedSiteMutationContext; target: HostedSiteApprovalTarget; decision: string }[] = [];
    const { registry, events } = makeRegistry({
      prepareApproval: () => Effect.succeed({ approval, mutation }),
      resolveApproval: (pending, target, decision) => {
        resolved.push({ mutation: pending, target, decision });
        return Effect.void;
      },
    });
    const { client } = stubClient(true);
    const request: AppServerRequest = {
      method: "openbot/hosted-site-approval",
      id: 7,
      params: { threadId: "t1", turnId: "turn-1" },
    };

    await Effect.runPromise(registry.surfaceHostedSiteApproval(client, request, mutation.params, "publish_site"));
    registry.clearForTurn("t1", "turn-1");

    expect(resolved).toEqual([{ mutation, decision: "decline", target: { client, id: 7, agentId: "agent-1" } }]);
    expect(events).toContainEqual(RESOLVED_EVENT);
  });
});
