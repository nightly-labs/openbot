import type { QueueDelivery, QueueDeliveryStatus, QueueSnapshot } from "@openbot/contracts/ipc";
import {
  computeSidebarAgentStates,
  type SidebarAgentStatesInput,
} from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { sidebarAgentStateLabel } from "@openbot/ui/features/sidebar/sidebar-filtering";

function queue(agentId: string, ...statuses: QueueDeliveryStatus[]): QueueSnapshot {
  const deliveries: QueueDelivery[] = statuses.map((status, index) => ({
    id: `delivery-${index}`,
    messageId: `message-${index}`,
    recipientAgentId: agentId,
    sender: { kind: "user" },
    text: "Do the thing",
    attachments: [],
    replyToMessageId: null,
    status,
    position: index,
    turnId: null,
    error: null,
    createdAt: "2026-08-12T10:00:00.000Z",
  }));
  return { agentId, deliveries };
}

function input(overrides: Partial<SidebarAgentStatesInput> = {}): SidebarAgentStatesInput {
  return {
    agentIds: ["chief"],
    activeTurns: {},
    queues: {},
    unreadReplies: {},
    recentReplies: {},
    pendingPrompts: {},
    pendingApprovals: {},
    failedTurns: {},
    ...overrides,
  };
}

function routineDelivery(
  agentId: string,
  status: QueueDeliveryStatus,
  overrides: Partial<QueueDelivery> = {},
): QueueDelivery {
  return {
    id: `delivery-${status}`,
    messageId: `message-${status}`,
    recipientAgentId: agentId,
    sender: {
      kind: "routine",
      routineId: "routine-1",
      runId: `run-${status}`,
      routineName: "Daily",
      scheduledFor: "2026-09-22T10:00:00.000Z",
    },
    text: "Do the thing",
    attachments: [],
    replyToMessageId: null,
    status,
    position: status === "queued" ? 1 : null,
    turnId: status === "queued" ? null : "turn-1",
    error: null,
    createdAt: "2026-09-22T10:00:00.000Z",
    ...overrides,
  };
}

function snapshot(agentId: string, ...deliveries: QueueDelivery[]): QueueSnapshot {
  return { agentId, deliveries };
}

