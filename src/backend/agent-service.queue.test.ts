// @vitest-environment node
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  firstInputText,
  notification,
  paramsRecord,
  protocolMessages,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { MailboxStore } from "./mailbox-store";
import { SidebarLayoutStore } from "./sidebar-layout-store";

let root: string;

let logPath: string;

let service: AgentService | null = null;

/**
 * What a stdio MCP server is launched with: this user's own `PATH`, then the configuration's pairs.
 * The `PATH` is what makes a command found through a login shell runnable outside a terminal.
 */

beforeEach(async () => {
  ({ root, logPath } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: queue and channel work", () => {
  it("sends an edited delivery once after a repeated save and drains past a deleted hold", async () => {
    const { service: agentService, client, store, mailbox } = await startService(root, { provider: "codex" });
    service = agentService;
    await store.getOrCreate("chief");
    const first = await mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Original" });
    const deliveryId = first.deliveries[0].id;
    const editing = await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "phone-edit" });
    expect(editing.deliveries[0]).toMatchObject({ id: deliveryId, text: "Original" });
    // Every device keeps the row, marked as being edited, rather than watching it disappear.
    expect(service.listQueue("chief").deliveries).toMatchObject([{ id: deliveryId, editing: true, position: 1 }]);
    expect(mailbox.nextQueued("chief")).toBeNull();
    const save = {
      action: "save" as const,
      deliveryId,
      editId: "phone-edit",
      text: "Edited on phone",
      keepAttachmentIds: [],
      attachmentDraftIds: [],
    };
    await service.editQueuedMessage("chief", save);
    await service.editQueuedMessage("chief", save);
    await expect(service.editQueuedMessage("chief", { ...save, text: "Changed after lost response" })).rejects.toThrow(
      "different contents",
    );
    await expect(
      service.editQueuedMessage("chief", { ...save, keepAttachmentIds: ["different-file"] }),
    ).rejects.toThrow("different contents");
    const file = join(root, "retry-upload.txt");
    await writeFile(file, "New attachment after lost response");
    const [draft] = await mailbox.prepareImportedAttachments([file], []);
    await expect(service.editQueuedMessage("chief", { ...save, attachmentDraftIds: [draft.id] })).rejects.toThrow(
      "different contents",
    );
    await expect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Reuse", draftIds: [draft.id] }),
    ).rejects.toThrow("no longer exists");
    const restored = new MailboxStore(join(root, "user-data"), store.sharedRoot, store.database);
    await restored.initialize();
    expect(restored.matchesFinishedQueueSave("chief", deliveryId, save.editId, save.text, [], [])).toBe(true);
    expect(restored.matchesFinishedQueueSave("chief", deliveryId, save.editId, "Changed", [], [])).toBe(false);
    expect(restored.listQueue("chief").deliveries[0]).not.toHaveProperty("finishedEditOutcomes");

    await waitFor(() => mailbox.listQueue("chief").deliveries[0]?.status === "completed");
    const starts = client.requests.filter((request) => request.method === "turn/start");
    expect(starts).toHaveLength(1);
    expect(firstInputText(starts[0].params)).toContain("Edited on phone");
    const removed = await mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["chief"],
      text: "Never send this",
    });
    await service.editQueuedMessage("chief", {
      action: "begin",
      deliveryId: removed.deliveries[0].id,
      editId: "removed-edit",
    });
    const next = await mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Continue" });
    await service.cancelQueuedMessage("chief", removed.deliveries[0].id);
    // Deletion finishes the edit too: cancellation retries confirm, but Save cannot revive it.
    const cancelRemoved = { action: "cancel" as const, deliveryId: removed.deliveries[0].id, editId: "removed-edit" };
    await service.editQueuedMessage("chief", cancelRemoved);
    await service.editQueuedMessage("chief", cancelRemoved);
    await expect(
      service.editQueuedMessage("chief", {
        ...save,
        deliveryId: cancelRemoved.deliveryId,
        editId: cancelRemoved.editId,
      }),
    ).rejects.toThrow("cancelled");
    await waitFor(
      () =>
        mailbox.listQueue("chief").deliveries.find((item) => item.id === next.deliveries[0].id)?.status === "completed",
    );
    expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
    expect(mailbox.listQueue("chief").deliveries.find((item) => item.id === removed.deliveries[0].id)?.status).toBe(
      "cancelled",
    );
  });

  it("confirms an earlier save retry after another device saves the same message", async () => {
    const { store, mailbox } = stores(root);
    // The active turn never completes, so the edited message waits queued behind it.
    const client = new FakeAgentClient("codex", "CODEX_DONE", false);
    service = createTestService({ store, mailbox, clientFactory: () => client });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.sendMessage({ agentId: "chief", text: "Active task" });
    const first = await mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Original" });
    const deliveryId = first.deliveries[0].id;
    const saveA = {
      action: "save" as const,
      deliveryId,
      editId: "device-a-edit",
      text: "Edited on A",
      keepAttachmentIds: [],
      attachmentDraftIds: [],
    };
    await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "device-a-edit" });
    await service.editQueuedMessage("chief", saveA);
    // The message stays queued, so a second device edits and saves it again. That
    // must not forget the first save: its exact retry still confirms.
    await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "device-b-edit" });
    const saveB = { ...saveA, editId: "device-b-edit", text: "Edited on B" };
    await service.editQueuedMessage("chief", saveB);
    await service.editQueuedMessage("chief", saveA);
    // The retry confirms without re-applying superseded text over the newer save.
    const queued = service.listQueue("chief").deliveries.find((item) => item.id === deliveryId);
    expect(queued).toMatchObject({ text: "Edited on B" });
    // A cancel reports the recorded save instead of overwriting its outcome,
    // so the second device keeps its own confirmation.
    await expect(
      service.editQueuedMessage("chief", { action: "cancel", deliveryId, editId: "device-a-edit" }),
    ).rejects.toThrow("already saved");
    await service.editQueuedMessage("chief", saveB);
    const restored = new MailboxStore(join(root, "user-data"), store.sharedRoot, store.database);
    await restored.initialize();
    expect(restored.matchesFinishedQueueSave("chief", deliveryId, "device-a-edit", "Edited on A", [], [])).toBe(true);
    expect(restored.matchesFinishedQueueSave("chief", deliveryId, "device-b-edit", "Edited on B", [], [])).toBe(true);
  });

  it("rejects a save that repeats a finished cancellation and keeps the original message", async () => {
    const { service: agentService, client, store, mailbox } = await startService(root, { provider: "codex" });
    service = agentService;
    await store.getOrCreate("chief");
    const first = await mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Original" });
    const deliveryId = first.deliveries[0].id;
    await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "phone-edit" });
    await service.editQueuedMessage("chief", { action: "cancel", deliveryId, editId: "phone-edit" });
    const file = join(root, "late-upload.txt");
    await writeFile(file, "Late upload");
    const [draft] = await mailbox.prepareImportedAttachments([file], []);
    // A cancel whose response was lost leaves the editor open. The save that follows it
    // must report the rejection instead of success, so the client keeps the typed text.
    await expect(
      service.editQueuedMessage("chief", {
        action: "save",
        deliveryId,
        editId: "phone-edit",
        text: "Edited on phone",
        keepAttachmentIds: [],
        attachmentDraftIds: [draft.id],
      }),
    ).rejects.toThrow("cancelled");
    // The upload belonged to the finished edit, so the host keeps no orphan draft.
    await expect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Reuse", draftIds: [draft.id] }),
    ).rejects.toThrow("no longer exists");
    await waitFor(() => mailbox.listQueue("chief").deliveries[0]?.status === "completed");
    const starts = client.requests.filter((request) => request.method === "turn/start");
    expect(starts).toHaveLength(1);
    expect(firstInputText(starts[0].params)).toContain("Original");
  });

  it("keeps rapid messages in FIFO order before the first turn-start event is observed", async () => {
    const { service: agentService } = await startService(root);
    service = agentService;

    await service.sendMessage({ agentId: "chief", text: "Start immediately" });
    await service.sendMessage({ agentId: "chief", text: "Wait behind the first message" });

    await waitFor(() => {
      const deliveries = service?.listQueue("chief").deliveries ?? [];
      return deliveries[0]?.status === "running" && deliveries[1]?.status === "queued";
    });
    const deliveries = service.listQueue("chief").deliveries;
    expect(deliveries.map((delivery) => delivery.text)).toEqual(["Start immediately", "Wait behind the first message"]);
    expect((await protocolMessages(logPath)).filter((message) => message.method === "turn/start")).toHaveLength(1);
  });

  it("keeps each completed response after the queued message that started its turn", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Question 1" });
    await service.sendMessage({ agentId: "chief", text: "Question 2" });
    await service.sendMessage({ agentId: "chief", text: "Question 3" });
    await service.sendMessage({ agentId: "chief", text: "Question 4" });

    await waitFor(() => {
      const deliveries = service?.listQueue("chief").deliveries ?? [];
      return deliveries.length === 4 && deliveries.every((delivery) => delivery.status === "completed");
    });

    const conversation = await service.readConversation("chief");
    const turnMessages = conversation.messages.filter(
      (message) => message.author === "user" || message.author === "assistant",
    );
    expect(turnMessages).toHaveLength(8);
    for (let index = 0; index < turnMessages.length; index += 2) {
      expect(turnMessages[index]?.author).toBe("user");
      expect(turnMessages[index + 1]?.author).toBe("assistant");
      expect(turnMessages[index + 1]?.turnId).toBe(turnMessages[index]?.turnId);
      expect(turnMessages[index]?.delivery).toMatchObject({ status: "completed" });
    }
    expect(clients.get("codex")?.requests.filter((request) => request.method === "turn/start")).toHaveLength(4);

    // MailboxSync.emitQueue tells the renderer about every queue transition.
    const queueEvents = events.filter((event) => event.type === "queue-changed");
    expect(queueEvents.length).toBeGreaterThan(0);
    const lastQueue = queueEvents.at(-1);
    expect(lastQueue?.type).toBe("queue-changed");
    if (lastQueue?.type === "queue-changed") {
      expect(lastQueue.snapshot.deliveries).toHaveLength(4);
      expect(lastQueue.snapshot.deliveries.every((delivery) => delivery.status === "completed")).toBe(true);
    }

    // A finished turn is never published with a stale delivery: completeTurn
    // stamps the terminal status before anything renders the snapshot, so any
    // publication with no active turn shows terminal deliveries.
    for (const event of events) {
      if (event.type !== "conversation" || event.snapshot.activeTurnId !== null) continue;
      for (const message of event.snapshot.messages) {
        if (message.author !== "user" || !message.turnId) continue;
        expect(message.delivery?.status).toBe("completed");
      }
    }
  });

  it("queues FIFO instead of steering and continues draining after an interrupt", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Start" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const active = events.find((event) => event.type === "turn-started");
    if (active?.type !== "turn-started") throw new Error("Turn did not start.");
    await service.sendMessage({ agentId: "chief", text: "Run after the first task" });

    const queue = service.listQueue("chief");
    expect(queue.deliveries.map((item) => item.status)).toEqual(["running", "queued"]);
    expect((await protocolMessages(logPath)).some((message) => message.method === "turn/steer")).toBe(false);

    await service.interrupt("chief", active.turnId);
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "interrupted");

    await waitFor(
      async () => (await protocolMessages(logPath)).filter((item) => item.method === "turn/start").length === 2,
    );
    expect(service.listQueue("chief").deliveries[1]?.status).toBe("running");

    const conversationSignatures = events
      .filter((event) => event.type === "conversation" && event.snapshot.agentId === "chief")
      .map((event) =>
        event.type === "conversation"
          ? JSON.stringify({
              threadId: event.snapshot.threadId,
              activeTurnId: event.snapshot.activeTurnId,
              messages: event.snapshot.messages,
            })
          : "",
      );
    for (let index = 1; index < conversationSignatures.length; index += 1) {
      expect(conversationSignatures[index]).not.toBe(conversationSignatures[index - 1]);
    }
  });
  it("steers a queued delivery into the active turn and completes it with that turn", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "CODEX_DONE", false);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Start this turn" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const active = events.find((event) => event.type === "turn-started");
    if (active?.type !== "turn-started") throw new Error("Turn did not start.");
    await service.sendMessage({ agentId: "chief", text: "Add this to the active turn" });
    const queued = service.listQueue("chief").deliveries.find((delivery) => delivery.status === "queued");
    if (!queued) throw new Error("Queued delivery was not created.");

    await service.steerQueuedMessage({
      agentId: "chief",
      deliveryId: queued.id,
      expectedTurnId: active.turnId,
    });

    const client = clients.get("codex");
    expect(client?.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "turn/steer",
          params: expect.objectContaining({
            expectedTurnId: active.turnId,
            clientUserMessageId: queued.id,
          }),
        }),
      ]),
    );
    const externalThreadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !externalThreadId) throw new Error("Active provider session is missing.");
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId: externalThreadId,
        turn: { id: active.turnId, status: "completed" },
      }),
    );
    await waitFor(() =>
      service
        ?.listQueue("chief")
        .deliveries.filter((delivery) => delivery.id === queued.id)
        .every((delivery) => delivery.status === "completed"),
    );
  });

  it("reorders the queue the user reads while channel work waits in it", async () => {
    let failInstall: ((error: Error) => void) | undefined;
    const gate = new Promise<string>((_resolve, reject) => {
      failInstall = reject;
    });
    const {
      service: agentService,
      store,
      mailbox,
    } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, "", false),
      preferredProvider: "codex",
    });
    service = agentService;
    await store.getOrCreate("chief");
    // The CLI is being replaced, so every delivery that arrives now waits in the mailbox.
    let installing = false;
    const update = service.updateProviderCli("codex", () => {
      installing = true;
      return gate;
    });
    await waitFor(() => installing);

    const actor = { id: "human", name: "Alex" };
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: "chief" }],
          leadAgentId: "chief",
        },
      },
      actor,
    );
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: "send",
        text: "Work in the channel.",
        recipientAgentId: "chief",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await waitFor(() => service?.channels.store.assignments("channel-1").some((item) => item.deliveryId));
    await service.sendMessage({ agentId: "chief", text: "Read the report" });
    await service.sendMessage({ agentId: "chief", text: "Send the summary" });
    await waitFor(() => service?.listQueue("chief").deliveries.length === 2);

    // The queue the user reads holds the two normal messages alone, so the order it sends can name
    // no more than those two, while the mailbox still holds the channel delivery in the same queue.
    const queued = service.listQueue("chief").deliveries.map((delivery) => delivery.id);
    await service.reorderQueue({ agentId: "chief", deliveryIds: [queued[1] ?? "", queued[0] ?? ""] });

    // The queue reads in position order, which is what the reorder writes.
    const positions = service
      .listQueue("chief")
      .deliveries.toSorted((first, second) => (first.position ?? 0) - (second.position ?? 0));
    expect(positions.map((delivery) => delivery.id)).toEqual([queued[1], queued[0]]);
    // Channel work keeps the head of the queue: it reserved the agent before these messages.
    expect(mailbox.queuedDeliveryIds("chief")[0]).toBe(service.channels.store.assignments("channel-1")[0]?.deliveryId);

    failInstall?.(new Error("Runtime download failed."));
    await expect(update).rejects.toThrow(/Runtime download failed/u);
  });

  it("says which channel a message waits for, and runs it when that work ends", async () => {
    const { service: agentService, store, mailbox } = await startService(root);
    service = agentService;
    await store.getOrCreate("chief");

    const actor = { id: "human", name: "Alex" };
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "project",
          title: "Project launch",
          instructions: "Shared work",
          members: [{ agentId: "chief" }],
          leadAgentId: "chief",
        },
      },
      actor,
    );
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: "send",
        text: "Work in the channel.",
        recipientAgentId: "chief",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await waitFor(() => service?.channels.store.assignments("channel-1").some((item) => item.turnId));

    // The channel turn runs on its own thread, so nothing in this agent's own chat reports it.
    await service.sendMessage({ agentId: "chief", text: "Read the report" });
    await waitFor(() => service?.listQueue("chief").hold !== undefined);

    const held = service.listQueue("chief");
    expect(held.hold).toEqual({
      reason: "channel-task",
      channelId: "channel-1",
      channelName: "Project launch",
      agentId: "chief",
    });
    // Waiting, not failed: a message to a busy agent always queues.
    expect(held.deliveries.map((delivery) => delivery.status)).toEqual(["queued"]);

    const deliveryId = held.deliveries[0].id;
    await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "channel-wait-edit" });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));

    const turnId = service.channels.store.assignments("channel-1")[0]?.turnId ?? "";
    await service.interrupt("chief", turnId, service.channels.store.context("channel-1", "chief").threadId);

    await waitFor(() =>
      events.some(
        (event) => event.type === "queue-changed" && event.snapshot.agentId === "chief" && !event.snapshot.hold,
      ),
    );
    expect(service.listQueue("chief").deliveries).toMatchObject([{ id: deliveryId, editing: true }]);
    expect(mailbox.nextQueued("chief")).toBeNull();
    await service.editQueuedMessage("chief", { action: "cancel", deliveryId, editId: "channel-wait-edit" });

    await waitFor(() => {
      const queue = service?.listQueue("chief");
      return queue?.deliveries.some((delivery) => delivery.status === "running") === true;
    });
    expect(service.listQueue("chief").hold).toBeUndefined();
  });
  it("runs a channel turn in a separate session and returns to the unchanged normal conversation", async () => {
    const { service: agentService, store } = await startService(root, {
      provider: "codex",
      output: "CODEX_DONE",
      preferredProvider: "codex",
    });
    service = agentService;
    await service.sendMessage({ agentId: "chief", text: "This is my normal conversation." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const agent = service.listAgents().find((item) => item.id === "chief");
    if (!agent?.threadId) throw new Error("Normal conversation did not start.");
    const normalSession = store.activeProviderSession(agent.id)?.externalSessionId;
    const before = await service.readConversation(agent.id);
    const actor = { id: "human", name: "Alex" };
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: agent.id }],
          leadAgentId: agent.id,
        },
      },
      actor,
    );
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: "send",
        text: "Work only in this channel.",
        recipientAgentId: agent.id,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await waitFor(() => service?.channels.store.tasks("channel-1")[0]?.state === "completed");
    expect(
      service.channels.store
        .messages("channel-1")
        .filter((item) => item.author.kind === "agent")
        .map((item) => item.message.text),
    ).toEqual(["CODEX_DONE"]);
    expect((await service.readConversation(agent.id)).messages).toEqual(before.messages);
    expect(store.activeProviderSession(agent.id)?.externalSessionId).toBe(normalSession);
    expect(store.list().find((item) => item.id === agent.id)?.threadId).toBe(agent.threadId);
    const execution = service.channels.store.context("channel-1", agent.id);
    expect(store.database.activeProviderSession(execution.threadId, agent.provider)?.externalSessionId).not.toBe(
      normalSession,
    );
    await service.sendMessage({ agentId: agent.id, text: "Continue in the normal conversation." });
    await waitFor(() => service?.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"));
    expect(store.activeProviderSession(agent.id)?.externalSessionId).toBe(normalSession);
  });

  it("resumes a channel session after the profile or the memories of the agent change", async () => {
    const {
      service: agentService,
      client,
      store,
    } = await startService(root, {
      provider: "codex",
      output: "CODEX_DONE",
      preferredProvider: "codex",
    });
    service = agentService;
    await store.getOrCreate("chief");
    const actor = { id: "human", name: "Alex" };
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: "chief" }],
          leadAgentId: "chief",
        },
      },
      actor,
    );
    const ask = async (operationId: string, text: string, tasks: number): Promise<void> => {
      await service?.channels.command(
        {
          type: "send",
          channelId: "channel-1",
          operationId,
          text,
          recipientAgentId: "chief",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      );
      // The count is part of the wait: the request of this ask has to reach the channel before the
      // tasks of the ask before it can answer for it.
      await waitFor(() => {
        const open = service?.channels.store.tasks("channel-1") ?? [];
        return open.length === tasks && open.every((task) => task.state === "completed");
      });
    };
    await ask("first", "Start the shared work.", 1);
    const execution = service.channels.store.context("channel-1", "chief");
    const channelSession = store.database.activeProviderSession(execution.threadId, "codex")?.externalSessionId;
    if (!channelSession) throw new Error("The channel turn started no provider session.");
    const lastChannelResume = (): string =>
      JSON.stringify(
        client.requests
          .filter((request) => request.method === "thread/resume")
          .filter((request) => paramsRecord(request.params)?.threadId === channelSession)
          .at(-1)?.params ?? "no resume of the channel session",
      );

    // The developer instructions are written when the session loads, so a memory the agent saved
    // after that reaches the channel only when the next turn loads the session again.
    service.createMemory({ agentId: "chief", text: "The user prefers concise status updates." });
    await ask("second", "Continue the shared work.", 2);
    expect(lastChannelResume()).toContain("The user prefers concise status updates.");

    await service.updateAgent({ agentId: "chief", description: "Owns the quarterly report." });
    await ask("third", "Report on the shared work.", 3);
    expect(lastChannelResume()).toContain("Owns the quarterly report.");

    // The profile dialog saves through a second path, which holds the same standing instructions.
    const sidebar = new SidebarLayoutStore(join(root, "sidebar.json"));
    await sidebar.initialize();
    await service.saveProfile(
      {
        operationId: randomUUID(),
        agentId: "chief",
        draft: {
          name: "Chief",
          title: "Local teammate",
          description: "Runs the weekly review.",
          avatarSeed: "first-bot",
          avatarHue: null,
          sectionId: null,
        },
      },
      sidebar,
    );
    await ask("fourth", "Review the shared work.", 4);
    expect(lastChannelResume()).toContain("Runs the weekly review.");
  });

  it("waits for active queue drains before shutdown completes", async () => {
    process.env.OPENBOT_FAKE_TURN_START_RESPONSE_DELAY = "100";
    const { service: agentService } = await startService(root);
    service = agentService;

    await service.sendMessage({ agentId: "chief", text: "Stop during startup" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "starting");
    await service.stop();

    expect(["failed", "interrupted"]).toContain(service.listQueue("chief").deliveries[0]?.status);
  });
});
