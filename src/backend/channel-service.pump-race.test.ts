import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { ChannelService } from "./channel-service";
import { runChannel } from "./channel-test-runtime";
import { StoredStateFailure } from "./stored-state-effects";

let root: string;
let service: ChannelService;
let data: ReturnType<typeof stores>;
const actor = { id: "human-1", name: "Alex" };
let count = 0;
let reported: unknown[] = [];
let allowReported = false;
let busy = false;
const operationId = () => `command-${++count}`;

beforeEach(async () => {
  reported = [];
  allowReported = false;
  busy = false;
  root = await mkdtemp(join(tmpdir(), "openbot-channels-race-"));
  data = stores(root);
  await runChannel(data.store.initialize());
  await runChannel(data.mailbox.initialize());
  await runChannel(data.store.getOrCreate("agent-a"));
  await runChannel(data.store.getOrCreate("agent-b"));
  service = new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    generate: () => Effect.succeed(JSON.stringify({ agentId: "agent-a" })),
    schedule: () => undefined,
    interrupt: () => Effect.void,
    busy: () => busy,
    usageLimited: () => false,
    changed: () => undefined,
    queueHoldChanged: () => undefined,
    error: (error) => {
      if (!allowReported) throw error;
      reported.push(error);
    },
  });
  await runChannel(
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
});

afterEach(async () => {
  await runChannel(service.stop());
  data.store.database.close();
  await rm(root, { recursive: true, force: true });
});