describe("computeSidebarAgentStates", () => {
  it("shows working while a turn runs, over the replies waiting to be read", () => {
    const states = computeSidebarAgentStates(
      input({
        activeTurns: { chief: "turn-1" },
        unreadReplies: { chief: 3 },
        recentReplies: { chief: true },
      }),
    );

    expect(states.chief).toEqual({ kind: "working" });
  });

  it("shows working for a queued delivery only once it has started", () => {
    const dormant = computeSidebarAgentStates(input({ queues: { chief: queue("chief", "queued", "failed") } }));
    expect(dormant.chief).toBeUndefined();

    for (const status of ["starting", "running"] as const) {
      const states = computeSidebarAgentStates(input({ queues: { chief: queue("chief", "queued", status) } }));
      expect(states.chief).toEqual({ kind: "working" });
    }
  });

  it("shows working for the agent that owns the channel task, not the ones it holds up", () => {
    const hold = {
      reason: "channel-task" as const,
      channelId: "channel-1",
      channelName: "Project launch",
      agentId: "chief",
    };

    // A channel turn runs on another thread: it reports no active turn and no started delivery
    // here, so the hold is the only signal that the agent doing that work is busy. The same hold
    // reaches every other agent's queue, because the assignment reserves the whole host.
    const states = computeSidebarAgentStates(
      input({
        agentIds: ["chief", "sales"],
        queues: {
          chief: { ...queue("chief", "queued"), hold },
          sales: { ...queue("sales", "queued"), hold },
        },
      }),
    );

    expect(states).toEqual({ chief: { kind: "working" } });
  });

  it("counts unread replies ahead of the completed indicator", () => {
    const states = computeSidebarAgentStates(input({ unreadReplies: { chief: 2 }, recentReplies: { chief: true } }));

    expect(states.chief).toEqual({ kind: "unread", count: 2 });
  });

  it("falls back to the completed indicator once the replies are read", () => {
    const states = computeSidebarAgentStates(input({ unreadReplies: { chief: 0 }, recentReplies: { chief: true } }));

    expect(states.chief).toEqual({ kind: "responded" });
  });

  it("leaves an idle agent out of the result rather than describing it", () => {
    const states = computeSidebarAgentStates(
      input({
        agentIds: ["chief", "sales"],
        activeTurns: { sales: null },
        queues: { sales: queue("sales", "completed") },
        unreadReplies: { chief: 1 },
      }),
    );

    expect(states).toEqual({ chief: { kind: "unread", count: 1 } });
  });

  it("describes only the agents it was given", () => {
    const states = computeSidebarAgentStates(input({ agentIds: [], activeTurns: { chief: "turn-1" } }));

    expect(states).toEqual({});
  });

  it("marks the agent that owns the running routine and nobody else", () => {
    const states = computeSidebarAgentStates(
      input({
        agentIds: ["chief", "sales"],
        queues: {
          chief: snapshot(
            "chief",
            routineDelivery("chief", "running"),
            routineDelivery("chief", "running", {
              id: "delivery-2",
              messageId: "message-2",
              sender: {
                kind: "routine",
                routineId: "routine-2",
                runId: "run-2",
                routineName: "Weekly",
                scheduledFor: "2026-09-22T11:00:00.000Z",
              },
            }),
          ),
          sales: snapshot("sales", routineDelivery("sales", "completed", { turnId: "turn-sales" })),
        },
      }),
    );

    expect(states).toEqual({ chief: { kind: "routine", phase: "running", count: 2 } });
    expect(sidebarAgentStateLabel(states.chief)).toBe("2 routines running");
  });

  it("shows a queued routine only when none of its runs are already going", () => {
    const waiting = computeSidebarAgentStates(
      input({ queues: { chief: snapshot("chief", routineDelivery("chief", "queued")) } }),
    );
    expect(waiting.chief).toEqual({ kind: "routine", phase: "queued", count: 1 });
    expect(sidebarAgentStateLabel(waiting.chief)).toBe("Routine waiting");

    const started = computeSidebarAgentStates(
      input({
        queues: {
          chief: snapshot(
            "chief",
            routineDelivery("chief", "queued", { id: "delivery-queued" }),
            routineDelivery("chief", "running"),
          ),
        },
      }),
    );
    expect(started.chief).toEqual({ kind: "routine", phase: "running", count: 1 });
  });

  it("shows needs attention when a prompt blocks the routine turn", () => {
    const states = computeSidebarAgentStates(
      input({
        queues: { chief: snapshot("chief", routineDelivery("chief", "running")) },
        pendingPrompts: { chief: { type: "prompt", turnId: "turn-1" } },
        unreadReplies: { chief: 4 },
      }),
    );

    expect(states.chief).toEqual({ kind: "routine", phase: "needs-attention", count: 1 });
    expect(sidebarAgentStateLabel(states.chief)).toBe("Routine needs attention");
  });

  it("marks the current failed routine turn and ignores an older one", () => {
    const current = computeSidebarAgentStates(
      input({
        queues: { chief: snapshot("chief", routineDelivery("chief", "failed")) },
        failedTurns: { chief: "turn-1" },
      }),
    );
    expect(current.chief).toEqual({ kind: "routine", phase: "failed", count: 1 });

    const older = computeSidebarAgentStates(
      input({
        queues: { chief: snapshot("chief", routineDelivery("chief", "failed", { turnId: "turn-old" })) },
        failedTurns: { chief: "turn-new" },
        unreadReplies: { chief: 1 },
      }),
    );
    expect(older.chief).toEqual({ kind: "unread", count: 1 });
  });

  it("keeps a user turn on the working mark", () => {
    const states = computeSidebarAgentStates(input({ queues: { chief: queue("chief", "running") } }));

    expect(states.chief).toEqual({ kind: "working" });
  });

  it("lets an unread reply replace a finished routine", () => {
    const states = computeSidebarAgentStates(
      input({
        queues: { chief: snapshot("chief", routineDelivery("chief", "completed", { turnId: "turn-done" })) },
        unreadReplies: { chief: 1 },
      }),
    );

    expect(states.chief).toEqual({ kind: "unread", count: 1 });
  });
});
