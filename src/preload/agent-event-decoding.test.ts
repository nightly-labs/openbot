import type { ScopedAgentEvent } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { decodeScopedAgentEvent } from "./agent-event-decoding";

const delta = {
  serverId: "local",
  event: {
    type: "conversation-delta",
    agentId: "agent-1",
    threadId: "thread-1",
    turnId: "turn-1",
    messageId: "message-1",
    delta: "Hello",
    createdAt: "2026-09-23T10:00:00.000Z",
    revision: 3,
  },
} satisfies ScopedAgentEvent;

// Larger than the Team API limits: 100,000 characters for a command and 100 paths for a list.
const largeApproval = {
  serverId: "local",
  event: {
    type: "approval",
    approval: {
      requestId: 7,
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      kind: "permissions",
      command: "x".repeat(100_001),
      cwd: "/workspace",
      reason: null,
      grantRoot: null,
      permissions: {
        fileSystem: { read: [], write: Array.from({ length: 101 }, (_, index) => `/workspace/${index}`) },
        network: false,
      },
    },
  },
} satisfies ScopedAgentEvent;

const hiddenAgents = {
  serverId: "server-1",
  event: { type: "hidden-agents-changed", agents: [{ agentId: "agent-1", hiddenAt: "2026-10-16T09:00:00.000Z" }] },
} satisfies ScopedAgentEvent;

const memoryChanges = {
  serverId: "local",
  event: {
    type: "conversation",
    snapshot: {
      agentId: "agent-1",
      threadId: "thread-1",
      activeTurnId: null,
      revision: 4,
      messages: [
        {
          id: "turn-1:memory-changes",
          turnId: "turn-1",
          author: "system",
          source: "system",
          text: "Memory: 1 saved, 1 updated, 0 forgotten.",
          createdAt: "2026-10-23T10:00:00.000Z",
          status: "completed",
          itemType: "memory-changes",
          memoryChanges: [
            { memoryId: "memory-1", action: "saved", text: "Keeps mornings for writing." },
            { memoryId: "memory-2", action: "updated", text: "Uses Todoist.", previousText: "Uses Things." },
          ],
        },
      ],
    },
  },
} satisfies ScopedAgentEvent;

/** The memory-changes event with its first change replaced by `change`. */
function withMemoryChange(change: unknown) {
  const [message] = memoryChanges.event.snapshot.messages;
  return {
    ...memoryChanges,
    event: {
      ...memoryChanges.event,
      snapshot: { ...memoryChanges.event.snapshot, messages: [{ ...message, memoryChanges: [change] }] },
    },
  };
}

const threadContext = {
  agentId: "agent-1",
  threadId: "thread-2",
  usage: { usedTokens: 148_000, windowTokens: 258_000, autoCompactAt: 0.8, nativeManaged: false },
  compaction: null,
};

function withThreadContexts(threadContextStates: unknown[]) {
  return {
    serverId: "local",
    event: {
      type: "runtime-snapshot",
      snapshot: {
        threadContextStates,
        agents: [],
        activeTurns: [],
        work: [],
        latestMessages: [],
        attentionComplete: true,
        pendingPrompts: [],
        pendingApprovals: [],
        pendingBrowserTakeovers: [],
        failedTurns: [],
      },
    },
  };
}

describe("decodeScopedAgentEvent", () => {
  it.each([
    ["an event", delta],
    [
      "a buffered live event",
      { serverId: "server-1", event: { type: "queue-invalidated", agentId: "agent-1" }, bufferedLive: true },
    ],
    ["a hidden agents change", hiddenAgents],
    ["an empty hidden agents change", { serverId: "local", event: { type: "hidden-agents-changed", agents: [] } }],
    ["the memory changes of a turn", memoryChanges],
  ] satisfies [string, ScopedAgentEvent][])("keeps %s", (_name, value) => {
    expect(decodeScopedAgentEvent(value)).toEqual(value);
  });

  it("keeps the context of a side thread", () => {
    const value = withThreadContexts([threadContext]);
    expect(decodeScopedAgentEvent(value)).toEqual(value);
  });

  it.each([
    ["no server", { event: delta.event }],
    ["an unknown event type", { serverId: "local", event: { type: "made-up" } }],
    ["an event with a missing field", { serverId: "local", event: { ...delta.event, delta: undefined } }],
    [
      "an approval of an unknown kind",
      {
        serverId: "local",
        event: { ...largeApproval.event, approval: { ...largeApproval.event.approval, kind: "network" } },
      },
    ],
    [
      "a hidden agent with a time that is not a date",
      { ...hiddenAgents, event: { ...hiddenAgents.event, agents: [{ agentId: "agent-1", hiddenAt: "yesterday" }] } },
    ],
    [
      "a hidden agent that is named two times",
      {
        ...hiddenAgents,
        event: { ...hiddenAgents.event, agents: [...hiddenAgents.event.agents, ...hiddenAgents.event.agents] },
      },
    ],
    ["hidden agents that are not a list", { ...hiddenAgents, event: { ...hiddenAgents.event, agents: null } }],
    ["a bufferedLive that is not a boolean", { ...delta, bufferedLive: "yes" }],
    ["a memory change of an unknown action", withMemoryChange({ memoryId: "memory-1", action: "pinned", text: "x" })],
    [
      "a memory change with a text longer than a memory",
      withMemoryChange({ memoryId: "memory-1", action: "saved", text: "x".repeat(501) }),
    ],
    [
      "a side thread context with no window",
      withThreadContexts([{ ...threadContext, usage: { ...threadContext.usage, windowTokens: 0 } }]),
    ],
    ["a side thread context with no thread", withThreadContexts([{ ...threadContext, threadId: undefined }])],
    [
      "more side thread contexts than the agents can have threads",
      withThreadContexts(Array(100 * 50 + 1).fill(threadContext)),
    ],
    ["a value that is not a record", "event"],
  ])("rejects %s", (_name, value) => {
    expect(() => decodeScopedAgentEvent(value)).toThrow(/^Invalid /);
  });
});
