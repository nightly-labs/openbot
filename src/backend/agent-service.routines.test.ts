import {
  type AgentEvent,
  isAgentEvent,
  routineConversationEvent,
  routineRunConversationEvent,
} from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  firstInputText,
  nextRoutinesChanged,
  notification,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { ChannelRoutineStore } from "./channel-routine-store";
import { ChannelStore } from "./channel-store";

let root: string;

let service: AgentService | null = null;

/**
 * What a stdio MCP server is launched with: this user's own `PATH`, then the configuration's pairs.
 * The `PATH` is what makes a command found through a login shell runnable outside a terminal.
 */

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: routines", () => {
  it("queues independent manual routine runs and renders routine metadata", async () => {
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
    const agent = await store.getOrCreate("chief");
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Queue health",
      instruction: "Check the current queue health.",
      active: true,
      timezone: "Europe/Warsaw",
      schedule: { kind: "daily", time: "09:00" },
    });

    await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await waitFor(() => service?.listQueue(agent.id).deliveries.some((delivery) => delivery.status === "running"));

    const queue = service.listQueue(agent.id);
    expect(queue.deliveries.map((delivery) => delivery.status)).toEqual(["running", "queued"]);
    expect(queue.deliveries.every((delivery) => delivery.sender.kind === "routine")).toBe(true);
    const conversation = await service.readConversation(agent.id);
    expect(conversation.messages.filter((message) => message.routine?.name === "Queue health")).toHaveLength(2);

    const running = queue.deliveries.find((delivery) => delivery.status === "running");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession(agent.id)?.externalSessionId;
    if (!running?.turnId || !client || !threadId) throw new Error("The routine turn did not start.");
    const routineInput = firstInputText(client.requests.find((request) => request.method === "turn/start")?.params);
    expect(routineInput).toContain("Execute one run of an existing OpenBot routine now.");
    expect(routineInput).toContain("Run type: manual Test run");
    expect(routineInput).toContain("Do not create, update, delete, list, or test routines during this run.");
    expect(routineInput).toContain("Report the action and result");
    expect(routineInput).toContain("Check the current queue health.");
    client.emit("request", {
      id: "routine-approval",
      method: "item/commandExecution/requestApproval",
      params: { threadId, turnId: running.turnId, command: "echo routine" },
    });
    await waitFor(() =>
      service
        ?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .some((run) => run.status === "needs-attention"),
    );
    expect(client.responses).toEqual([]);
    await service.respondToApproval({ requestId: "routine-approval", decision: "accept" });
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "running" })]),
    );
    expect(client.responses).toEqual([
      expect.objectContaining({ id: "routine-approval", result: { decision: "accept" } }),
    ]);

    const queued = queue.deliveries.find((delivery) => delivery.status === "queued");
    if (!queued) throw new Error("The second routine run was not queued.");
    await service.cancelQueuedMessage(agent.id, queued.id);
    expect(
      service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 }).map((run) => run.status),
    ).toEqual(expect.arrayContaining(["running", "cancelled"]));
    expect(client.requests.some((request) => request.method === "turn/start")).toBe(true);

    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: running.turnId, status: "failed" },
      }),
    );
    await waitFor(() =>
      service
        ?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .some((run) => run.status === "failed"),
    );
    const failedRuntime = service.getRuntimeSnapshot();
    expect(isAgentEvent({ type: "runtime-snapshot", snapshot: failedRuntime })).toBe(true);
    expect(failedRuntime.failedTurns).toEqual([{ agentId: agent.id, turnId: running.turnId }]);
    expect(failedRuntime.work).toEqual([
      expect.objectContaining({ id: running.id, agentId: agent.id, status: "failed", turnId: running.turnId }),
    ]);
    service.acknowledgeFailedTurn(agent.id, running.turnId);
    expect(service.getRuntimeSnapshot().failedTurns).toEqual([]);
    expect(service.getRuntimeSnapshot().work).toEqual([]);

    await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await waitFor(
      () => service?.listQueue(agent.id).deliveries.filter((delivery) => delivery.status === "running").length === 1,
    );
    const interruptedDelivery = service
      .listQueue(agent.id)
      .deliveries.find((delivery) => delivery.status === "running");
    if (!interruptedDelivery?.turnId) throw new Error("The interrupted routine turn did not start.");
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: interruptedDelivery.turnId, status: "interrupted" },
      }),
    );
    await waitFor(() =>
      service
        ?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })
        .some((run) => run.status === "interrupted"),
    );
    const transitionStatuses = (await service.readConversation(agent.id)).messages.flatMap(
      (message) => routineRunConversationEvent(message)?.status ?? [],
    );
    expect(transitionStatuses).toEqual(
      expect.arrayContaining(["running", "needs-attention", "cancelled", "failed", "interrupted"]),
    );
    expect(transitionStatuses.filter((status) => status === "running")).toHaveLength(3);
  });

  it("queues only the last missed run after sleep and does not duplicate it after restart", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    await service.initialize();
    const agent = await store.getOrCreate("chief");
    vi.useFakeTimers({ now: new Date("2026-08-25T11:07:00.000Z") });
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Quarter-hour check",
      instruction: "Check the current queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
    });
    store.database.connection
      .prepare("UPDATE projection_routine_triggers SET next_run_at = ? WHERE trigger_id = ?")
      .run("2026-08-25T10:15:00.000Z", routine.trigger.id);
    service.updateRoutine({ agentId: agent.id, routineId: routine.id, name: routine.name });
    const routineChanged = nextRoutinesChanged(service, agent.id);

    await vi.advanceTimersByTimeAsync(0);
    await routineChanged;

    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toEqual([
      expect.objectContaining({ kind: "scheduled", scheduledFor: "2026-08-25T11:00:00.000Z" }),
    ]);
    expect(service.listRoutines(agent.id)[0]?.trigger.nextRunAt).toBe("2026-08-25T11:15:00.000Z");

    await service.stop();
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    await service.initialize();

    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toHaveLength(1);
  });
  it("rearms the shared timer when restoring an archived channel routine", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-25T10:00:00.000Z") });
    const { store, mailbox } = stores(root);
    await store.initialize();
    await mailbox.initialize();
    const agent = await store.getOrCreate("chief");
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
    await service.initialize();

    await service.channels.command(
      { type: "restore", channelId: channel.id, operationId: "test.channel-restore" },
      { id: "member-1", name: "Alex" },
    );
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(service.listChannelRoutineRuns({ channelId: channel.id, routineId: routine.id, limit: 10 })).toEqual([
      expect.objectContaining({ kind: "scheduled", status: expect.any(String) }),
    ]);
  });

  it("persists routine lifecycle markers without adding unread or search results", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    const agent = await store.getOrCreate("chief");

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
    await service.deleteRoutine({ agentId: agent.id, routineId: created.id });

    const conversation = await service.readConversation(agent.id);
    expect(conversation.messages.flatMap((message) => routineConversationEvent(message) ?? [])).toEqual([
      { action: "created", routineId: created.id, routineName: "Morning brief" },
      { action: "updated", routineId: updated.id, routineName: "Updated morning brief" },
      { action: "deleted", routineId: updated.id, routineName: "Updated morning brief" },
    ]);
    expect((await service.readConversationPageFor(agent.id, "member-1")).readState?.unreadCount).toBe(0);
    expect(service.searchConversationMessages("morning brief", agent.id).total).toBe(0);

    await service.stop();
    service = createTestService({ store, mailbox });
    await service.initialize();
    expect(
      (await service.readConversation(agent.id)).messages.flatMap((message) => routineConversationEvent(message) ?? []),
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
    await service.initialize();
    const agent = await store.getOrCreate("chief");
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

    const run = await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await waitFor(() => {
      const currentRun = service?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })[0];
      return currentRun?.id === run.id && currentRun.status === "running";
    });

    expect(service.listQueue(agent.id).deliveries).toContainEqual(expect.objectContaining({ status: "running" }));
    expect(client?.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
    expect(emitted).toContainEqual(
      expect.objectContaining({ type: "error", code: "delivery_reconciliation_pending", agentId: agent.id }),
    );
    const runningMarkers = (await service.readConversation(agent.id)).messages.filter(
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
    await service.initialize();
    const agent = await store.getOrCreate("chief");
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Approval marker retry",
      instruction: "Request approval and continue after the response.",
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
    await service.respondToApproval({ requestId: "retry-routine-approval", decision: "accept" });
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
    const transitions = (await service.readConversation(agent.id)).messages.flatMap(
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
    await service.initialize();
    const agent = await store.getOrCreate("chief");
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Retry terminal marker",
      instruction: "Continue queued work after terminal marker persistence retries.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const firstRun = await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await service.testRoutine({ agentId: agent.id, routineId: routine.id });
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
    const terminalMarkers = (await service.readConversation(agent.id)).messages.filter((message) => {
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
    await service.initialize();
    const agent = await store.getOrCreate("chief");
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Queue health",
      instruction: "Check the current queue health.",
      active: true,
      timezone: "Europe/Warsaw",
      schedule: { kind: "daily", time: "09:00" },
    });

    await service.testRoutine({ agentId: agent.id, routineId: routine.id });
    await waitFor(() => service?.listQueue(agent.id).deliveries[0]?.status === "completed");

    const turnId = service.listQueue(agent.id).deliveries[0]?.turnId;
    if (!turnId) throw new Error("The completed routine turn did not start.");
    expect(
      store.database.connection
        .prepare("SELECT status, completed_at FROM projection_turns WHERE turn_id = ?")
        .get(turnId),
    ).toMatchObject({ status: "completed", completed_at: expect.any(String) });
    expect((await service.readConversation(agent.id)).activeTurnId).toBeNull();
    expect(
      (await service.readConversation(agent.id)).messages.flatMap(
        (message) => routineRunConversationEvent(message)?.status ?? [],
      ),
    ).toContain("succeeded");
  });
});
