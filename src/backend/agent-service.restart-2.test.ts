import { type AgentEvent, type BrowserTab, isAgentEvent, routineRunConversationEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  fakeBrowser,
  firstInputText,
  nextRoutinesChanged,
  notification,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";

const browserTab = (id: string, ownerAgentId: string | null, ownerThreadId: string | null): BrowserTab => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
  loading: false,
  ownerThreadId,
  ownerAgentId,
});

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: restart (2/2)", () => {
  it("deletes idle agents and refuses to orphan active work", async () => {
    const { store, mailbox } = stores(root);
    let revokeFails = true;
    const deleteWithRevokedApproval = vi.fn(async (_agentId: string, remove: () => Promise<void>) => {
      if (revokeFails) throw new Error("Approval revocation failed.");
      await remove();
    });
    service = createTestService({ store, mailbox, deleteWithRevokedApproval });
    await service.initialize();

    const deletedAgent = await store.getOrCreate("sales-outbound");
    store.ensureThreadIdNow(deletedAgent.id);
    store.database.recordPendingHostedSiteTerminalEvent({
      agentId: deletedAgent.id,
      threadId: "provider-thread-sales-outbound",
      turnId: "turn-delete-agent",
      operationId: "operation-delete-agent",
      action: "replace",
      status: "succeeded",
      details: {
        siteId: "site-delete-agent",
        title: "Deleted agent site",
        hostname: null,
        url: null,
      },
      markerCommandId: `hosted-site-event:${deletedAgent.id}:operation-delete-agent:succeeded`,
      createdAt: "2026-09-01T12:00:00.000Z",
    });
    expect(store.database.pendingHostedSiteTerminalEvents()).toHaveLength(1);
    await expect(service.deleteAgent("sales-outbound")).rejects.toThrow(
      "The agent data could not be removed completely.",
    );
    expect(service.listAgents().some((agent) => agent.id === "sales-outbound")).toBe(true);
    revokeFails = false;
    await service.deleteAgent("sales-outbound");
    await expect(service.deleteAgent("sales-outbound")).resolves.toBeUndefined();
    expect(service.listAgents().some((agent) => agent.id === "sales-outbound")).toBe(false);
    expect(store.database.pendingHostedSiteTerminalEvents()).toEqual([]);
    expect(
      store.database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM orchestration_events
           WHERE payload_json LIKE '%sales-outbound%'`,
        )
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      store.database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM orchestration_command_receipts
           WHERE command_id LIKE '%sales-outbound%'`,
        )
        .get(),
    ).toMatchObject({ count: 0 });

    await service.sendMessage({ agentId: "chief", text: "Keep working" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    await expect(service.deleteAgent("chief")).rejects.toThrow(
      "Stop the agent and cancel its queued messages before deleting it.",
    );
    expect(service.listAgents().some((agent) => agent.id === "chief")).toBe(true);
  });

  it("keeps an agent available for retry when mailbox deletion fails", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    const agent = await store.getOrCreate("delete-retry");
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    vi.spyOn(mailbox, "deleteAgentData").mockRejectedValueOnce(new Error("private/path secret"));

    await expect(service.deleteAgent(agent.id)).rejects.toThrow("The agent data could not be removed completely.");
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(true);
    expect(events.filter((event) => event.type === "agents-changed")).toEqual([]);

    await service.deleteAgent(agent.id);
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(false);
    expect(events).toContainEqual({ type: "agents-changed", agents: service.listAgents() });
  });

  it("holds due routines and rejects messages during deletion, then resumes after failure", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      // Keep the resumed turn running until the test can observe it.
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await service.initialize();
    const agent = await store.getOrCreate("delete-routine");
    vi.useFakeTimers({ now: new Date("2026-08-25T11:00:00.000Z") });
    let releaseCleanup: (() => void) | undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    vi.spyOn(mailbox, "deleteAgentData").mockImplementationOnce(async () => {
      await cleanupGate;
      throw new Error("Cleanup failed");
    });
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Check during deletion",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T11:00:00.000Z" },
    });
    const deletion = service.deleteAgent(agent.id);
    const failedDeletion = expect(deletion).rejects.toThrow("Retry deleting the agent.");
    try {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id })).toEqual([]);
      await expect(service.testRoutine({ agentId: agent.id, routineId: routine.id })).rejects.toThrow(
        "Wait until the agent operation finishes before running a routine.",
      );
      await expect(service.sendMessage({ agentId: agent.id, text: "Wait for cleanup." })).rejects.toThrow(
        "The recipient is being deleted. Retry after deletion finishes.",
      );
      expect(service.listQueue(agent.id).deliveries).toEqual([]);
      expect(store.activeProviderSession(agent.id)).toBeNull();
      await expect(service.deleteAgent(agent.id)).rejects.toThrow("Agent deletion is already in progress.");

      releaseCleanup?.();
      await failedDeletion;
      const changed = nextRoutinesChanged(service, agent.id);
      await vi.advanceTimersByTimeAsync(0);
      await changed;
      expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id })).toEqual([
        expect.objectContaining({ kind: "scheduled" }),
      ]);
      vi.useRealTimers();
      await waitFor(() => service?.listQueue(agent.id).deliveries.some((delivery) => delivery.status === "running"));
    } finally {
      releaseCleanup?.();
      await failedDeletion;
      vi.useRealTimers();
    }
  });

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
  it("closes a deleted agent's browser tabs and leaves another agent's tabs open", async () => {
    const { store, mailbox } = stores(root);
    const tabs: BrowserTab[] = [];
    const closed: string[] = [];
    const browser = fakeBrowser(tabs);
    browser.close = async (tabId: string) => {
      closed.push(tabId);
    };
    service = createTestService({ store, mailbox, browser });
    await service.initialize();
    const deleted = await store.getOrCreate("tab-owner");
    const kept = await store.getOrCreate("tab-keeper");
    // A fresh agent holds no thread until its first turn, and the legacy owner rule matches on the
    // thread id, so give both agents one.
    const deletedThreadId = store.ensureThreadIdNow(deleted.id);
    const keptThreadId = store.ensureThreadIdNow(kept.id);
    tabs.push(
      browserTab("tab-owned", deleted.id, deletedThreadId),
      // A tab from a build that stored only the thread id. The renderer still groups it under this
      // agent, so deleting the agent has to take it too.
      browserTab("tab-legacy", null, deletedThreadId),
      browserTab("tab-other", kept.id, keptThreadId),
    );

    await service.deleteAgent(deleted.id);

    expect(closed).toEqual(["tab-owned", "tab-legacy"]);
  });

  it("still deletes the agent when closing one of its browser tabs fails", async () => {
    const { store, mailbox } = stores(root);
    const tabs: BrowserTab[] = [];
    const browser = fakeBrowser(tabs);
    browser.close = async () => {
      throw new Error("could not close");
    };
    service = createTestService({ store, mailbox, browser });
    await service.initialize();
    const agent = await store.getOrCreate("tab-close-failure");
    tabs.push(browserTab("tab-stuck", agent.id, store.ensureThreadIdNow(agent.id)));

    await expect(service.deleteAgent(agent.id)).resolves.toBeUndefined();
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(false);
  });
});
