// @vitest-environment node
import { type AgentEvent, routineConversationEvent, routineRunConversationEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  callOpenBotTool,
  createTestService,
  expectOpenBotToolError,
  expectOpenBotToolFailure,
  FakeAgentClient,
  openBotToolPayload,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("RoutineScheduler: routine mutations, runs and tools", () => {
  it("lets an agent manage routines for itself and another agent", async () => {
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
    await store.getOrCreate("design", "Design Studio", "Product design");
    await service.sendMessage({ agentId: "chief", text: "Manage our routines." });
    await waitFor(() => Boolean(store.activeProviderSession("chief")));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !threadId) throw new Error("The routine tool test thread did not start.");

    const ownCreate = await callOpenBotTool(client, threadId, "create_routine", {
      name: "Morning brief",
      instruction: "Prepare the daily brief.",
      schedule: { kind: "daily", time: "09:00" },
    });
    expect(ownCreate.error).toBeUndefined();
    const ownRoutine = openBotToolPayload(ownCreate.result);
    expect(ownRoutine).toMatchObject({
      agentId: "chief",
      name: "Morning brief",
      active: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });

    const otherCreate = await callOpenBotTool(client, threadId, "create_routine", {
      agentId: "design",
      name: "Weekly review",
      instruction: "Review the current design work.",
      active: false,
      timezone: "UTC",
      schedule: { kind: "weekly", weekday: 1, time: "10:30" },
    });
    expect(otherCreate.error).toBeUndefined();
    const otherRoutine = openBotToolPayload(otherCreate.result);
    expect(otherRoutine).toMatchObject({ agentId: "design", active: false, timezone: "UTC" });

    const listResult = await callOpenBotTool(client, threadId, "list_routines", { agentId: "design" });
    expect(openBotToolPayload(listResult.result).routines).toEqual([
      expect.objectContaining({ id: otherRoutine.id, name: "Weekly review" }),
    ]);

    const updated = await callOpenBotTool(client, threadId, "update_routine", {
      agentId: "design",
      routineId: otherRoutine.id,
      active: true,
      schedule: { kind: "weekdays", time: "08:15" },
    });
    expect(openBotToolPayload(updated.result)).toMatchObject({
      id: otherRoutine.id,
      active: true,
      trigger: { schedule: { kind: "weekdays", time: "08:15" } },
    });

    const testRun = await callOpenBotTool(client, threadId, "test_routine", {
      agentId: "design",
      routineId: otherRoutine.id,
    });
    expect(openBotToolPayload(testRun.result)).toMatchObject({
      routineId: otherRoutine.id,
      agentId: "design",
      kind: "manual",
      status: "queued",
    });

    const deleted = await callOpenBotTool(client, threadId, "delete_routine", { routineId: ownRoutine.id });
    expect(openBotToolPayload(deleted.result)).toEqual({
      deleted: true,
      agentId: "chief",
      routineId: ownRoutine.id,
    });
    expect(service.listRoutines("chief")).toEqual([]);
    expect(service.listRoutines("design")).toEqual([expect.objectContaining({ id: otherRoutine.id, active: true })]);
    const ownEvents = (await service.readConversation("chief")).messages.flatMap((message) => {
      const event = routineConversationEvent(message);
      return event ? [{ ...event, turnId: message.turnId }] : [];
    });
    expect(ownEvents).toEqual([
      expect.objectContaining({ action: "created", routineId: ownRoutine.id, turnId: expect.any(String) }),
      expect.objectContaining({ action: "deleted", routineId: ownRoutine.id, turnId: expect.any(String) }),
    ]);
    const otherEvents = (await service.readConversation("design")).messages.flatMap((message) => {
      const event = routineConversationEvent(message);
      return event ? [{ ...event, turnId: message.turnId }] : [];
    });
    expect(otherEvents).toEqual([
      expect.objectContaining({ action: "created", routineId: otherRoutine.id, turnId: undefined }),
      expect.objectContaining({ action: "updated", routineId: otherRoutine.id, turnId: undefined }),
    ]);
  });
  it("appends a cancellation marker before deleting an active routine run", async () => {
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
    await service.initialize();
    const agent = await store.getOrCreate("chief");
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Active routine",
      instruction: "Remain active until deletion.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const run = await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await waitFor(() =>
      service
        ?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .some((candidate) => candidate.id === run.id && candidate.status === "running"),
    );
    const runningDelivery = service.listQueue(agent.id).deliveries.find((delivery) => delivery.status === "running");
    if (!runningDelivery?.turnId || !client) throw new Error("The active routine turn did not start.");

    await service.deleteRoutine({ agentId: agent.id, routineId: routine.id });

    expect(client.requests).toContainEqual(
      expect.objectContaining({
        method: "turn/interrupt",
        params: expect.objectContaining({ turnId: runningDelivery.turnId }),
      }),
    );
    const events = (await service.readConversation(agent.id)).messages.flatMap(
      (message) => routineRunConversationEvent(message) ?? [],
    );
    expect(events).toContainEqual(
      expect.objectContaining({ routineId: routine.id, runId: run.id, status: "cancelled" }),
    );
  });
  it("rolls back a routine transition and retries without a duplicate marker", async () => {
    const { store, mailbox } = stores(root);
    const createService = () =>
      createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: (provider) => new FakeAgentClient(provider, "", false),
      });
    service = createService();
    await service.initialize();
    const agent = await store.getOrCreate("chief");
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Atomic run",
      instruction: "Keep run state and history together.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const runningRun = await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await waitFor(() =>
      service
        ?.listQueue(agent.id)
        .deliveries.some((delivery) => delivery.id === runningRun.deliveryId && delivery.status === "running"),
    );
    const queuedRun = await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    const queued = service.listQueue(agent.id).deliveries.find((delivery) => delivery.id === queuedRun.deliveryId);
    if (queued?.status !== "queued") throw new Error("The queued routine delivery is missing.");
    const appendConversationMessage = store.database.appendConversationMessage.bind(store.database);
    let rejectCancellationMarker = true;
    vi.spyOn(store.database, "appendConversationMessage").mockImplementation((input) => {
      if (rejectCancellationMarker && input.eventType === "routine.run-cancelled") {
        rejectCancellationMarker = false;
        throw new Error("transition marker persistence failed");
      }
      return appendConversationMessage(input);
    });

    await expect(service.cancelQueuedMessage(agent.id, queued.id)).rejects.toThrow(
      "transition marker persistence failed",
    );
    expect(
      service
        .listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .find((run) => run.deliveryId === queued.id),
    ).toMatchObject({ status: "queued" });
    const cancelledMarkers = async () =>
      (await service?.readConversation(agent.id))?.messages.filter((message) => {
        const event = routineRunConversationEvent(message);
        return event?.runId === queuedRun.id && event.status === "cancelled";
      }) ?? [];

    await service.stop();
    service = createService();
    await service.initialize();

    // The restarted service reconciles the cancelled delivery while it starts, so the marker is
    // waited for. It arrives with the run transition, in one transaction. The count stays a plain
    // assertion: the attempt that rolled back must leave no marker of its own behind.
    await waitFor(async () => (await cancelledMarkers()).length > 0);
    expect(
      service
        .listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .find((run) => run.deliveryId === queued.id),
    ).toMatchObject({ status: "cancelled" });
    expect(await cancelledMarkers()).toHaveLength(1);
  });
  it("rejects invalid or cross-agent routine tool mutations", async () => {
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
    const errors: AgentEvent[] = [];
    service.on("event", (event: AgentEvent) => {
      if (event.type === "error") errors.push(event);
    });
    await store.getOrCreate("design", "Design Studio", "Product design");
    await service.sendMessage({ agentId: "chief", text: "Validate routine requests." });
    await waitFor(() => Boolean(store.activeProviderSession("chief")));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !threadId) throw new Error("The routine validation test thread did not start.");

    await expectOpenBotToolFailure(client, threadId, "list_routines", { agentId: "missing" }, "Unknown agent");
    await expectOpenBotToolFailure(
      client,
      threadId,
      "create_routine",
      {
        name: "Invalid",
        instruction: "This must not be saved.",
        schedule: { kind: "daily", time: "25:00" },
      },
      "schedule is invalid",
    );
    await expectOpenBotToolFailure(
      client,
      threadId,
      "create_routine",
      {
        name: "Invalid active state",
        instruction: "This must not be saved.",
        active: null,
        schedule: { kind: "daily", time: "09:00" },
      },
      "active must be a boolean",
    );
    expect(service.listRoutines("chief")).toEqual([]);

    // The model corrects a refused request and retries; only the retry is saved.
    const retried = await callOpenBotTool(client, threadId, "create_routine", {
      name: "Morning summary",
      instruction: "Summarize the inbox.",
      schedule: { kind: "daily", time: "09:00" },
    });
    expect(openBotToolPayload(retried.result)).toMatchObject({ name: "Morning summary" });
    expect(service.listRoutines("chief").map((routine) => routine.name)).toEqual(["Morning summary"]);

    const routine = service.createRoutine({
      agentId: "chief",
      name: "Owned routine",
      instruction: "Remain owned by Chief.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    await expectOpenBotToolFailure(
      client,
      threadId,
      "update_routine",
      { routineId: routine.id },
      "At least one routine update is required",
    );
    await expectOpenBotToolFailure(
      client,
      threadId,
      "update_routine",
      { agentId: "design", routineId: routine.id, active: false },
      "routine no longer exists",
    );
    // A refused tool call is not a provider error toast.
    expect(errors).toEqual([]);

    // A fault is not a request the model can correct, so it still fails as a provider error.
    vi.spyOn(store.database, "persistConversation").mockImplementationOnce(() => {
      throw new Error("conversation persistence failed");
    });
    await expectOpenBotToolError(
      client,
      threadId,
      "create_routine",
      { name: "Faulted", instruction: "This must not be saved.", schedule: { kind: "daily", time: "09:00" } },
      "conversation persistence failed",
    );
    expect(service.listRoutines("chief").map((routine) => routine.name)).not.toContain("Faulted");
  });
  it("creates folder-listening routines with short polling and rejects intervals below 3 minutes", async () => {
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
    await service.sendMessage({ agentId: "chief", text: "Watch the inbox folder." });
    await waitFor(() => Boolean(store.activeProviderSession("chief")));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !threadId) throw new Error("The folder listening test thread did not start.");

    const folderInstruction =
      "Watch /Users/kamicyrek/Desktop/OpenBot/INBOX for new invoice files and create a notification for each new file.";
    const created = await callOpenBotTool(client, threadId, "create_routine", {
      name: "Inbox watcher",
      instruction: folderInstruction,
      schedule: { kind: "interval", amount: 5, unit: "minutes", anchorAt: new Date().toISOString() },
    });
    expect(created.error).toBeUndefined();
    const folderRoutine = openBotToolPayload(created.result);
    expect(folderRoutine).toMatchObject({
      name: "Inbox watcher",
      trigger: { schedule: { kind: "interval", amount: 5, unit: "minutes" } },
    });
    expect(folderRoutine.instruction).toContain("/Users/kamicyrek/Desktop/OpenBot/INBOX");

    await expectOpenBotToolFailure(
      client,
      threadId,
      "create_routine",
      {
        name: "Too frequent watcher",
        instruction: folderInstruction,
        schedule: { kind: "interval", amount: 2, unit: "minutes", anchorAt: new Date().toISOString() },
      },
      "at least 3 minutes",
    );
    await expectOpenBotToolFailure(
      client,
      threadId,
      "update_routine",
      {
        routineId: folderRoutine.id,
        schedule: { kind: "interval", amount: 1, unit: "minutes", anchorAt: new Date().toISOString() },
      },
      "at least 3 minutes",
    );
    // The failed updates must not drop the folder path or the monitoring instructions.
    expect(service?.listRoutines("chief").find((routine) => routine.id === folderRoutine.id)).toMatchObject({
      instruction: expect.stringContaining("/Users/kamicyrek/Desktop/OpenBot/INBOX"),
      trigger: { schedule: { kind: "interval", amount: 5, unit: "minutes" } },
    });
  });
  it("rolls back a routine mutation when its transcript marker cannot persist", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    const agent = await store.getOrCreate("chief");
    const initialAgent = store.list().find((candidate) => candidate.id === agent.id);
    vi.spyOn(store.database, "persistConversation").mockImplementationOnce(() => {
      throw new Error("conversation persistence failed");
    });

    expect(() =>
      service?.createRoutine({
        agentId: agent.id,
        name: "Atomic routine",
        instruction: "Do not persist half of this change.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "daily", time: "09:00" },
      }),
    ).toThrow("conversation persistence failed");
    expect(service.listRoutines(agent.id)).toEqual([]);
    expect((await service.readConversation(agent.id)).messages).toEqual([]);
    expect(store.list().find((candidate) => candidate.id === agent.id)).toMatchObject({
      threadId: initialAgent?.threadId ?? null,
      updatedAt: initialAgent?.updatedAt ?? null,
    });
  });
  it("restores queued routine work when a delete marker cannot persist", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    const agent = await store.getOrCreate("chief");
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Queued routine",
      instruction: "Keep this queued when deletion fails.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await waitFor(() => service?.listQueue(agent.id).deliveries.some((delivery) => delivery.status === "queued"));
    const queuedDelivery = service.listQueue(agent.id).deliveries.find((delivery) => delivery.status === "queued");
    if (!queuedDelivery) throw new Error("The queued routine delivery is missing.");
    const queuedRun = service
      .listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
      .find((run) => run.deliveryId === queuedDelivery.id);
    if (!queuedRun) throw new Error("The queued routine run is missing.");
    const persistConversation = store.database.persistConversation.bind(store.database);
    vi.spyOn(store.database, "persistConversation").mockImplementation((...args) => {
      if (args[1] === "routine.deleted") throw new Error("delete marker persistence failed");
      return persistConversation(...args);
    });

    await expect(service.deleteRoutine({ agentId: agent.id, routineId: routine.id })).rejects.toThrow(
      "delete marker persistence failed",
    );
    expect(service.listRoutines(agent.id)).toEqual([expect.objectContaining({ id: routine.id })]);
    const restoredDelivery = service
      .listQueue(agent.id)
      .deliveries.find((delivery) => delivery.id === queuedDelivery.id);
    expect(restoredDelivery).toBeDefined();
    expect(["queued", "starting", "running"]).toContain(restoredDelivery?.status);
    const restoredRun = service
      .listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
      .find((run) => run.id === queuedRun.id);
    expect(restoredRun).toBeDefined();
    expect(["queued", "running"]).toContain(restoredRun?.status);
    await waitFor(() =>
      service
        ?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .some((run) => run.status === "interrupted"),
    );
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "interrupted" })]),
    );
  });
});
