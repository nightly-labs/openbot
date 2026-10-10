import { Effect } from "effect";

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelRoutine, ChannelTask } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { ChannelRoutineScheduler } from "./channel-routine-scheduler";
import { ChannelService } from "./channel-service";
import type { ChannelAssignment } from "./channel-store";
import { runCauseEffect } from "./effect-boundary";

let root: string;
let data: ReturnType<typeof stores>;
let service: ChannelService;
let scheduler: ChannelRoutineScheduler;
let routine: ChannelRoutine;
const actor = { id: "human-1", name: "Alex" };
const errors: string[] = [];
const generate = vi.fn(() => Effect.succeed(JSON.stringify({ agentId: "agent-a" })));
let count = 0;
const operationId = () => `command-${++count}`;
/** Whether a spent plan holds the members, as the usage-limit gate reports it. */
let limited = false;
/** Whether the members run other work, so the pump leaves a task unassigned. */
let busy = false;
/** Channels the service published, as the renderer and the queue holds hear it. */
const published: string[] = [];

beforeEach(async () => {
  errors.length = 0;
  published.length = 0;
  limited = false;
  busy = false;
  generate.mockReset();
  generate.mockImplementation(() => Effect.succeed(JSON.stringify({ agentId: "agent-a" })));
  root = await mkdtemp(join(tmpdir(), "openbot-channel-routines-"));
  data = stores(root);
  await runCauseEffect(data.store.initialize());
  await runCauseEffect(data.mailbox.initialize());
  await runCauseEffect(data.store.getOrCreate("agent-a"));
  await runCauseEffect(data.store.getOrCreate("agent-b"));
  service = new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    generate,
    schedule: () => undefined,
    interrupt: () => Effect.void,
    busy: () => busy,
    usageLimited: () => limited,
    skipAtLimit: (task) => scheduler.skipAtLimit(task.channelId, task.requestMessageId),
    // The production wiring: every channel commit publishes, and the publish reconciles the runs.
    changed: (channelId) => {
      published.push(channelId);
      scheduler.reconcile(channelId);
    },
    error: (error) => {
      throw error;
    },
  });
  scheduler = newScheduler();
  await runCauseEffect(
    service.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: operationId(),
        draft: {
          name: "Project",
          title: "Release coordination",
          instructions: "Ship the project",
          members: data.store.list().map((agent) => ({ agentId: agent.id })),
          leadAgentId: "agent-a",
        },
      },
      actor,
    ),
  );
  routine = scheduler.create({
    channelId: "channel-1",
    name: "Daily brief",
    instruction: "Post the daily brief.",
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
});

afterEach(async () => {
  await runCauseEffect(service.stop());
  data.store.database.close();
  await rm(root, { recursive: true, force: true });
});

function newScheduler(): ChannelRoutineScheduler {
  return new ChannelRoutineScheduler({
    channels: service,
    hooks: {
      changed: () => undefined,
      emitError: (code) => errors.push(code),
      excludedChannels: () => new Set(),
      usageLimited: () => limited,
    },
  });
}

