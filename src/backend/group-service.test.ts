import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GroupDraft, GroupMessage } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { GroupHistory } from "./group-history";
import { GroupService, resourcesConflict } from "./group-service";

let root: string;
let service: GroupService;
let data: ReturnType<typeof stores>;
let draft: GroupDraft;
const actor = { id: "human-1", name: "Alex" };
const changed = vi.fn();
const generate = vi.fn(async () => JSON.stringify({ agentId: "agent-a" }));
let count = 0;
const operationId = () => `command-${++count}`;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-groups-"));
  data = stores(root);
  await data.store.initialize();
  await data.mailbox.initialize();
  await data.store.getOrCreate("agent-a");
  await data.store.getOrCreate("agent-b");
  draft = {
    name: "Project",
    purpose: "Ship the project",
    members: data.store.list().map((agent) => ({ agentId: agent.id, responsibility: agent.description })),
    leadAgentId: "agent-a",
    linkedThreadIds: [],
  };
  generate.mockClear();
  service = new GroupService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    generate,
    schedule: () => undefined,
    interrupt: async () => undefined,
    busy: () => false,
    changed,
    error: (error) => {
      throw error;
    },
  });
  await service.command({ type: "save", groupId: "group-1", operationId: operationId(), draft }, actor);
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
      groupId: "group-1",
      operationId: operationId(),
      text,
      recipientAgentId,
      replyToMessageId: null,
      attachmentDraftIds: [],
    },
    actor,
  );
  await vi.waitFor(() => expect(service.store.assignments("group-1").some((item) => item.deliveryId)).toBe(true));
  return required(service.store.tasks("group-1")[0]);
}
describe("shared group coordination", () => {
  it("addresses one member and keeps the agent normal thread and provider session", async () => {
    const threadId = await data.store.ensureThreadId("agent-a");
    data.store.bindProviderSession("agent-a", "normal-provider-session");
    const task = await send("Prepare the report");
    const assignment = required(service.store.assignments("group-1")[0]);
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
      groupId: "group-1",
      operationId: operationId(),
      text: "Prepare the report",
      recipientAgentId: "agent-a",
      replyToMessageId: null,
      attachmentDraftIds: [],
    };
    await service.command(command, actor);
    await service.command(command, actor);
    expect(service.store.messages("group-1").filter((item) => item.author.kind === "member")).toHaveLength(1);
    expect(service.store.tasks("group-1")).toHaveLength(1);
  });
  it("stops queued assignments and resumes with the current task revision", async () => {
    const task = await send("Prepare the report");
    const first = required(service.store.assignments("group-1")[0]);
    await service.command(
      { type: "stop", groupId: "group-1", operationId: operationId(), taskId: task.id, recipientAgentId: null },
      actor,
    );
    expect(data.mailbox.getDelivery(required(first.deliveryId))?.delivery.status).toBe("cancelled");
    expect(service.store.tasks("group-1")[0]?.state).toBe("paused");
    await service.command(
      { type: "resume", groupId: "group-1", operationId: operationId(), taskId: task.id, recipientAgentId: null },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("group-1")).toHaveLength(2));
    expect(service.store.assignments("group-1")[1]?.taskRevision).toBe(2);
  });
  it("stops a turn accepted after Stop and retries an interrupted control without dispatching again", async () => {
    const task = await send("Prepare the report");
    const assignment = required(service.store.assignments("group-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
    await data.mailbox.markStarting(deliveryId);
    const stop = {
      type: "stop" as const,
      groupId: "group-1",
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
        service.store.context("group-1", "agent-a").threadId,
      ),
    );
    expect(service.store.tasks("group-1")[0]?.state).toBe("paused");
    interrupt.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(service.command(stop, actor)).rejects.toThrow("Provider unavailable");
    await service.command(stop, actor);
    expect(service.store.tasks("group-1")[0]?.revision).toBe(1);
    expect(service.store.assignments("group-1")).toHaveLength(1);
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
  });
  it("does not lose messages at a page boundary and replays the same transcript", () => {
    const messages: GroupMessage[] = Array.from({ length: 105 }, (_, i) => ({
      id: `message-${i}`,
      groupId: "group-1",
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
    service.store.update(service.store.get("group-1"), { messages });
    const page = service.store.page("group-1");
    expect(page.messages).toHaveLength(100);
    const older = service.store.page("group-1", required(page.olderCursor));
    expect(older.messages).toHaveLength(5);
    expect(new Set([...older.messages, ...page.messages].map((item) => item.id)).size).toBe(105);
    service.store.context("group-1", "agent-a");
    const context = service.store.context("group-1", "agent-a");
    service.store.acceptContext("group-1", "agent-a", "session-1", 105, 1);
    service.store.saveSummary("group-1", { version: 1, throughSequence: 50, text: "Decisions with references" });
    service.store.markRead("group-1", actor.id, 105, operationId());
    const before = service.store.page("group-1");
    service.store.rebuild("group-1");
    expect(service.store.page("group-1")).toEqual(before);
    expect(service.store.context("group-1", "agent-a").threadId).toBe(context.threadId);
    expect(service.store.summary("group-1").text).toBe("Decisions with references");
    expect(service.store.list(actor.id)[0]?.unreadCount).toBe(0);
  });
  it("keeps an uncertain accepted turn paused after restart", async () => {
    await send("Write a file");
    const assignment = required(service.store.assignments("group-1")[0]);
    await data.mailbox.markStarting(required(assignment.deliveryId));
    await data.mailbox.markRunning(required(assignment.deliveryId), "turn-1");
    service.accepted(required(assignment.deliveryId), "session-1", "turn-1");
    await data.mailbox.markTerminal(required(assignment.deliveryId), "interrupted");
    await service.recover();
    expect(service.store.tasks("group-1")[0]?.state).toBe("paused");
    expect(service.store.tasks("group-1")[0]?.error).toContain("no confirmed result");
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
  });
  it("asks one visible question for ambiguous routing and never broadcasts", async () => {
    generate.mockResolvedValueOnce(JSON.stringify({ question: "Which member should own this?" }));
    await service.command(
      {
        type: "send",
        groupId: "group-1",
        operationId: operationId(),
        text: "Can someone help?",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.tasks("group-1")[0]?.state).toBe("paused"));
    expect(service.store.messages("group-1").filter((item) => item.author.kind === "coordinator")).toHaveLength(1);
    expect(service.store.assignments("group-1")).toEqual([]);
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
    generate.mockResolvedValueOnce(JSON.stringify({ agentId: "agent-a", idle: true }));
    await service.command(
      {
        type: "send",
        groupId: "group-1",
        operationId: operationId(),
        text: "Research a second project",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.tasks("group-1").at(-1)?.state).toBe("paused"));
    expect(service.store.messages("group-1").filter((item) => item.author.kind === "coordinator")).toHaveLength(2);
    expect(service.store.assignments("group-1")).toEqual([]);
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
        groupId: "group-1",
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
        groupId: "group-1",
        operationId: operationId(),
        draft: { ...draft, members: draft.members.filter((item) => item.agentId !== "agent-b") },
      },
      actor,
    );
    resolve(JSON.stringify({ agentId: "agent-b" }));
    await vi.waitFor(() => expect(service.store.assignments("group-1").some((item) => item.deliveryId)).toBe(true));
    expect(service.store.tasks("group-1")[0]?.ownerAgentId).toBe("agent-a");
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
        groupId: "group-1",
        operationId: operationId(),
        text: "Research this project",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    service.store.update(service.store.get("group-1"), {
      messages: [
        {
          id: "progress",
          groupId: "group-1",
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
    const revision = service.store.get("group-1").revision;
    resolve(JSON.stringify({ agentId: "agent-b" }));
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-b")).not.toBeNull());
    expect(service.store.tasks("group-1")[0]?.ownerAgentId).toBe("agent-b");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(service.store.get("group-1").revision).toBeGreaterThan(revision);
  });
  it("runs independent child tasks and returns their results to the parent once", async () => {
    await data.store.getOrCreate("agent-c");
    await service.command(
      {
        type: "save",
        groupId: "group-1",
        operationId: operationId(),
        draft: { ...draft, members: [...draft.members, { agentId: "agent-c", responsibility: "Review" }] },
      },
      actor,
    );
    const parent = await send("Compare the two projects");
    const begin = async (taskId: string, turnId: string) => {
      await vi.waitFor(() =>
        expect(
          service.store
            .assignments("group-1")
            .some((item) => item.taskId === taskId && item.deliveryId && item.state === "starting"),
        ).toBe(true),
      );
      const assignment = required(
        service.store
          .assignments("group-1")
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
      const assignment = required(service.store.assignments("group-1").find((item) => item.turnId === turnId));
      await data.mailbox.markTerminal(required(assignment.deliveryId), "completed");
      const threadId = service.store.context("group-1", assignment.agentId).threadId;
      service.event({ type: "turn-completed", agentId: assignment.agentId, threadId, turnId, status: "completed" });
      expect(service.store.tasks("group-1").find((item) => item.id === taskId)?.state).not.toBe("running");
    };
    await begin(parent.id, "parent-turn");
    await service.tool("group-1", "agent-a", "parent-turn", "child-1", "group_assign", {
      recipientAgentId: "agent-b",
      task: "Inspect project B",
      expectedResult: "Findings B",
      sourceMessageIds: [parent.requestMessageId],
      resources: ["workspace:/work/b"],
    });
    await service.tool("group-1", "agent-a", "parent-turn", "child-2", "group_assign", {
      recipientAgentId: "agent-c",
      task: "Inspect project C",
      expectedResult: "Findings C",
      sourceMessageIds: [parent.requestMessageId],
      resources: ["workspace:/work/c"],
    });
    await finish(parent.id, "parent-turn");
    const children = service.store.tasks("group-1").filter((item) => item.parentTaskId === parent.id);
    await begin(required(children[0]).id, "child-turn-b");
    await begin(required(children[1]).id, "child-turn-c");
    expect(service.store.tasks("group-1").filter((item) => item.state === "running")).toHaveLength(2);
    await service.tool("group-1", "agent-b", "child-turn-b", "result-b", "group_result", { text: "Findings B" });
    await service.tool("group-1", "agent-b", "child-turn-b", "result-b", "group_result", { text: "Findings B" });
    await finish(required(children[0]).id, "child-turn-b");
    expect(service.store.tasks("group-1").find((item) => item.id === parent.id)?.state).toBe("waiting");
    await service.tool("group-1", "agent-c", "child-turn-c", "result-c", "group_result", { text: "Findings C" });
    await finish(required(children[1]).id, "child-turn-c");
    const resumed = await begin(parent.id, "parent-result-turn");
    expect(resumed.execution?.text).toContain("Findings B");
    expect(resumed.execution?.text).toContain("Findings C");
    await finish(parent.id, "parent-result-turn");
    expect(service.store.tasks("group-1").find((item) => item.id === parent.id)?.state).toBe("completed");
    expect(service.store.messages("group-1").filter((item) => item.message.text === "Findings B")).toHaveLength(1);
    expect(service.store.assignments("group-1").filter((item) => item.taskId === parent.id)).toHaveLength(2);
  });

  it("accepts a correction before completing its turn and keeps earlier output superseded", async () => {
    const task = await send("Prepare the report");
    const assignment = required(service.store.assignments("group-1")[0]);
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
      expect(service.store.tasks("group-1").find((item) => item.id === task.id)?.state).toBe("queued");
      return "accepted";
    };
    await service.command(
      {
        type: "send",
        groupId: "group-1",
        operationId: operationId(),
        text: "Actually use the revised figures",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    expect(service.store.tasks("group-1")[0]).toMatchObject({
      id: task.id,
      state: "completed",
      revision: 1,
      instruction: "Actually use the revised figures",
    });
    expect(service.store.messages("group-1").find((item) => item.id === "partial")?.superseded).toBe(true);
    expect(service.store.assignments("group-1")).toHaveLength(1);
  });

  it("pauses work before a pending correction returns and ignores its late acceptance", async () => {
    const task = await send("Write the report");
    const assignment = required(service.store.assignments("group-1")[0]);
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
        groupId: "group-1",
        text: "Actually use new figures",
        recipientAgentId: null,
        replyToMessageId: task.requestMessageId,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(steer).toHaveBeenCalled());
    const stopping = service.command(
      { type: "stop", operationId: operationId(), groupId: "group-1", taskId: task.id, recipientAgentId: null },
      actor,
    );
    try {
      await vi.waitFor(() => expect(service.store.tasks("group-1")[0]?.state).toBe("paused"));
    } finally {
      resolve("accepted");
      await Promise.all([correcting, stopping]);
    }
    expect(service.store.tasks("group-1")[0]).toMatchObject({ state: "paused", revision: 2 });
    expect(service.store.assignments("group-1")[0]?.taskRevision).toBe(0);
  });
  it("does not repeat an unconfirmed correction after restart", async () => {
    const task = await send("Write the report");
    const assignment = required(service.store.assignments("group-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    await service.prepare(required(data.mailbox.getDelivery(deliveryId)));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "turn-before-restart");
    service.accepted(deliveryId, "session-before-restart", "turn-before-restart");
    service.store.update(service.store.get("group-1"), {
      tasks: [{ ...task, revision: 1, instruction: "Use new figures", state: "queued" }],
      assignments: [{ ...assignment, turnId: "turn-before-restart", state: "running", pendingRevision: 1 }],
    });
    await data.mailbox.markTerminal(deliveryId, "completed");
    await service.recover();
    expect(service.store.tasks("group-1")[0]).toMatchObject({
      state: "paused",
      revision: 1,
      instruction: "Use new figures",
    });
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
  });

  it("resumes an uncertain correction after the provider confirms termination", async () => {
    const task = await send("Write the report");
    const assignment = required(service.store.assignments("group-1")[0]);
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
        groupId: "group-1",
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
    expect(service.store.tasks("group-1")[0]?.state).toBe("paused");
    await service.command(
      { type: "resume", operationId: operationId(), groupId: "group-1", taskId: task.id, recipientAgentId: null },
      actor,
    );
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-a")).not.toBeNull());
    expect(service.store.assignments("group-1")).toHaveLength(2);
    expect(service.store.tasks("group-1")[0]).toMatchObject({ revision: 2, instruction: "Actually use new figures" });
  });
  it("retains full history while a late member receives the shared summary", async () => {
    const task = await send("Apply the shared decision");
    const messages: GroupMessage[] = Array.from({ length: 150 }, (_, index) => ({
      id: `history-${index}`,
      groupId: "group-1",
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
    service.store.update(service.store.get("group-1"), { messages });
    const model = vi.fn(async () => "DECISION_A applies. Source: history-0.");
    const history = new GroupHistory(service.store, model);
    const agents = data.store.list();
    const first = await history.prepare(task, required(agents[0]), required(agents[0]));
    const summary = service.store.summary("group-1");
    expect(summary.throughSequence).toBeGreaterThan(0);
    expect(summary.throughSequence).toBeLessThan(service.store.page("group-1").throughSequence);
    expect(first.text).toContain("DECISION_A applies");
    const late = await history.prepare(task, required(agents[1]), required(agents[0]));
    expect(late.text).toContain("DECISION_A applies");
    expect(late.text).toContain("Apply the shared decision");
    expect(service.store.messages("group-1")).toHaveLength(151);
    expect(late.text.length).toBeLessThanOrEqual(120_000);
  });

  it("transfers one owner and waits for the declared task dependency", async () => {
    const task = await send("Write the report");
    const assignment = required(service.store.assignments("group-1")[0]);
    const deliveryId = required(assignment.deliveryId);
    const execution = required(await service.prepare(required(data.mailbox.getDelivery(deliveryId))));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "transfer-turn");
    service.accepted(deliveryId, "transfer-session", "transfer-turn");
    await service.command(
      {
        type: "send",
        operationId: operationId(),
        groupId: "group-1",
        text: "Check the figures",
        recipientAgentId: "agent-b",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    const dependency = required(
      service.store.tasks("group-1").find((item) => item.instruction === "Check the figures"),
    );
    await service.tool("group-1", "agent-a", "transfer-turn", "transfer", "group_transfer", {
      recipientAgentId: "agent-b",
      task: "Finish the report",
      expectedResult: "The final report",
      sourceMessageIds: [task.requestMessageId],
      dependencies: [dependency.id],
      resources: ["none"],
    });
    expect(service.store.tasks("group-1").find((item) => item.id === task.id)).toMatchObject({
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
    expect(service.store.tasks("group-1").find((item) => item.id === task.id)?.state).toBe("queued");
  });
  it("waits for the previous turn to stop before reassignment", async () => {
    const task = await send("Prepare the report");
    const first = required(service.store.assignments("group-1")[0]);
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
        groupId: "group-1",
        operationId: operationId(),
        taskId: task.id,
        recipientAgentId: "agent-b",
      },
      actor,
    );
    await vi.waitFor(() => expect(service.hooks.interrupt).toHaveBeenCalled());
    service.wake();
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
    expect(service.store.assignments("group-1")).toHaveLength(1);
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
    expect(service.store.tasks("group-1")[0]?.ownerAgentId).toBe("agent-b");
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
  });

  it("pauses removed members and restores their transcript without restarting work", async () => {
    const task = await send("Keep the conversation");
    await service.command(
      {
        type: "save",
        groupId: "group-1",
        operationId: operationId(),
        draft: {
          ...draft,
          leadAgentId: "agent-b",
          members: draft.members.filter((member) => member.agentId !== "agent-a"),
        },
      },
      actor,
    );
    expect(service.store.tasks("group-1")[0]?.state).toBe("paused");
    expect(data.mailbox.nextQueued("agent-a")).toBeNull();
    await service.command({ type: "archive", groupId: "group-1", operationId: operationId() }, actor);
    await service.command({ type: "restore", groupId: "group-1", operationId: operationId() }, actor);
    expect(service.store.tasks("group-1")[0]?.state).toBe("paused");
    expect(service.store.messages("group-1")[0]?.message.text).toBe("Keep the conversation");
    expect(data.store.list()).toHaveLength(2);
    await service.command(
      {
        type: "reassign",
        groupId: "group-1",
        operationId: operationId(),
        taskId: task.id,
        recipientAgentId: "agent-b",
      },
      actor,
    );
    await vi.waitFor(() => expect(data.mailbox.nextQueued("agent-b")).not.toBeNull());
  });

  it("rejects dependency cycles and pauses the root at the automatic assignment limit", async () => {
    const task = await send("Coordinate the report");
    const first = required(service.store.assignments("group-1")[0]);
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
      service.tool("group-1", "agent-a", "parent-limit-turn", "cycle", "group_assign", {
        ...args,
        dependencies: [task.id],
      }),
    ).rejects.toThrow("Invalid task dependencies");
    await expect(
      service.tool("group-1", "agent-a", "parent-limit-turn", "duplicate-source", "group_assign", {
        ...args,
        sourceMessageIds: [task.requestMessageId, task.requestMessageId],
      }),
    ).rejects.toThrow("Invalid group task");
    expect(service.store.tasks("group-1")).toHaveLength(1);
    for (let index = 0; index < 8; index++)
      await service.tool("group-1", "agent-a", "parent-limit-turn", `child-${index}`, "group_assign", args);
    expect(service.store.tasks("group-1")).toHaveLength(9);
    await service.tool("group-1", "agent-a", "parent-limit-turn", "child-over-limit", "group_assign", args);
    expect(service.store.tasks("group-1")).toHaveLength(9);
    expect(service.store.tasks("group-1").every((item) => item.state === "paused")).toBe(true);
    expect(data.mailbox.nextQueued("agent-b")).toBeNull();
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
