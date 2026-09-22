// @vitest-environment node
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  callOpenBotTool,
  createTestService,
  FakeAgentClient,
  inputRecords,
  openBotToolPayload,
  protocolMessages,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { getString } from "./protocol";

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

describe.sequential("AgentService: routines (2/2)", () => {
  it("rolls back response attachments when conversation persistence fails and permits retry", async () => {
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
    await service.initialize();
    const screenshotPath = join(store.sharedRoot, "retry-screenshot.png");
    await writeFile(screenshotPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await service.sendMessage({ agentId: "chief", text: "Send the screenshot safely." });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = service.listQueue("chief").deliveries[0]?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The attachment rollback turn did not start.");

    const callId = "stable-attachment-call";
    const persistence = vi.spyOn(mailbox, "persistGeneratedAttachmentsWithConversation").mockImplementationOnce(() => {
      throw new Error("conversation write failed");
    });
    const failed = await callOpenBotTool(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [screenshotPath] },
      turnId,
      callId,
    );
    expect(failed.error?.message).toContain("conversation write failed");
    expect((await service.readConversation("chief")).messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ itemType: "agent_attachment", turnId })]),
    );
    await expect(mailbox.listExportAttachments()).resolves.toEqual([]);

    persistence.mockRestore();
    const retried = await callOpenBotTool(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [screenshotPath] },
      turnId,
      callId,
    );
    expect(openBotToolPayload(retried.result)).toMatchObject({
      status: "attached",
      attachments: [{ name: "retry-screenshot.png" }],
    });
    await expect(mailbox.listExportAttachments()).resolves.toHaveLength(1);
    expect(
      (await service.readConversation("chief")).messages.filter(
        (message) => message.itemType === "agent_attachment" && message.turnId === turnId,
      ),
    ).toHaveLength(1);
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

  it("reads the canonical SQLite conversation during an active stream", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "First turn" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    const firstTurnId = service.listQueue("chief").deliveries[0]?.turnId;
    if (!firstTurnId) throw new Error("First turn did not start.");
    await service.interrupt("chief", firstTurnId);
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "interrupted");
    await service.sendMessage({ agentId: "chief", text: "New live turn" });
    await waitFor(() => service?.listQueue("chief").deliveries[1]?.status === "running");

    const snapshot = await service.readConversation("chief");
    expect(snapshot.activeTurnId).toBe(service.listQueue("chief").deliveries[1]?.turnId);
    expect(snapshot.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "Streaming", status: "streaming" })]),
    );
    expect((await protocolMessages(logPath)).filter((message) => message.method === "thread/read")).toHaveLength(0);
  });

  it("does not fail or replay a turn whose start response times out after lifecycle events", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "Finished despite the late response";
    // Auto-complete is 20ms. The RPC timeout has to land after that, and before
    // the delayed start response. 75ms vs 250ms loses that order when CI load
    // delays the fake CLI, and the wait then never sees completed.
    process.env.OPENBOT_FAKE_TURN_START_RESPONSE_DELAY = "1500";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox, requestTimeoutMs: 400 });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Run exactly once" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
    await waitFor(() => events.some((event) => event.type === "error" && event.code === "delivery_start_unconfirmed"));

    expect(service.listQueue("chief").deliveries[0]).toMatchObject({
      status: "completed",
      error: null,
    });
    expect((await protocolMessages(logPath)).filter((message) => message.method === "turn/start")).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "delivery_start_unconfirmed" }));
  });

  it("keeps a completed turn idle when its start response arrives after lifecycle events", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "Finished before the start response";
    process.env.OPENBOT_FAKE_TURN_START_RESPONSE_DELAY = "100";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Run exactly once" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
    const deliveryId = service.listQueue("chief").deliveries[0]?.id;

    // The fake answers `turn/start` on a delay, so a second completed turn is the
    // barrier proving the first turn's late start response was already written and
    // processed: both responses travel the same pipe, in order.
    await service.sendMessage({ agentId: "chief", text: "Run once more" });
    await waitFor(
      () => service?.listQueue("chief").deliveries.filter((entry) => entry.status === "completed").length === 2,
    );

    const delivery = service.listQueue("chief").deliveries.find((entry) => entry.id === deliveryId);
    if (!delivery?.turnId) throw new Error("The completed delivery did not have a turn.");
    expect((await service.readConversation("chief")).activeTurnId).toBeNull();
    expect(
      store.database.connection
        .prepare("SELECT status, completed_at FROM projection_turns WHERE turn_id = ?")
        .get(delivery.turnId),
    ).toMatchObject({ status: "completed", completed_at: expect.any(String) });
  });
});
