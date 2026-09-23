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

describe.sequential("AgentService: teammate messages", () => {
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

  it("sends a teammate request only to the selected profile match", async () => {
    process.env.OPENBOT_FAKE_AGENT_TOOL_CALLS = JSON.stringify([
      { tool: "list_agents", arguments: {} },
      {
        tool: "send_message",
        arguments: {
          recipientAgentIds: ["design"],
          text: "Please review the interface proposal.",
        },
      },
    ]);
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    await store.getOrCreate("design", "Design Studio", "Product design");
    await store.updateAgent({
      agentId: "design",
      description: "Owns product interface and visual design.",
    });
    await store.getOrCreate("research", "Research", "Research partner");
    await service.sendMessage({ agentId: "chief", text: "Ask the design agent." });

    await waitFor(() => service?.listQueue("design").deliveries.length === 1);
    expect(service.listQueue("research").deliveries).toHaveLength(0);
    expect(service.listQueue("design").deliveries[0]?.sender).toEqual({ kind: "agent", agentId: "chief" });
  });

  it("carries the sender's answer choice from the tool call onto the delivery", async () => {
    process.env.OPENBOT_FAKE_AGENT_TOOL_CALLS = JSON.stringify([
      {
        tool: "send_message",
        arguments: {
          recipientAgentIds: ["design"],
          text: "The interface proposal is in the shared folder.",
          expectsReply: false,
        },
      },
    ]);
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    await store.getOrCreate("design", "Design Studio", "Product design");
    await service.sendMessage({ agentId: "chief", text: "Tell design where the proposal is." });

    await waitFor(() => service?.listQueue("design").deliveries.length === 1);
    expect(service.listQueue("design").deliveries[0]).toMatchObject({ expectsReply: false });
  });

  it("reliably relays a completed teammate result back through a reply chain without loops", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "AUTO_WEATHER_RESULT";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await store.initialize();
    await mailbox.initialize();
    await store.getOrCreate("chief");
    await store.getOrCreate("sales-outbound");

    const rootMessage = await mailbox.enqueue({
      sender: { kind: "agent", agentId: "chief" },
      recipientAgentIds: ["sales-outbound"],
      text: "Check the weather.",
    });
    const clarification = await mailbox.enqueue({
      sender: { kind: "agent", agentId: "sales-outbound" },
      recipientAgentIds: ["chief"],
      text: "Which city?",
      replyToMessageId: rootMessage.messageId,
    });
    const location = await mailbox.enqueue({
      sender: { kind: "agent", agentId: "chief" },
      recipientAgentIds: ["sales-outbound"],
      text: "Kraków.",
      replyToMessageId: clarification.messageId,
    });

    await service.initialize();
    await waitFor(() =>
      service
        ?.listQueue("chief")
        .deliveries.some(
          (delivery) =>
            delivery.sender.kind === "agent" &&
            delivery.sender.agentId === "sales-outbound" &&
            delivery.replyToMessageId === location.messageId,
        ),
    );
    await waitFor(() =>
      (service?.listQueue("chief").deliveries ?? []).every((delivery) => delivery.status === "completed"),
    );

    expect(await service.readConversation("chief")).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          author: "agent",
          senderAgentId: "sales-outbound",
          text: "AUTO_WEATHER_RESULT",
          replyToMessageId: location.messageId,
        }),
      ]),
    });
    expect(service.listQueue("sales-outbound").deliveries).toHaveLength(2);
    expect(service.listQueue("chief").deliveries).toHaveLength(2);
  });

  it("sends nothing back for a teammate message that asks for no answer", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "AUTO_RESULT";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await store.initialize();
    await mailbox.initialize();
    await store.getOrCreate("chief");
    await store.getOrCreate("sales-outbound");

    await mailbox.enqueue({
      sender: { kind: "agent", agentId: "chief" },
      recipientAgentIds: ["sales-outbound"],
      text: "The Berlin deck is in the shared folder.",
      expectsReply: false,
    });
    // A request behind the notice: its relayed result is the point after which the notice's own
    // turn is certainly finished, so an absent relay is a decision rather than a race.
    const request = await mailbox.enqueue({
      sender: { kind: "agent", agentId: "chief" },
      recipientAgentIds: ["sales-outbound"],
      text: "Check the weather.",
    });

    await service.initialize();
    await waitFor(() => service?.listQueue("chief").deliveries.length === 1);

    expect(service.listQueue("chief").deliveries).toEqual([
      expect.objectContaining({
        sender: { kind: "agent", agentId: "sales-outbound" },
        replyToMessageId: request.messageId,
        text: "AUTO_RESULT",
        expectsReply: false,
      }),
    ]);
    const noticeStart = (await protocolMessages(logPath)).find(
      (message) =>
        message.method === "turn/start" &&
        inputRecords(message.params).some((item) => getString(item, "text")?.includes("The Berlin deck")),
    );
    expect(getString(inputRecords(noticeStart?.params)[0], "text")).toContain("The sender does not want an answer.");
  });

  it("drops a placeholder answer to a teammate request instead of showing and relaying it", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "∅";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await store.initialize();
    await mailbox.initialize();
    await store.getOrCreate("chief");
    await store.getOrCreate("sales-outbound");

    await mailbox.enqueue({
      sender: { kind: "agent", agentId: "chief" },
      recipientAgentIds: ["sales-outbound"],
      text: "Check the weather.",
    });

    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    // The turn relays its result and sets the preview before it reports completion, so this wait
    // is the point after which an absent relay is a decision rather than a race.
    await waitFor(() => events.some((event) => event.type === "turn-completed" && event.agentId === "sales-outbound"));

    const snapshot = await service.readConversation("sales-outbound");
    expect(snapshot.messages.filter((message) => message.author === "assistant")).toEqual([]);
    expect(service.listQueue("chief").deliveries).toEqual([]);
    expect(service.listAgents().find((agent) => agent.id === "sales-outbound")?.preview).not.toBe("∅");
  });
});
