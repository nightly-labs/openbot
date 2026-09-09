// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelRoutine, ChannelRoutineRun, ChannelTask } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { ChannelRoutineScheduler, channelRunStatusForTasks } from "./channel-routine-scheduler";
import { ChannelService } from "./channel-service";
import { OpenBotDatabase } from "./openbot-database";

let root: string;
let data: ReturnType<typeof stores>;
let service: ChannelService;
let scheduler: ChannelRoutineScheduler;
let routine: ChannelRoutine;
const actor = { id: "human-1", name: "Alex" };
const errors: string[] = [];
const generate = vi.fn(async () => JSON.stringify({ agentId: "agent-a" }));
let count = 0;
const operationId = () => `command-${++count}`;

beforeEach(async () => {
  errors.length = 0;
  generate.mockReset();
  generate.mockImplementation(async () => JSON.stringify({ agentId: "agent-a" }));
  root = await mkdtemp(join(tmpdir(), "openbot-channel-routines-"));
  data = stores(root);
  await data.store.initialize();
  await data.mailbox.initialize();
  await data.store.getOrCreate("agent-a");
  await data.store.getOrCreate("agent-b");
  service = new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    generate,
    schedule: () => undefined,
    interrupt: async () => undefined,
    busy: () => false,
    // The production wiring: every channel commit publishes, and the publish reconciles the runs.
    changed: (channelId) => scheduler.reconcile(channelId),
    error: (error) => {
      throw error;
    },
  });
  scheduler = newScheduler();
  await service.command(
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
  await service.stop();
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
    },
  });
}

function currentRun(runId: string, from: ChannelRoutineScheduler = scheduler): ChannelRoutineRun {
  return required(from.listRuns({ channelId: "channel-1", routineId: routine.id }).find((run) => run.id === runId));
}

/** Fires the routine and waits for the request to reach a member. */
async function fire(): Promise<ChannelRoutineRun> {
  const run = await scheduler.test({ channelId: "channel-1", routineId: routine.id });
  await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
  return run;
}

async function begin(taskId: string, turnId: string): Promise<void> {
  await vi.waitFor(() =>
    expect(
      service.store
        .assignments("channel-1")
        .some((item) => item.taskId === taskId && item.deliveryId && item.state === "starting"),
    ).toBe(true),
  );
  const assignment = required(
    service.store
      .assignments("channel-1")
      .filter((item) => item.taskId === taskId && item.deliveryId && item.state === "starting")
      .at(-1),
  );
  const deliveryId = required(assignment.deliveryId);
  await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
  await data.mailbox.markStarting(deliveryId);
  await data.mailbox.markRunning(deliveryId, turnId);
  service.accepted(deliveryId, `session-${taskId}`, turnId);
}

async function finish(turnId: string, status: "completed" | "failed"): Promise<void> {
  const assignment = required(service.store.assignments("channel-1").find((item) => item.turnId === turnId));
  await data.mailbox.markTerminal(required(assignment.deliveryId), status);
  const threadId = service.store.context("channel-1", assignment.agentId).threadId;
  service.event({ type: "turn-completed", agentId: assignment.agentId, threadId, turnId, status });
}

describe("channelRunStatusForTasks", () => {
  it("separates an unclaimed request from one a member has picked up", () => {
    const queued = [task({ state: "queued" })];
    expect(channelRunStatusForTasks(queued, false)).toEqual({ status: "queued", error: null });
    expect(channelRunStatusForTasks(queued, true)).toEqual({ status: "running", error: null });
  });

  it("reads a paused task as work a human has to unblock, not as a failure", () => {
    expect(channelRunStatusForTasks([task({ state: "paused", error: "Which report?" })], false)).toEqual({
      status: "needs-attention",
      error: "Which report?",
    });
    expect(channelRunStatusForTasks([task({ state: "failed", error: "The agent gave up." })], false)).toEqual({
      status: "failed",
      error: "The agent gave up.",
    });
  });

  it("succeeds on a cancelled-only fan-out and cancels a request whose tasks are gone", () => {
    expect(channelRunStatusForTasks([task({ state: "completed" }), task({ state: "cancelled" })], false)).toEqual({
      status: "succeeded",
      error: null,
    });
    expect(channelRunStatusForTasks([], false)).toEqual({ status: "cancelled", error: null });
  });
});

