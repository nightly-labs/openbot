import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import type { ChannelDraft, ChannelMessage } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { ChannelHistory } from "./channel-history";
import { ChannelRoutineStore } from "./channel-routine-store";
import { ChannelService, resourcesConflict } from "./channel-service";

let root: string;
let service: ChannelService;
let data: ReturnType<typeof stores>;
let draft: ChannelDraft;
const actor = { id: "human-1", name: "Alex" };
const changed = vi.fn();
const schedule = vi.fn();
const interrupt = vi.fn(async () => undefined);
const generate = vi.fn(async () => JSON.stringify({ agentId: "agent-a" }));
let count = 0;
const operationId = () => `command-${++count}`;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-channels-"));
  data = stores(root);
  await data.store.initialize();
  await data.mailbox.initialize();
  await data.store.getOrCreate("agent-a");
  await data.store.getOrCreate("agent-b");
  draft = {
    name: "Project",
    title: "Release coordination",
    instructions: "Ship the project",
    members: data.store.list().map((agent) => ({ agentId: agent.id })),
    leadAgentId: "agent-a",
  };
  generate.mockClear();
  schedule.mockClear();
  interrupt.mockClear();
  changed.mockClear();
  service = new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    generate,
    schedule,
    interrupt,
    busy: () => false,
    changed,
    error: (error) => {
      throw error;
    },
  });
  await service.command({ type: "save", channelId: "channel-1", operationId: operationId(), draft }, actor);
});
afterEach(async () => {
  await service.stop();
  data.store.database.close();
  await rm(root, { recursive: true, force: true });
});
async function send(text: string, recipientAgentId: string | null = "agent-a") {
  await service.command(
    {
      type: "send",
      channelId: "channel-1",
      operationId: operationId(),
      text,
      recipientAgentId,
      replyToMessageId: null,
      attachmentDraftIds: [],
    },
    actor,
  );
  await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
  return required(service.store.tasks("channel-1")[0]);
}
describe("shared channel coordination", () => {
  it("addresses one member and keeps the agent normal thread and provider session", async () => {
    const threadId = await data.store.ensureThreadId("agent-a");
    data.store.bindProviderSession("agent-a", "normal-provider-session");
    const task = await send("Prepare the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const context = required(data.mailbox.getDelivery(required(assignment.deliveryId)));
    const execution = await service.prepare(context);
    expect(execution?.threadId).not.toBe(threadId);
    expect(data.store.list().find((agent) => agent.id === "agent-a")?.threadId).toBe(threadId);
    expect(data.store.activeProviderSession("agent-a")?.externalSessionId).toBe("normal-provider-session");
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(execution?.text).toContain(task.instruction);
    expect(data.mailbox.conversationMessages("agent-a")).toEqual([]);
  });
  it("saves one visible request when a command is retried", async () => {
    const command = {
      type: "send" as const,
      channelId: "channel-1",
      operationId: operationId(),
      text: "Prepare the report",
      recipientAgentId: "agent-a",
      replyToMessageId: null,
      attachmentDraftIds: [],
    };
    await service.command(command, actor);
    await service.command(command, actor);
    expect(service.store.messages("channel-1").filter((item) => item.author.kind === "member")).toHaveLength(1);
    expect(service.store.tasks("channel-1")).toHaveLength(1);
  });
  it("stops queued assignments and resumes with the current task revision", async () => {
    const task = await send("Prepare the report");
    const first = required(service.store.assignments("channel-1")[0]);
    await service.command(
      { type: "stop", channelId: "channel-1", operationId: operationId(), taskId: task.id, recipientAgentId: null },
      actor,
    );
    expect(data.mailbox.getDelivery(required(first.deliveryId))?.delivery.status).toBe("cancelled");
    expect(service.store.tasks("channel-1")[0]?.state).toBe("paused");
    await service.command(
      { type: "resume", channelId: "channel-1", operationId: operationId(), taskId: task.id, recipientAgentId: null },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("channel-1")).toHaveLength(2));
    expect(service.store.assignments("channel-1")[1]?.taskRevision).toBe(2);
  });
  it("stops a turn accepted after Stop and retries an interrupted control without dispatching again", async () => {
    const task = await send("Prepare the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
    await data.mailbox.markStarting(deliveryId);
    const stop = {
      type: "stop" as const,
      channelId: "channel-1",
      operationId: operationId(),
      taskId: task.id,
      recipientAgentId: null,
    };
    await service.command(stop, actor);
    const interrupt = vi.fn(async () => undefined);
    service.hooks.interrupt = interrupt;
    await data.mailbox.markRunning(deliveryId, "late-turn");
    service.accepted(deliveryId, "late-session", "late-turn");
    await vi.waitFor(() =>
      expect(interrupt).toHaveBeenCalledWith(
        "agent-a",
        "late-turn",
        service.store.context("channel-1", "agent-a").threadId,
      ),
    );
    expect(service.store.tasks("channel-1")[0]?.state).toBe("paused");
    interrupt.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(service.command(stop, actor)).rejects.toThrow("Provider unavailable");
    await service.command(stop, actor);
    expect(service.store.tasks("channel-1")[0]?.revision).toBe(1);
    expect(service.store.assignments("channel-1")).toHaveLength(1);
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
  });
  it("does not lose messages at a page boundary and replays the same transcript", () => {
    expect(service.store.list(actor.id)[0]?.lastMessage).toBeNull();
    const messages: ChannelMessage[] = Array.from({ length: 105 }, (_, i) => ({
      id: `message-${i}`,
      channelId: "channel-1",
      sequence: 0,
      author: { kind: "member", ...actor },
      taskId: null,
      superseded: false,
      message: {
        id: `message-${i}`,
        author: "user",
        text: `Request ${i}`,
        createdAt: new Date().toISOString(),
        status: "completed",
      },
    }));
    service.store.update(service.store.get("channel-1"), { messages });
    const page = service.store.page("channel-1");
    expect(page.messages).toHaveLength(100);
    const older = service.store.page("channel-1", required(page.olderCursor));
    expect(older.messages).toHaveLength(5);
    expect(new Set([...older.messages, ...page.messages].map((item) => item.id)).size).toBe(105);
    service.store.context("channel-1", "agent-a");
    const context = service.store.context("channel-1", "agent-a");
    service.store.acceptContext("channel-1", "agent-a", "session-1", 105, 1);
    service.store.saveSummary("channel-1", { version: 1, throughSequence: 50, text: "Decisions with references" });
    service.store.markRead("channel-1", actor.id, 105, operationId());
    const before = service.store.page("channel-1");
    service.store.rebuild("channel-1");
    expect(service.store.page("channel-1")).toEqual(before);
    expect(service.store.context("channel-1", "agent-a").threadId).toBe(context.threadId);
    expect(service.store.summary("channel-1").text).toBe("Decisions with references");
    expect(service.store.list(actor.id)[0]?.unreadCount).toBe(0);
    expect(service.store.list(actor.id)[0]?.lastMessage).toMatchObject({
      authorName: actor.name,
      text: "Request 104",
    });
  });
  it("keeps an uncertain accepted turn paused after restart", async () => {
    await send("Write a file");
    const assignment = required(service.store.assignments("channel-1")[0]);
    await data.mailbox.markStarting(required(assignment.deliveryId));
    await data.mailbox.markRunning(required(assignment.deliveryId), "turn-1");
    service.accepted(required(assignment.deliveryId), "session-1", "turn-1");
    await data.mailbox.markTerminal(required(assignment.deliveryId), "interrupted");
    await service.recover();
    expect(service.store.tasks("channel-1")[0]?.state).toBe("paused");
    expect(service.store.tasks("channel-1")[0]?.error).toContain("no confirmed result");
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
  });
  it("asks one visible question for ambiguous routing and never broadcasts", async () => {
    generate.mockResolvedValueOnce(JSON.stringify({ question: "Which member should own this?" }));
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Can someone help?",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.state).toBe("paused"));
    expect(service.store.messages("channel-1").filter((item) => item.author.kind === "coordinator")).toHaveLength(1);
    expect(service.store.assignments("channel-1")).toEqual([]);
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
    generate.mockResolvedValueOnce(JSON.stringify({ agentId: "agent-a", idle: true }));
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Research a second project",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.tasks("channel-1").at(-1)?.state).toBe("paused"));
    expect(service.store.messages("channel-1").filter((item) => item.author.kind === "coordinator")).toHaveLength(2);
    expect(service.store.assignments("channel-1")).toEqual([]);
  });
  it("discards routing after the membership changes", async () => {
    let resolve!: (value: string) => void;
    generate.mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Research this project",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    await service.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: operationId(),
        draft: { ...draft, members: draft.members.filter((item) => item.agentId !== "agent-b") },
      },
      actor,
    );
    resolve(JSON.stringify({ agentId: "agent-b" }));
    await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
    expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBe("agent-a");
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
  });
  it("keeps a routing decision when an ordinary progress message arrives", async () => {
    let resolve!: (value: string) => void;
    generate.mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Research this project",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    service.store.update(service.store.get("channel-1"), {
      messages: [
        {
          id: "progress",
          channelId: "channel-1",
          sequence: 0,
          author: { kind: "agent", id: "agent-b", name: "B" },
          taskId: null,
          superseded: false,
          message: {
            id: "progress",
            author: "assistant",
            text: "The earlier check is still in progress.",
            createdAt: new Date().toISOString(),
            status: "streaming",
          },
        },
      ],
    });
    const revision = service.store.get("channel-1").revision;
    resolve(JSON.stringify({ agentId: "agent-b" }));
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-b")).not.toBeNull());
    expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBe("agent-b");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(service.store.get("channel-1").revision).toBeGreaterThan(revision);
  });
  it("runs independent child tasks and returns their results to the parent once", async () => {
    await data.store.getOrCreate("agent-c");
    await service.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: operationId(),
        draft: { ...draft, members: [...draft.members, { agentId: "agent-c" }] },
      },
      actor,
    );
    const parent = await send("Compare the two projects");
    const begin = async (taskId: string, turnId: string) => {
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
          .filter((item) => item.taskId === taskId)
          .at(-1),
      );
      const context = required(data.mailbox.getDelivery(required(assignment.deliveryId)));
      const execution = await service.prepare(context);
      await data.mailbox.markStarting(required(assignment.deliveryId));
      await data.mailbox.markRunning(required(assignment.deliveryId), turnId);
      service.accepted(required(assignment.deliveryId), `session-${taskId}`, turnId);
      return { assignment, execution };
    };
    const finish = async (taskId: string, turnId: string) => {
      const assignment = required(service.store.assignments("channel-1").find((item) => item.turnId === turnId));
      await data.mailbox.markTerminal(required(assignment.deliveryId), "completed");
      const threadId = service.store.context("channel-1", assignment.agentId).threadId;
      service.event({ type: "turn-completed", agentId: assignment.agentId, threadId, turnId, status: "completed" });
      expect(service.store.tasks("channel-1").find((item) => item.id === taskId)?.state).not.toBe("running");
    };
    await begin(parent.id, "parent-turn");
    await service.tool("channel-1", "agent-a", "parent-turn", "child-1", "channel_assign", {
      recipientAgentId: "agent-b",
      task: "Inspect project B",
      expectedResult: "Findings B",
      sourceMessageIds: [parent.requestMessageId],
      resources: ["workspace:/work/b"],
    });
    await service.tool("channel-1", "agent-a", "parent-turn", "child-2", "channel_assign", {
      recipientAgentId: "agent-c",
      task: "Inspect project C",
      expectedResult: "Findings C",
      sourceMessageIds: [parent.requestMessageId],
      resources: ["workspace:/work/c"],
    });
    await finish(parent.id, "parent-turn");
    const children = service.store.tasks("channel-1").filter((item) => item.parentTaskId === parent.id);
    await begin(required(children[0]).id, "child-turn-b");
    await begin(required(children[1]).id, "child-turn-c");
    expect(service.store.tasks("channel-1").filter((item) => item.state === "running")).toHaveLength(2);
    await service.tool("channel-1", "agent-b", "child-turn-b", "result-b", "channel_result", { text: "Findings B" });
    await service.tool("channel-1", "agent-b", "child-turn-b", "result-b", "channel_result", { text: "Findings B" });
    await finish(required(children[0]).id, "child-turn-b");
    expect(service.store.tasks("channel-1").find((item) => item.id === parent.id)?.state).toBe("waiting");
    await service.tool("channel-1", "agent-c", "child-turn-c", "result-c", "channel_result", { text: "Findings C" });
    await finish(required(children[1]).id, "child-turn-c");
    const resumed = await begin(parent.id, "parent-result-turn");
    expect(resumed.execution?.text).toContain("Findings B");
    expect(resumed.execution?.text).toContain("Findings C");
    await finish(parent.id, "parent-result-turn");
    expect(service.store.tasks("channel-1").find((item) => item.id === parent.id)?.state).toBe("completed");
    expect(service.store.messages("channel-1").filter((item) => item.message.text === "Findings B")).toHaveLength(1);
    expect(service.store.assignments("channel-1").filter((item) => item.taskId === parent.id)).toHaveLength(2);
  });

  it("accepts a correction before completing its turn and keeps earlier output superseded", async () => {
    const task = await send("Prepare the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    const execution = required(await service.prepare(required(data.mailbox.getDelivery(deliveryId))));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "turn-correction");
    service.accepted(deliveryId, "session-correction", "turn-correction");
    service.event({
      type: "conversation",
      snapshot: {
        agentId: "agent-a",
        threadId: execution.threadId,
        activeTurnId: "turn-correction",
        revision: 0,
        messages: [
          {
            id: "partial",
            author: "assistant",
            turnId: "turn-correction",
            text: "Earlier partial result",
            createdAt: "2026-09-07T12:00:00.000Z",
            status: "streaming",
          },
        ],
      },
    });
    service.hooks.steer = async (_agentId, threadId, turnId) => {
      service.event({ type: "turn-completed", agentId: "agent-a", threadId, turnId, status: "completed" });
      expect(service.store.tasks("channel-1").find((item) => item.id === task.id)?.state).toBe("queued");
      return "accepted";
    };
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Actually use the revised figures",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    expect(service.store.tasks("channel-1")[0]).toMatchObject({
      id: task.id,
      state: "completed",
      revision: 1,
      instruction: "Actually use the revised figures",
    });
    expect(service.store.messages("channel-1").find((item) => item.id === "partial")?.superseded).toBe(true);
    expect(service.store.assignments("channel-1")).toHaveLength(1);
  });

  it("pauses work before a pending correction returns and ignores its late acceptance", async () => {
    const task = await send("Write the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "pending-correction-turn");
    service.accepted(deliveryId, "pending-correction-session", "pending-correction-turn");
    let resolve!: (result: "accepted") => void;
    const steer = vi.fn(
      () =>
        new Promise<"accepted">((done) => {
          resolve = done;
        }),
    );
    service.hooks.steer = steer;
    const correcting = service.command(
      {
        type: "send",
        operationId: operationId(),
        channelId: "channel-1",
        text: "Actually use new figures",
        recipientAgentId: null,
        replyToMessageId: task.requestMessageId,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(steer).toHaveBeenCalled());
    const stopping = service.command(
      { type: "stop", operationId: operationId(), channelId: "channel-1", taskId: task.id, recipientAgentId: null },
      actor,
    );
    try {
      await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.state).toBe("paused"));
    } finally {
      resolve("accepted");
      await Promise.all([correcting, stopping]);
    }
    expect(service.store.tasks("channel-1")[0]).toMatchObject({ state: "paused", revision: 2 });
    expect(service.store.assignments("channel-1")[0]?.taskRevision).toBe(0);
  });
  it("does not repeat an unconfirmed correction after restart", async () => {
    const task = await send("Write the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "turn-before-restart");
    service.accepted(deliveryId, "session-before-restart", "turn-before-restart");
    service.store.update(service.store.get("channel-1"), {
      tasks: [{ ...task, revision: 1, instruction: "Use new figures", state: "queued" }],
      assignments: [{ ...assignment, turnId: "turn-before-restart", state: "running", pendingRevision: 1 }],
    });
    await data.mailbox.markTerminal(deliveryId, "completed");
    await service.recover();
    expect(service.store.tasks("channel-1")[0]).toMatchObject({
      state: "paused",
      revision: 1,
      instruction: "Use new figures",
    });
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
  });

  it("resumes an uncertain correction after the provider confirms termination", async () => {
    const task = await send("Write the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    const execution = required(await service.prepare(required(data.mailbox.getDelivery(deliveryId))));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "uncertain-turn");
    service.accepted(deliveryId, "uncertain-session", "uncertain-turn");
    service.hooks.steer = async () => "uncertain";
    await service.command(
      {
        type: "send",
        operationId: operationId(),
        channelId: "channel-1",
        text: "Actually use new figures",
        recipientAgentId: null,
        replyToMessageId: task.requestMessageId,
        attachmentDraftIds: [],
      },
      actor,
    );
    await data.mailbox.markTerminal(deliveryId, "completed");
    service.event({
      type: "turn-completed",
      agentId: "agent-a",
      threadId: execution.threadId,
      turnId: "uncertain-turn",
      status: "completed",
    });
    expect(service.store.tasks("channel-1")[0]?.state).toBe("paused");
    await service.command(
      { type: "resume", operationId: operationId(), channelId: "channel-1", taskId: task.id, recipientAgentId: null },
      actor,
    );
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-a")).not.toBeNull());
    expect(service.store.assignments("channel-1")).toHaveLength(2);
    expect(service.store.tasks("channel-1")[0]).toMatchObject({ revision: 2, instruction: "Actually use new figures" });
  });
  it("retains full history while a late member receives the shared summary", async () => {
    const task = await send("Apply the shared decision");
    const messages: ChannelMessage[] = Array.from({ length: 150 }, (_, index) => ({
      id: `history-${index}`,
      channelId: "channel-1",
      sequence: 0,
      author: { kind: "member", ...actor },
      taskId: task.id,
      superseded: false,
      message: {
        id: `history-${index}`,
        author: "user",
        text: `${index === 0 ? "DECISION_A" : "context"} ${"detail ".repeat(100)}`,
        status: "completed",
        createdAt: "2026-09-07T12:00:00.000Z",
      },
    }));
    service.store.update(service.store.get("channel-1"), { messages });
    const model = vi.fn(async () => "DECISION_A applies. Source: history-0.");
    const history = new ChannelHistory(service.store, model, service.memories);
    const agents = data.store.list();
    const first = await history.prepare(task, required(agents[0]), required(agents[0]));
    const summary = service.store.summary("channel-1");
    expect(summary.throughSequence).toBeGreaterThan(0);
    expect(summary.throughSequence).toBeLessThan(service.store.page("channel-1").throughSequence);
    expect(first.text).toContain("DECISION_A applies");
    const late = await history.prepare(task, required(agents[1]), required(agents[0]));
    expect(late.text).toContain("DECISION_A applies");
    expect(late.text).toContain("Apply the shared decision");
    expect(service.store.messages("channel-1")).toHaveLength(151);
    expect(late.text.length).toBeLessThanOrEqual(120_000);
  });

  it("transfers one owner and waits for the declared task dependency", async () => {
    const task = await send("Write the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    const execution = required(await service.prepare(required(data.mailbox.getDelivery(deliveryId))));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "transfer-turn");
    service.accepted(deliveryId, "transfer-session", "transfer-turn");
    await service.command(
      {
        type: "send",
        operationId: operationId(),
        channelId: "channel-1",
        text: "Check the figures",
        recipientAgentId: "agent-b",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    const dependency = required(
      service.store.tasks("channel-1").find((item) => item.instruction === "Check the figures"),
    );
    await service.tool("channel-1", "agent-a", "transfer-turn", "transfer", "channel_transfer", {
      recipientAgentId: "agent-b",
      task: "Finish the report",
      expectedResult: "The final report",
      sourceMessageIds: [task.requestMessageId],
      dependencies: [dependency.id],
      resources: ["none"],
    });
    expect(service.store.tasks("channel-1").find((item) => item.id === task.id)).toMatchObject({
      ownerAgentId: "agent-b",
      state: "queued",
      dependencies: [dependency.id],
    });
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
    await data.mailbox.markTerminal(deliveryId, "completed");
    service.event({
      type: "turn-completed",
      agentId: "agent-a",
      threadId: execution.threadId,
      turnId: "transfer-turn",
      status: "completed",
    });
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-b")).not.toBeNull());
    expect(data.mailbox.nextQueued("agent-b")?.delivery.text).toBe("Check the figures");
    expect(service.store.tasks("channel-1").find((item) => item.id === task.id)?.state).toBe("queued");
  });
  it("waits for the previous turn to stop before reassignment", async () => {
    const task = await send("Prepare the report");
    const first = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(first.deliveryId);
    const execution = required(await service.prepare(required(data.mailbox.getDelivery(deliveryId))));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "old-turn");
    service.accepted(deliveryId, "old-session", "old-turn");
    let finish!: () => void;
    service.hooks.interrupt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const changing = service.command(
      {
        type: "reassign",
        channelId: "channel-1",
        operationId: operationId(),
        taskId: task.id,
        recipientAgentId: "agent-b",
      },
      actor,
    );
    await vi.waitFor(() => expect(service.hooks.interrupt).toHaveBeenCalled());
    service.wake();
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
    expect(service.store.assignments("channel-1")).toHaveLength(1);
    await data.mailbox.markTerminal(deliveryId, "interrupted");
    service.event({
      type: "turn-completed",
      agentId: "agent-a",
      threadId: execution.threadId,
      turnId: "old-turn",
      status: "interrupted",
    });
    finish();
    await changing;
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-b")).not.toBeNull());
    expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBe("agent-b");
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
  });

  it("pauses removed members and restores their transcript without restarting work", async () => {
    const task = await send("Keep the conversation");
    await service.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: operationId(),
        draft: {
          ...draft,
          leadAgentId: "agent-b",
          members: draft.members.filter((member) => member.agentId !== "agent-a"),
        },
      },
      actor,
    );
    expect(service.store.tasks("channel-1")[0]?.state).toBe("paused");
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
    await service.command({ type: "archive", channelId: "channel-1", operationId: operationId() }, actor);
    await service.command({ type: "restore", channelId: "channel-1", operationId: operationId() }, actor);
    expect(service.store.tasks("channel-1")[0]?.state).toBe("paused");
    expect(service.store.messages("channel-1")[0]?.message.text).toBe("Keep the conversation");
    expect(data.store.list()).toHaveLength(2);
    await service.command(
      {
        type: "reassign",
        channelId: "channel-1",
        operationId: operationId(),
        taskId: task.id,
        recipientAgentId: "agent-b",
      },
      actor,
    );
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-b")).not.toBeNull());
  });

  it("permanently removes channel data while preserving its member agents", async () => {
    await send("Remove this channel");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    const context = service.store.context("channel-1", "agent-a");
    const memory = service.memories.createManual("channel-1", "Keep this channel private");
    const routines = new ChannelRoutineStore(data.store.database);
    const routine = routines.create({
      channelId: "channel-1",
      name: "Channel cleanup check",
      instruction: "Check the channel.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const run = routines.createRun(routine, routine.trigger.id, "scheduled", "2026-09-09T12:00:00.000Z");
    const generated = await data.mailbox.storeGeneratedAttachment({
      bytes: new Uint8Array([1, 2, 3]),
      name: "channel.png",
      mimeType: "image/png",
      ownerAgentId: "agent-a",
      ownerThreadId: context.threadId,
    });
    expect(await data.mailbox.resolveAttachment(generated.id)).toMatchObject({ path: expect.any(String) });
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "delete-turn");
    service.accepted(deliveryId, "delete-session", "delete-turn");
    const channelRevision = service.store.get("channel-1").revision;
    changed.mockClear();
    expect(
      data.store.database.connection
        .prepare("SELECT 1 FROM projection_threads WHERE thread_id = ?")
        .get(context.threadId),
    ).toBeDefined();

    await service.deleteChannel("channel-1");

    expect(service.store.exists("channel-1")).toBe(false);
    expect(changed).toHaveBeenCalledWith("channel-1", channelRevision + 1);
    expect(interrupt).toHaveBeenCalledWith("agent-a", "delete-turn", context.threadId);
    expect(data.mailbox.getDelivery(deliveryId)).toBeNull();
    expect(await data.mailbox.resolveAttachment(generated.id)).toBeNull();
    expect(service.memories.list("channel-1")).toEqual([]);
    expect(routines.list("channel-1")).toEqual([]);
    expect(
      data.store.database.connection
        .prepare("SELECT 1 FROM projection_channel_routine_runs WHERE run_id = ?")
        .get(run.id),
    ).toBeUndefined();
    expect(
      data.store.database.connection
        .prepare("SELECT 1 FROM orchestration_events WHERE aggregate_type = 'channel-memory' AND aggregate_id = ?")
        .get(memory.id),
    ).toBeUndefined();
    expect(
      data.store.database.connection
        .prepare("SELECT 1 FROM orchestration_events WHERE aggregate_type = 'channel' AND aggregate_id = ?")
        .get("channel-1"),
    ).toBeUndefined();
    expect(
      data.store.database.connection
        .prepare("SELECT 1 FROM orchestration_events WHERE aggregate_type = 'channel-routine' AND aggregate_id = ?")
        .get(routine.id),
    ).toBeUndefined();
    expect(
      data.store.database.connection
        .prepare("SELECT COUNT(*) AS count FROM orchestration_command_receipts WHERE command_id LIKE 'channels:%'")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      data.store.database.connection
        .prepare("SELECT 1 FROM orchestration_events WHERE aggregate_type = 'channel-routine-run' AND aggregate_id = ?")
        .get(routine.id),
    ).toBeUndefined();
    expect(
      data.store.database.connection
        .prepare("SELECT 1 FROM projection_threads WHERE thread_id = ?")
        .get(context.threadId),
    ).toBeUndefined();
    expect(data.store.list().map((agent) => agent.id)).toEqual(["agent-a", "agent-b"]);
  });

  it("waits for a pending delivery start before deleting channel records", async () => {
    await send("Remove while the assignment is starting");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    const threadId = service.store.context("channel-1", "agent-a").threadId;
    await data.mailbox.markStarting(deliveryId);

    let release!: () => void;
    const pendingInterrupt = new Promise<undefined>(() => undefined);
    interrupt.mockImplementationOnce(() => pendingInterrupt);
    const pendingDrain = new Promise<void>((resolve) => {
      release = resolve;
    });
    service.hooks.awaitDrain = vi.fn(() => pendingDrain);

    const deletion = service.deleteChannel("channel-1");
    await vi.waitFor(() => expect(service.hooks.awaitDrain).toHaveBeenCalledWith("agent-a"));
    expect(service.store.exists("channel-1")).toBe(true);

    await data.mailbox.markRunning(deliveryId, "late-start-turn");
    service.accepted(deliveryId, "late-start-session", "late-start-turn");
    release();
    await vi.waitFor(() => expect(interrupt).toHaveBeenCalledWith("agent-a", "late-start-turn", threadId));
    service.event({
      type: "turn-completed",
      agentId: "agent-a",
      threadId,
      turnId: "late-start-turn",
      status: "interrupted",
    });
    await deletion;

    expect(interrupt).toHaveBeenCalledWith("agent-a", "late-start-turn", threadId);
    expect(service.store.exists("channel-1")).toBe(false);
    expect(service.store.tasks("channel-1")).toEqual([]);
  });

  it("keeps a channel when its provider start has no confirmed turn", async () => {
    await send("Keep this channel while the provider outcome is unknown");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    await data.mailbox.markStarting(deliveryId);
    service.deliveryUncertain(deliveryId);
    service.hooks.awaitDrain = vi.fn(async () => undefined);

    await expect(service.deleteChannel("channel-1")).rejects.toThrow("unconfirmed assignment start");

    expect(service.store.exists("channel-1")).toBe(true);
    expect(service.store.tasks("channel-1")[0]?.state).toBe("paused");
    expect(data.mailbox.getDelivery(deliveryId)?.delivery.status).toBe("starting");
  });

  it("rejects dependency cycles and pauses the root at the automatic assignment limit", async () => {
    const task = await send("Coordinate the report");
    const first = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(first.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "parent-limit-turn");
    service.accepted(deliveryId, "session-limit", "parent-limit-turn");
    const args = {
      recipientAgentId: "agent-b",
      task: "Research",
      expectedResult: "Findings",
      sourceMessageIds: [task.requestMessageId],
    };
    await expect(
      service.tool("channel-1", "agent-a", "parent-limit-turn", "cycle", "channel_assign", {
        ...args,
        dependencies: [task.id],
      }),
    ).rejects.toThrow("Invalid task dependencies");
    await expect(
      service.tool("channel-1", "agent-a", "parent-limit-turn", "duplicate-source", "channel_assign", {
        ...args,
        sourceMessageIds: [task.requestMessageId, task.requestMessageId],
      }),
    ).rejects.toThrow("Invalid channel task");
    expect(service.store.tasks("channel-1")).toHaveLength(1);
    for (let index = 0; index < 8; index++)
      await service.tool("channel-1", "agent-a", "parent-limit-turn", `child-${index}`, "channel_assign", args);
    expect(service.store.tasks("channel-1")).toHaveLength(9);
    await service.tool("channel-1", "agent-a", "parent-limit-turn", "child-over-limit", "channel_assign", args);
    expect(service.store.tasks("channel-1")).toHaveLength(9);
    expect(service.store.tasks("channel-1").every((item) => item.state === "paused")).toBe(true);
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
  });

  it("lists an archived channel among the sidebar ids so its place in the layout survives", async () => {
    await service.command({ type: "archive", channelId: "channel-1", operationId: operationId() }, actor);
    expect(service.store.ids()).toContain("channel-1");
  });

  it("fires a routine request as a new root task and never absorbs an open one", async () => {
    const open = await send("Prepare the report");
    // "Actually …" is the exact text that makes `send` reuse the one open task. A routine must not
    // inherit that heuristic, or a schedule silently rewrites the request a human is waiting on.
    await service.command(
      {
        type: "request",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Actually re-check the figures",
        recipientAgentId: null,
        requestMessageId: "routine-request-1",
        origin: { kind: "routine", routineId: "routine-1", routineName: "Daily check", runId: "run-1" },
      },
      actor,
    );
    const tasks = service.store.tasks("channel-1");
    expect(tasks).toHaveLength(2);
    const untouched = required(tasks.find((task) => task.id === open.id));
    expect(untouched.instruction).toBe("Prepare the report");
    expect(untouched.revision).toBe(open.revision);
    const fired = required(tasks.find((task) => task.id !== open.id));
    expect(fired.requestMessageId).toBe("routine-request-1");
    expect(fired.parentTaskId).toBeNull();
    // The routine authors the message, so the transcript reads it as a request, not as agent output.
    const message = required(service.store.messages("channel-1").find((item) => item.id === "routine-request-1"));
    expect(message.author).toEqual({ kind: "member", id: "routine:routine-1", name: "Daily check" });
    expect(message.message.author).toBe("user");
  });

  it("keeps one routine request when the fire is replayed and refuses an archived channel", async () => {
    const command = {
      type: "request" as const,
      channelId: "channel-1",
      operationId: "channel-routine-run:run-1",
      text: "Post the weekly figures",
      recipientAgentId: null,
      requestMessageId: "routine-request-2",
      origin: { kind: "routine" as const, routineId: "routine-1", routineName: "Weekly", runId: "run-1" },
    };
    await service.command(command, actor);
    await service.command(command, actor);
    expect(service.store.tasks("channel-1")).toHaveLength(1);
    expect(service.store.messages("channel-1").filter((item) => item.id === "routine-request-2")).toHaveLength(1);
    await service.command({ type: "archive", channelId: "channel-1", operationId: operationId() }, actor);
    await expect(service.command({ ...command, operationId: "channel-routine-run:run-2" }, actor)).rejects.toThrow(
      /Restore this channel/,
    );
  });

  it("writes one channel memory for a tool call and ignores the retry of that call", async () => {
    const task = await send("Prepare the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "memory-turn");
    service.accepted(deliveryId, "session-memory", "memory-turn");
    expect(service.store.tasks("channel-1").find((item) => item.id === task.id)?.state).toBe("running");
    await service.tool("channel-1", "agent-a", "memory-turn", "call-1", "channel_remember", {
      text: "The client signs off on Fridays.",
    });
    await service.tool("channel-1", "agent-a", "memory-turn", "call-1", "channel_remember", {
      text: "The client signs off on Fridays.",
    });
    const memories = service.memories.list("channel-1");
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ text: "The client signs off on Fridays.", origin: "automatic" });
    await service.tool("channel-1", "agent-a", "memory-turn", "call-2", "channel_forget_memory", {
      text: "The client signs off on Fridays.",
    });
    expect(service.memories.list("channel-1")).toHaveLength(0);
  });

  it("counts a normal request held behind another agent's channel work as unfinished", async () => {
    await send("Inspect project A");
    await data.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["agent-b"],
      text: "Draft the release note",
      idempotencyKey: "test:channel-hold:normal-request",
    });
    // One active assignment reserves the host, so every agent whose next request is not channel
    // work is held: this delivery stays queued for as long as agent-a's assignment runs.
    expect(service.mayDrain("agent-b")).toBe(false);
    expect(data.mailbox.listQueue("agent-b").deliveries.map((delivery) => delivery.status)).toEqual(["queued"]);
    // Agent deletion and the provider switch both refuse on this. A guard that reads only the
    // active statuses sees an idle agent and takes the request and its files away while it waits.
    expect(data.mailbox.hasUnfinishedDelivery("agent-b")).toBe(true);
  });

  it("schedules the agents held behind a channel assignment when it fails to start", async () => {
    await send("Inspect project A");
    const deliveryId = required(service.store.assignments("channel-1").find((item) => item.deliveryId)?.deliveryId);
    await data.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["agent-b"],
      text: "Draft the release note",
      idempotencyKey: "test:channel-hold:startup-failure",
    });
    expect(service.mayDrain("agent-b")).toBe(false);
    schedule.mockClear();
    service.deliveryFailed(deliveryId, "The provider did not start.");
    // The failure lifts the reservation, so agent-b may drain again - but the drain scheduler
    // retries only the failed assignment's agent, so without this the held request waits for an
    // unrelated trigger.
    expect(service.mayDrain("agent-b")).toBe(true);
    expect(schedule.mock.calls.map(([agentId]) => agentId)).toContain("agent-b");
  });

  it("keeps the stored request and its file when a child task starts", async () => {
    await data.store.getOrCreate("agent-c");
    await service.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: operationId(),
        draft: { ...draft, members: [...draft.members, { agentId: "agent-c" }] },
      },
      actor,
    );
    const file = join(root, "brief.txt");
    await writeFile(file, "the brief");
    const attachment = required((await data.mailbox.prepareAttachments([file]))[0]);
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: `Compare the two projects ${serializeAttachmentReference(attachment.name, attachment.id)}`,
        recipientAgentId: "agent-a",
        replyToMessageId: null,
        attachmentDraftIds: [attachment.id],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
    const parent = required(service.store.tasks("channel-1")[0]);
    const request = () =>
      required(service.store.messages("channel-1").find((item) => item.id === parent.requestMessageId)).message;
    const committed = required(request().attachments?.[0]);
    const text = request().text;
    // The first dispatch turns the draft into an attachment, so the reference in the request now
    // names the committed file.
    expect(text).toContain(committed.id);
    const deliveryId = required(service.store.assignments("channel-1")[0]?.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "parent-turn");
    service.accepted(deliveryId, "parent-session", "parent-turn");
    await service.tool("channel-1", "agent-a", "parent-turn", "child-1", "channel_assign", {
      recipientAgentId: "agent-b",
      task: "Inspect project B",
      expectedResult: "Findings B",
      sourceMessageIds: [parent.requestMessageId],
      resources: ["workspace:/work/b"],
    });
    await data.mailbox.markTerminal(deliveryId, "completed");
    service.event({
      type: "turn-completed",
      agentId: "agent-a",
      threadId: service.store.context("channel-1", "agent-a").threadId,
      turnId: "parent-turn",
      status: "completed",
    });
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-b")).not.toBeNull());
    // A child task inherits the id of the request message, and its instruction is the delegation,
    // not what the human wrote. The request keeps its own words and its own file.
    expect(data.mailbox.nextQueued("agent-b")?.delivery.text).toBe("Inspect project B");
    expect(request().text).toBe(text);
    expect(request().attachments).toEqual([committed]);
  });

  it("sends the request file again when a stopped assignment resumes", async () => {
    const file = join(root, "brief.txt");
    await writeFile(file, "the brief");
    const attachment = required((await data.mailbox.prepareAttachments([file]))[0]);
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Prepare the report",
        recipientAgentId: "agent-a",
        replyToMessageId: null,
        attachmentDraftIds: [attachment.id],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
    const task = required(service.store.tasks("channel-1")[0]);
    const first = required(service.store.assignments("channel-1")[0]);
    expect(data.mailbox.getDelivery(required(first.deliveryId))?.delivery.attachments).toHaveLength(1);
    await service.command(
      { type: "stop", channelId: "channel-1", operationId: operationId(), taskId: task.id, recipientAgentId: null },
      actor,
    );
    await service.command(
      { type: "resume", channelId: "channel-1", operationId: operationId(), taskId: task.id, recipientAgentId: null },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("channel-1")[1]?.deliveryId).not.toBeNull());
    const second = required(service.store.assignments("channel-1")[1]);
    // The drafts are consumed by the first dispatch, so a retry has to attach the committed
    // copies. Without them the agent resumes a request without the file it is about.
    expect(
      data.mailbox.getDelivery(required(second.deliveryId))?.delivery.attachments.map((item) => item.name),
    ).toEqual([attachment.name]);
    expect(
      required(service.store.messages("channel-1").find((item) => item.id === task.requestMessageId)).message
        .attachments,
    ).toHaveLength(1);
  });

  it("holds a transferred task and its resource until the previous owner stops", async () => {
    await data.store.getOrCreate("agent-c");
    await service.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: operationId(),
        draft: { ...draft, members: [...draft.members, { agentId: "agent-c" }] },
      },
      actor,
    );
    const parent = await send("Compare the two projects");
    const parentDeliveryId = required(service.store.assignments("channel-1")[0]?.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(parentDeliveryId)));
    await data.mailbox.markStarting(parentDeliveryId);
    await data.mailbox.markRunning(parentDeliveryId, "parent-turn");
    service.accepted(parentDeliveryId, "parent-session", "parent-turn");
    for (const [index, recipientAgentId] of ["agent-b", "agent-c"].entries())
      await service.tool("channel-1", "agent-a", "parent-turn", `child-${index}`, "channel_assign", {
        recipientAgentId,
        task: `Inspect project B as ${recipientAgentId}`,
        expectedResult: "Findings B",
        sourceMessageIds: [parent.requestMessageId],
        resources: ["workspace:/work/b"],
      });
    await data.mailbox.markTerminal(parentDeliveryId, "completed");
    service.event({
      type: "turn-completed",
      agentId: "agent-a",
      threadId: service.store.context("channel-1", "agent-a").threadId,
      turnId: "parent-turn",
      status: "completed",
    });
    // The two children declare the same workspace, so the second one waits for the first.
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-b")).not.toBeNull());
    const children = service.store.tasks("channel-1").filter((item) => item.parentTaskId === parent.id);
    const transferred = required(children[0]);
    const waiting = required(children[1]);
    const childDeliveryId = required(
      service.store.assignments("channel-1").find((item) => item.taskId === transferred.id)?.deliveryId,
    );
    await service.prepare(required(data.mailbox.getDelivery(childDeliveryId)));
    await data.mailbox.markStarting(childDeliveryId);
    await data.mailbox.markRunning(childDeliveryId, "child-turn");
    service.accepted(childDeliveryId, "child-session", "child-turn");
    await service.tool("channel-1", "agent-b", "child-turn", "transfer", "channel_transfer", {
      recipientAgentId: "agent-a",
      task: "Finish the inspection",
      expectedResult: "Findings B",
      sourceMessageIds: [parent.requestMessageId],
      resources: ["none"],
    });
    // Agent-b still runs the turn that holds the workspace. The new owner of that task must not
    // start a second turn on it, and the task that declares the same workspace must not read the
    // lowered resources of the transfer as a free reservation.
    const assignmentsFor = (taskId: string) =>
      service.store.assignments("channel-1").filter((item) => item.taskId === taskId);
    expect(assignmentsFor(transferred.id)).toHaveLength(1);
    expect(assignmentsFor(waiting.id)).toHaveLength(0);
    await data.mailbox.markTerminal(childDeliveryId, "completed");
    service.event({
      type: "turn-completed",
      agentId: "agent-b",
      threadId: service.store.context("channel-1", "agent-b").threadId,
      turnId: "child-turn",
      status: "completed",
    });
    await vi.waitFor(() => expect(assignmentsFor(transferred.id)).toHaveLength(2));
    expect(data.mailbox.nextQueued("agent-a")?.delivery.text).toBe("Finish the inspection");
  });

  it("reads an assignment stored before resources as a host reservation", async () => {
    await send("Prepare the report");
    const assignment = required(service.store.assignments("channel-1")[0]);
    const { resources, ...withoutResources } = assignment;
    expect(resources).toEqual(["host"]);
    data.store.database.connection
      .prepare("UPDATE projection_channel_assignments SET assignment_json = ? WHERE assignment_id = ?")
      .run(JSON.stringify(withoutResources), assignment.id);
    // A profile that ran the previous build holds assignment records with no resources. The
    // conservative reading holds the channel until that assignment ends, because the resources the
    // running turn uses are unknown.
    expect(service.store.assignments("channel-1")[0]?.resources).toEqual(["host"]);
  });

  it("serializes overlapping workspaces and permits independent declared resources", () => {
    expect(resourcesConflict(["workspace:/work/project"], ["workspace:/work/project/src"])).toBe(true);
    expect(resourcesConflict(["browser"], ["browser"])).toBe(true);
    expect(resourcesConflict(["host"], ["none"])).toBe(true);
    expect(resourcesConflict(["workspace:/work/a"], ["workspace:/work/b"])).toBe(false);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("The expected test record is missing.");
  return value;
}
