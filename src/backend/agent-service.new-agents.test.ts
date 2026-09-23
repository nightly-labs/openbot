// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVELOPMENT_DEFAULT_MODEL, DEVELOPMENT_DEFAULT_REASONING_EFFORT } from "./agent/development-defaults";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  CREATE_AGENT_INPUT,
  callOpenBotTool,
  createFakeClaude,
  createFakeOpencode,
  createTestService,
  FakeAgentClient,
  openBotToolPayload,
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

describe.sequential("AgentService: new agents and provider accounts", () => {
  it("starts a new agent in a development build on the OpenCode development model", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      developmentDefaults: true,
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") {
          client.modelList = () => ({
            data: [{ model: "opencode/muse-spark-1.3-contributor-free" }, { model: DEVELOPMENT_DEFAULT_MODEL }],
          });
        }
        return client;
      },
    });

    await service.initialize();
    await service.ensureProvider("opencode");

    // The developer asked for this model at this effort, and OpenCode lists it, so the built-in
    // `codex` default steps aside -- provider included, because the model belongs to OpenCode.
    await expect(service.createAgent(CREATE_AGENT_INPUT)).resolves.toMatchObject({
      provider: "opencode",
      model: DEVELOPMENT_DEFAULT_MODEL,
      reasoningEffort: DEVELOPMENT_DEFAULT_REASONING_EFFORT,
    });
  });

  it("leaves a packaged build and a recorded preference on their own model", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") client.modelList = () => ({ data: [{ model: DEVELOPMENT_DEFAULT_MODEL }] });
        return client;
      },
    });
    service = agentService;

    await service.ensureProvider("opencode");

    // Same catalog, no development build: the built-in default stands.
    await expect(service.createAgent(CREATE_AGENT_INPUT)).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.6-luna",
    });

    // And a provider the developer chose is theirs, development build or not.
    await service.setPreferredProvider("claude");
    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, name: "Chosen Agent", avatarSeed: "setup:chosen" }),
    ).resolves.toMatchObject({
      provider: "claude",
      model: "claude-sonnet-5",
    });
  });

  it("starts a new agent on the requested provider and model before the initial message", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") client.modelList = () => ({ data: [{ model: "opencode/example-model" }] });
        clients.set(provider, client);
        return client;
      },
    });
    await service.initialize();

    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, provider: "opencode", model: "opencode/example-model" }),
    ).resolves.toMatchObject({ provider: "opencode", model: "opencode/example-model" });
    // The initial turn ran on the requested provider: a follow-up provider change would be rejected
    // as active work, so the record has to name it before the first message is queued.
    await waitFor(
      () =>
        clients.get("opencode")?.requests.some((request) => request.method === "turn/start") === true &&
        clients.get("codex")?.requests.some((request) => request.method === "turn/start") !== true,
    );
  });

  it("rejects creation with an unlisted model and removes the incomplete agent", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider),
    });
    service = agentService;

    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, provider: "opencode", model: "opencode/no-such-model" }),
    ).rejects.toThrow("The selected agent model is unavailable.");
    expect(service.listAgents()).toEqual([]);
  });

  it("updates the active account and new-agent defaults with the preferred provider", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { service: agentService } = await startService(root, { preferredProvider: "claude" });
    service = agentService;

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
    // The store default, which is what a new agent on the default provider keeps: `low`, not the
    // `medium` the Codex CLI reports for every GPT-5.6 model.
    await expect(service.createAgent(CREATE_AGENT_INPUT)).resolves.toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    // Setup can record a model beside the provider, which is how a custom endpoint becomes the
    // default: it is a model of the CLI that runs it, so only the model names it.
    await service.setPreferredProvider("claude", "claude-opus-5");
    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, name: "Opus Agent", avatarSeed: "setup:opus" }),
    ).resolves.toMatchObject({
      provider: "claude",
      model: "claude-opus-5",
      reasoningEffort: "high",
    });
    // A recorded model the provider no longer lists is ignored, so a new agent still starts usable.
    await service.setPreferredProvider("claude", "claude-retired-9");
    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, name: "Fallback Agent", avatarSeed: "setup:fallback" }),
    ).resolves.toMatchObject({
      provider: "claude",
      model: "claude-sonnet-5",
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
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) =>
        new FakeAgentClient(provider, "DONE", true, true, {}, async (method) => {
          if (holdMetadata && (method === "model/list" || method === "plugin/list")) await metadataReleased;
        }),
    });
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
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) =>
        new FakeAgentClient(provider, "DONE", true, true, {}, async (method) => {
          if (method === "account/read" && ++accountReads === 2) throw new Error("Temporary account API failure");
        }),
    });
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
    const { service: agentService, store, mailbox } = await startService(root);
    service = agentService;
    vi.spyOn(mailbox, "enqueue").mockRejectedValueOnce(new Error("Queue write failed."));

    await expect(service.createAgent(CREATE_AGENT_INPUT)).rejects.toThrow("Queue write failed.");

    expect(service.listAgents()).toEqual([]);
    expect(store.database.listAgents()).toEqual([]);
    await expect(readdir(join(root, "home", "OpenBot", "Agents"))).resolves.toEqual([]);
  });
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

  it("creates and groups a persistent teammate from conversation and rejects invalid changes", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    const sidebarPath = join(root, "sidebar-layout.json");
    const sidebar = new SidebarLayoutStore(sidebarPath);
    await sidebar.initialize();
    const changes: unknown[] = [];
    sidebar.on("changed", (layout) => changes.push(layout));
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
      hostedSites: null,
      sidebarLayout: sidebar,
    });
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
    const { service: agentService, store } = await startService(root);
    service = agentService;
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