describe("channel pump error path", () => {
  it("keeps a reassignment made while the failed dispatch was being enqueued", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    vi.spyOn(data.mailbox, "enqueue").mockImplementation((input) =>
      Effect.gen(function* () {
        if (input.channelId !== "channel-1") throw new Error("unexpected enqueue");
        entered = true;
        yield* Effect.promise(() => gate);
        // The enqueue fails after the await, for example a persist failure.
        return yield* new StoredStateFailure({ cause: new Error("persist failed") });
      }),
    );
    await runChannel(
      service.command(
        {
          type: "send",
          channelId: "channel-1",
          operationId: operationId(),
          text: "Inspect project A",
          recipientAgentId: "agent-a",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      ),
    );
    await vi.waitFor(() => expect(entered).toBe(true));
    const before = service.store.tasks("channel-1")[0];
    if (!before) throw new Error("task missing");

    // The user reassigns the task to agent-b while the pump waits inside enqueue.
    await runChannel(
      service.command(
        {
          type: "reassign",
          channelId: "channel-1",
          operationId: operationId(),
          taskId: before.id,
          recipientAgentId: "agent-b",
        },
        actor,
      ),
    );
    const reassigned = service.store.tasks("channel-1").find((task) => task.id === before.id);

    release();
    await vi.waitFor(() =>
      expect(service.store.assignments("channel-1").some((assignment) => assignment.state === "failed")).toBe(true),
    );
    const after = service.store.tasks("channel-1").find((task) => task.id === before.id);
    // The user's newer decision must survive the failure of the older dispatch.
    expect(after?.ownerAgentId).toBe("agent-b");
    expect(after?.revision).toBe(reassigned?.revision);
  });

  it("withdraws the delivery when a step after the enqueue fails", async () => {
    // A normal message waits first, so the pump must move the channel delivery ahead of it.
    await runChannel(
      data.mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["agent-a"], text: "Earlier message" }),
    );
    vi.spyOn(data.mailbox, "reorderQueue").mockImplementation(() =>
      Effect.fail(new StoredStateFailure({ cause: new Error("persist failed") })),
    );
    await runChannel(
      service.command(
        {
          type: "send",
          channelId: "channel-1",
          operationId: operationId(),
          text: "Inspect project A",
          recipientAgentId: "agent-a",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      ),
    );
    await vi.waitFor(() =>
      expect(service.store.assignments("channel-1").some((assignment) => assignment.state === "failed")).toBe(true),
    );
    const [failed] = service.store.assignments("channel-1");
    if (!failed?.deliveryId) throw new Error("The enqueue created no delivery.");
    // The failed assignment offers Resume; a delivery left behind would also run the task.
    expect(data.mailbox.queuedDeliveryIds("agent-a")).not.toContain(failed.deliveryId);
  });

  it("frees the queue and refuses the leftover delivery when withdrawing it fails too", async () => {
    allowReported = true;
    await runChannel(
      data.mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["agent-a"], text: "Earlier message" }),
    );
    vi.spyOn(data.mailbox, "reorderQueue").mockImplementation(() =>
      Effect.fail(new StoredStateFailure({ cause: new Error("persist failed") })),
    );
    vi.spyOn(data.mailbox, "cancelNow").mockImplementation(() => {
      throw new Error("cancel persist failed");
    });
    await runChannel(
      service.command(
        {
          type: "send",
          channelId: "channel-1",
          operationId: operationId(),
          text: "Inspect project A",
          recipientAgentId: "agent-a",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      ),
    );
    await vi.waitFor(() =>
      expect(service.store.assignments("channel-1").map((item) => item.state)).toEqual(["failed"]),
    );
    const [assignment] = service.store.assignments("channel-1");
    if (!assignment?.deliveryId) throw new Error("The enqueue created no delivery.");
    expect(reported).toHaveLength(1);
    // The delivery could not be withdrawn and sits behind the earlier message: nothing may hold
    // that message, and the delivery must end without a turn when it comes up.
    expect(data.mailbox.queuedDeliveryIds("agent-a")).toContain(assignment.deliveryId);
    expect(service.mayDrain("agent-a")).toBe(true);
    const context = data.mailbox.getDelivery(assignment.deliveryId);
    if (!context) throw new Error("The delivery is gone.");
    await expect(runChannel(service.prepare(context))).rejects.toThrow();
  });

  it("keeps the saved copies of a legacy task's drafts when a step after the enqueue fails", async () => {
    busy = true;
    await runChannel(
      service.command(
        {
          type: "send",
          channelId: "channel-1",
          operationId: operationId(),
          text: "Inspect project A",
          recipientAgentId: "agent-a",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      ),
    );
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBe("agent-a"));
    const task = service.store.tasks("channel-1")[0];
    if (!task) throw new Error("task missing");
    // An earlier version queued the task with its drafts still open.
    const file = join(root, "notes.txt");
    await writeFile(file, "Notes");
    const [draft] = await runChannel(data.mailbox.prepareImportedAttachments([file], []));
    if (!draft) throw new Error("draft missing");
    service.store.update(service.store.get("channel-1"), { tasks: [{ ...task, attachmentDraftIds: [draft.id] }] });
    await runChannel(
      data.mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["agent-a"], text: "Earlier message" }),
    );
    vi.spyOn(data.mailbox, "reorderQueue").mockImplementation(() =>
      Effect.fail(new StoredStateFailure({ cause: new Error("persist failed") })),
    );

    busy = false;
    await runChannel(service.wake("channel-1"));
    await vi.waitFor(() =>
      expect(service.store.assignments("channel-1").map((item) => item.state)).toEqual(["failed"]),
    );

    // Resume must re-send the saved copies; the drafts were consumed by the enqueue.
    const failed = service.store.tasks("channel-1")[0];
    expect(failed?.state).toBe("failed");
    expect(failed?.attachmentDraftIds).toEqual([]);
    const request = service.store.message("channel-1", task.requestMessageId);
    expect(request?.message.attachments).toHaveLength(1);
  });

  it("keeps the saved copies of a legacy task's drafts when the task is reassigned during the enqueue", async () => {
    busy = true;
    await runChannel(
      service.command(
        {
          type: "send",
          channelId: "channel-1",
          operationId: operationId(),
          text: "Inspect project A",
          recipientAgentId: "agent-a",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      ),
    );
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBe("agent-a"));
    const task = service.store.tasks("channel-1")[0];
    if (!task) throw new Error("task missing");
    // An earlier version queued the task with its drafts still open.
    const file = join(root, "notes.txt");
    await writeFile(file, "Notes");
    const [draft] = await runChannel(data.mailbox.prepareImportedAttachments([file], []));
    if (!draft) throw new Error("draft missing");
    service.store.update(service.store.get("channel-1"), { tasks: [{ ...task, attachmentDraftIds: [draft.id] }] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const enqueue = data.mailbox.enqueue.bind(data.mailbox);
    vi.spyOn(data.mailbox, "enqueue").mockImplementation((input) =>
      Effect.gen(function* () {
        if (!entered) {
          entered = true;
          yield* Effect.promise(() => gate);
        }
        return yield* enqueue(input);
      }),
    );

    busy = false;
    await runChannel(service.wake("channel-1"));
    await vi.waitFor(() => expect(entered).toBe(true));
    // The user reassigns the task while the pump waits inside the enqueue that consumes the drafts.
    busy = true;
    await runChannel(
      service.command(
        {
          type: "reassign",
          channelId: "channel-1",
          operationId: operationId(),
          taskId: task.id,
          recipientAgentId: "agent-b",
        },
        actor,
      ),
    );
    release();
    await vi.waitFor(() =>
      expect(service.store.assignments("channel-1").map((item) => item.state)).toEqual(["interrupted"]),
    );

    // The next dispatch must re-send the saved copies; the drafts are gone.
    const moved = service.store.tasks("channel-1")[0];
    expect(moved?.ownerAgentId).toBe("agent-b");
    expect(moved?.attachmentDraftIds).toEqual([]);
    const request = service.store.message("channel-1", task.requestMessageId);
    expect(request?.message.attachments).toHaveLength(1);
  });
});
