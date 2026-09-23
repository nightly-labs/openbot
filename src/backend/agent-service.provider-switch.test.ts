import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
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

describe.sequential("AgentService: provider switches", () => {
  it("removes private handoff files immediately when replacement session binding fails", async () => {
    const { service: agentService, store } = await startService(root, {
      provider: "codex",
      preferredProvider: "codex",
    });
    service = agentService;
    await service.sendMessage({ agentId: "chief", text: "Private history for the replacement session." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const original = store.activeProviderSession("chief")?.externalSessionId;
    const manifests = join(store.database.userDataPath, "provider-toolsets");
    const recorded = await readdir(manifests);
    for (const file of recorded) await writeFile(join(manifests, file), "outdated");
    const binding = vi.spyOn(store, "bindProviderSession").mockImplementationOnce(() => {
      throw new Error("Session binding failed.");
    });
    try {
      await service.sendMessage({ agentId: "chief", text: "Continue with new tools." });
      await waitFor(() => service?.listQueue("chief").deliveries.some((delivery) => delivery.status === "failed"));
      expect(store.activeProviderSession("chief")?.externalSessionId).toBe(original);
      expect(await readdir(join(store.database.userDataPath, "provider-handoffs"))).toEqual([]);
      expect(await readdir(manifests)).toEqual(recorded);
    } finally {
      binding.mockRestore();
    }
  });

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
});
