// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import { AgentService } from "./agent-service";
import {
  CREATE_AGENT_INPUT,
  callOpenBotTool,
  createFakeClaude,
  createFakeGrok,
  createFakeOpencode,
  FakeAgentClient,
  fakeBrowser,
  firstInputText,
  inputRecords,
  notification,
  openBotToolPayload,
  protocolMessages,
  startAgentTestFixture,
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

describe.sequential("AgentService: queue", () => {
  it("updates the active account and new-agent defaults with the preferred provider", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "claude");

    await service.initialize();

    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      auth: { kind: "claude", email: "claude@example.com" },
      providers: [
        {
          id: "codex",
          state: "available",
          version: "0.144.1",
          email: "codex@example.com",
        },
        {
          id: "claude",
          state: "available",
          version: "2.1.246",
          email: "claude@example.com",
        },
        { id: "grok", state: "not-installed", version: null },
        { id: "opencode", state: "not-installed", version: null },
      ],
    });
    await expect(
      service.createAgent({
        ...CREATE_AGENT_INPUT,
        name: "Claude Planning Agent",
        avatarSeed: "setup:claude-planning",
      }),
    ).resolves.toMatchObject({
      model: "claude-sonnet-5",
      reasoningEffort: "high",
    });
    await service.setPreferredProvider("codex");
    expect(service.getStatus()).toMatchObject({
      auth: { kind: "chatgpt", email: "codex@example.com" },
      cliVersion: "0.144.1",
    });
    await expect(service.createAgent(CREATE_AGENT_INPUT)).resolves.toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
    });
  });

  it("detects a newly installed provider without disconnecting an available one", async () => {
    const codexPath = process.env.OPENBOT_CODEX_PATH;
    if (!codexPath) throw new Error("The fake Codex path is missing.");
    process.env.OPENBOT_CODEX_PATH = join(root, "missing-codex");
    const workingDirectory = process.cwd();
    process.chdir(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    try {
      await service.initialize();
      expect(service.getStatus()).toMatchObject({
        phase: "blocked",
        providers: [
          { id: "codex", state: "error", message: expect.stringContaining("included ChatGPT runtime") },
          { id: "claude", state: "error", message: expect.stringContaining("included Claude runtime") },
          { id: "grok", state: "not-installed" },
          { id: "opencode", state: "not-installed" },
        ],
      });

      process.env.OPENBOT_CODEX_PATH = codexPath;
      await expect(service.refreshProviders()).resolves.toMatchObject({
        phase: "ready",
        providers: [
          { id: "codex", state: "available" },
          { id: "claude", state: "error", message: expect.stringContaining("included Claude runtime") },
          { id: "grok", state: "not-installed" },
          { id: "opencode", state: "not-installed" },
        ],
      });
      const codexClient = clients.get("codex");
      expect(codexClient?.running).toBe(true);

      await service.refreshProviders();

      expect(clients.get("codex")).toBe(codexClient);
      expect(codexClient?.running).toBe(true);
      expect(service.getStatus().providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "codex", state: "available" }),
          expect.objectContaining({ id: "claude", state: "error" }),
          expect.objectContaining({ id: "grok", state: "not-installed" }),
        ]),
      );
    } finally {
      process.chdir(workingDirectory);
    }
  });

  it("returns a provider refresh before runtime metadata finishes loading", async () => {
    const { store, mailbox } = stores(root);
    let holdMetadata = false;
    let releaseMetadata: (() => void) | undefined;
    const metadataReleased = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) =>
        new FakeAgentClient(provider, "DONE", true, true, {}, async (method) => {
          if (holdMetadata && (method === "model/list" || method === "plugin/list")) await metadataReleased;
        }),
    );
    await service.initialize();
    holdMetadata = true;

    const outcome = await Promise.race([
      service.refreshProviders().then(() => "resolved" as const),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 500)),
    ]);
    releaseMetadata?.();

    expect(outcome).toBe("resolved");
    expect(service.getStatus().phase).toBe("ready");
  });

  it("keeps a connected provider and surfaces its account refresh warning", async () => {
    const { store, mailbox } = stores(root);
    let accountReads = 0;
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) =>
        new FakeAgentClient(provider, "DONE", true, true, {}, async (method) => {
          if (method === "account/read" && ++accountReads === 2) throw new Error("Temporary account API failure");
        }),
    );
    await service.initialize();

    await service.refreshProviders();

    expect(service.getStatus().providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codex",
          state: "available",
          checkError: "Could not verify ChatGPT. Keeping the existing connection.",
        }),
      ]),
    );
  });

  it("removes a new Agent and its workspace when the first message cannot enter the queue", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
    vi.spyOn(mailbox, "enqueue").mockRejectedValueOnce(new Error("Queue write failed."));

    await expect(service.createAgent(CREATE_AGENT_INPUT)).rejects.toThrow("Queue write failed.");

    expect(service.listAgents()).toEqual([]);
    expect(store.database.listAgents()).toEqual([]);
    await expect(readdir(join(root, "home", "OpenBot", "Agents"))).resolves.toEqual([]);
  });

  it("removes queued profile creation on receipt failure and runs only the successful retry", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex");
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
    await service.initialize();
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
      service = new AgentService(restarted.store, restarted.mailbox, fakeBrowser(), 30_000, "codex", () => client);
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();

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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, undefined, true, true, {}, async (method) => {
        if (provider === "grok" && method === "turn/start" && rejectTurnStart) {
          rejectTurnStart = false;
          throw new Error("Unknown Grok session: stale-session-id");
        }
      });
      if (provider === "grok") grokClient = client;
      return client;
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
      service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
        const client = new FakeAgentClient(provider, "PROVIDER_DONE", true, true, {}, async (method) => {
          if (provider === target && method === "thread/resume" && rejectResume) {
            throw new Error(`${target} session not found`);
          }
        });
        if (provider === target) providerClient = client;
        return client;
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const output = provider === "codex" ? "X".repeat(250_000) : "CLAUDE_DONE";
      const client = new FakeAgentClient(provider, output);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
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
    service = new AgentService(store, mailbox, fakeBrowser());
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

  it("steers a queued delivery into the active turn and completes it with that turn", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "CODEX_DONE", false);
      clients.set(provider, client);
      return client;
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Start this turn" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const active = events.find((event) => event.type === "turn-started");
    if (active?.type !== "turn-started") throw new Error("Turn did not start.");
    await service.sendMessage({ agentId: "chief", text: "Add this to the active turn" });
    const queued = service.listQueue("chief").deliveries.find((delivery) => delivery.status === "queued");
    if (!queued) throw new Error("Queued delivery was not created.");

    await service.steerQueuedMessage({
      agentId: "chief",
      deliveryId: queued.id,
      expectedTurnId: active.turnId,
    });

    const client = clients.get("codex");
    expect(client?.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "turn/steer",
          params: expect.objectContaining({
            expectedTurnId: active.turnId,
            clientUserMessageId: queued.id,
          }),
        }),
      ]),
    );
    const externalThreadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !externalThreadId) throw new Error("Active provider session is missing.");
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId: externalThreadId,
        turn: { id: active.turnId, status: "completed" },
      }),
    );
    await waitFor(() =>
      service
        ?.listQueue("chief")
        .deliveries.filter((delivery) => delivery.id === queued.id)
        .every((delivery) => delivery.status === "completed"),
    );
  });

  it("renders a Codex image generation item and manages its saved image", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    const imagePath = join(root, "codex-image.png");
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "", false);
      clients.set(provider, client);
      return client;
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Create a mountain observatory." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake Codex turn did not start.");
    }
    const item = {
      id: "image-call-1",
      type: "image_generation_call",
      status: "in_progress",
      size: "1536x1024",
      aspect_ratio: "landscape",
    };
    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId: started.turnId,
        item,
      }),
    );
    await waitFor(async () =>
      (await service?.readConversation("chief"))?.messages.some(
        (message) => message.id === item.id && message.status === "streaming",
      ),
    );
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: started.turnId,
        item: {
          ...item,
          status: "completed",
          revised_prompt: "A mountain observatory at blue hour",
          saved_path: imagePath,
        },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: started.turnId, status: "completed" },
      }),
    );

    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === item.id,
      );
      return message?.status === "completed" && Boolean(message.attachments?.[0]);
    });
    const message = (await service.readConversation("chief")).messages.find((candidate) => candidate.id === item.id);
    expect(message).toMatchObject({
      itemType: "image_generation",
      imageGeneration: {
        prompt: "A mountain observatory at blue hour",
        resolution: "1536x1024",
        aspectRatio: "landscape",
      },
      attachments: [{ kind: "image", previewKind: "image" }],
    });
    await expect(mailbox.resolveAttachment(message?.attachments?.[0]?.id ?? "")).resolves.toMatchObject({
      mimeType: "image/png",
    });
  });

  it("falls back to Codex base64 image results without persisting the encoded payload", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "", false);
      clients.set(provider, client);
      return client;
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Make this image vivid." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake Codex turn did not start.");
    }
    const imageCall = { id: "image-call-base64", type: "image_generation_call" };
    client.emit("notification", notification("item/started", { threadId, turnId: started.turnId, item: imageCall }));
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: started.turnId,
        item: {
          ...imageCall,
          status: "completed",
          result: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
        },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: started.turnId, status: "completed" },
      }),
    );

    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === imageCall.id,
      );
      return message?.status === "completed" && Boolean(message.attachments?.[0]);
    });
    const message = (await service.readConversation("chief")).messages.find(
      (candidate) => candidate.id === imageCall.id,
    );
    expect(JSON.stringify(message)).not.toContain("iVBORw0KGgo");
    await expect(mailbox.resolveAttachment(message?.attachments?.[0]?.id ?? "")).resolves.toMatchObject({
      mimeType: "image/png",
    });
  });

  it("keeps failed and interrupted image generations visible in the conversation", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "", false);
      clients.set(provider, client);
      return client;
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Generate two atmospheric studies." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake Codex turn did not start.");
    }
    const failedCall = { id: "image-call-failed", type: "image_generation_call" };
    const interruptedCall = { id: "image-call-interrupted", type: "image_generation_call" };
    client.emit("notification", notification("item/started", { threadId, turnId: started.turnId, item: failedCall }));
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: started.turnId,
        item: {
          ...failedCall,
          status: "failed",
          failure: { message: "The image provider rejected the prompt." },
        },
      }),
    );
    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId: started.turnId,
        item: interruptedCall,
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: started.turnId, status: "interrupted" },
      }),
    );

    await waitFor(async () => {
      const messages = (await service?.readConversation("chief"))?.messages ?? [];
      return (
        messages.some(
          (message) =>
            message.id === failedCall.id &&
            message.status === "failed" &&
            message.imageGeneration?.error === "The image provider rejected the prompt.",
        ) && messages.some((message) => message.id === interruptedCall.id && message.status === "interrupted")
      );
    });
    const messages = (await service.readConversation("chief")).messages;
    expect(messages.find((message) => message.id === failedCall.id)?.imageGeneration?.prompt).toBe(
      "Generate two atmospheric studies.",
    );
    expect(messages.find((message) => message.id === interruptedCall.id)?.imageGeneration?.error).toBe(
      "Image generation was interrupted.",
    );
  });

  it("marks an active image generation interrupted before a late Codex result arrives", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "", false);
      clients.set(provider, client);
      return client;
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Generate a cinematic still." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake Codex turn did not start.");
    }
    const item = {
      id: "image-call-late-result",
      type: "image_generation_call",
      status: "in_progress",
      revised_prompt: "A cinematic still at blue hour",
    };
    client.emit("notification", notification("item/started", { threadId, turnId: started.turnId, item }));
    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === item.id,
      );
      return message?.status === "streaming";
    });

    await service.interrupt("chief", started.turnId);
    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === item.id,
      );
      return message?.status === "interrupted";
    });

    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: started.turnId,
        item: {
          ...item,
          status: "completed",
          result: Buffer.from("late-image").toString("base64"),
        },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId,
        turn: { id: started.turnId, status: "interrupted" },
      }),
    );

    await waitFor(async () => {
      const message = (await service?.readConversation("chief"))?.messages.find(
        (candidate) => candidate.id === item.id,
      );
      return message?.status === "interrupted" && !message.attachments?.length;
    });
    const message = (await service.readConversation("chief")).messages.find((candidate) => candidate.id === item.id);
    expect(message?.imageGeneration?.error).toBe("Image generation was interrupted.");
  });

  it("waits for active queue drains before shutdown completes", async () => {
    process.env.OPENBOT_FAKE_TURN_START_RESPONSE_DELAY = "100";
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Stop during startup" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "starting");
    await service.stop();

    expect(["failed", "interrupted"]).toContain(service.listQueue("chief").deliveries[0]?.status);
  });

  it("fans out an idempotent agent tool message with referenced files", async () => {
    process.env.OPENBOT_FAKE_AGENT_TOOL = "1";
    const notePath = join(root, "generated-note.txt");
    const imagePath = join(root, "generated-image.png");
    await Promise.all([
      writeFile(notePath, "OPENBOT_SHARED_FILE_OK\n"),
      writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    ]);
    process.env.OPENBOT_FAKE_AGENT_TOOL_PATHS = JSON.stringify([notePath, imagePath]);
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
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
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      provider,
      (selectedProvider) => {
        const client = new FakeAgentClient(selectedProvider);
        clients.set(selectedProvider, client);
        return client;
      },
      undefined,
      undefined,
      null,
      context === "unavailable" ? null : sidebar,
    );
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

  it("creates and groups a persistent teammate from conversation and rejects invalid changes", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    const sidebarPath = join(root, "sidebar-layout.json");
    const sidebar = new SidebarLayoutStore(sidebarPath);
    await sidebar.initialize();
    const changes: unknown[] = [];
    sidebar.on("changed", (layout) => changes.push(layout));
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
      undefined,
      undefined,
      null,
      sidebar,
    );
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Create a research teammate." });
    await waitFor(() => Boolean(store.activeProviderSession("chief")?.externalSessionId));
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !threadId) throw new Error("The agent session did not start.");
    const result = await callOpenBotTool(client, threadId, "create_agent", {
      name: "Research Partner",
      title: "Research",
      description: "Find primary sources.",
      initialMessage: "Research train routes to Berlin.",
      avatarSeed: "research-partner",
      avatarHue: 150,
    });
    expect(result.error).toBeUndefined();
    const created = openBotToolPayload(result.result);
    expect(created).toMatchObject({
      name: "Research Partner",
      title: "Research",
      description: "Find primary sources.",
      avatarSeed: "research-partner",
      avatarHue: 150,
    });
    const agentId = getString(created, "id");
    if (!agentId) throw new Error("The tool did not return the created agent id.");
    expect(service.listQueue(agentId).deliveries).toHaveLength(1);
    await service.setAvatar(agentId, {
      mimeType: "image/png",
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    expect(store.resolveAvatar(agentId)).not.toBeNull();
    const caller = service.listAgents().find((agent) => agent.id === "chief");
    if (!caller) throw new Error("Missing calling agent.");
    const avatarPath = join(caller.workspacePath, "custom-avatar.png");
    const avatarBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(avatarPath, avatarBytes);
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    const custom = await callOpenBotTool(client, threadId, "update_profile", {
      agentId,
      avatarPath: "custom-avatar.png",
    });
    expect(custom.error).toBeUndefined();
    const customUrl = service.listAgents().find((agent) => agent.id === agentId)?.avatarUrl;
    expect(customUrl).toBeTruthy();
    expect(openBotToolPayload(custom.result)).toMatchObject({ id: agentId, avatarUrl: customUrl });
    expect(await readFile(store.resolveAvatar(agentId)?.path ?? "")).toEqual(avatarBytes);
    expect(await readFile(avatarPath)).toEqual(avatarBytes);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agents-changed",
        agents: expect.arrayContaining([expect.objectContaining({ id: agentId, avatarUrl: customUrl })]),
      }),
    );
    const restoredAvatarStore = stores(root).store;
    await restoredAvatarStore.initialize();
    expect(restoredAvatarStore.list().find((agent) => agent.id === agentId)?.avatarUrl).toBe(customUrl);
    restoredAvatarStore.database.close();
    for (const fields of [
      { avatarPath: "missing.png" },
      { avatarPath, avatarHue: null },
      { avatarPath, avatarSeed: "new-seed" },
    ]) {
      const rejected = await callOpenBotTool(client, threadId, "update_profile", {
        agentId,
        name: "Must not change",
        ...fields,
      });
      expect(rejected.error).toBeDefined();
      expect(service.listAgents().find((agent) => agent.id === agentId)).toMatchObject({
        name: "Research Partner",
        avatarUrl: customUrl,
      });
    }
    const replaced = await callOpenBotTool(client, threadId, "update_profile", { agentId, avatarPath });
    expect(replaced.error).toBeUndefined();
    expect(service.listAgents().find((agent) => agent.id === agentId)?.avatarUrl).not.toBe(customUrl);
    const invalid = await callOpenBotTool(client, threadId, "update_profile", {
      agentId,
      name: "Invalid",
      avatarHue: 999,
    });
    expect(invalid.error).toBeDefined();
    expect(service.listAgents().find((agent) => agent.id === agentId)?.name).toBe("Research Partner");
    const invalidCreation = await callOpenBotTool(client, threadId, "create_agent", {
      name: "Invalid",
      description: "",
      initialMessage: " ",
    });
    expect(invalidCreation.error).toBeDefined();
    expect(service.listAgents().filter((agent) => agent.name === "Invalid")).toEqual([]);
    await callOpenBotTool(client, threadId, "update_profile", { agentId, avatarHue: null });
    expect(service.listAgents().find((agent) => agent.id === agentId)?.avatarUrl).toBeNull();
    expect(store.resolveAvatar(agentId)).toBeNull();
    const initialLayout = await callOpenBotTool(client, threadId, "list_sections", {});
    expect(openBotToolPayload(initialLayout.result)).toMatchObject({ sections: [], agentAssignments: {} });
    const grouped = await callOpenBotTool(client, threadId, "create_section", { name: "Research" });
    expect(grouped.error).toBeUndefined();
    const sectionId = sidebar.getSnapshot().sections[0]?.id;
    if (!sectionId) throw new Error("The section was not created.");
    const assigned = await callOpenBotTool(client, threadId, "assign_agent_section", { agentId, sectionId });
    expect(openBotToolPayload(assigned.result)).toMatchObject({ agentAssignments: { [agentId]: sectionId } });
    expect(changes.at(-1)).toMatchObject({ agentAssignments: { [agentId]: sectionId } });
    const renamed = await callOpenBotTool(client, threadId, "rename_section", { sectionId, name: "Travel" });
    expect(openBotToolPayload(renamed.result)).toMatchObject({ sections: [{ id: sectionId, name: "Travel" }] });
    const persistedSidebar = new SidebarLayoutStore(sidebarPath);
    await persistedSidebar.initialize();
    expect(persistedSidebar.getSnapshot()).toMatchObject({
      sections: [{ id: sectionId, name: "Travel" }],
      agentAssignments: { [agentId]: sectionId },
    });
    const beforeInvalid = sidebar.getSnapshot();
    for (const [tool, args] of [
      ["create_section", { name: " " }],
      ["create_section", { name: "Travel" }],
      ["assign_agent_section", { agentId: "missing-agent", sectionId }],
      ["assign_agent_section", { agentId, sectionId: "missing-section" }],
    ] as const) {
      const rejected = await callOpenBotTool(client, threadId, tool, args);
      expect(rejected.error).toBeDefined();
      expect(sidebar.getSnapshot()).toEqual(beforeInvalid);
    }
    const ungrouped = await callOpenBotTool(client, threadId, "assign_agent_section", { agentId, sectionId: null });
    expect(openBotToolPayload(ungrouped.result).agentAssignments).toEqual({});
    await callOpenBotTool(client, threadId, "assign_agent_section", { agentId, sectionId });
    const deleted = await callOpenBotTool(client, threadId, "delete_section", { sectionId });
    expect(openBotToolPayload(deleted.result).sections).toEqual([]);
    expect(openBotToolPayload(deleted.result).agentAssignments).toEqual({});
    expect(service.listAgents().some((agent) => agent.id === agentId)).toBe(true);
    await service.stop();
    service = null;
    const restored = stores(root);
    await restored.store.initialize();
    expect(restored.store.list().find((agent) => agent.id === agentId)).toMatchObject({
      name: "Research Partner",
      title: "Research",
      description: "Find primary sources.",
      avatarSeed: "research-partner",
      avatarHue: null,
    });
  });

  it("lists complete local profiles and updates a selected agent profile", async () => {
    process.env.OPENBOT_FAKE_AGENT_TOOL_CALLS = JSON.stringify([
      { tool: "list_agents", arguments: {} },
      {
        tool: "update_profile",
        arguments: {
          agentId: "design",
          name: "Design Studio",
          title: "Product design",
          description: "Owns product interface and visual design.",
          avatarSeed: "design-studio",
          avatarHue: 215,
        },
      },
    ]);
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
    await store.getOrCreate("design", "Designer", "Design");
    await service.sendMessage({ agentId: "chief", text: "Update the design teammate." });

    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.some((message) => message.id === "agent-tool-configured-1" && message.result);
    });

    expect(await store.getOrCreate("design")).toMatchObject({
      name: "Design Studio",
      title: "Product design",
      description: "Owns product interface and visual design.",
      avatarSeed: "design-studio",
      avatarHue: 215,
    });
    const listResponse = (await protocolMessages(logPath)).find((message) => message.id === "agent-tool-configured-0");
    expect(JSON.stringify(listResponse?.result)).toContain('\\"title\\":\\"Design\\"');
    expect(JSON.stringify(listResponse?.result)).toContain('\\"description\\":\\"\\"');
  });
});
