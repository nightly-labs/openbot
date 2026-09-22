// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createFakeGrok,
  createFakeOpencode,
  createTestService,
  FakeAgentClient,
  firstInputText,
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

describe.sequential("AgentService: queue (2/3)", () => {
  it("removes queued profile creation on receipt failure and runs only the successful retry", async () => {
    const {
      service: agentService,
      client,
      store,
      mailbox,
    } = await startService(root, {
      provider: "codex",
      preferredProvider: "codex",
    });
    service = agentService;
    const sidebar = new SidebarLayoutStore(join(root, "sidebar.json"));
    await sidebar.initialize();
    const input = {
      operationId: randomUUID(),
      initialMessage: "Introduce yourself",
      draft: {
        name: "Researcher",
        title: "Research",
        description: "Cite sources",
        avatarSeed: "research",
        avatarHue: null,
        sectionId: null,
      },
    };
    let failedAgentId = "";
    const failure = vi.spyOn(store, "commitReviewedProfile").mockImplementationOnce((agentId) => {
      failedAgentId = agentId;
      expect(mailbox.listQueue(agentId).deliveries.map((delivery) => delivery.status)).toEqual(["queued"]);
      throw new Error("Receipt write failed.");
    });
    await expect(service.saveProfile(input, sidebar)).rejects.toThrow("Receipt write failed.");
    expect(service.listAgents()).toEqual([]);
    expect(store.database.listAgents()).toEqual([]);
    expect(mailbox.listQueue(failedAgentId).deliveries).toEqual([]);
    expect(sidebar.getSnapshot().agentAssignments).toEqual({});
    expect(client.requests.filter((request) => request.method === "turn/start")).toEqual([]);
    await expect(readdir(join(root, "home", "OpenBot", "Agents"))).resolves.toEqual([]);
    failure.mockRestore();
    const result = await service.saveProfile(input, sidebar);
    expect((await service.saveProfile(input, sidebar)).agent.id).toBe(result.agent.id);
    expect(service.listAgents()).toHaveLength(1);
    await waitFor(() => client.requests.some((request) => request.method === "turn/start"));
    expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
  });

  it.each([false, true])(
    "recovers profile creation before startup drains queues (committed: %s)",
    async (committed) => {
      const { store, mailbox } = stores(root);
      await store.initialize();
      await mailbox.initialize();
      const existing = await store.createAgent({ ...CREATE_AGENT_INPUT, name: "Keep this agent" });
      const sidebar = new SidebarLayoutStore(join(root, "sidebar.json"));
      await sidebar.initialize();
      const input = {
        operationId: randomUUID(),
        initialMessage: "Introduce yourself",
        draft: {
          name: "Researcher",
          title: "Research",
          description: "Cite sources",
          avatarSeed: "research",
          avatarHue: null,
          sectionId: null,
        },
      };
      const pending = await store.createAgent(input.draft, input.operationId);
      await mailbox.enqueue({
        sender: { kind: "user" },
        recipientAgentIds: [pending.id],
        text: input.initialMessage,
        draftIds: [],
        replyToMessageId: null,
      });
      if (committed)
        store.commitReviewedProfile(
          pending.id,
          input.draft,
          `agent-profile:${input.operationId}`,
          sidebar.getSnapshot(),
        );
      // Reopen the persisted state without invoking ProfileSave's in-memory catch or finally.
      store.database.close();
      const restarted = stores(root);
      const client = new FakeAgentClient("codex");
      service = createTestService({
        store: restarted.store,
        mailbox: restarted.mailbox,
        preferredProvider: "codex",
        clientFactory: () => client,
      });
      await service.initialize();
      expect(service.listAgents().some((agent) => agent.id === existing.id)).toBe(true);
      expect(service.listAgents().some((agent) => agent.id === pending.id)).toBe(committed);
      if (!committed) {
        expect(restarted.mailbox.listQueue(pending.id).deliveries).toEqual([]);
        expect(client.requests.filter((request) => request.method === "turn/start")).toEqual([]);
        await expect(readdir(join(root, "home", "OpenBot", "Agents"))).resolves.toEqual([existing.id]);
      }
      const result = await service.saveProfile(input, sidebar);
      if (committed) expect(result.agent.id).toBe(pending.id);
      else expect(result.agent.id).not.toBe(pending.id);
      expect(service.listAgents()).toHaveLength(2);
      await waitFor(() => client.requests.some((request) => request.method === "turn/start"));
      expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
    },
  );

  it("keeps the agent model and thread when a lazy provider cannot start", async () => {
    const { service: agentService, store } = await startService(root);
    service = agentService;
    await store.getOrCreate("chief");
    const threadId = await store.ensureThreadId("chief");

    await expect(
      service.updateAgent({ agentId: "chief", provider: "claude", model: "claude-sonnet-5" }),
    ).rejects.toThrow("included Claude runtime");
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      model: "gpt-5.6-luna",
      threadId,
    });
  });

  it("starts the second provider when an agent selects its model", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { service: agentService, store } = await startService(root);
    service = agentService;
    await store.getOrCreate("chief");

    await expect(
      service.updateAgent({
        agentId: "chief",
        provider: "claude",
        model: "claude-sonnet-5",
        reasoningEffort: "high",
      }),
    ).resolves.toMatchObject({ model: "claude-sonnet-5", reasoningEffort: "high" });
    expect(service.getStatus().providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex", state: "available" }),
        expect.objectContaining({ id: "claude", state: "available" }),
      ]),
    );
  });

  it("hands one SQLite conversation across repeated provider switches", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
      preferredProvider: "codex",
    });
    service = agentService;

    await service.sendMessage({ agentId: "chief", text: "First request" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
    const publicThreadId = service.listAgents().find((agent) => agent.id === "chief")?.threadId;

    await service.updateAgent({ agentId: "chief", provider: "grok", model: "grok-4.5" });
    expect(service.listAgents().find((agent) => agent.id === "chief")?.threadId).toBe(publicThreadId);
    await service.sendMessage({ agentId: "chief", text: "Second request" });
    await waitFor(() => service?.listQueue("chief").deliveries[1]?.status === "completed");

    const grokInput = clients.get("grok")?.requests.find((request) => request.method === "turn/start")?.params;
    expect(firstInputText(grokInput)).toContain("CODEX_DONE");
    expect(firstInputText(grokInput)).toContain("Second request");
    const firstGrokSessionId = store.activeProviderSession("chief")?.externalSessionId;

    await service.updateAgent({ agentId: "chief", provider: "claude", model: "claude-sonnet-5" });
    await service.sendMessage({ agentId: "chief", text: "Third request" });
    await waitFor(() => service?.listQueue("chief").deliveries[2]?.status === "completed");
    const claudeInput = clients.get("claude")?.requests.find((request) => request.method === "turn/start")?.params;
    expect(firstInputText(claudeInput)).toContain("GROK_DONE");

    await service.updateAgent({ agentId: "chief", provider: "grok", model: "grok-4.5" });
    await service.sendMessage({ agentId: "chief", text: "Fourth request" });
    await waitFor(() => service?.listQueue("chief").deliveries[3]?.status === "completed");
    const grokTurns = clients.get("grok")?.requests.filter((request) => request.method === "turn/start") ?? [];
    expect(firstInputText(grokTurns[1]?.params)).toContain("CLAUDE_DONE");
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstGrokSessionId);

    const conversation = await service.readConversation("chief");
    expect(conversation.threadId).toBe(publicThreadId);
    expect(conversation.messages.map((message) => message.text)).toEqual(
      expect.arrayContaining(["CODEX_DONE", "GROK_DONE", "CLAUDE_DONE"]),
    );
    if (!publicThreadId) throw new Error("The public thread was not created.");
    expect(store.database.listProviderSessions(publicThreadId)).toMatchObject([
      { provider: "codex", state: "inactive" },
      { provider: "grok", state: "inactive" },
      { provider: "claude", state: "inactive" },
      { provider: "grok", state: "active" },
    ]);
  });

  it("resumes and retries once when Grok loses its in-memory session", async () => {
    process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
    let rejectTurnStart = true;
    let grokClient: FakeAgentClient | undefined;
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, undefined, true, true, {}, async (method) => {
          if (provider === "grok" && method === "turn/start" && rejectTurnStart) {
            rejectTurnStart = false;
            throw new Error("Unknown Grok session: stale-session-id");
          }
        });
        if (provider === "grok") grokClient = client;
        return client;
      },
    });
    const warning = vi.spyOn(process.stderr, "write");
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "grok", model: "grok-4.5" });

    await service.sendMessage({ agentId: "chief", text: "Recover this request" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");

    expect(grokClient?.requests.filter((request) => request.method === "thread/start")).toHaveLength(1);
    expect(grokClient?.requests.filter((request) => request.method === "thread/resume")).toHaveLength(1);
    expect(grokClient?.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
    expect(
      (await service.readConversation("chief")).messages.filter((message) => message.author === "user"),
    ).toHaveLength(1);
    expect(
      warning.mock.calls.some(
        ([chunk]) =>
          String(chunk).includes("Recovered an unavailable provider session.") &&
          String(chunk).includes('"outcome":"resumed"'),
      ),
    ).toBe(true);
    warning.mockRestore();
  });

  it.each(["grok", "opencode"] as const)(
    "replaces a %s session that the provider can no longer resume",
    async (target) => {
      process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
      process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
      let rejectResume = false;
      let providerClient: FakeAgentClient | undefined;
      const { store, mailbox } = stores(root);
      service = createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: (provider) => {
          const client = new FakeAgentClient(provider, "PROVIDER_DONE", true, true, {}, async (method) => {
            if (provider === target && method === "thread/resume" && rejectResume) {
              throw new Error(`${target} session not found`);
            }
          });
          if (provider === target) providerClient = client;
          return client;
        },
      });
      const warning = vi.spyOn(process.stderr, "write");
      await service.initialize();
      await store.getOrCreate("chief");
      await service.updateAgent({
        agentId: "chief",
        provider: target,
        model: target === "grok" ? "grok-4.5" : "opencode/example-model",
      });
      await service.sendMessage({ agentId: "chief", text: "First provider request" });
      await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
      const publicThreadId = service.listAgents().find((agent) => agent.id === "chief")?.threadId;
      const originalSessionId = store.activeProviderSession("chief")?.externalSessionId;
      if (!publicThreadId || !originalSessionId) throw new Error("The first provider session was not created.");

      rejectResume = true;
      await service.updateAgent({ agentId: "chief", description: "Force the provider session to reload." });
      await service.sendMessage({ agentId: "chief", text: "Continue after recovery" });
      await waitFor(() => service?.listQueue("chief").deliveries[1]?.status === "completed");

      const sessions = store.database.listProviderSessions(publicThreadId);
      expect(sessions).toMatchObject([
        { externalSessionId: originalSessionId, provider: target, state: "inactive" },
        { provider: target, state: "active" },
      ]);
      expect(sessions[1]?.externalSessionId).not.toBe(originalSessionId);
      const turns = providerClient?.requests.filter((request) => request.method === "turn/start") ?? [];
      expect(firstInputText(turns[1]?.params)).toContain("PROVIDER_DONE");
      expect(firstInputText(turns[1]?.params)).toContain("Continue after recovery");
      expect(
        warning.mock.calls.some(
          ([chunk]) =>
            String(chunk).includes("Recovered an unavailable provider session.") &&
            String(chunk).includes('"outcome":"replaced"'),
        ),
      ).toBe(true);
      warning.mockRestore();
    },
  );

  it("stores a visible summary when a provider handoff exceeds its budget", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const output = provider === "codex" ? "X".repeat(250_000) : "CLAUDE_DONE";
        const client = new FakeAgentClient(provider, output);
        clients.set(provider, client);
        return client;
      },
      preferredProvider: "codex",
    });
    service = agentService;
    await service.sendMessage({ agentId: "chief", text: "Create a long result" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
    const publicThreadId = service.listAgents().find((agent) => agent.id === "chief")?.threadId;

    await service.updateAgent({ agentId: "chief", provider: "claude", model: "claude-sonnet-5" });
    await service.sendMessage({ agentId: "chief", text: "Continue from the result" });
    await waitFor(() => service?.listQueue("chief").deliveries[1]?.status === "completed");

    const claudeTurn = clients.get("claude")?.requests.find((request) => request.method === "turn/start")?.params;
    expect(firstInputText(claudeTurn)).toContain("oldest visible history was summarized");
    if (!publicThreadId) throw new Error("The public thread was not created.");
    expect(store.database.latestThreadSummary(publicThreadId)).toMatchObject({
      threadId: publicThreadId,
      throughMessageId: expect.any(String),
    });
  });

  it("starts a new thread with the persisted onboarding remit", async () => {
    const { service: agentService, store } = await startService(root);
    service = agentService;
    await store.getOrCreate("chief");
    await service.updateAgent({
      agentId: "chief",
      title: "Research & writing",
      description: "Researches topics and turns findings into clear writing.",
    });

    await service.sendMessage({
      agentId: "chief",
      text: "Focus on research and writing.",
    });
    await waitFor(async () => (await protocolMessages(logPath)).some((message) => message.method === "thread/start"));

    const start = (await protocolMessages(logPath)).find((message) => message.method === "thread/start");
    const instructions = getString(start?.params, "developerInstructions") ?? "";
    expect(instructions).toContain('"title": "Research & writing"');
    expect(instructions).toContain('"description": "Researches topics and turns findings into clear writing."');
    expect(instructions).toContain("Be pragmatic and direct");
    expect(instructions).toContain("Give the shortest answer that is complete and useful");
    expect(instructions).toContain("Do not add filler");
    expect(instructions).toContain("openbot.ask_user");
    expect(instructions).toContain("GitHub-flavored Markdown tables");
    expect(instructions).toContain("at least three dashes per column");
    expect(instructions).toContain("put exactly ✓ or — in every option cell");
    expect(instructions).toContain("render that Markdown as a comparison table");
    expect(instructions).toContain("standing remit");
  });

  it("keeps rapid messages in FIFO order before the first turn-start event is observed", async () => {
    const { service: agentService } = await startService(root);
    service = agentService;

    await service.sendMessage({ agentId: "chief", text: "Start immediately" });
    await service.sendMessage({ agentId: "chief", text: "Wait behind the first message" });

    await waitFor(() => {
      const deliveries = service?.listQueue("chief").deliveries ?? [];
      return deliveries[0]?.status === "running" && deliveries[1]?.status === "queued";
    });
    const deliveries = service.listQueue("chief").deliveries;
    expect(deliveries.map((delivery) => delivery.text)).toEqual(["Start immediately", "Wait behind the first message"]);
    expect((await protocolMessages(logPath)).filter((message) => message.method === "turn/start")).toHaveLength(1);
  });

  it("keeps each completed response after the queued message that started its turn", async () => {
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
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Question 1" });
    await service.sendMessage({ agentId: "chief", text: "Question 2" });
    await service.sendMessage({ agentId: "chief", text: "Question 3" });
    await service.sendMessage({ agentId: "chief", text: "Question 4" });

    await waitFor(() => {
      const deliveries = service?.listQueue("chief").deliveries ?? [];
      return deliveries.length === 4 && deliveries.every((delivery) => delivery.status === "completed");
    });

    const conversation = await service.readConversation("chief");
    const turnMessages = conversation.messages.filter(
      (message) => message.author === "user" || message.author === "assistant",
    );
    expect(turnMessages).toHaveLength(8);
    for (let index = 0; index < turnMessages.length; index += 2) {
      expect(turnMessages[index]?.author).toBe("user");
      expect(turnMessages[index + 1]?.author).toBe("assistant");
      expect(turnMessages[index + 1]?.turnId).toBe(turnMessages[index]?.turnId);
      expect(turnMessages[index]?.delivery).toMatchObject({ status: "completed" });
    }
    expect(clients.get("codex")?.requests.filter((request) => request.method === "turn/start")).toHaveLength(4);

    // MailboxSync.emitQueue tells the renderer about every queue transition.
    const queueEvents = events.filter((event) => event.type === "queue-changed");
    expect(queueEvents.length).toBeGreaterThan(0);
    const lastQueue = queueEvents.at(-1);
    expect(lastQueue?.type).toBe("queue-changed");
    if (lastQueue?.type === "queue-changed") {
      expect(lastQueue.snapshot.deliveries).toHaveLength(4);
      expect(lastQueue.snapshot.deliveries.every((delivery) => delivery.status === "completed")).toBe(true);
    }

    // A finished turn is never published with a stale delivery: completeTurn
    // stamps the terminal status before anything renders the snapshot, so any
    // publication with no active turn shows terminal deliveries.
    for (const event of events) {
      if (event.type !== "conversation" || event.snapshot.activeTurnId !== null) continue;
      for (const message of event.snapshot.messages) {
        if (message.author !== "user" || !message.turnId) continue;
        expect(message.delivery?.status).toBe("completed");
      }
    }
  });

  it("queues FIFO instead of steering and continues draining after an interrupt", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Start" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const active = events.find((event) => event.type === "turn-started");
    if (active?.type !== "turn-started") throw new Error("Turn did not start.");
    await service.sendMessage({ agentId: "chief", text: "Run after the first task" });

    const queue = service.listQueue("chief");
    expect(queue.deliveries.map((item) => item.status)).toEqual(["running", "queued"]);
    expect((await protocolMessages(logPath)).some((message) => message.method === "turn/steer")).toBe(false);

    await service.interrupt("chief", active.turnId);
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "interrupted");

    await waitFor(
      async () => (await protocolMessages(logPath)).filter((item) => item.method === "turn/start").length === 2,
    );
    expect(service.listQueue("chief").deliveries[1]?.status).toBe("running");

    const conversationSignatures = events
      .filter((event) => event.type === "conversation" && event.snapshot.agentId === "chief")
      .map((event) =>
        event.type === "conversation"
          ? JSON.stringify({
              threadId: event.snapshot.threadId,
              activeTurnId: event.snapshot.activeTurnId,
              messages: event.snapshot.messages,
            })
          : "",
      );
    for (let index = 1; index < conversationSignatures.length; index += 1) {
      expect(conversationSignatures[index]).not.toBe(conversationSignatures[index - 1]);
    }
  });
});
