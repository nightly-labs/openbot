// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  callOpenBotTool,
  createFakeClaude,
  createFakeGrok,
  createTestService,
  FakeAgentClient,
  inputRecords,
  notification,
  openBotToolPayload,
  protocolMessages,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { getString } from "./protocol";
import { SidebarLayoutStore } from "./sidebar-layout-store";

let root: string;
let logPath: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root, logPath } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: queue (3/3)", () => {
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

  it("renders a Codex image generation item and manages its saved image", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    const imagePath = join(root, "codex-image.png");
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "", false);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Create a mountain observatory." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake Codex turn did not start.");
    }
    const item = {
      id: "image-call-1",
      type: "image_generation_call",
      status: "in_progress",
      size: "1536x1024",
      aspect_ratio: "landscape",
    };
    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId: started.turnId,
        item,
      }),
    );
    await waitFor(async () =>
      (await service?.readConversation("chief"))?.messages.some(
        (message) => message.id === item.id && message.status === "streaming",
      ),
    );
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: started.turnId,
        item: {
          ...item,
          status: "completed",
          revised_prompt: "A mountain observatory at blue hour",
          saved_path: imagePath,
        },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: started.turnId, status: "completed" },
      }),
    );

    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === item.id,
      );
      return message?.status === "completed" && Boolean(message.attachments?.[0]);
    });
    const message = (await service.readConversation("chief")).messages.find((candidate) => candidate.id === item.id);
    expect(message).toMatchObject({
      itemType: "image_generation",
      imageGeneration: {
        prompt: "A mountain observatory at blue hour",
        resolution: "1536x1024",
        aspectRatio: "landscape",
      },
      attachments: [{ kind: "image", previewKind: "image" }],
    });
    await expect(mailbox.resolveAttachment(message?.attachments?.[0]?.id ?? "")).resolves.toMatchObject({
      mimeType: "image/png",
    });
  });

  it("falls back to Codex base64 image results without persisting the encoded payload", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "", false);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Make this image vivid." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake Codex turn did not start.");
    }
    const imageCall = { id: "image-call-base64", type: "image_generation_call" };
    client.emit("notification", notification("item/started", { threadId, turnId: started.turnId, item: imageCall }));
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: started.turnId,
        item: {
          ...imageCall,
          status: "completed",
          result: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
        },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: started.turnId, status: "completed" },
      }),
    );

    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === imageCall.id,
      );
      return message?.status === "completed" && Boolean(message.attachments?.[0]);
    });
    const message = (await service.readConversation("chief")).messages.find(
      (candidate) => candidate.id === imageCall.id,
    );
    expect(JSON.stringify(message)).not.toContain("iVBORw0KGgo");
    await expect(mailbox.resolveAttachment(message?.attachments?.[0]?.id ?? "")).resolves.toMatchObject({
      mimeType: "image/png",
    });
  });

  it("keeps failed and interrupted image generations visible in the conversation", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "", false);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Generate two atmospheric studies." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake Codex turn did not start.");
    }
    const failedCall = { id: "image-call-failed", type: "image_generation_call" };
    const interruptedCall = { id: "image-call-interrupted", type: "image_generation_call" };
    client.emit("notification", notification("item/started", { threadId, turnId: started.turnId, item: failedCall }));
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: started.turnId,
        item: {
          ...failedCall,
          status: "failed",
          failure: { message: "The image provider rejected the prompt." },
        },
      }),
    );
    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId: started.turnId,
        item: interruptedCall,
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: started.turnId, status: "interrupted" },
      }),
    );

    await waitFor(async () => {
      const messages = (await service?.readConversation("chief"))?.messages ?? [];
      return (
        messages.some(
          (message) =>
            message.id === failedCall.id &&
            message.status === "failed" &&
            message.imageGeneration?.error === "The image provider rejected the prompt.",
        ) && messages.some((message) => message.id === interruptedCall.id && message.status === "interrupted")
      );
    });
    const messages = (await service.readConversation("chief")).messages;
    expect(messages.find((message) => message.id === failedCall.id)?.imageGeneration?.prompt).toBe(
      "Generate two atmospheric studies.",
    );
    expect(messages.find((message) => message.id === interruptedCall.id)?.imageGeneration?.error).toBe(
      "Image generation was interrupted.",
    );
  });

  it("marks an active image generation interrupted before a late Codex result arrives", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "", false);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Generate a cinematic still." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake Codex turn did not start.");
    }
    const item = {
      id: "image-call-late-result",
      type: "image_generation_call",
      status: "in_progress",
      revised_prompt: "A cinematic still at blue hour",
    };
    client.emit("notification", notification("item/started", { threadId, turnId: started.turnId, item }));
    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === item.id,
      );
      return message?.status === "streaming";
    });

    await service.interrupt("chief", started.turnId);
    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === item.id,
      );
      return message?.status === "interrupted";
    });

    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: started.turnId,
        item: {
          ...item,
          status: "completed",
          result: Buffer.from("late-image").toString("base64"),
        },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: started.turnId, status: "interrupted" },
      }),
    );

    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === item.id,
      );
      return message?.status === "interrupted" && !message.attachments?.length;
    });
    const message = (await service.readConversation("chief")).messages.find((candidate) => candidate.id === item.id);
    expect(message?.imageGeneration?.error).toBe("Image generation was interrupted.");
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

  it("waits for active queue drains before shutdown completes", async () => {
    process.env.OPENBOT_FAKE_TURN_START_RESPONSE_DELAY = "100";
    const { service: agentService } = await startService(root);
    service = agentService;

    await service.sendMessage({ agentId: "chief", text: "Stop during startup" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "starting");
    await service.stop();

    expect(["failed", "interrupted"]).toContain(service.listQueue("chief").deliveries[0]?.status);
  });

  it("fans out an idempotent agent tool message with referenced files", async () => {
    process.env.OPENBOT_FAKE_AGENT_TOOL = "1";
    const notePath = join(root, "generated-note.txt");
    const imagePath = join(root, "generated-image.png");
    await Promise.all([
      writeFile(notePath, "OPENBOT_SHARED_FILE_OK\n"),
      writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    ]);
    process.env.OPENBOT_FAKE_AGENT_TOOL_PATHS = JSON.stringify([notePath, imagePath]);
    const { service: agentService, store, mailbox } = await startService(root);
    service = agentService;
    await Promise.all([store.getOrCreate("sales-outbound"), store.getOrCreate("inbox-manager")]);
    await service.sendMessage({ agentId: "chief", text: "Coordinate the team" });

    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.some((message) => message.id === "agent-tool-1" && message.result);
    });
    await waitFor(() => service?.listQueue("sales-outbound").deliveries.length === 1);
    await waitFor(() => service?.listQueue("inbox-manager").deliveries.length === 1);

    const sales = service.listQueue("sales-outbound").deliveries[0];
    const inbox = service.listQueue("inbox-manager").deliveries[0];
    expect(sales.messageId).toBe(inbox.messageId);
    expect(sales.sender).toEqual({ kind: "agent", agentId: "chief" });
    expect(sales.text).toBe("Please prepare your reports.");
    expect(sales.attachments.map((item) => item.name)).toEqual(["generated-note.txt", "generated-image.png"]);
    const managedNote = await mailbox.resolveAttachment(sales.attachments[0]?.id ?? "");
    const managedImage = await mailbox.resolveAttachment(sales.attachments[1]?.id ?? "");
    expect(managedNote?.path).not.toBe(notePath);
    expect(managedImage?.path).not.toBe(imagePath);
    await expect(readFile(managedNote?.path ?? "", "utf8")).resolves.toBe("OPENBOT_SHARED_FILE_OK\n");

    const chiefMessages = (await service.readConversation("chief")).messages;
    expect(chiefMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exchange: expect.objectContaining({ direction: "outgoing" }) }),
      ]),
    );
    expect(chiefMessages.findIndex((message) => message.exchange?.direction === "outgoing")).toBeLessThan(
      chiefMessages.findIndex((message) => message.author === "assistant"),
    );
    await waitFor(async () =>
      (await service?.readConversation("sales-outbound"))?.messages.some(
        (message) => message.exchange?.direction === "incoming",
      ),
    );
    expect((await service.readConversation("sales-outbound")).messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          senderAgentId: "chief",
          exchange: expect.objectContaining({ direction: "incoming" }),
        }),
      ]),
    );

    await waitFor(async () =>
      (await protocolMessages(logPath)).some(
        (message) => message.method === "turn/start" && getString(message.params, "cwd")?.endsWith("/sales-outbound"),
      ),
    );
    const starts = (await protocolMessages(logPath)).filter((message) => message.method === "turn/start");
    const salesStart = starts.find((message) => getString(message.params, "cwd")?.endsWith("/sales-outbound"));
    const salesInput = inputRecords(salesStart?.params);
    expect(getString(salesInput[0], "text")).toContain(
      "After completing the request, send a concise result back to Chief",
    );
    expect(getString(salesInput[0], "text")).toContain(`replyToMessageId "${sales.messageId}"`);
    expect(salesInput).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mention",
          name: "generated-note.txt",
          path: expect.stringContaining("generated-note.txt"),
        }),
        expect.objectContaining({
          type: "localImage",
          path: expect.stringContaining("generated-image.png"),
        }),
      ]),
    );
  });

  it.each<{ provider: AgentProvider; context: "assigned" | "unassigned" | "unavailable" | "rollback" }>([
    { provider: "codex", context: "assigned" },
    { provider: "claude", context: "assigned" },
    { provider: "grok", context: "assigned" },
    { provider: "codex", context: "unassigned" },
    { provider: "codex", context: "unavailable" },
    { provider: "codex", context: "rollback" },
  ])("preserves the caller's space for $provider with $context context", async ({ provider, context }) => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
    const { store, mailbox } = stores(root);
    const sidebarPath = join(root, "sidebar-layout.json");
    const sidebar = new SidebarLayoutStore(sidebarPath);
    await sidebar.initialize();
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      preferredProvider: provider,
      clientFactory: (selectedProvider) => {
        const client = new FakeAgentClient(selectedProvider);
        clients.set(selectedProvider, client);
        return client;
      },
      hostedSites: null,
      sidebarLayout: context === "unavailable" ? null : sidebar,
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({
      agentId: "chief",
      provider,
      model: provider === "codex" ? "gpt-5.6-luna" : provider === "claude" ? "claude-sonnet-5" : "grok-4.5",
    });
    const layout = await sidebar.mutate({ type: "create", name: "space1" }, new Set(["chief"]));
    const sectionId = layout.sections[0]?.id;
    if (!sectionId) throw new Error("The section was not created.");
    const inherits = context === "assigned" || context === "rollback";
    if (inherits) await sidebar.mutate({ type: "assign", agentId: "chief", sectionId }, new Set(["chief"]));
    const originalAssignments = sidebar.getSnapshot().agentAssignments;
    let publishedAssignments = originalAssignments;
    sidebar.on("changed", (next) => {
      publishedAssignments = next.agentAssignments;
    });
    await service.sendMessage({ agentId: "chief", text: "Create a research agent." });
    await waitFor(() => Boolean(store.activeProviderSession("chief")?.externalSessionId));
    const client = clients.get(provider);
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !threadId) throw new Error("The agent session did not start.");
    let createdAgentId = "";
    let assignmentAtEnqueue: string | null = null;
    const enqueue = mailbox.enqueue.bind(mailbox);
    vi.spyOn(mailbox, "enqueue").mockImplementationOnce(async (...args) => {
      createdAgentId = args[0].recipientAgentIds[0] ?? "";
      assignmentAtEnqueue = sidebar.getSnapshot().agentAssignments[createdAgentId] ?? null;
      if (context === "rollback") throw new Error("Queue write failed.");
      return enqueue(...args);
    });

    const result = await callOpenBotTool(client, threadId, "create_agent", {
      name: "Research Partner",
      description: "Find primary sources.",
      initialMessage: "Research train routes to Berlin.",
    });
    const restored = new SidebarLayoutStore(sidebarPath);
    await restored.initialize();
    const expectedAssignments =
      context === "assigned" ? { ...originalAssignments, [createdAgentId]: sectionId } : originalAssignments;
    expect({
      error: result.error?.message,
      assignmentAtEnqueue,
      assignments: sidebar.getSnapshot().agentAssignments,
      persistedAssignments: restored.getSnapshot().agentAssignments,
      publishedAssignments,
      created: service.listAgents().some((agent) => agent.id === createdAgentId),
      deliveries: service.listQueue(createdAgentId).deliveries.length,
    }).toEqual({
      error: context === "rollback" ? "Error: Queue write failed." : undefined,
      assignmentAtEnqueue: inherits ? sectionId : null,
      assignments: expectedAssignments,
      persistedAssignments: expectedAssignments,
      publishedAssignments: expectedAssignments,
      created: context !== "rollback",
      deliveries: context === "rollback" ? 0 : 1,
    });
  });

  it("creates and groups a persistent teammate from conversation and rejects invalid changes", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    const sidebarPath = join(root, "sidebar-layout.json");
    const sidebar = new SidebarLayoutStore(sidebarPath);
    await sidebar.initialize();
    const changes: unknown[] = [];
    sidebar.on("changed", (layout) => changes.push(layout));
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
      hostedSites: null,
      sidebarLayout: sidebar,
    });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Create a research teammate." });
    await waitFor(() => Boolean(store.activeProviderSession("chief")?.externalSessionId));
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !threadId) throw new Error("The agent session did not start.");
    const result = await callOpenBotTool(client, threadId, "create_agent", {
      name: "Research Partner",
      title: "Research",
      description: "Find primary sources.",
      initialMessage: "Research train routes to Berlin.",
      avatarSeed: "research-partner",
      avatarHue: 150,
    });
    expect(result.error).toBeUndefined();
    const created = openBotToolPayload(result.result);
    expect(created).toMatchObject({
      name: "Research Partner",
      title: "Research",
      description: "Find primary sources.",
      avatarSeed: "research-partner",
      avatarHue: 150,
    });
    const agentId = getString(created, "id");
    if (!agentId) throw new Error("The tool did not return the created agent id.");
    expect(service.listQueue(agentId).deliveries).toHaveLength(1);
    await service.setAvatar(agentId, {
      mimeType: "image/png",
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    expect(store.resolveAvatar(agentId)).not.toBeNull();
    const caller = service.listAgents().find((agent) => agent.id === "chief");
    if (!caller) throw new Error("Missing calling agent.");
    const avatarPath = join(caller.workspacePath, "custom-avatar.png");
    const avatarBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(avatarPath, avatarBytes);
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    const custom = await callOpenBotTool(client, threadId, "update_profile", {
      agentId,
      avatarPath: "custom-avatar.png",
    });
    expect(custom.error).toBeUndefined();
    const customUrl = service.listAgents().find((agent) => agent.id === agentId)?.avatarUrl;
    expect(customUrl).toBeTruthy();
    expect(openBotToolPayload(custom.result)).toMatchObject({ id: agentId, avatarUrl: customUrl });
    expect(await readFile(store.resolveAvatar(agentId)?.path ?? "")).toEqual(avatarBytes);
    expect(await readFile(avatarPath)).toEqual(avatarBytes);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agents-changed",
        agents: expect.arrayContaining([expect.objectContaining({ id: agentId, avatarUrl: customUrl })]),
      }),
    );
    const restoredAvatarStore = stores(root).store;
    await restoredAvatarStore.initialize();
    expect(restoredAvatarStore.list().find((agent) => agent.id === agentId)?.avatarUrl).toBe(customUrl);
    restoredAvatarStore.database.close();
    for (const fields of [
      { avatarPath: "missing.png" },
      { avatarPath, avatarHue: null },
      { avatarPath, avatarSeed: "new-seed" },
    ]) {
      const rejected = await callOpenBotTool(client, threadId, "update_profile", {
        agentId,
        name: "Must not change",
        ...fields,
      });
      expect(rejected.error).toBeDefined();
      expect(service.listAgents().find((agent) => agent.id === agentId)).toMatchObject({
        name: "Research Partner",
        avatarUrl: customUrl,
      });
    }
    const replaced = await callOpenBotTool(client, threadId, "update_profile", { agentId, avatarPath });
    expect(replaced.error).toBeUndefined();
    expect(service.listAgents().find((agent) => agent.id === agentId)?.avatarUrl).not.toBe(customUrl);
    const invalid = await callOpenBotTool(client, threadId, "update_profile", {
      agentId,
      name: "Invalid",
      avatarHue: 999,
    });
    expect(invalid.error).toBeDefined();
    expect(service.listAgents().find((agent) => agent.id === agentId)?.name).toBe("Research Partner");
    const invalidCreation = await callOpenBotTool(client, threadId, "create_agent", {
      name: "Invalid",
      description: "",
      initialMessage: " ",
    });
    expect(invalidCreation.error).toBeDefined();
    expect(service.listAgents().filter((agent) => agent.name === "Invalid")).toEqual([]);
    await callOpenBotTool(client, threadId, "update_profile", { agentId, avatarHue: null });
    expect(service.listAgents().find((agent) => agent.id === agentId)?.avatarUrl).toBeNull();
    expect(store.resolveAvatar(agentId)).toBeNull();
    const initialLayout = await callOpenBotTool(client, threadId, "list_sections", {});
    expect(openBotToolPayload(initialLayout.result)).toMatchObject({ sections: [], agentAssignments: {} });
    const grouped = await callOpenBotTool(client, threadId, "create_section", { name: "Research" });
    expect(grouped.error).toBeUndefined();
    const sectionId = sidebar.getSnapshot().sections[0]?.id;
    if (!sectionId) throw new Error("The section was not created.");
    const assigned = await callOpenBotTool(client, threadId, "assign_agent_section", { agentId, sectionId });
    expect(openBotToolPayload(assigned.result)).toMatchObject({ agentAssignments: { [agentId]: sectionId } });
    expect(changes.at(-1)).toMatchObject({ agentAssignments: { [agentId]: sectionId } });
    const renamed = await callOpenBotTool(client, threadId, "rename_section", { sectionId, name: "Travel" });
    expect(openBotToolPayload(renamed.result)).toMatchObject({ sections: [{ id: sectionId, name: "Travel" }] });
    const persistedSidebar = new SidebarLayoutStore(sidebarPath);
    await persistedSidebar.initialize();
    expect(persistedSidebar.getSnapshot()).toMatchObject({
      sections: [{ id: sectionId, name: "Travel" }],
      agentAssignments: { [agentId]: sectionId },
    });
    const beforeInvalid = sidebar.getSnapshot();
    for (const [tool, args] of [
      ["create_section", { name: " " }],
      ["create_section", { name: "Travel" }],
      ["assign_agent_section", { agentId: "missing-agent", sectionId }],
      ["assign_agent_section", { agentId, sectionId: "missing-section" }],
    ] as const) {
      const rejected = await callOpenBotTool(client, threadId, tool, args);
      expect(rejected.error).toBeDefined();
      expect(sidebar.getSnapshot()).toEqual(beforeInvalid);
    }
    const ungrouped = await callOpenBotTool(client, threadId, "assign_agent_section", { agentId, sectionId: null });
    expect(openBotToolPayload(ungrouped.result).agentAssignments).toEqual({});
    await callOpenBotTool(client, threadId, "assign_agent_section", { agentId, sectionId });
    const deleted = await callOpenBotTool(client, threadId, "delete_section", { sectionId });
    expect(openBotToolPayload(deleted.result).sections).toEqual([]);
    expect(openBotToolPayload(deleted.result).agentAssignments).toEqual({});
    expect(service.listAgents().some((agent) => agent.id === agentId)).toBe(true);
    await service.stop();
    service = null;
    const restored = stores(root);
    await restored.store.initialize();
    expect(restored.store.list().find((agent) => agent.id === agentId)).toMatchObject({
      name: "Research Partner",
      title: "Research",
      description: "Find primary sources.",
      avatarSeed: "research-partner",
      avatarHue: null,
    });
  });

  it("lists complete local profiles and updates a selected agent profile", async () => {
    process.env.OPENBOT_FAKE_AGENT_TOOL_CALLS = JSON.stringify([
      { tool: "list_agents", arguments: {} },
      {
        tool: "update_profile",
        arguments: {
          agentId: "design",
          name: "Design Studio",
          title: "Product design",
          description: "Owns product interface and visual design.",
          avatarSeed: "design-studio",
          avatarHue: 215,
        },
      },
    ]);
    const { service: agentService, store } = await startService(root);
    service = agentService;
    await store.getOrCreate("design", "Designer", "Design");
    await service.sendMessage({ agentId: "chief", text: "Update the design teammate." });

    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.some((message) => message.id === "agent-tool-configured-1" && message.result);
    });

    expect(await store.getOrCreate("design")).toMatchObject({
      name: "Design Studio",
      title: "Product design",
      description: "Owns product interface and visual design.",
      avatarSeed: "design-studio",
      avatarHue: 215,
    });
    const listResponse = (await protocolMessages(logPath)).find((message) => message.id === "agent-tool-configured-0");
    expect(JSON.stringify(listResponse?.result)).toContain('\\"title\\":\\"Design\\"');
    expect(JSON.stringify(listResponse?.result)).toContain('\\"description\\":\\"\\"');
  });
});
