import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  createFakeClaude,
  createFakeGrok,
  createFakeOpencode,
  createTestService,
  FakeAgentClient,
  paramsRecord,
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

describe.sequential("AgentService: restart", () => {
  it("notifies other devices when a member reads a reply without clearing another member's unread state", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
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
    service = createTestService({ store, mailbox });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Remember this" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    const threadId = (await store.getOrCreate("chief")).threadId;
    await service.stop();

    service = createTestService({ store, mailbox });
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
    service = createTestService({ store, mailbox });
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

    service = createTestService({ store, mailbox });
    await service.initialize();

    const recovered = await service.readConversation("chief");
    expect(recovered.activeTurnId).toBeNull();
    expect(recovered.messages.find((message) => message.questionPrompt)?.questionPrompt?.resolution).toEqual({
      status: "expired",
    });
  });

  it("reads a stored session with the workspace an ACP agent needs to load it", async () => {
    const { store } = stores(root);
    await store.initialize();
    await store.getOrCreate("chief");
    const threadId = await store.ensureThreadId("chief");
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
    await service.initialize();

    // The banner above the composer is what a failed read costs the user at every start.
    await waitFor(async () => (await service?.readConversation("chief"))?.messages.length === 1);
    expect(events.some((event) => event.type === "error" && event.code === "provider_history_backfill_pending")).toBe(
      false,
    );
    expect((await service.readConversation("chief")).messages).toEqual([expect.objectContaining(local)]);
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

  it("recovers an interrupted Claude answer under its saved ID after a provider switch", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    await store.initialize();
    await store.getOrCreate("chief");
    const threadId = await store.ensureThreadId("chief");
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
    await service.initialize();
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
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Remember this" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    await store.getOrCreate("chief");
    const externalThreadId = store.activeProviderSession("chief")?.externalSessionId;
    await service.stop();

    service = createTestService({ store, mailbox });
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

  it.each<AgentProvider>(["codex", "claude", "grok", "opencode"])(
    "delivers the quiet collaboration policy to %s on startup and after restart",
    async (provider) => {
      process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
      process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
      process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
      const { store, mailbox } = stores(root);
      for (const method of ["thread/start", "thread/resume"]) {
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
        });
        await service.initialize();
        if (method === "thread/start") {
          await store.getOrCreate("chief");
          await service.updateAgent({
            agentId: "chief",
            provider,
            model:
              provider === "codex"
                ? "gpt-5.6-luna"
                : provider === "claude"
                  ? "claude-sonnet-5"
                  : provider === "grok"
                    ? "grok-4.5"
                    : "opencode/example-model",
          });
        }
        await service.sendMessage({ agentId: "chief", text: "Continue coordinating the research task." });
        await waitFor(() =>
          service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"),
        );

        const request = clients.get(provider)?.requests.find((candidate) => candidate.method === method);
        const instructions = paramsRecord(request?.params)?.developerInstructions;
        expect(instructions).toContain("Keep routine teammate communication internal");
        expect(instructions).toContain("On startup or resume, begin or continue the task without narrating setup");
        expect(instructions).toContain(
          "Report meaningful outcomes, completed work, material changes, blockers, failures",
        );
        expect(instructions).toContain("required user input or approval");
        expect(instructions).toContain("If the user asks for a detailed coordination report, provide it");
        expect(instructions).toContain("send the result back in the Status/Result/Evidence format");
        expect(instructions).toContain("Do not create acknowledgement loops");
        expect(instructions).not.toContain("When you receive a reply, summarize it for the user");
        await service.stop();
      }
    },
  );
});
