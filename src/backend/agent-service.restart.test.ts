import { type AgentEvent, type BrowserTab, isAgentEvent, routineRunConversationEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRemovalFailed } from "./agent/agent-removal";
import type { FailureSignal } from "./agent/failure-signal";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  fakeBrowser,
  fakeClaudeCli,
  firstInputText,
  nextRoutinesChanged,
  notification,
  protocolMessages,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
  waitForQueue,
} from "./agent-service-test-harness";
import { browserFailure } from "./browser-effects";
import { ChannelStore } from "./channel-store";
import { runCauseEffect } from "./effect-boundary";
import { LineTooLongError } from "./jsonl";
import { getString } from "./protocol";
import { StoredStateFailure } from "./stored-state-effects";

const browserTab = (id: string, ownerAgentId: string | null, ownerThreadId: string | null): BrowserTab => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
  loading: false,
  ownerThreadId,
  ownerAgentId,
});

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
  it("keeps the conversation and permits provider changes after a size-limit exit", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await fakeClaudeCli();
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, undefined, false);
        clients.set(provider, client);
        return client;
      },
    });
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Keep this message" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    const before = await runCauseEffect(service.readConversation("chief"));
    expect(before.activeTurnId).not.toBeNull();
    const client = clients.get("codex");
    if (!client) throw new Error("The fake provider did not start.");
    client.emit("exit", new LineTooLongError("Codex"));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "interrupted");

    await runCauseEffect(service.updateAgent({ agentId: "chief", provider: "claude", model: "claude-fable-5" }));
    await runCauseEffect(service.updateAgent({ agentId: "chief", provider: "codex", model: "gpt-5.6-sol" }));
    const after = await runCauseEffect(service.readConversation("chief"));
    expect(after.threadId).toBe(before.threadId);
    expect(after.activeTurnId).toBeNull();
    expect(after.messages.map((message) => message.id)).toEqual(before.messages.map((message) => message.id));
  });

  it("notifies other devices when a member reads a reply without clearing another member's unread state", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Reply to this" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    const snapshot = await runCauseEffect(service.readConversation("chief"));
    const boundary = snapshot.messages.at(-1)?.id;
    if (!boundary) throw new Error("The reply is missing");
    const unread = service.listConversationReads("member-other").chief;
    expect(unread?.unreadCount).toBeGreaterThan(0);
    const events: AgentEvent[] = [];
    service.on("event", (event) => {
      if (event.type === "conversation-invalidated") events.push(event);
    });
    await runCauseEffect(service.markConversationRead("chief", "member-owner", boundary));
    expect(events).toEqual([{ type: "conversation-invalidated", agentId: "chief", revision: snapshot.revision }]);
    expect(service.listConversationReads("member-owner").chief?.unreadCount).toBe(0);
    expect(service.listConversationReads("member-other").chief).toEqual(unread);
    await runCauseEffect(service.markConversationRead("chief", "member-owner", boundary));
    expect(events).toHaveLength(1);
    await runCauseEffect(service.markConversationUnread("chief", "member-owner"));
    expect(events.at(-1)).toEqual({ type: "conversation-invalidated", agentId: "chief", revision: snapshot.revision });
    expect(events).toHaveLength(2);
    expect(service.listConversationReads("member-owner").chief?.unreadCount).toBeGreaterThan(0);
    expect(service.listConversationReads("member-other").chief).toEqual(unread);
    await runCauseEffect(service.markConversationRead("chief", "member-owner", boundary));
    expect(service.listConversationReads("member-owner").chief?.unreadCount).toBe(0);
  });

  it("resumes stored threads and does not replay an uncertain running delivery", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Remember this" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    const threadId = (await runCauseEffect(store.getOrCreate("chief"))).threadId;
    await runCauseEffect(service.stop());

    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    expect(service.listQueue("chief").deliveries[0]?.status).toBe("interrupted");
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Continue" }));
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
    expect((await runCauseEffect(store.getOrCreate("chief"))).threadId).toBe(threadId);
  });

  it("keeps a turn that started before provider startup finished", async () => {
    const { store, mailbox } = stores(root);
    let releaseModels = () => {};
    const modelsListed = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });
    const client = new FakeAgentClient("codex", "CODEX_DONE", false, true, {}, async (method) => {
      if (method === "model/list") await modelsListed;
    });
    service = createTestService({ store, mailbox, clientFactory: () => client });
    // Chat is ready once the CLIs answer; model discovery and the recovery pass run after that.
    const initialized = runCauseEffect(service.initialize());
    await waitFor(() => service?.getStatus().phase === "ready");
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Start before startup finished" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");

    releaseModels();
    await initialized;

    expect(service.listQueue("chief").deliveries[0]?.status).toBe("running");
    expect((await runCauseEffect(service.readConversation("chief"))).activeTurnId).not.toBeNull();
  });

  it("settles the running delivery of a provider that exited", async () => {
    const { service: agentService, client } = await startService(root, { provider: "codex", autoComplete: false });
    service = agentService;
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Work that the crash cuts short" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");

    client.emit("exit", new Error("Codex exited."));

    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "interrupted");
  });

  it("expires a persisted question prompt after restart", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Start a recoverable turn" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(service.stop());
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

    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());

    const recovered = await runCauseEffect(service.readConversation("chief"));
    expect(recovered.activeTurnId).toBeNull();
    expect(recovered.messages.find((message) => message.questionPrompt)?.questionPrompt?.resolution).toEqual({
      status: "expired",
    });
  });

  it("reads a stored session with the workspace an ACP agent needs to load it", async () => {
    const { store } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    const threadId = await runCauseEffect(store.ensureThreadId("chief"));
    store.bindProviderSession("chief", "ses_stored");
    const local = {
      id: "local-message",
      author: "user" as const,
      text: "Keep this local message",
      createdAt: "2026-08-01T12:00:00.000Z",
      status: "completed" as const,
    };
    store.database.persistConversation(
      { agentId: "chief", threadId, activeTurnId: null, revision: 0, messages: [local] },
      "test.saved-before-restart",
    );
    store.database.close();

    const events: AgentEvent[] = [];
    const restored = stores(root);
    service = createTestService({
      store: restored.store,
      mailbox: restored.mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        // An ACP session lives in the agent process alone, so a read answers only for a session the
        // client can load - which it cannot do without the workspace the session belongs to.
        client.threadRead = (params) => {
          if (!getString(params, "cwd")) throw new Error(`Unknown ACP session: ${getString(params, "threadId")}`);
          return { thread: { id: getString(params, "threadId"), turns: [] } };
        };
        return client;
      },
    });
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());

    // The banner above the composer is what a failed read costs the user at every start.
    await waitFor(
      async () =>
        (await (service ? runCauseEffect(service.readConversation("chief")) : undefined))?.messages.length === 1,
    );
    expect(events.some((event) => event.type === "error" && event.code === "provider_history_backfill_pending")).toBe(
      false,
    );
    expect((await runCauseEffect(service.readConversation("chief"))).messages).toEqual([
      expect.objectContaining(local),
    ]);
  });

  it("reports a structured provider error once when its message is absent", async () => {
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
    const events: AgentEvent[] = [];
    const failures: FailureSignal[] = [];
    service.on("event", (event) => events.push(event));
    service.on("failure", (failure) => failures.push(failure));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Say hi" }));
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) throw new Error("The fake Codex turn did not start.");
    client.emit(
      "notification",
      notification("error", { threadId, turnId: started.turnId, error: { code: "invalid_upload_request" } }),
    );
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: started.turnId, status: "failed" } }),
    );
    await waitForQueue(service, "chief", (queue) => queue.deliveries.some((delivery) => delivery.status === "failed"));
    expect(failures.filter((failure) => failure.turnId === started.turnId)).toEqual([
      expect.objectContaining({ causeCode: "invalid_upload_request", provider: "codex" }),
    ]);
  });

  it("keeps the provider's reason on a failed delivery after a restart", async () => {
    const reason = "The selected model is not available on this endpoint.";
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
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Say hi" }));
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) throw new Error("The fake Codex turn did not start.");
    client.emit("notification", notification("error", { threadId, turnId: started.turnId, message: reason }));
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: started.turnId, status: "failed" } }),
    );
    await waitForQueue(service, "chief", (queue) => queue.deliveries.some((delivery) => delivery.status === "failed"));
    await runCauseEffect(service.stop());
    service = null;
    store.database.close();

    // The banner that showed the reason lives in the window. After a restart the delivery is all that is left.
    const restored = stores(root);
    service = createTestService({
      store: restored.store,
      mailbox: restored.mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await runCauseEffect(service.initialize());
    expect(service.listQueue("chief").deliveries).toEqual([
      expect.objectContaining({ status: "failed", turnId: started.turnId, error: reason }),
    ]);
  });

  it("recovers history from sessions retired by an upgrade and retries failed reads without losing local messages", async () => {
    const { store } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    const threadId = await runCauseEffect(store.ensureThreadId("chief"));
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
      const next = createTestService({
        store: restored.store,
        mailbox: restored.mailbox,
        preferredProvider: "codex",
        clientFactory: (provider) => {
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
        },
      });
      next.on("event", (event) => events.push(event));
      return { next, restored };
    };
    const first = createService();
    service = first.next;
    await runCauseEffect(service.initialize());
    await waitFor(() =>
      events.some((event) => event.type === "error" && event.code === "provider_history_backfill_pending"),
    );
    expect((await runCauseEffect(service.readConversation("chief"))).messages).toEqual([
      expect.objectContaining(local),
    ]);
    expect(first.restored.store.activeProviderSession("chief")).toBeNull();
    await runCauseEffect(service.stop());
    first.restored.store.database.close();

    failRead = false;
    for (let restart = 0; restart < 2; restart += 1) {
      const { next, restored } = createService();
      service = next;
      await runCauseEffect(service.initialize());
      await waitFor(async () =>
        (await runCauseEffect(next.readConversation("chief"))).messages.some((message) => message.id === "old-reply"),
      );
      const recovered = await runCauseEffect(service.readConversation("chief"));
      expect(recovered.threadId).toBe(threadId);
      expect(recovered.messages).toEqual([
        expect.objectContaining(local),
        expect.objectContaining({ id: "old-reply", text: "Reply saved before the update" }),
      ]);
      expect(restored.store.database.listProviderSessions(threadId)).toEqual([
        expect.objectContaining({ externalSessionId: "old-session", state: "inactive" }),
      ]);
      await runCauseEffect(service.stop());
      restored.store.database.close();
    }
  });

  it("recovers an interrupted Claude answer under its saved ID after a provider switch", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await fakeClaudeCli();
    const { store, mailbox } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    const threadId = await runCauseEffect(store.ensureThreadId("chief"));
    store.database.bindProviderSession({
      threadId,
      provider: "claude",
      externalSessionId: "claude-history",
      model: "sonnet",
      effort: "medium",
    });
    store.database.deactivateProviderSessions(threadId);
    const answer = {
      id: "saved-turn:assistant",
      turnId: "saved-turn",
      author: "assistant" as const,
      itemType: "agentMessage",
      text: "Before.Af",
      status: "interrupted" as const,
      createdAt: "2026-08-01T12:00:00.000Z",
    };
    store.database.persistConversation(
      { agentId: "chief", threadId, activeTurnId: null, revision: 0, messages: [answer] },
      "test.saved-claude-answer",
    );
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        client.threadRead = () => ({
          thread: {
            id: "claude-history",
            turns: [
              {
                id: "saved-turn",
                status: "completed",
                items: [
                  { id: "part-1", type: "agentMessage", text: "Before." },
                  { id: "part-2", type: "agentMessage", text: "After." },
                ],
              },
            ],
          },
        });
        return client;
      },
    });
    await runCauseEffect(service.initialize());
    await waitFor(() =>
      store.database
        .readConversation("chief", threadId)
        .messages.some((message) => message.text === "After." || message.text === "Before.After."),
    );
    expect(store.database.readConversation("chief", threadId).messages).toEqual([
      expect.objectContaining({ ...answer, text: "Before.After.", status: "completed" }),
    ]);
  });

  it("does not persist unchanged provider history after repeated restarts", async () => {
    const clients: FakeAgentClient[] = [];
    const { store, mailbox } = stores(root);
    const createService = () =>
      createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: (provider) => {
          const client = new FakeAgentClient(provider);
          clients.push(client);
          return client;
        },
      });
    service = createService();
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Remember this" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    const before = await runCauseEffect(service.readConversation("chief"));
    await runCauseEffect(service.stop());

    for (let restart = 0; restart < 2; restart += 1) {
      service = createService();
      await runCauseEffect(service.initialize());
      const client = clients.filter((candidate) => candidate.provider === "codex").at(-1);
      await waitFor(() => client?.requests.some((request) => request.method === "thread/read"));
      await runCauseEffect(service.stop());
    }

    expect(
      store.database.connection
        .prepare("SELECT COUNT(*) AS count FROM orchestration_events WHERE event_type = 'provider-history.backfilled'")
        .get(),
    ).toMatchObject({ count: 0 });
    expect((await store.database.readConversation("chief", before.threadId)).revision).toBe(before.revision);
  });

  it("keeps the member who wrote a message after a restart", async () => {
    const { store, mailbox } = stores(root);
    const createService = () =>
      createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: (provider) => new FakeAgentClient(provider),
      });
    service = createService();
    await runCauseEffect(service.initialize());
    await runCauseEffect(
      service.sendMessage({ agentId: "chief", text: "From Ada" }, { id: "member-ada", name: "Ada" }),
    );
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "From nobody" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[1]?.status === "completed");
    await runCauseEffect(service.stop());

    service = createService();
    await runCauseEffect(service.initialize());
    const userMessages = (await runCauseEffect(service.readConversation("chief"))).messages.filter(
      (message) => message.author === "user",
    );
    expect(userMessages.map((message) => [message.text, message.senderMember])).toEqual([
      ["From Ada", { id: "member-ada", name: "Ada" }],
      ["From nobody", undefined],
    ]);
  });

  it("unarchives a stored Codex thread and resumes the queued delivery", async () => {
    process.env.OPENBOT_FAKE_ARCHIVED_THREAD = "1";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Remember this" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    await runCauseEffect(store.getOrCreate("chief"));
    const externalThreadId = store.activeProviderSession("chief")?.externalSessionId;
    await runCauseEffect(service.stop());

    service = createTestService({ store, mailbox });
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Continue" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[1]?.status === "running");

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
    let revokeFails = true;
    const deleteWithRevokedApproval = vi.fn((_agentId: string, remove: () => Effect.Effect<void, AgentRemovalFailed>) =>
      Effect.gen(function* () {
        if (revokeFails) return yield* new AgentRemovalFailed({ cause: new Error("Approval revocation failed.") });
        yield* remove();
      }),
    );
    service = createTestService({ store, mailbox, deleteWithRevokedApproval });
    await runCauseEffect(service.initialize());

    const deletedAgent = await runCauseEffect(store.getOrCreate("sales-outbound"));
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
    await expect(runCauseEffect(service.deleteAgent("sales-outbound"))).rejects.toThrow(
      "The agent data could not be removed completely.",
    );
    expect(service.listAgents().some((agent) => agent.id === "sales-outbound")).toBe(true);
    revokeFails = false;
    await runCauseEffect(service.deleteAgent("sales-outbound"));
    await expect(runCauseEffect(service.deleteAgent("sales-outbound"))).resolves.toBeUndefined();
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

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Keep working" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    await expect(runCauseEffect(service.deleteAgent("chief"))).rejects.toThrow(
      "Stop the agent and cancel its queued messages before deleting it.",
    );
    expect(service.listAgents().some((agent) => agent.id === "chief")).toBe(true);
  });

  it("keeps an agent available for retry when mailbox deletion fails", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("delete-retry"));
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    vi.spyOn(mailbox, "deleteAgentData").mockReturnValueOnce(
      Effect.fail(new StoredStateFailure({ cause: new Error("private/path secret") })),
    );

    await expect(runCauseEffect(service.deleteAgent(agent.id))).rejects.toThrow(
      "The agent data could not be removed completely.",
    );
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(true);
    expect(events.filter((event) => event.type === "agents-changed")).toEqual([]);

    await runCauseEffect(service.deleteAgent(agent.id));
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(false);
    expect(events).toContainEqual({ type: "agents-changed", agents: service.listAgents() });
  });

  it("does not recreate a deleted agent when a device reads or marks its conversation", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("deleted-elsewhere"));
    await runCauseEffect(service.deleteAgent(agent.id));
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    const unknown = `Unknown agent: ${agent.id}`;

    await expect(runCauseEffect(service.readConversation(agent.id))).rejects.toThrow(unknown);
    await expect(runCauseEffect(service.readConversationFor(agent.id, "member-owner"))).rejects.toThrow(unknown);
    await expect(runCauseEffect(service.readConversationPageFor(agent.id, "member-owner"))).rejects.toThrow(unknown);
    await expect(runCauseEffect(service.markConversationRead(agent.id, "member-owner", null))).rejects.toThrow(unknown);
    await expect(runCauseEffect(service.markConversationUnread(agent.id, "member-owner"))).rejects.toThrow(unknown);

    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(false);
    expect(
      store.database.connection
        .prepare("SELECT COUNT(*) AS count FROM projection_agents WHERE agent_id = ?")
        .get(agent.id),
    ).toMatchObject({ count: 0 });
    expect(events).toEqual([]);
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
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("delete-routine"));
    vi.useFakeTimers({ now: new Date("2026-08-25T11:00:00.000Z") });
    let releaseCleanup: (() => void) | undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    vi.spyOn(mailbox, "deleteAgentData").mockImplementationOnce(() =>
      Effect.gen(function* () {
        yield* Effect.promise(() => cleanupGate);
        return yield* new StoredStateFailure({ cause: new Error("Cleanup failed") });
      }),
    );
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Check during deletion",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T11:00:00.000Z" },
    });
    const deletion = runCauseEffect(service.deleteAgent(agent.id));
    const failedDeletion = expect(deletion).rejects.toThrow("Retry deleting the agent.");
    try {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id })).toEqual([]);
      await expect(runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }))).rejects.toThrow(
        "Wait until the agent operation finishes before running a routine.",
      );
      await expect(
        runCauseEffect(service.sendMessage({ agentId: agent.id, text: "Wait for cleanup." })),
      ).rejects.toThrow("The recipient is being deleted. Retry after deletion finishes.");
      expect(service.listQueue(agent.id).deliveries).toEqual([]);
      expect(store.activeProviderSession(agent.id)).toBeNull();
      await expect(runCauseEffect(service.deleteAgent(agent.id))).rejects.toThrow(
        "Agent deletion is already in progress.",
      );

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
    await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await waitFor(() => service?.listQueue(agent.id).deliveries.some((delivery) => delivery.status === "running"));

    const queue = service.listQueue(agent.id);
    expect(queue.deliveries.map((delivery) => delivery.status)).toEqual(["running", "queued"]);
    expect(queue.deliveries.every((delivery) => delivery.sender.kind === "routine")).toBe(true);
    const conversation = await runCauseEffect(service.readConversation(agent.id));
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
    await runCauseEffect(service.respondToApproval({ requestId: "routine-approval", decision: "accept" }));
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "running" })]),
    );
    expect(client.responses).toEqual([
      expect.objectContaining({ id: "routine-approval", result: { decision: "accept" } }),
    ]);

    const queued = queue.deliveries.find((delivery) => delivery.status === "queued");
    if (!queued) throw new Error("The second routine run was not queued.");
    await runCauseEffect(service.cancelQueuedMessage(agent.id, queued.id));
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

    await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }));
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
    const transitionStatuses = (await runCauseEffect(service.readConversation(agent.id))).messages.flatMap(
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
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));
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

    await runCauseEffect(service.stop());
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    await runCauseEffect(service.initialize());

    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toHaveLength(1);
  });
  it("closes a deleted agent's browser tabs and leaves another agent's tabs open", async () => {
    const { store, mailbox } = stores(root);
    const tabs: BrowserTab[] = [];
    const closed: string[] = [];
    const browser = fakeBrowser(tabs);
    browser.close = (tabId: string) =>
      Effect.sync(() => {
        closed.push(tabId);
      });
    service = createTestService({ store, mailbox, browser });
    await runCauseEffect(service.initialize());
    const deleted = await runCauseEffect(store.getOrCreate("tab-owner"));
    const kept = await runCauseEffect(store.getOrCreate("tab-keeper"));
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

    await runCauseEffect(service.deleteAgent(deleted.id));

    expect(closed).toEqual(["tab-owned", "tab-legacy"]);
  });

  it("removes deleted agents from channel members at startup and on deletion", async () => {
    const { store } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(store.getOrCreate("member-a"));
    await runCauseEffect(store.getOrCreate("member-b"));
    // An older version kept deleted agents in the channel, the lead among them.
    const channels = new ChannelStore(store.database);
    channels.update(
      channels.create("channel-1", {
        name: "Project",
        title: "",
        instructions: "",
        members: [{ agentId: "gone-1" }, { agentId: "member-a" }, { agentId: "gone-2" }, { agentId: "member-b" }],
        leadAgentId: "gone-1",
      }),
    );
    store.database.close();

    const restored = stores(root);
    service = createTestService({ store: restored.store, mailbox: restored.mailbox });
    await runCauseEffect(service.initialize());
    expect(service.channels.store.get("channel-1")).toMatchObject({
      members: [{ agentId: "member-a" }, { agentId: "member-b" }],
      leadAgentId: "member-a",
    });

    await runCauseEffect(service.deleteAgent("member-a"));
    expect(service.channels.store.get("channel-1")).toMatchObject({
      members: [{ agentId: "member-b" }],
      leadAgentId: "member-b",
    });
  });

  it("still deletes the agent when closing one of its browser tabs fails", async () => {
    const { store, mailbox } = stores(root);
    const tabs: BrowserTab[] = [];
    const browser = fakeBrowser(tabs);
    browser.close = () => Effect.fail(browserFailure(new Error("could not close")));
    service = createTestService({ store, mailbox, browser });
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("tab-close-failure"));
    tabs.push(browserTab("tab-stuck", agent.id, store.ensureThreadIdNow(agent.id)));

    await expect(runCauseEffect(service.deleteAgent(agent.id))).resolves.toBeUndefined();
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(false);
  });
});
