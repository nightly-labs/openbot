import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ChannelDraft, ChannelMessage, ChannelTask } from "@openbot/contracts/ipc";
import { validateProfileName } from "@openbot/contracts/validation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { ChannelHistory, type ChannelTextModel } from "./channel-history";
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
const busy = vi.fn((_agentId: string) => false);
const generate = vi.fn<ChannelTextModel>(async () => JSON.stringify({ agentId: "agent-a" }));
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
  busy.mockReset();
  busy.mockReturnValue(false);
  changed.mockClear();
  service = new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    generate,
    schedule,
    interrupt,
    busy,
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
  it("removes a member the deletion of its agent left behind, and still refuses a new one", async () => {
    // Both members are deleted agents. The draft the settings panel sends holds the other one.
    vi.spyOn(data.store, "list").mockReturnValue([]);
    await service.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: operationId(),
        draft: { ...draft, members: [{ agentId: "agent-b" }], leadAgentId: "agent-b" },
      },
      actor,
    );
    expect(service.store.get("channel-1").members).toEqual([{ agentId: "agent-b" }]);
    await expect(
      service.command(
        {
          type: "save",
          channelId: "channel-1",
          operationId: operationId(),
          draft: { ...draft, members: [{ agentId: "agent-b" }, { agentId: "agent-c" }], leadAgentId: "agent-b" },
        },
        actor,
      ),
    ).rejects.toThrow("A channel member is unavailable.");
  });
  it("summarizes a channel from the read cursor without reading its history", () => {
    const message = (id: string, author: ChannelMessage["author"]): ChannelMessage => ({
      id,
      channelId: "channel-1",
      sequence: 0,
      author,
      taskId: null,
      superseded: false,
      message: { id, author: "user", text: id, createdAt: new Date().toISOString(), status: "completed" },
    });
    const runningTask: ChannelTask = {
      id: "task-running",
      channelId: "channel-1",
      parentTaskId: null,
      rootTaskId: "task-running",
      requestMessageId: "mine",
      sourceMessageIds: [],
      instruction: "Write the brief.",
      expectedResult: "The brief is written.",
      ownerAgentId: "agent-a",
      state: "running",
      error: null,
      dependencies: [],
      resources: [],
      attachmentDraftIds: [],
      assignmentCount: 1,
      revision: 1,
    };
    service.store.update(service.store.get("channel-1"), {
      messages: [
        message("mine", { kind: "member", ...actor }),
        message("theirs", { kind: "agent", id: "agent-a", name: "A" }),
        message("theirs-again", { kind: "agent", id: "agent-a", name: "A" }),
      ],
      tasks: [runningTask, { ...runningTask, id: "task-queued", rootTaskId: "task-queued", state: "queued" }],
    });
    // The reader's own message is read where it is written, so only the two replies are unread.
    expect(service.store.list(actor.id)[0]).toMatchObject({ unreadCount: 2, activeTasks: 1 });
    service.store.markRead("channel-1", actor.id, 2, operationId());
    expect(service.store.list(actor.id)[0]).toMatchObject({ unreadCount: 1 });
    expect(service.store.list(actor.id)[0]?.lastMessage).toMatchObject({ text: "theirs-again" });
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
  it("assigns the only available member without a routing turn", async () => {
    // Membership alone is not eligibility: agent-b stays a member here, but no agent answers for
    // it, so there is one possible owner and nothing for the lead to decide.
    vi.spyOn(data.store, "list").mockReturnValue(data.store.list().filter((agent) => agent.id === "agent-a"));
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Prepare the report",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
    expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBe("agent-a");
    expect(generate).not.toHaveBeenCalled();
    expect(service.store.messages("channel-1")).toHaveLength(1);
  });
  it("gives a reply to a member message with no task to that member", async () => {
    service.store.update(service.store.get("channel-1"), {
      messages: [
        {
          id: "note",
          channelId: "channel-1",
          sequence: 0,
          author: { kind: "agent", id: "agent-b", name: "Agent B" },
          taskId: null,
          superseded: false,
          message: {
            id: "note",
            text: "I looked at the archive.",
            author: "system",
            createdAt: new Date().toISOString(),
            status: "completed",
          },
        },
      ],
    });
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Write that up",
        recipientAgentId: null,
        replyToMessageId: "note",
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
    expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBe("agent-b");
    expect(generate).not.toHaveBeenCalled();
  });
  it("posts the routing decision as one message from the lead", async () => {
    generate.mockResolvedValueOnce(JSON.stringify({ agentId: "agent-b" }));
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Someone please research this",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
    const task = required(service.store.tasks("channel-1")[0]);
    expect(task.ownerAgentId).toBe("agent-b");
    const dispatch = required(service.store.messages("channel-1").at(-1));
    expect(dispatch.author).toEqual({ kind: "agent", id: "agent-a", name: required(agent("agent-a")).name });
    expect(dispatch.taskId).toBe(task.id);
    expect(dispatch.message.text).toContain(required(agent("agent-b")).name);
    expect(service.store.messages("channel-1")).toHaveLength(2);
  });
  it("tells the renderer about the dispatch before the chosen member is free", async () => {
    // The owner is busy, so no assignment follows and nothing else publishes this channel. Without
    // its own publish the routing decision would sit in the database, invisible until the next
    // unrelated change.
    busy.mockImplementation((agentId) => agentId === "agent-b");
    generate.mockResolvedValueOnce(JSON.stringify({ agentId: "agent-b" }));
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Someone please research this",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.messages("channel-1")).toHaveLength(2));
    expect(service.store.assignments("channel-1")).toEqual([]);
    expect(changed).toHaveBeenLastCalledWith("channel-1", service.store.get("channel-1").revision);
  });
  it("writes no message when routing finds no work to do", async () => {
    generate.mockResolvedValueOnce(JSON.stringify({ idle: true }));
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Thanks all",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.tasks("channel-1")[0]?.state).toBe("completed"));
    expect(service.store.messages("channel-1")).toHaveLength(1);
    expect(service.store.assignments("channel-1")).toEqual([]);
  });
  it("routes a decision that arrives after a sentence of prose", async () => {
    generate.mockResolvedValueOnce('Agent B knows the archive.\n{"agentId":"agent-b"}');
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Someone please research this",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
    expect(service.store.tasks("channel-1")[0]?.ownerAgentId).toBe("agent-b");
  });
  it("routes from the channel summary instead of the message history", async () => {
    service.store.update(service.store.get("channel-1"), {
      messages: [
        {
          id: "old-note",
          channelId: "channel-1",
          sequence: 0,
          author: { kind: "agent", id: "agent-b", name: "Agent B" },
          taskId: null,
          superseded: false,
          message: {
            id: "old-note",
            text: "The archive migration finished last week.",
            author: "system",
            createdAt: new Date().toISOString(),
            status: "completed",
          },
        },
      ],
    });
    service.store.saveSummary("channel-1", {
      version: 1,
      throughSequence: required(service.store.messages("channel-1").at(-1)).sequence,
      text: "Earlier the team agreed the archive migration is done.",
    });
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Someone please research this",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    const prompt = required(generate.mock.calls[0])[1];
    expect(prompt).toContain("the team agreed the archive migration is done");
    expect(prompt).not.toContain("The archive migration finished last week.");
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

  it("summarizes a message larger than one summary input instead of blocking the channel", async () => {
    const task = await send("Apply the shared decision");
    // The command contract accepts 100000 characters, and half the context budget is the largest
    // input the summary takes, so one stored message can be larger than any single input.
    const messages: ChannelMessage[] = [
      {
        id: "history-huge",
        channelId: "channel-1",
        sequence: 0,
        author: { kind: "member", ...actor },
        taskId: task.id,
        superseded: false,
        message: {
          id: "history-huge",
          author: "user",
          text: `DECISION_A ${"detail ".repeat(12_000)}`,
          status: "completed",
          createdAt: "2026-09-07T12:00:00.000Z",
        },
      },
      {
        id: "history-short",
        channelId: "channel-1",
        sequence: 0,
        author: { kind: "member", ...actor },
        taskId: task.id,
        superseded: false,
        message: {
          id: "history-short",
          author: "user",
          text: "context",
          status: "completed",
          createdAt: "2026-09-07T12:00:01.000Z",
        },
      },
    ];
    service.store.update(service.store.get("channel-1"), { messages });
    const model = vi.fn<ChannelTextModel>(async () => "DECISION_A applies. Source: history-huge.");
    const history = new ChannelHistory(service.store, model, service.memories);
    const agents = data.store.list();
    const prepared = await history.prepare(task, required(agents[0]), required(agents[0]));
    expect(prepared.text).toContain("DECISION_A applies");
    expect(service.store.summary("channel-1").throughSequence).toBeGreaterThan(0);
    // Every part of the large message reaches the model, and each one fits the input it accepts.
    expect(model.mock.calls.length).toBeGreaterThan(1);
    for (const [, prompt] of model.mock.calls) expect(prompt.length).toBeLessThanOrEqual(120_000);
    // The message stays in the channel, so it is still available by its source ID.
    expect(service.store.messages("channel-1").some((message) => message.id === "history-huge")).toBe(true);
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
    // A routine the user removed before the channel keeps its instruction in the event log, and the
    // projection row that named its channel is already gone.
    const removedRoutine = routines.create({
      channelId: "channel-1",
      name: "Old cleanup check",
      instruction: "Read the private notes.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 30 },
    });
    routines.delete("channel-1", removedRoutine.id);
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
        .prepare("SELECT 1 FROM orchestration_events WHERE aggregate_type = 'channel-routine' AND aggregate_id = ?")
        .get(removedRoutine.id),
    ).toBeUndefined();
    expect(
      data.store.database.connection
        .prepare("SELECT 1 FROM projection_channel_routine_triggers WHERE routine_id = ?")
        .get(removedRoutine.id),
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

  it("starts the rest of a stopped run when one of its tasks is reassigned", async () => {
    const parent = await send("Prepare the report");
    const first = required(service.store.assignments("channel-1")[0]);
    const deliveryId = required(first.deliveryId);
    const execution = required(await service.prepare(required(data.mailbox.getDelivery(deliveryId))));
    await data.mailbox.markStarting(deliveryId);
    await data.mailbox.markRunning(deliveryId, "parent-stop-turn");
    service.accepted(deliveryId, "session-stop", "parent-stop-turn");
    await service.tool("channel-1", "agent-a", "parent-stop-turn", "child-1", "channel_assign", {
      recipientAgentId: "agent-b",
      task: "Research",
      expectedResult: "Findings",
      sourceMessageIds: [parent.requestMessageId],
    });
    await service.command(
      { type: "stop", channelId: "channel-1", operationId: operationId(), taskId: parent.id, recipientAgentId: null },
      actor,
    );
    expect(service.store.tasks("channel-1").every((item) => item.state === "paused")).toBe(true);
    await data.mailbox.markTerminal(deliveryId, "interrupted");
    service.event({
      type: "turn-completed",
      agentId: "agent-a",
      threadId: execution.threadId,
      turnId: "parent-stop-turn",
      status: "interrupted",
    });
    await service.command(
      {
        type: "reassign",
        channelId: "channel-1",
        operationId: operationId(),
        taskId: parent.id,
        recipientAgentId: "agent-b",
      },
      actor,
    );
    // The parent waits for the task it delegated, so the run moves only when the child starts again.
    const child = required(service.store.tasks("channel-1").find((item) => item.parentTaskId === parent.id));
    await vi.waitFor(() =>
      expect(service.store.assignments("channel-1").some((item) => item.taskId === child.id)).toBe(true),
    );
    expect(service.store.tasks("channel-1").find((item) => item.id === parent.id)?.ownerAgentId).toBe("agent-b");
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

  it("schedules the agents held behind a channel assignment stopped before it starts", async () => {
    const task = await send("Inspect project A");
    await data.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["agent-b"],
      text: "Draft the release note",
      idempotencyKey: "test:channel-hold:stopped-before-start",
    });
    expect(service.mayDrain("agent-b")).toBe(false);
    schedule.mockClear();
    await service.command(
      { type: "stop", channelId: "channel-1", operationId: operationId(), taskId: task.id, recipientAgentId: null },
      actor,
    );
    // The delivery never started, so cancelling it is the only thing left that can lift the
    // reservation it took. Without that, the held request waits for an unrelated trigger.
    expect(service.mayDrain("agent-b")).toBe(true);
    expect(schedule.mock.calls.map(([agentId]) => agentId)).toContain("agent-b");
  });

  it("schedules the agents held behind a channel assignment stopped while its delivery is prepared", async () => {
    let release!: () => void;
    const copy = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enqueue = data.mailbox.enqueue.bind(data.mailbox);
    vi.spyOn(data.mailbox, "enqueue").mockImplementation(async (input) => {
      if (input.channelId === "channel-1") await copy;
      return enqueue(input);
    });
    await service.command(
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
    );
    // The reservation is taken before the delivery is created, which is the state this test needs.
    await vi.waitFor(() => expect(service.store.assignments("channel-1")).toHaveLength(1));
    const task = required(service.store.tasks("channel-1")[0]);
    await data.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["agent-b"],
      text: "Draft the release note",
      idempotencyKey: "test:channel-hold:stopped-while-prepared",
    });
    expect(service.mayDrain("agent-b")).toBe(false);
    await service.command(
      { type: "stop", channelId: "channel-1", operationId: operationId(), taskId: task.id, recipientAgentId: null },
      actor,
    );
    schedule.mockClear();
    release();
    // The task changed while the delivery was prepared, so the assignment that reserved the host
    // is cancelled on arrival. It carries the agents that waited behind the reservation with it.
    await vi.waitFor(() => expect(schedule.mock.calls.map(([agentId]) => agentId)).toContain("agent-b"));
    expect(service.mayDrain("agent-b")).toBe(true);
  });

  it("keeps channel deliveries ahead of normal messages queued during attachment copying", async () => {
    await service.command(
      {
        type: "save",
        channelId: "channel-2",
        operationId: operationId(),
        draft: { ...draft, title: "Second channel" },
      },
      actor,
    );
    const firstFile = join(root, "first-brief.txt");
    const secondFile = join(root, "second-brief.txt");
    await writeFile(firstFile, "the first brief");
    await writeFile(secondFile, "the second brief");
    const firstAttachment = required((await data.mailbox.prepareAttachments([firstFile]))[0]);
    const secondAttachment = required((await data.mailbox.prepareAttachments([secondFile]))[0]);
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstCopy = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondCopy = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const enqueue = data.mailbox.enqueue.bind(data.mailbox);
    vi.spyOn(data.mailbox, "enqueue").mockImplementation(async (input) => {
      if (input.channelId === "channel-1") await firstCopy;
      if (input.channelId === "channel-2") await secondCopy;
      return enqueue(input);
    });

    const wake = vi.spyOn(service, "wake").mockImplementation(() => undefined);
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: `Compare the first brief ${serializeAttachmentReference(firstAttachment.name, firstAttachment.id)}`,
        recipientAgentId: "agent-a",
        replyToMessageId: null,
        attachmentDraftIds: [firstAttachment.id],
      },
      actor,
    );
    await service.command(
      {
        type: "send",
        channelId: "channel-2",
        operationId: operationId(),
        text: `Compare the second brief ${serializeAttachmentReference(secondAttachment.name, secondAttachment.id)}`,
        recipientAgentId: "agent-b",
        replyToMessageId: null,
        attachmentDraftIds: [secondAttachment.id],
      },
      actor,
    );
    const firstTask = required(service.store.tasks("channel-1")[0]);
    const secondTask = required(service.store.tasks("channel-2")[0]);
    // Independent resource reservations can be copied concurrently. Pause the pumps above so
    // the test can give these queued tasks their separate workspace reservations before dispatch.
    service.store.update(service.store.get("channel-1"), {
      tasks: [{ ...firstTask, resources: ["workspace:/first"] }],
    });
    service.store.update(service.store.get("channel-2"), {
      tasks: [{ ...secondTask, resources: ["workspace:/second"] }],
    });
    wake.mockRestore();
    service.wake("channel-1");
    service.wake("channel-2");
    await vi.waitFor(() => expect(service.store.assignments("channel-1")).toHaveLength(1));
    await vi.waitFor(() => expect(service.store.assignments("channel-2")).toHaveLength(1));
    await data.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["agent-a"],
      text: "Answer the first normal request",
      idempotencyKey: "test:channel-order:first-normal",
    });
    await data.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["agent-a"],
      text: "Answer the first follow-up",
      idempotencyKey: "test:channel-order:first-follow-up",
    });
    await data.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["agent-b"],
      text: "Answer the second normal request",
      idempotencyKey: "test:channel-order:second-normal",
    });
    await data.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["agent-b"],
      text: "Answer the second follow-up",
      idempotencyKey: "test:channel-order:second-follow-up",
    });

    expect(service.mayDrain("agent-a")).toBe(false);
    expect(service.mayDrain("agent-b")).toBe(false);

    releaseFirst();
    releaseSecond();
    await vi.waitFor(() => expect(service.store.assignments("channel-1")[0]?.deliveryId).not.toBeNull());
    await vi.waitFor(() => expect(service.store.assignments("channel-2")[0]?.deliveryId).not.toBeNull());
    await vi.waitFor(() =>
      expect(service.store.messages("channel-1")[0]?.message.attachments).toEqual([
        expect.objectContaining({ name: firstAttachment.name }),
      ]),
    );
    await vi.waitFor(() =>
      expect(service.store.messages("channel-2")[0]?.message.attachments).toEqual([
        expect.objectContaining({ name: secondAttachment.name }),
      ]),
    );
    const firstDeliveryId = required(service.store.assignments("channel-1")[0]?.deliveryId);
    const secondDeliveryId = required(service.store.assignments("channel-2")[0]?.deliveryId);
    await vi.waitFor(() => {
      const next = data.mailbox.nextQueued("agent-a");
      expect(next && service.store.assignmentForDelivery(next.delivery.id)?.id).toBe(
        service.store.assignments("channel-1")[0]?.id,
      );
    });
    await vi.waitFor(() => {
      const next = data.mailbox.nextQueued("agent-b");
      expect(next && service.store.assignmentForDelivery(next.delivery.id)?.id).toBe(
        service.store.assignments("channel-2")[0]?.id,
      );
    });
    // Once the channel deliveries finish, the normal messages that arrived during the copy are
    // still queued and can become the next work for each agent.
    await data.mailbox.cancel("agent-a", firstDeliveryId);
    service.deliveryFailed(firstDeliveryId, "The channel delivery failed.");
    await data.mailbox.cancel("agent-b", secondDeliveryId);
    service.deliveryFailed(secondDeliveryId, "The channel delivery failed.");
    expect(data.mailbox.nextQueued("agent-a")?.delivery.text).toBe("Answer the first normal request");
    expect(data.mailbox.nextQueued("agent-b")?.delivery.text).toBe("Answer the second normal request");
    expect(data.mailbox.listQueue("agent-a").deliveries.map((item) => item.text)).toEqual([
      "Answer the first normal request",
      "Answer the first follow-up",
    ]);
    expect(data.mailbox.listQueue("agent-b").deliveries.map((item) => item.text)).toEqual([
      "Answer the second normal request",
      "Answer the second follow-up",
    ]);
    expect(service.mayDrain("agent-a")).toBe(true);
    expect(service.mayDrain("agent-b")).toBe(true);
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
    // The send turns the draft into an attachment, so the reference in the request now names the
    // committed file.
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

  it("sends the files of a request that was still queued at a restart", async () => {
    const file = join(root, "brief.txt");
    await writeFile(file, "the brief");
    const attachment = required((await data.mailbox.prepareAttachments([file]))[0]);
    // No member is free, so the request waits. This is the normal state of a busy channel.
    busy.mockReturnValue(true);
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: `Prepare the report ${serializeAttachmentReference(attachment.name, attachment.id)}`,
        recipientAgentId: "agent-a",
        replyToMessageId: null,
        attachmentDraftIds: [attachment.id],
      },
      actor,
    );
    expect(service.store.assignments("channel-1")).toHaveLength(0);
    // The restart. It clears every draft and deletes the uploaded files, so only a copy the send
    // committed can still reach the member.
    await data.mailbox.initialize();
    busy.mockReturnValue(false);
    service.wake("channel-1");
    await vi.waitFor(() => expect(service.store.assignments("channel-1").some((item) => item.deliveryId)).toBe(true));
    const deliveryId = required(service.store.assignments("channel-1")[0]?.deliveryId);
    const delivery = required(data.mailbox.getDelivery(deliveryId)).delivery;
    expect(delivery.attachments.map((item) => item.name)).toEqual([attachment.name]);
    const request = required(service.store.messages("channel-1").find((item) => item.author.kind === "member")).message;
    const stored = required(await data.mailbox.resolveAttachment(required(request.attachments?.[0]).id));
    expect(await readFile(stored.path, "utf8")).toBe("the brief");
    // The reference in the text follows the file, or the member reads the name of a file it has no
    // way to open.
    expect(request.text).toContain(required(request.attachments?.[0]).id);
  });

  it("refuses a send that an archive overtakes while its files are copied", async () => {
    const file = join(root, "brief.txt");
    await writeFile(file, "the brief");
    const attachment = required((await data.mailbox.prepareAttachments([file]))[0]);
    let release!: () => void;
    const copying = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = data.mailbox.commitChannelAttachments.bind(data.mailbox);
    const copy = vi.spyOn(data.mailbox, "commitChannelAttachments").mockImplementation(async (input) => {
      await copying;
      return commit(input);
    });
    const sent = service.command(
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
    await vi.waitFor(() => expect(copy).toHaveBeenCalled());
    // Archive does not queue behind the other commands, so it lands inside the copy.
    await service.command({ type: "archive", channelId: "channel-1", operationId: operationId() }, actor);
    release();
    await expect(sent).rejects.toThrow("Restore this channel before sending messages or changing tasks.");
    // The send read the channel before the archive. Writing that read back would restore the
    // channel and start the work the reader stopped.
    expect(service.store.get("channel-1").archived).toBe(true);
    expect(service.store.messages("channel-1")).toHaveLength(0);
    expect(service.store.tasks("channel-1")).toHaveLength(0);
  });

  it("refuses a settings save that arrives after its channel is deleted", async () => {
    await service.deleteChannel("channel-1");
    await expect(
      service.command({ type: "save", channelId: "channel-1", operationId: operationId(), draft, update: true }, actor),
    ).rejects.toThrow("Channel not found.");
    expect(service.store.exists("channel-1")).toBe(false);
    // A save with no channel behind it is still how a channel is made.
    await service.command({ type: "save", channelId: "channel-2", operationId: operationId(), draft }, actor);
    expect(service.store.exists("channel-2")).toBe(true);
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

  it("reads back a message from a member whose account name is long", async () => {
    // An account name holds up to 20 visible characters in 120 UTF-16 units, so eight family emoji
    // are a name a person can have. The message is stored whatever the reader accepts, so a
    // narrower bound leaves a channel that no read can decode and a sidebar that cannot list it.
    const name = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}".repeat(8);
    expect(validateProfileName(name).error).toBeNull();
    expect(name.length).toBeGreaterThan(INPUT_LIMITS.agentName);
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Prepare the report",
        recipientAgentId: "agent-a",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      { id: "human-2", name },
    );

    expect(service.store.messages("channel-1").at(-1)?.author.name).toBe(name);
    expect(service.store.list("human-2").at(0)?.lastMessage?.authorName).toBe(name);
  });

  it("keeps a channel read when the reader signs in", async () => {
    await send("Draft the release note.");
    const through = service.store.page("channel-1").throughSequence;
    service.store.markRead("channel-1", "local", through, operationId());
    expect(required(service.store.list("local")[0]).unreadCount).toBe(0);

    service.store.adoptReads("local", "member-9");

    // `channelActor` answers `local` while no account is signed in and a member id after it. The
    // reader that signs in has read this channel, so nothing here is unread for it.
    expect(required(service.store.list("member-9")[0]).unreadCount).toBe(0);
  });

  it("leaves the read position a signed-in reader already holds", async () => {
    await send("Draft the release note.");
    const through = service.store.page("channel-1").throughSequence;
    service.store.markRead("channel-1", "local", through, operationId());
    service.store.markRead("channel-1", "member-9", 0, operationId());

    service.store.adoptReads("local", "member-9");

    // A reader with its own cursor keeps it. Adoption carries a position to a reader that has
    // none; it does not read messages on behalf of one that stayed behind.
    expect(required(service.store.list("member-9")[0]).unreadCount).toBe(through);
  });

  it("keeps a message the reader wrote before signing in out of the unread count", async () => {
    await service.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: operationId(),
        text: "Draft the release note.",
        recipientAgentId: "agent-a",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      { id: "local", name: "You" },
    );

    // The signed-in reader holds no cursor here, so only authorship can hold this message out of
    // the count. It carries the signed-out id, and that is the same person as the host member.
    expect(required(service.store.list("member-9", true)[0]).unreadCount).toBe(0);

    // A remote member is another person. The host wrote this message, so it is unread for them.
    expect(required(service.store.list("member-9")[0]).unreadCount).toBe(1);
  });

  it("carries every read channel to the reader that signs in", async () => {
    await service.command({ type: "save", channelId: "channel-2", operationId: operationId(), draft }, actor);
    await send("Draft the release note.");
    await service.command(
      {
        type: "send",
        channelId: "channel-2",
        operationId: operationId(),
        text: "Check the changelog.",
        recipientAgentId: "agent-a",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    for (const channelId of ["channel-1", "channel-2"]) {
      service.store.markRead(channelId, "local", service.store.page(channelId).throughSequence, operationId());
    }

    service.store.adoptReads("local", "member-9");

    // Each channel needs its own command, or the second adoption answers with the first receipt
    // and the reader that signs in sees a channel it has read as unread.
    expect(service.store.list("member-9").map((channel) => channel.unreadCount)).toEqual([0, 0]);
  });

  it("serializes overlapping workspaces and permits independent declared resources", () => {
    expect(resourcesConflict(["workspace:/work/project"], ["workspace:/work/project/src"])).toBe(true);
    expect(resourcesConflict(["browser"], ["browser"])).toBe(true);
    expect(resourcesConflict(["host"], ["none"])).toBe(true);
    expect(resourcesConflict(["workspace:/work/a"], ["workspace:/work/b"])).toBe(false);
  });
});

function agent(agentId: string) {
  return data.store.list().find((entry) => entry.id === agentId);
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("The expected test record is missing.");
  return value;
}