describe("ChannelRoutineScheduler", () => {
  it("tracks a fired routine from queued through running to succeeded", async () => {
    const run = await fire();
    expect(currentRun(run.id).status).toBe("running");
    const rootTask = required(service.store.tasks("channel-1")[0]);
    expect(rootTask.requestMessageId).toBe(run.requestMessageId);
    await begin(rootTask.id, "turn-1");
    await finish("turn-1", "completed");
    expect(currentRun(run.id)).toMatchObject({ status: "succeeded", error: null });
  });

  it("stays open until every task of the fan-out is done", async () => {
    await data.store.getOrCreate("agent-c");
    await service.command(
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
    );
    const run = await fire();
    const rootTask = required(service.store.tasks("channel-1")[0]);
    await begin(rootTask.id, "turn-root");
    await service.tool("channel-1", "agent-a", "turn-root", "child-1", "channel_assign", {
      recipientAgentId: "agent-b",
      task: "Collect the numbers",
      expectedResult: "The numbers",
      sourceMessageIds: [rootTask.requestMessageId],
      resources: ["workspace:/work/b"],
    });
    await finish("turn-root", "completed");
    // The root only waits on its child, so the run must not report success yet - and with nothing
    // picked up it reads as queued again, which is the honest state for the reader.
    expect(currentRun(run.id).status).toBe("queued");
    // The child inherits the request id: that is the only join between a run and its fan-out.
    const child = required(service.store.tasks("channel-1").find((item) => item.parentTaskId === rootTask.id));
    expect(child.requestMessageId).toBe(run.requestMessageId);
    await begin(child.id, "turn-child");
    expect(currentRun(run.id).status).toBe("running");
    await service.tool("channel-1", "agent-b", "turn-child", "result-1", "channel_result", { text: "The numbers" });
    await finish("turn-child", "completed");
    expect(currentRun(run.id).status).not.toBe("succeeded");
    await begin(rootTask.id, "turn-root-2");
    await finish("turn-root-2", "completed");
    expect(currentRun(run.id)).toMatchObject({ status: "succeeded", error: null });
  });

  it("reports the failing task's own error", async () => {
    const run = await fire();
    const rootTask = required(service.store.tasks("channel-1")[0]);
    await begin(rootTask.id, "turn-1");
    await finish("turn-1", "failed");
    expect(currentRun(run.id)).toMatchObject({
      status: "failed",
      error: "The agent could not complete this task.",
    });
  });

  it("waits for a human when the lead cannot route, then follows the resumed task", async () => {
    generate.mockImplementation(async () => JSON.stringify({ question: "Which report do you mean?" }));
    const run = await scheduler.test({ channelId: "channel-1", routineId: routine.id });
    await vi.waitFor(() => expect(currentRun(run.id).status).toBe("needs-attention"));
    expect(currentRun(run.id).error).toBe("Which report do you mean?");

    generate.mockImplementation(async () => JSON.stringify({ agentId: "agent-a" }));
    const paused = required(service.store.tasks("channel-1")[0]);
    await service.command(
      {
        type: "resume",
        channelId: "channel-1",
        operationId: operationId(),
        taskId: paused.id,
        recipientAgentId: null,
      },
      actor,
    );
    await vi.waitFor(() => expect(currentRun(run.id).status).toBe("running"));
    expect(currentRun(run.id).error).toBeNull();
  });

  it("keeps a run open while its request command is still in flight", async () => {
    const pending = scheduler.test({ channelId: "channel-1", routineId: routine.id });
    // The run row is written before its command commits, and other channel work publishes in that
    // window. The reconcile of that publish reads a request that no task holds yet, which is not
    // the same as a request that every task has dropped.
    scheduler.reconcile("channel-1");
    const run = await pending;
    await vi.waitFor(() => expect(currentRun(run.id).status).toBe("running"));
  });

  it("keeps tracking a request the lead merged into another task", async () => {
    const open = await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Prepare the report",
        recipientAgentId: "agent-a",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    expect(open.id).toBe("channel-1");
    await vi.waitFor(() => expect(service.store.tasks("channel-1")).toHaveLength(1));
    const existing = required(service.store.tasks("channel-1")[0]);
    // The lead folds the routine's request into the task already in flight. That cancels the
    // routine's own root task and moves its request id onto a task with a different id, which is
    // why the run tracks the request message and not the root task.
    generate.mockImplementation(async () => JSON.stringify({ taskId: existing.id }));
    const run = await scheduler.test({ channelId: "channel-1", routineId: routine.id });
    await vi.waitFor(() => {
      const merged = required(service.store.tasks("channel-1").find((item) => item.id === existing.id));
      expect(merged.requestMessageId).toBe(run.requestMessageId);
    });
    const root = required(
      service.store.tasks("channel-1").find((item) => item.id !== existing.id && item.state === "cancelled"),
    );
    expect(root.requestMessageId).toBe(run.requestMessageId);
    expect(currentRun(run.id).status).toBe("running");
  });

  it("settles open runs from the database alone after a restart", async () => {
    const run = await fire();
    const rootTask = required(service.store.tasks("channel-1")[0]);
    await begin(rootTask.id, "turn-1");
    await finish("turn-1", "completed");
    const userDataPath = data.store.database.userDataPath;
    // Rewind the row, so only a fresh reconcile over the durable rows can settle it again.
    data.store.database.connection
      .prepare("UPDATE projection_channel_routine_runs SET status = 'running' WHERE run_id = ?")
      .run(run.id);
    await service.stop();
    data.store.database.close();

    const reopened = new OpenBotDatabase(userDataPath);
    await reopened.initialize();
    const restarted = new ChannelService(reopened, data.mailbox, {
      agents: () => [],
      generate,
      schedule: () => undefined,
      interrupt: async () => undefined,
      busy: () => false,
      changed: () => undefined,
      error: () => undefined,
    });
    const cold = new ChannelRoutineScheduler({
      channels: restarted,
      hooks: { changed: () => undefined, emitError: (code) => errors.push(code), excludedChannels: () => new Set() },
    });
    cold.reconcileAll();
    expect(currentRun(run.id, cold).status).toBe("succeeded");
    expect(errors).toEqual([]);
    await restarted.stop();
    reopened.close();
    // The shared afterEach closes the original handle; reopening is enough for it to be a no-op.
    data.store.database.close();
  });
});

function task(fields: Partial<ChannelTask>): ChannelTask {
  return {
    id: "task-1",
    channelId: "channel-1",
    parentTaskId: null,
    rootTaskId: "task-1",
    requestMessageId: "request-1",
    sourceMessageIds: [],
    instruction: "Post the daily brief.",
    expectedResult: "The brief is posted.",
    ownerAgentId: "agent-a",
    state: "queued",
    error: null,
    dependencies: [],
    resources: [],
    attachmentDraftIds: [],
    assignmentCount: 0,
    revision: 1,
    ...fields,
  };
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("The expected test record is missing.");
  return value;
}