describe("ChannelRoutineScheduler.delete", () => {
  it("does not dispatch a queued request of a routine the user deleted", async () => {
    busy = true;
    await runCauseEffect(scheduler.test({ channelId: "channel-1", routineId: routine.id }));
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBeTruthy());
    expect(service.store.assignments("channel-1")).toEqual([]);

    published.length = 0;
    scheduler.delete({ channelId: "channel-1", routineId: routine.id });
    expect(scheduler.list("channel-1")).toEqual([]);
    // The cancelled task must reach the channel view and the queue holds, not only the routine list.
    expect(published).toContain("channel-1");

    busy = false;
    await runCauseEffect(service.wake("channel-1"));
    // Let the pump that wake started finish its pass.
    await vi
      .waitFor(() => expect(service.store.tasks("channel-1")[0]?.state).not.toBe("queued"), { timeout: 2000 })
      .catch(() => undefined);
    expect(service.store.assignments("channel-1").filter((item) => item.deliveryId)).toEqual([]);
  });

  it("keeps the queued child of a request whose parent task already runs", async () => {
    busy = true;
    await runCauseEffect(scheduler.test({ channelId: "channel-1", routineId: routine.id }));
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBeTruthy());
    const parent = service.store.tasks("channel-1")[0];
    if (!parent) throw new Error("The routine posted no task.");
    // The parent delegated: its child shares the request id, and the parent waits for it.
    const child = {
      ...parent,
      id: "child-task",
      parentTaskId: parent.id,
      ownerAgentId: "agent-b",
      dependencies: [],
      state: "queued" as const,
      revision: 1,
    };
    service.store.update(service.store.get("channel-1"), {
      tasks: [{ ...parent, state: "running", dependencies: [child.id], revision: parent.revision + 1 }, child],
    });

    scheduler.delete({ channelId: "channel-1", routineId: routine.id });

    const states = Object.fromEntries(service.store.tasks("channel-1").map((task) => [task.id, task.state]));
    expect(states).toEqual({ [parent.id]: "running", [child.id]: "queued" });
  });

  it("keeps a request that ran, was stopped and was resumed", async () => {
    busy = true;
    await runCauseEffect(scheduler.test({ channelId: "channel-1", routineId: routine.id }));
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBeTruthy());
    const task = service.store.tasks("channel-1")[0];
    if (!task?.ownerAgentId) throw new Error("The routine posted no task.");
    // It ran once (a turn), was stopped, and Resume queued it again while the members are busy.
    service.store.update(service.store.get("channel-1"), {
      assignments: [endedAssignment(task, task.requestMessageId)],
      tasks: [{ ...task, state: "queued", revision: task.revision + 2 }],
    });

    scheduler.delete({ channelId: "channel-1", routineId: routine.id });

    expect(service.store.tasks("channel-1").map((item) => item.state)).toEqual(["queued"]);
  });

  it("withdraws a new request on a reused task whose earlier request ran", async () => {
    busy = true;
    await runCauseEffect(scheduler.test({ channelId: "channel-1", routineId: routine.id }));
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBeTruthy());
    const task = service.store.tasks("channel-1")[0];
    if (!task?.ownerAgentId) throw new Error("The routine posted no task.");
    // The router reused this task for the routine's request; its turn belonged to an older request.
    service.store.update(service.store.get("channel-1"), {
      assignments: [endedAssignment(task, "older-request")],
    });

    scheduler.delete({ channelId: "channel-1", routineId: routine.id });

    expect(service.store.tasks("channel-1").map((item) => item.state)).toEqual(["cancelled"]);
  });

  it("withdraws a new request on a reused task while the earlier request's turn still runs", async () => {
    busy = true;
    await runCauseEffect(scheduler.test({ channelId: "channel-1", routineId: routine.id }));
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBeTruthy());
    const task = service.store.tasks("channel-1")[0];
    if (!task?.ownerAgentId) throw new Error("The routine posted no task.");
    // The router took this task for the routine's request and waits for the older turn to stop.
    const receipt = await runCauseEffect(
      data.mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [task.ownerAgentId], text: "Older" }),
    );
    const deliveryId = receipt.deliveries[0]?.id;
    if (!deliveryId) throw new Error("The enqueue created no delivery.");
    await runCauseEffect(data.mailbox.markStarting(deliveryId));
    await runCauseEffect(data.mailbox.markRunning(deliveryId, "older-turn"));
    service.store.update(service.store.get("channel-1"), {
      assignments: [{ ...endedAssignment(task, "older-request"), state: "running", deliveryId, turnId: "older-turn" }],
    });

    scheduler.delete({ channelId: "channel-1", routineId: routine.id });

    expect(scheduler.list("channel-1")).toEqual([]);
    expect(service.store.tasks("channel-1").map((item) => item.state)).toEqual(["cancelled"]);
    // The older request's turn is not this request's queued work: it keeps running.
    expect(data.mailbox.getDelivery(deliveryId)?.delivery.status).toBe("running");
  });

  it("keeps the queued child of a request whose parent task was reused after it ran", async () => {
    busy = true;
    await runCauseEffect(scheduler.test({ channelId: "channel-1", routineId: routine.id }));
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBeTruthy());
    const parent = service.store.tasks("channel-1")[0];
    if (!parent) throw new Error("The routine posted no task.");
    // The parent ran for the routine's request and delegated a child; a newer request then reused
    // the parent task, and the child was resumed.
    const child = {
      ...parent,
      id: "child-task",
      parentTaskId: parent.id,
      ownerAgentId: "agent-b",
      dependencies: [],
      state: "queued" as const,
      revision: 1,
    };
    service.store.update(service.store.get("channel-1"), {
      assignments: [endedAssignment(parent, parent.requestMessageId)],
      tasks: [{ ...parent, requestMessageId: "newer-request", revision: parent.revision + 1 }, child],
    });

    scheduler.delete({ channelId: "channel-1", routineId: routine.id });

    const states = Object.fromEntries(service.store.tasks("channel-1").map((task) => [task.id, task.state]));
    expect(states[child.id]).toBe("queued");
  });

  it("keeps the queued child of a reused parent whose run predates stored request ids", async () => {
    busy = true;
    await runCauseEffect(scheduler.test({ channelId: "channel-1", routineId: routine.id }));
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBeTruthy());
    const parent = service.store.tasks("channel-1")[0];
    if (!parent) throw new Error("The routine posted no task.");
    // The parent ran before assignments stored their request, then a newer request reused it.
    const child = {
      ...parent,
      id: "child-task",
      parentTaskId: parent.id,
      ownerAgentId: "agent-b",
      dependencies: [],
      state: "queued" as const,
      revision: 1,
    };
    service.store.update(service.store.get("channel-1"), {
      assignments: [{ ...endedAssignment(parent, parent.requestMessageId), requestMessageId: null }],
      tasks: [{ ...parent, requestMessageId: "newer-request", revision: parent.revision + 1 }, child],
    });

    scheduler.delete({ channelId: "channel-1", routineId: routine.id });

    const states = Object.fromEntries(service.store.tasks("channel-1").map((task) => [task.id, task.state]));
    expect(states[child.id]).toBe("queued");
  });

  it("finishes a withdrawal on retry after the channel write failed", async () => {
    busy = true;
    await runCauseEffect(scheduler.test({ channelId: "channel-1", routineId: routine.id }));
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBeTruthy());
    const task = service.store.tasks("channel-1")[0];
    if (!task?.ownerAgentId) throw new Error("The routine posted no task.");
    const receipt = await runCauseEffect(
      data.mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [task.ownerAgentId], text: "Queued" }),
    );
    const deliveryId = receipt.deliveries[0]?.id;
    if (!deliveryId) throw new Error("The enqueue created no delivery.");
    service.store.update(service.store.get("channel-1"), {
      assignments: [
        {
          ...endedAssignment(task, task.requestMessageId),
          state: "queued",
          deliveryId,
          turnId: null,
        },
      ],
    });
    // The mailbox saves the cancellation, then the channel write fails once.
    const update = service.store.update.bind(service.store);
    const failing = vi.spyOn(service.store, "update").mockImplementationOnce(() => {
      throw new Error("channel write failed");
    });
    expect(() => service.withdrawRequests("channel-1", new Set([task.requestMessageId]))).toThrow(
      "channel write failed",
    );
    failing.mockImplementation(update);

    scheduler.delete({ channelId: "channel-1", routineId: routine.id });

    expect(service.store.tasks("channel-1").map((item) => item.state)).toEqual(["cancelled"]);
    expect(data.mailbox.getDelivery(deliveryId)?.delivery.status).toBe("cancelled");
  });
});

/** An assignment that ran a turn for `requestMessageId` on this task and then ended. */
function endedAssignment(task: ChannelTask, requestMessageId: string): ChannelAssignment {
  if (!task.ownerAgentId) throw new Error("The task has no owner.");
  return {
    id: "earlier-assignment",
    channelId: "channel-1",
    taskId: task.id,
    agentId: task.ownerAgentId,
    taskRevision: task.revision,
    requestMessageId,
    resources: [],
    deliveryId: null,
    turnId: "earlier-turn",
    state: "interrupted",
    throughSequence: 0,
    summaryVersion: 0,
    awaitedTaskIds: [],
    pendingRevision: null,
    pendingOutcome: null,
  };
}
