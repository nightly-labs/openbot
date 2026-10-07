// @vitest-environment node
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AgentEvent, routineConversationEvent, routineRunConversationEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  callOpenBotTool,
  createTestService,
  expectOpenBotToolError,
  FakeAgentClient,
  firstInputText,
  inputRecords,
  notification,
  openBotToolPayload,
  protocolMessages,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
  waitForQueue,
} from "./agent-service-test-harness";
import { ChannelRoutineStore } from "./channel-routine-store";
import { ChannelStore } from "./channel-store";
import { runCauseEffect } from "./effect-boundary";
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

describe.sequential("AgentService: routines", () => {
  it("rearms the shared timer when restoring an archived channel routine", async () => {
    vi.useFakeTimers({
      now: new Date("2026-08-25T10:00:00.000Z"),
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const { store, mailbox } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    const channels = new ChannelStore(store.database);
    const channel = channels.create("channel-1", {
      name: "Project",
      title: "Release coordination",
      instructions: "Ship the project.",
      members: [{ agentId: agent.id }],
      leadAgentId: agent.id,
    });
    channels.commit("test.channel-create", { channel, messages: [], tasks: [], assignments: [] });
    channels.update({ ...channel, archived: true }, {}, "test.channel-archive");
    const routines = new ChannelRoutineStore(store.database);
    const routine = routines.create(
      {
        channelId: channel.id,
        name: "Hourly brief",
        instruction: "Prepare the brief.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    await runCauseEffect(service.initialize());

    await runCauseEffect(
      service.channels.command(
        { type: "restore", channelId: channel.id, operationId: "test.channel-restore" },
        { id: "member-1", name: "Alex" },
      ),
    );
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(service.listChannelRoutineRuns({ channelId: channel.id, routineId: routine.id, limit: 10 })).toEqual([
      expect.objectContaining({ kind: "scheduled", status: expect.any(String) }),
    ]);
  });

  it("does not add a scheduled run while the routine's previous run is unfinished", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      // Keep the first run's turn open, as a run that stalls during a sleep does.
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("hourly"));
    vi.useFakeTimers({ now: new Date("2026-08-25T10:00:00.000Z") });
    try {
      const routine = service.createRoutine({
        agentId: agent.id,
        name: "Check for updates",
        instruction: "Check for updates.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
      });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id })).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(45 * 60_000);
      expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id })).toEqual([
        expect.objectContaining({ kind: "scheduled", scheduledFor: "2026-08-25T10:15:00.000Z" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists routine lifecycle markers without adding unread or search results", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));

    const created = service.createRoutine({
      agentId: agent.id,
      name: "Morning brief",
      instruction: "Prepare the daily brief.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const updated = service.updateRoutine({
      agentId: agent.id,
      routineId: created.id,
      name: "Updated morning brief",
    });
    await runCauseEffect(service.deleteRoutine({ agentId: agent.id, routineId: created.id }));

    const conversation = await runCauseEffect(service.readConversation(agent.id));
    expect(conversation.messages.flatMap((message) => routineConversationEvent(message) ?? [])).toEqual([
      { action: "created", routineId: created.id, routineName: "Morning brief" },
      { action: "updated", routineId: updated.id, routineName: "Updated morning brief" },
      { action: "deleted", routineId: updated.id, routineName: "Updated morning brief" },
    ]);
    expect((await runCauseEffect(service.readConversationPageFor(agent.id, "member-1"))).readState?.unreadCount).toBe(
      0,
    );
    expect(service.searchConversationMessages("morning brief", agent.id).total).toBe(0);

    await runCauseEffect(service.stop());
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    expect(
      (await runCauseEffect(service.readConversation(agent.id))).messages.flatMap(
        (message) => routineConversationEvent(message) ?? [],
      ),
    ).toHaveLength(3);
  });

  it("keeps a started routine delivery running while its transition marker retries", async () => {
    const { store, mailbox } = stores(root);
    let client: FakeAgentClient | undefined;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        client = new FakeAgentClient(provider, "", false);
        return client;
      },
    });
    const emitted: AgentEvent[] = [];
    service.on("event", (event: AgentEvent) => emitted.push(event));
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Retry running marker",
      instruction: "Keep the provider turn active while marker persistence retries.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const appendConversationMessage = store.database.appendConversationMessage.bind(store.database);
    let rejectRunningMarker = true;
    vi.spyOn(store.database, "appendConversationMessage").mockImplementation((input) => {
      if (rejectRunningMarker && input.eventType === "routine.run-running") {
        rejectRunningMarker = false;
        throw new Error("running marker persistence failed");
      }
      return appendConversationMessage(input);
    });

    const run = await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await waitFor(() => {
      const currentRun = service?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })[0];
      return currentRun?.id === run.id && currentRun.status === "running";
    });

    expect(service.listQueue(agent.id).deliveries).toContainEqual(expect.objectContaining({ status: "running" }));
    expect(client?.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
    expect(emitted).toContainEqual(
      expect.objectContaining({ type: "error", code: "delivery_reconciliation_pending", agentId: agent.id }),
    );
    const runningMarkers = (await runCauseEffect(service.readConversation(agent.id))).messages.filter(
      (message) => routineRunConversationEvent(message)?.status === "running",
    );
    expect(runningMarkers).toHaveLength(1);
  });

  it("keeps routine approvals interactive while attention markers retry", async () => {
    const { store, mailbox } = stores(root);
    let client: FakeAgentClient | undefined;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        client = new FakeAgentClient(provider, "", false);
        return client;
      },
    });
    const emitted: AgentEvent[] = [];
    service.on("event", (event: AgentEvent) => emitted.push(event));
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Approval marker retry",
      instruction: "Request approval and continue after the response.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const run = await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await waitFor(() =>
      service
        ?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .some((candidate) => candidate.id === run.id && candidate.status === "running"),
    );
    const delivery = service.listQueue(agent.id).deliveries.find((candidate) => candidate.status === "running");
    const threadId = store.activeProviderSession(agent.id)?.externalSessionId;
    if (!delivery?.turnId || !client || !threadId) throw new Error("The routine turn did not start.");

    const appendConversationMessage = store.database.appendConversationMessage.bind(store.database);
    let rejectNeedsAttentionMarker = true;
    let rejectResumedRunningMarker = false;
    vi.spyOn(store.database, "appendConversationMessage").mockImplementation((input) => {
      if (rejectNeedsAttentionMarker && input.eventType === "routine.run-needs-attention") {
        rejectNeedsAttentionMarker = false;
        throw new Error("attention marker persistence failed");
      }
      if (rejectResumedRunningMarker && input.eventType === "routine.run-running") {
        rejectResumedRunningMarker = false;
        throw new Error("resumed marker persistence failed");
      }
      return appendConversationMessage(input);
    });

    client.emit("request", {
      id: "retry-routine-approval",
      method: "item/commandExecution/requestApproval",
      params: { threadId, turnId: delivery.turnId, command: "echo routine" },
    });

    await waitFor(() => emitted.some((event) => event.type === "approval"));
    await waitFor(() =>
      service
        ?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .some((candidate) => candidate.id === run.id && candidate.status === "needs-attention"),
    );
    expect(client.responses).toEqual([]);

    rejectResumedRunningMarker = true;
    await runCauseEffect(service.respondToApproval({ requestId: "retry-routine-approval", decision: "accept" }));
    expect(client.responses).toContainEqual(
      expect.objectContaining({ id: "retry-routine-approval", result: { decision: "accept" } }),
    );
    await waitFor(() =>
      service
        ?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .some((candidate) => candidate.id === run.id && candidate.status === "running"),
    );

    expect(
      emitted.filter(
        (event) =>
          event.type === "error" && event.code === "delivery_reconciliation_pending" && event.agentId === agent.id,
      ),
    ).toHaveLength(2);
    const transitions = (await runCauseEffect(service.readConversation(agent.id))).messages.flatMap(
      (message) => routineRunConversationEvent(message) ?? [],
    );
    expect(transitions.filter((event) => event.runId === run.id && event.status === "needs-attention")).toHaveLength(1);
    expect(transitions.filter((event) => event.runId === run.id && event.status === "running")).toHaveLength(2);
  });

  it("continues turn completion while a terminal routine marker retries", async () => {
    const { store, mailbox } = stores(root);
    let client: FakeAgentClient | undefined;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        client = new FakeAgentClient(provider, "", false);
        return client;
      },
    });
    const emitted: AgentEvent[] = [];
    service.on("event", (event: AgentEvent) => emitted.push(event));
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Retry terminal marker",
      instruction: "Continue queued work after terminal marker persistence retries.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const firstRun = await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await waitFor(() => {
      const deliveries = service?.listQueue(agent.id).deliveries ?? [];
      return (
        deliveries.some((delivery) => delivery.status === "running") &&
        deliveries.some((delivery) => delivery.status === "queued")
      );
    });
    const firstDelivery = service.listQueue(agent.id).deliveries.find((delivery) => delivery.status === "running");
    const threadId = store.activeProviderSession(agent.id)?.externalSessionId;
    if (!firstDelivery?.turnId || !client || !threadId) throw new Error("The first routine turn did not start.");
    const appendConversationMessage = store.database.appendConversationMessage.bind(store.database);
    let rejectTerminalMarker = true;
    vi.spyOn(store.database, "appendConversationMessage").mockImplementation((input) => {
      if (rejectTerminalMarker && input.eventType === "routine.run-succeeded") {
        rejectTerminalMarker = false;
        throw new Error("terminal marker persistence failed");
      }
      return appendConversationMessage(input);
    });

    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: firstDelivery.turnId, status: "completed" },
      }),
    );

    await waitFor(() =>
      emitted.some(
        (event) =>
          event.type === "turn-completed" && event.agentId === agent.id && event.turnId === firstDelivery.turnId,
      ),
    );
    await waitFor(() =>
      service
        ?.listQueue(agent.id)
        .deliveries.some((delivery) => delivery.id !== firstDelivery.id && delivery.status === "running"),
    );
    expect(
      service
        .listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .find((run) => run.id === firstRun.id),
    ).toMatchObject({ status: "succeeded" });
    expect(emitted).toContainEqual(
      expect.objectContaining({ type: "error", code: "delivery_reconciliation_pending", agentId: agent.id }),
    );
    const terminalMarkers = (await runCauseEffect(service.readConversation(agent.id))).messages.filter((message) => {
      const event = routineRunConversationEvent(message);
      return event?.runId === firstRun.id && event.status === "succeeded";
    });
    expect(terminalMarkers).toHaveLength(1);
  });

  it("persists a completed routine turn as terminal", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Queue health",
      instruction: "Check the current queue health.",
      active: true,
      timezone: "Europe/Warsaw",
      schedule: { kind: "daily", time: "09:00" },
    });

    await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await waitFor(() => service?.listQueue(agent.id).deliveries[0]?.status === "completed");

    const turnId = service.listQueue(agent.id).deliveries[0]?.turnId;
    if (!turnId) throw new Error("The completed routine turn did not start.");
    expect(
      store.database.connection
        .prepare("SELECT status, completed_at FROM projection_turns WHERE turn_id = ?")
        .get(turnId),
    ).toMatchObject({ status: "completed", completed_at: expect.any(String) });
    expect((await runCauseEffect(service.readConversation(agent.id))).activeTurnId).toBeNull();
    expect(
      (await runCauseEffect(service.readConversation(agent.id))).messages.flatMap(
        (message) => routineRunConversationEvent(message)?.status ?? [],
      ),
    ).toContain("succeeded");
  });

  it("sends a local script's payload with the routine and keeps it in the run for recovery", async () => {
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
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Build watcher",
      instruction: "Read the build result and tell me what failed.",
      active: false,
      timezone: "Europe/Warsaw",
      schedule: { kind: "daily", time: "09:00" },
    });
    const input = { agentId: agent.id, routineId: routine.id, payload: "build 42 failed: 3 tests" };

    await expect(runCauseEffect(service.runRoutineFromAutomation(input))).rejects.toThrow();
    await runCauseEffect(service.updateAgent({ agentId: agent.id, allowAutomation: true }));
    const run = await runCauseEffect(service.runRoutineFromAutomation(input));

    // `resumePendingRuns` sends the stored instruction again, so the payload survives a restart.
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 1 })[0]?.instruction).toContain(
      "build 42 failed: 3 tests",
    );
    await waitFor(() => clients.get("codex")?.requests.some((request) => request.method === "turn/start") === true);
    const prompt = firstInputText(
      clients.get("codex")?.requests.find((request) => request.method === "turn/start")?.params,
    );
    expect(prompt).toContain("Read the build result and tell me what failed.");
    expect(prompt).toContain("build 42 failed: 3 tests");
    expect(run.deliveryId).not.toBeNull();
  });

  it("lets an agent react to the current user message without replacing the user's reaction", async () => {
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
    await runCauseEffect(service.initialize());
    const receipt = await runCauseEffect(service.sendMessage({ agentId: "chief", text: "The launch is approved." }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = service.listQueue("chief").deliveries[0]?.turnId;
    const messageId = receipt.deliveries[0]?.id;
    if (!client || !threadId || !turnId || !messageId) throw new Error("The reaction test turn did not start.");

    await runCauseEffect(service.setMessageReaction({ agentId: "chief", messageId, emoji: "❤️" }));
    const first = await callOpenBotTool(client, threadId, "react_to_user_message", { emoji: "🎉" }, turnId);
    expect(openBotToolPayload(first.result)).toMatchObject({ status: "reacted", messageId, emoji: "🎉" });
    const second = await callOpenBotTool(client, threadId, "react_to_user_message", { emoji: "👨‍👩‍👧‍👦" }, turnId);
    expect(openBotToolPayload(second.result)).toMatchObject({ emoji: "👨‍👩‍👧‍👦" });

    const message = (await runCauseEffect(service.readConversation("chief"))).messages.find(
      (candidate) => candidate.id === messageId,
    );
    expect(message).toMatchObject({
      reaction: "❤️",
      reactions: [
        { emoji: "❤️", actor: { kind: "user" } },
        { emoji: "👨‍👩‍👧‍👦", actor: { kind: "agent", agentId: "chief" } },
      ],
    });
    await expectOpenBotToolError(
      client,
      threadId,
      "react_to_user_message",
      { emoji: "🎉🎉" },
      "exactly one complete Unicode emoji",
      turnId,
    );
  });

  it("rejects an agent reaction when the current turn was not started by the user", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(store.getOrCreate("research"));
    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "research" },
        recipientAgentIds: ["chief"],
        text: "Teammate update.",
      }),
    );
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
    await runCauseEffect(service.initialize());
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = service.listQueue("chief").deliveries[0]?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The teammate reaction test turn did not start.");
    await expectOpenBotToolError(
      client,
      threadId,
      "react_to_user_message",
      { emoji: "👍" },
      "Only the current user message",
      turnId,
    );
  });

  it("attaches an agent-created screenshot to the current user response", async () => {
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
    await runCauseEffect(service.initialize());
    const screenshotPath = join(store.sharedRoot, "desktop-screenshot.png");
    const screenshot = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    await writeFile(screenshotPath, screenshot);
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Send me a screenshot." }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = service.listQueue("chief").deliveries[0]?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The screenshot attachment turn did not start.");

    const result = await callOpenBotTool(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [screenshotPath] },
      turnId,
    );
    expect(openBotToolPayload(result.result)).toMatchObject({
      status: "attached",
      attachments: [{ name: "desktop-screenshot.png" }],
    });

    const message = (await runCauseEffect(service.readConversation("chief"))).messages.find(
      (candidate) => candidate.itemType === "agent_attachment" && candidate.turnId === turnId,
    );
    expect(message).toMatchObject({
      author: "assistant",
      status: "completed",
      text: "",
      attachments: [
        {
          name: "desktop-screenshot.png",
          kind: "image",
          mimeType: "image/png",
          previewKind: "image",
        },
      ],
    });
    expect(service.getRuntimeSnapshot().latestMessages).not.toContainEqual(
      expect.objectContaining({ id: message?.id }),
    );
    const managed = await runCauseEffect(mailbox.resolveAttachment(message?.attachments?.[0]?.id ?? ""));
    expect(managed?.path).not.toBe(screenshotPath);
    await expect(readFile(managed?.path ?? "")).resolves.toEqual(screenshot);

    const outsidePath = join(root, "outside.png");
    await writeFile(outsidePath, screenshot);
    await expectOpenBotToolError(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [outsidePath] },
      "inside this agent's workspace or the OpenBot shared directory",
      turnId,
    );
    const linkedPath = join(store.sharedRoot, "linked-outside.png");
    await symlink(outsidePath, linkedPath);
    await expectOpenBotToolError(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [linkedPath] },
      "inside this agent's workspace or the OpenBot shared directory",
      turnId,
    );
    await expectOpenBotToolError(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [screenshotPath, screenshotPath] },
      "Duplicate attachment paths are not allowed.",
      turnId,
    );

    const publishedPath = join(store.sharedRoot, "published-screenshot.png");
    await writeFile(publishedPath, screenshot);
    const publicationFailure = (event: AgentEvent) => {
      if (
        event.type === "conversation" &&
        event.snapshot.messages.some((candidate) =>
          candidate.attachments?.some((attachment) => attachment.name === "published-screenshot.png"),
        )
      ) {
        throw new Error("conversation listener failed");
      }
    };
    const publicationEvents: AgentEvent[] = [];
    const recordPublicationEvent = (event: AgentEvent) => publicationEvents.push(event);
    service.on("event", publicationFailure);
    service.on("event", recordPublicationEvent);
    const publicationCallId = "publication-failure-call";
    const publicationResult = await callOpenBotTool(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [publishedPath] },
      turnId,
      publicationCallId,
    );
    service.off("event", publicationFailure);
    service.off("event", recordPublicationEvent);
    expect(openBotToolPayload(publicationResult.result)).toMatchObject({
      status: "attached",
      attachments: [{ name: "published-screenshot.png" }],
    });
    expect(publicationEvents).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "conversation_publication_failed",
        message: "conversation listener failed",
      }),
    );
    const publishedMessage = (await runCauseEffect(service.readConversation("chief"))).messages.find((candidate) =>
      candidate.attachments?.some((attachment) => attachment.name === "published-screenshot.png"),
    );
    await expect(
      runCauseEffect(mailbox.resolveAttachment(publishedMessage?.attachments?.[0]?.id ?? "")),
    ).resolves.not.toBeNull();
  });

  it("shares one attachment operation between concurrent retries", async () => {
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
    await runCauseEffect(service.initialize());
    const screenshotPath = join(store.sharedRoot, "concurrent-screenshot.png");
    await writeFile(screenshotPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Send the screenshot once." }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = service.listQueue("chief").deliveries[0]?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The concurrent attachment turn did not start.");

    const originalStore = mailbox.stageGeneratedAttachments.bind(mailbox);
    let releaseStore: (() => void) | undefined;
    const storeGate = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    let markStoreStarted: (() => void) | undefined;
    const storeStarted = new Promise<void>((resolve) => {
      markStoreStarted = resolve;
    });
    const storage = vi.spyOn(mailbox, "stageGeneratedAttachments").mockImplementation((input) =>
      Effect.gen(function* () {
        markStoreStarted?.();
        yield* Effect.promise(() => storeGate);
        return yield* originalStore(input);
      }),
    );
    const callId = "concurrent-attachment-call";
    const first = callOpenBotTool(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [screenshotPath] },
      turnId,
      callId,
    );
    await storeStarted;
    const second = callOpenBotTool(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [screenshotPath] },
      turnId,
      callId,
    );
    let stopCompleted = false;
    const stopping = runCauseEffect(service.stop()).then(() => {
      stopCompleted = true;
    });
    await Promise.resolve();
    expect(stopCompleted).toBe(false);
    releaseStore?.();

    const [firstResult, secondResult] = await Promise.all([first, second, stopping]);
    expect(stopCompleted).toBe(true);
    expect(openBotToolPayload(firstResult.result)).toEqual(openBotToolPayload(secondResult.result));
    expect(storage).toHaveBeenCalledTimes(1);
    expect(
      (await runCauseEffect(service.readConversation("chief"))).messages.filter(
        (message) => message.itemType === "agent_attachment" && message.turnId === turnId,
      ),
    ).toHaveLength(1);
    await expect(runCauseEffect(mailbox.listExportAttachments())).resolves.toHaveLength(1);
  });

  it("keeps a visual reply that is saved while a response attachment reads its files", async () => {
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
    await runCauseEffect(service.initialize());
    const screenshotPath = join(store.sharedRoot, "parallel-screenshot.png");
    await writeFile(screenshotPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Show a chart and a screenshot." }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = service.listQueue("chief").deliveries[0]?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The parallel visual reply turn did not start.");

    const originalStore = mailbox.stageGeneratedAttachments.bind(mailbox);
    let releaseStore: (() => void) | undefined;
    const storeGate = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    let markStoreStarted: (() => void) | undefined;
    const storeStarted = new Promise<void>((resolve) => {
      markStoreStarted = resolve;
    });
    vi.spyOn(mailbox, "stageGeneratedAttachments").mockImplementation((input) =>
      Effect.gen(function* () {
        markStoreStarted?.();
        yield* Effect.promise(() => storeGate);
        return yield* originalStore(input);
      }),
    );
    const attaching = callOpenBotTool(
      client,
      threadId,
      "attach_files_to_response",
      { paths: [screenshotPath] },
      turnId,
      "parallel-attachment-call",
    );
    await storeStarted;
    const rendered = await callOpenBotTool(
      client,
      threadId,
      "html_render",
      { html: "<p>Chart</p>", title: "Chart" },
      turnId,
      "parallel-visual-call",
    );
    expect(openBotToolPayload(rendered.result)).toMatchObject({ status: "shown" });
    releaseStore?.();
    expect(openBotToolPayload((await attaching).result)).toMatchObject({ status: "attached" });

    // The saved rows, not the memory copy: the memory copy can keep a message that the database lost.
    const saved = store.database.readConversation(
      "chief",
      store.list().find((a) => a.id === "chief")?.threadId ?? null,
    );
    expect(saved.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemType: "agent_attachment" }),
        expect.objectContaining({ text: "Chart", itemType: expect.stringMatching(/^visual-reply:/) }),
      ]),
    );
  });

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
    await runCauseEffect(service.initialize());
    const screenshotPath = join(store.sharedRoot, "retry-screenshot.png");
    await writeFile(screenshotPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Send the screenshot safely." }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");

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
    expect((await runCauseEffect(service.readConversation("chief"))).messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ itemType: "agent_attachment", turnId })]),
    );
    await expect(runCauseEffect(mailbox.listExportAttachments())).resolves.toEqual([]);

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
    await expect(runCauseEffect(mailbox.listExportAttachments())).resolves.toHaveLength(1);
    expect(
      (await runCauseEffect(service.readConversation("chief"))).messages.filter(
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
    await runCauseEffect(service.initialize());
    await runCauseEffect(store.getOrCreate("design", "Design Studio", "Product design"));
    await runCauseEffect(
      store.updateAgent({
        agentId: "design",
        description: "Owns product interface and visual design.",
      }),
    );
    await runCauseEffect(store.getOrCreate("research", "Research", "Research partner"));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Ask the design agent." }));

    await waitForQueue(service, "design", (queue) => queue.deliveries.length === 1);
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
    await runCauseEffect(service.initialize());
    await runCauseEffect(store.getOrCreate("design", "Design Studio", "Product design"));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Tell design where the proposal is." }));

    await waitForQueue(service, "design", (queue) => queue.deliveries.length === 1);
    expect(service.listQueue("design").deliveries[0]).toMatchObject({ expectsReply: false });
  });

  it("reliably relays a completed teammate result back through a reply chain without loops", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "AUTO_WEATHER_RESULT";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(store.getOrCreate("sales-outbound"));

    const rootMessage = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "chief" },
        recipientAgentIds: ["sales-outbound"],
        text: "Check the weather.",
      }),
    );
    const clarification = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "sales-outbound" },
        recipientAgentIds: ["chief"],
        text: "Which city?",
        replyToMessageId: rootMessage.messageId,
      }),
    );
    const location = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "chief" },
        recipientAgentIds: ["sales-outbound"],
        text: "Kraków.",
        replyToMessageId: clarification.messageId,
      }),
    );

    await runCauseEffect(service.initialize());
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

    expect(await runCauseEffect(service.readConversation("chief"))).toMatchObject({
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
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(store.getOrCreate("sales-outbound"));

    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "chief" },
        recipientAgentIds: ["sales-outbound"],
        text: "The Berlin deck is in the shared folder.",
        expectsReply: false,
      }),
    );
    // A request behind the notice: its relayed result is the point after which the notice's own
    // turn is certainly finished, so an absent relay is a decision rather than a race.
    const request = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "chief" },
        recipientAgentIds: ["sales-outbound"],
        text: "Check the weather.",
      }),
    );

    await runCauseEffect(service.initialize());
    await waitForQueue(service, "chief", (queue) => queue.deliveries.length === 1);

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
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(store.getOrCreate("sales-outbound"));

    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "chief" },
        recipientAgentIds: ["sales-outbound"],
        text: "Check the weather.",
      }),
    );

    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    // The turn relays its result and sets the preview before it reports completion, so this wait
    // is the point after which an absent relay is a decision rather than a race.
    await waitFor(() => events.some((event) => event.type === "turn-completed" && event.agentId === "sales-outbound"));

    const snapshot = await runCauseEffect(service.readConversation("sales-outbound"));
    expect(snapshot.messages.filter((message) => message.author === "assistant")).toEqual([]);
    expect(service.listQueue("chief").deliveries).toEqual([]);
    expect(service.listAgents().find((agent) => agent.id === "sales-outbound")?.preview).not.toBe("∅");
  });

  it("reads the canonical SQLite conversation during an active stream", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "First turn" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    const firstTurnId = service.listQueue("chief").deliveries[0]?.turnId;
    if (!firstTurnId) throw new Error("First turn did not start.");
    await runCauseEffect(service.interrupt("chief", firstTurnId));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "interrupted");
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "New live turn" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[1]?.status === "running");
    const liveTurnId = service.listQueue("chief").deliveries[1]?.turnId;
    // The queue can report `running` before the streamed text reaches the conversation,
    // so a read right away can miss it. The flushed delta writes it to SQLite.
    await waitFor(() => events.some((event) => event.type === "conversation-delta" && event.turnId === liveTurnId));

    const snapshot = await runCauseEffect(service.readConversation("chief"));
    expect(snapshot.activeTurnId).toBe(liveTurnId);
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
    await runCauseEffect(service.initialize());

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Run exactly once" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
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
    await runCauseEffect(service.initialize());

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Run exactly once" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    const deliveryId = service.listQueue("chief").deliveries[0]?.id;

    // The fake answers `turn/start` on a delay, so a second completed turn is the
    // barrier proving the first turn's late start response was already written and
    // processed: both responses travel the same pipe, in order.
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Run once more" }));
    await waitFor(
      () => service?.listQueue("chief").deliveries.filter((entry) => entry.status === "completed").length === 2,
    );

    const delivery = service.listQueue("chief").deliveries.find((entry) => entry.id === deliveryId);
    if (!delivery?.turnId) throw new Error("The completed delivery did not have a turn.");
    expect((await runCauseEffect(service.readConversation("chief"))).activeTurnId).toBeNull();
    expect(
      store.database.connection
        .prepare("SELECT status, completed_at FROM projection_turns WHERE turn_id = ?")
        .get(delivery.turnId),
    ).toMatchObject({ status: "completed", completed_at: expect.any(String) });
  });
});
