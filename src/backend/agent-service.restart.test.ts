import { type AgentEvent, isAgentEvent, routineRunConversationEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import { AgentService } from "./agent-service";
import {
  FakeAgentClient,
  fakeBrowser,
  firstInputText,
  nextRoutinesChanged,
  notification,
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

describe.sequential("AgentService: restart", () => {
  it("notifies other devices when a member reads a reply without clearing another member's unread state", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) => new FakeAgentClient(provider),
    );
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Reply to this" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
    const snapshot = await service.readConversation("chief");
    const boundary = snapshot.messages.at(-1)?.id;
    if (!boundary) throw new Error("The reply is missing");
    const unread = service.listConversationReads("member-other").chief;
    expect(unread?.unreadCount).toBeGreaterThan(0);
    const events: AgentEvent[] = [];
    service.on("event", (event) => {
      if (event.type === "conversation-invalidated") events.push(event);
    });
    await service.markConversationRead("chief", "member-owner", boundary);
    expect(events).toEqual([{ type: "conversation-invalidated", agentId: "chief", revision: snapshot.revision }]);
    expect(service.listConversationReads("member-owner").chief?.unreadCount).toBe(0);
    expect(service.listConversationReads("member-other").chief).toEqual(unread);
    await service.markConversationRead("chief", "member-owner", boundary);
    expect(events).toHaveLength(1);
    await service.markConversationUnread("chief", "member-owner");
    expect(events.at(-1)).toEqual({ type: "conversation-invalidated", agentId: "chief", revision: snapshot.revision });
    expect(events).toHaveLength(2);
    expect(service.listConversationReads("member-owner").chief?.unreadCount).toBeGreaterThan(0);
    expect(service.listConversationReads("member-other").chief).toEqual(unread);
    await service.markConversationRead("chief", "member-owner", boundary);
    expect(service.listConversationReads("member-owner").chief?.unreadCount).toBe(0);
  });

  it("resumes stored threads and does not replay an uncertain running delivery", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Remember this" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    const threadId = (await store.getOrCreate("chief")).threadId;
    await service.stop();

    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
    expect(service.listQueue("chief").deliveries[0]?.status).toBe("interrupted");
    await service.sendMessage({ agentId: "chief", text: "Continue" });
    await waitFor(async () => (await protocolMessages(logPath)).some((message) => message.method === "thread/resume"));
    const resume = (await protocolMessages(logPath)).find((message) => message.method === "thread/resume");
    expect(resume?.params).toMatchObject({ threadId: store.activeProviderSession("chief")?.externalSessionId });
    // Codex fixes tools at session creation; resume ignores a dynamicTools field.
    const start = (await protocolMessages(logPath)).find((message) => message.method === "thread/start");
    expect(start?.params).toMatchObject({
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ type: "namespace", name: "openbot_browser" }),
        expect.objectContaining({ type: "namespace", name: "openbot" }),
      ]),
    });
    expect((await store.getOrCreate("chief")).threadId).toBe(threadId);
  });

  it("expires a persisted question prompt after restart", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Start a recoverable turn" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    const agent = await store.getOrCreate("chief");
    await service.stop();
    const snapshot = store.database.readConversation("chief", agent.threadId);
    snapshot.activeTurnId = "turn-with-question";
    snapshot.messages.push({
      id: "question-prompt:turn-with-question:request-1",
      turnId: "turn-with-question",
      author: "assistant",
      source: "assistant",
      text: "",
      createdAt: "2026-08-28T12:00:00.000Z",
      status: "completed",
      itemType: "question_prompt",
      questionPrompt: {
        requestId: "request-1",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "How broad should the change be?",
            isSecret: false,
            options: null,
          },
        ],
        resolution: null,
      },
    });
    store.database.persistConversation(snapshot, "test.question-prompt-pending");

    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

    const recovered = await service.readConversation("chief");
    expect(recovered.activeTurnId).toBeNull();
    expect(recovered.messages.find((message) => message.questionPrompt)?.questionPrompt?.resolution).toEqual({
      status: "expired",
    });
  });

  it("recovers history from sessions retired by an upgrade and retries failed reads without losing local messages", async () => {
    const { store } = stores(root);
    await store.initialize();
    await store.getOrCreate("chief");
    const threadId = await store.ensureThreadId("chief");
    store.bindProviderSession("chief", "old-session");
    const local = {
      id: "local-message",
      author: "user" as const,
      text: "Keep this local message",
      createdAt: "2026-08-01T12:00:00.000Z",
      status: "completed" as const,
    };
    store.database.persistConversation(
      { agentId: "chief", threadId, activeTurnId: null, revision: 0, messages: [local] },
      "test.saved-before-upgrade",
    );
    // Version 14 changes session state only. Reopen the version 13 database to run the shipped upgrade.
    // Every later version goes too: a history that keeps 15 but drops 14 has a gap, which the
    // schema check rejects before any upgrade runs.
    store.database.connection.prepare("DELETE FROM schema_migrations WHERE version >= 14").run();
    store.database.close();

    let failRead = true;
    const events: AgentEvent[] = [];
    const createService = () => {
      const restored = stores(root);
      const next = new AgentService(restored.store, restored.mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
        const client = new FakeAgentClient(provider);
        client.threadRead = () => {
          if (failRead) throw new Error("Saved provider history is unavailable. Try again.");
          return {
            thread: {
              id: "old-session",
              turns: [
                {
                  id: "old-turn",
                  status: "completed",
                  startedAt: 1785585600,
                  items: [{ id: "old-reply", type: "agentMessage", text: "Reply saved before the update" }],
                },
              ],
            },
          };
        };
        return client;
      });
      next.on("event", (event) => events.push(event));
      return { next, restored };
    };
    const first = createService();
    service = first.next;
    await service.initialize();
    await waitFor(() =>
      events.some((event) => event.type === "error" && event.code === "provider_history_backfill_pending"),
    );
    expect((await service.readConversation("chief")).messages).toEqual([expect.objectContaining(local)]);
    expect(first.restored.store.activeProviderSession("chief")).toBeNull();
    await service.stop();
    first.restored.store.database.close();

    failRead = false;
    for (let restart = 0; restart < 2; restart += 1) {
      const { next, restored } = createService();
      service = next;
      await service.initialize();
      await waitFor(async () =>
        (await next.readConversation("chief")).messages.some((message) => message.id === "old-reply"),
      );
      const recovered = await service.readConversation("chief");
      expect(recovered.threadId).toBe(threadId);
      expect(recovered.messages).toEqual([
        expect.objectContaining(local),
        expect.objectContaining({ id: "old-reply", text: "Reply saved before the update" }),
      ]);
      expect(restored.store.database.listProviderSessions(threadId)).toEqual([
        expect.objectContaining({ externalSessionId: "old-session", state: "inactive" }),
      ]);
      await service.stop();
      restored.store.database.close();
    }
  });

  it("does not persist unchanged provider history after repeated restarts", async () => {
    const clients: FakeAgentClient[] = [];
    const { store, mailbox } = stores(root);
    const createService = () =>
      new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
        const client = new FakeAgentClient(provider);
        clients.push(client);
        return client;
      });
    service = createService();
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Remember this" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
    const before = await service.readConversation("chief");
    await service.stop();

    for (let restart = 0; restart < 2; restart += 1) {
      service = createService();
      await service.initialize();
      const client = clients.filter((candidate) => candidate.provider === "codex").at(-1);
      await waitFor(() => client?.requests.some((request) => request.method === "thread/read"));
      await service.stop();
    }

    expect(
      store.database.connection
        .prepare("SELECT COUNT(*) AS count FROM orchestration_events WHERE event_type = 'provider-history.backfilled'")
        .get(),
    ).toMatchObject({ count: 0 });
    expect((await store.database.readConversation("chief", before.threadId)).revision).toBe(before.revision);
  });

  it("unarchives a stored Codex thread and resumes the queued delivery", async () => {
    process.env.OPENBOT_FAKE_ARCHIVED_THREAD = "1";
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Remember this" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    await store.getOrCreate("chief");
    const externalThreadId = store.activeProviderSession("chief")?.externalSessionId;
    await service.stop();

    service = new AgentService(store, mailbox, fakeBrowser());
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Continue" });
    await waitFor(() => service?.listQueue("chief").deliveries[1]?.status === "running");

    const requests = await protocolMessages(logPath);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "thread/unarchive",
          params: { threadId: externalThreadId },
        }),
      ]),
    );
    expect(
      requests.filter(
        (message) => message.method === "thread/resume" && getString(message.params, "threadId") === externalThreadId,
      ),
    ).toHaveLength(2);
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("is archived"),
        }),
      ]),
    );
  });

  it("deletes idle agents and refuses to orphan active work", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
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
    service = new AgentService(store, mailbox, fakeBrowser());
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
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      // Keep the resumed turn running until the test can observe it.
      (provider) => new FakeAgentClient(provider, "", false),
    );
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "", false);
      clients.set(provider, client);
      return client;
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
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) => new FakeAgentClient(provider),
    );
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
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) => new FakeAgentClient(provider),
    );
    await service.initialize();

    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toHaveLength(1);
  });
});
