import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { type AgentEvent, COMPUTER_USE_MCP_SERVER_NAME } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createTestService,
  FakeAgentClient,
  fakeBrowser,
  firstInputText,
  notification,
  paramsRecord,
  protocolMessages,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import type { DynamicToolCallParams } from "./protocol";

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

describe.sequential("AgentService: providers", () => {
  it("derives live progress from the provider-neutral turn and tool lifecycle", async () => {
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
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Check the latest result" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake provider turn did not start.");
    }
    const turnId = started.turnId;

    const progress = () =>
      events.filter(
        (event): event is Extract<AgentEvent, { type: "turn-progress" }> =>
          event.type === "turn-progress" && event.turnId === turnId,
      );
    expect(progress()).toEqual([]);
    const stored = await service.readConversation("chief");
    expect(stored.messages.find((message) => message.id === `activity:${turnId}`)).toBeUndefined();
    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId,
        item: { id: "reasoning-1", type: "reasoning", summary: [], content: [] },
      }),
    );
    client.emit(
      "notification",
      notification("item/reasoning/summaryTextDelta", {
        threadId,
        turnId,
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: "Inspecting the sources.",
      }),
    );
    client.emit(
      "notification",
      notification("item/reasoning/summaryPartAdded", {
        threadId,
        turnId,
        itemId: "reasoning-1",
        summaryIndex: 1,
      }),
    );
    client.emit(
      "notification",
      notification("item/reasoning/summaryTextDelta", {
        threadId,
        turnId,
        itemId: "reasoning-1",
        summaryIndex: 1,
        delta: "Comparing the results.",
      }),
    );
    const reasoning = (await service.readConversation("chief")).messages.find(
      (message) => message.id === "reasoning-1",
    );
    expect(reasoning).toMatchObject({
      itemType: "commentary",
      status: "streaming",
      text: "Inspecting the sources.\n\nComparing the results.",
    });
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId,
        item: {
          id: "reasoning-1",
          type: "reasoning",
          summary: ["Inspecting the sources.", "Comparing the results."],
          content: [],
        },
      }),
    );
    expect(
      (await service.readConversation("chief")).messages.find((message) => message.id === "reasoning-1"),
    ).toMatchObject({
      itemType: "commentary",
      status: "completed",
      text: reasoning?.text,
    });
    const conversationEventCount = () => events.filter((event) => event.type === "conversation").length;
    const persistedBeforeTools = conversationEventCount();

    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId,
        item: { id: "tool-1", type: "toolCall", name: "web_search", status: "in_progress" },
      }),
    );
    await waitFor(() => progress().at(-1)?.detail === "Searching for current information…");

    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId,
        item: { id: "tool-1", type: "toolCall", name: "web_search", status: "completed" },
      }),
    );
    await waitFor(() => progress().at(-1)?.detail === "Reviewing the sources and information I found…");
    expect(conversationEventCount()).toBe(persistedBeforeTools);

    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId,
        item: { id: "answer-1", type: "agentMessage", text: "Here is the result." },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } }),
    );
    await waitFor(() => events.some((event) => event.type === "turn-completed" && event.turnId === turnId));
  });

  it("creates a bounded runtime snapshot for reconnecting clients", async () => {
    const { service: agentService, store } = await startService(root);
    service = agentService;
    await store.getOrCreate("chief");

    expect(service.getRuntimeSnapshot()).toMatchObject({
      agents: [expect.objectContaining({ id: "chief" })],
      activeTurns: [],
      work: [],
      attentionComplete: true,
      pendingPrompts: [],
      pendingApprovals: [],
      pendingBrowserTakeovers: [],
      failedTurns: [],
    });
    expect(service.getRuntimeSnapshot().agents[0]).not.toHaveProperty("workspacePath");
    expect(service.getRuntimeSnapshot().agents[0]).not.toHaveProperty("description");
  });

  it("resolves only regular files inside the shared directory", async () => {
    const { service: agentService, store } = await startService(root);
    service = agentService;

    const nested = join(store.sharedRoot, "nested");
    const sharedFile = join(nested, "report.csv");
    const outside = join(root, "outside.csv");
    const link = join(nested, "outside-link.csv");
    await mkdir(nested, { recursive: true });
    await writeFile(sharedFile, "value\n");
    await writeFile(outside, "secret\n");
    await symlink(outside, link);

    await expect(service.resolveSharedFile("~/OpenBot/Shared/nested/report.csv")).resolves.toMatchObject({
      path: await realpath(sharedFile),
      name: "report.csv",
      size: 6,
    });
    await expect(service.resolveSharedFile(outside)).rejects.toThrow("inside the shared directory");
    await expect(service.resolveSharedFile(link)).rejects.toThrow("inside the shared directory");
  });

  it("opens a historical routine message that only exists in the mailbox", async () => {
    const { service: agentService, store, mailbox } = await startService(root);
    service = agentService;
    await store.getOrCreate("chief");
    await store.ensureThreadId("chief");
    const receipt = await mailbox.enqueue({
      sender: {
        kind: "routine",
        routineId: "routine-1",
        runId: "run-1",
        routineName: "Morning brief",
        scheduledFor: "2026-08-25T07:00:00.000Z",
      },
      recipientAgentIds: ["chief"],
      text: "Prepare the morning brief.",
      idempotencyKey: "test:routine-history:run-1",
    });
    const messageId = receipt.deliveries[0]?.id;
    if (!messageId) throw new Error("The routine delivery was not created.");

    const page = await service.readConversationPageFor("chief", "member-1", { type: "around", messageId }, 50);

    expect(page.messages).toContainEqual(
      expect.objectContaining({
        id: messageId,
        source: "routine",
        routine: expect.objectContaining({ routineId: "routine-1", runId: "run-1" }),
      }),
    );
  });

  it("resolves only regular files inside the selected agent workspace", async () => {
    const { service: agentService, store } = await startService(root);
    service = agentService;

    const agent = await store.createAgent(CREATE_AGENT_INPUT);
    const appDirectory = join(agent.workspacePath, "app");
    const page = join(appDirectory, "page.tsx");
    const spaced = join(agent.workspacePath, "lutra brand board.html");
    const outside = join(root, "outside.html");
    const link = join(appDirectory, "outside-link.html");
    await mkdir(appDirectory, { recursive: true });
    await writeFile(page, "export default function Page() {}\n");
    await writeFile(spaced, "<!doctype html>\n");
    await writeFile(outside, "secret\n");
    await symlink(outside, link);

    await expect(service.resolveWorkspaceFile(agent.id, "app/page.tsx")).resolves.toMatchObject({
      path: await realpath(page),
      name: "page.tsx",
    });
    await expect(service.resolveWorkspaceFile(agent.id, page)).resolves.toMatchObject({
      path: await realpath(page),
      name: "page.tsx",
    });
    await expect(service.resolveWorkspaceFile(agent.id, "lutra%20brand%20board.html")).resolves.toMatchObject({
      path: await realpath(spaced),
      name: "lutra brand board.html",
    });
    await expect(service.resolveWorkspaceFile(agent.id, outside)).rejects.toThrow("inside the agent workspace");
    await expect(service.resolveWorkspaceFile(agent.id, link)).rejects.toThrow("inside the agent workspace");
    await expect(service.resolveWorkspaceFile("missing", page)).rejects.toThrow("Unknown agent");
  });

  it("does not surface the skills context-budget notice as an agent error", async () => {
    process.env.OPENBOT_FAKE_WARNING = "Skill descriptions were shortened to fit the skills context budget.";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "First task" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("Skill descriptions were shortened"),
        }),
      ]),
    );
  });

  it("expands inline file references before sending text to the agent", async () => {
    const source = join(root, "start-types.d.ts");
    await writeFile(source, "export type Start = true;\n");
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { service: agentService } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
      preferredProvider: "codex",
    });
    service = agentService;
    const [draft] = await service.prepareAttachments([source]);

    await service.sendMessage({
      agentId: "chief",
      text: `Review ${serializeAttachmentReference(draft.name, draft.id)}`,
      attachmentDraftIds: [draft.id],
    });
    await waitFor(() => Boolean(clients.get("codex")?.requests.some((request) => request.method === "turn/start")));

    const turn = clients.get("codex")?.requests.find((request) => request.method === "turn/start");
    const inputText = firstInputText(turn?.params);
    expect(inputText).toContain("Review start-types.d.ts");
    expect(inputText).not.toContain("attachment:");
  });

  it("expands agent and skill tags before sending text to the agent", async () => {
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
    await store.getOrCreate("research", "Research Lead", "Research partner");

    await service.sendMessage({
      agentId: "chief",
      text: `Ask ${serializeChatTagReference("agent", "Old Research", "research")} to use ${serializeChatTagReference("skill", "Release Notes", "skill-1")}.`,
    });
    await waitFor(() => Boolean(clients.get("codex")?.requests.some((request) => request.method === "turn/start")));

    const turn = clients.get("codex")?.requests.find((request) => request.method === "turn/start");
    expect(firstInputText(turn?.params)).toContain("Ask @Research Lead to use Release Notes (skill).");
    expect(firstInputText(turn?.params)).not.toContain("Old Research");
  });

  it("creates independent full-access threads with browser and OpenBot tools", async () => {
    const { service: agentService, store } = await startService(root);
    service = agentService;

    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      auth: { kind: "chatgpt", email: "codex@example.com" },
      providers: [
        {
          id: "codex",
          state: "available",
          version: "0.144.1",
          email: "codex@example.com",
        },
        { id: "claude", state: "error", version: null },
        { id: "grok", state: "not-installed", version: null },
        { id: "opencode", state: "not-installed", version: null },
      ],
      // Unavailable because no Computer Use driver was given to this service. It no longer follows
      // from Codex being connected.
      capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
    });
    await expect(service.getUsage()).resolves.toMatchObject({
      limits: [
        {
          id: "codex",
          primary: { usedPercent: 25, windowDurationMins: 300 },
          secondary: { usedPercent: 40, windowDurationMins: 10_080 },
        },
      ],
    });
    expect((await service.getUsage()).limits).toHaveLength(1);
    await service.sendMessage({ agentId: "chief", text: "First task" });
    await service.sendMessage({ agentId: "sales-outbound", text: "Second task" });
    await waitFor(
      async () => (await protocolMessages(logPath)).filter((item) => item.method === "turn/start").length === 2,
    );

    const requests = await protocolMessages(logPath);
    const starts = requests.filter((message) => message.method === "thread/start");
    expect(starts).toHaveLength(2);
    for (const start of starts) {
      const params = paramsRecord(start.params);
      if (!params) throw new Error("The fake thread request has no parameters.");
      expect(params).toMatchObject({
        model: "gpt-5.6-luna",
        approvalPolicy: "on-request",
        sandbox: "danger-full-access",
        ephemeral: false,
        serviceName: "openbot",
      });
      expect(params.runtimeWorkspaceRoots).toEqual([params.cwd, store.sharedRoot]);
      expect(params.developerInstructions).toContain(
        "You have full local computer, filesystem, command, and network access",
      );
      expect(params.developerInstructions).toContain(
        "You may list, read, create, edit, move, and delete files and run local commands in both directories.",
      );
      expect(params.developerInstructions).toContain("For every browser task");
      expect(params.developerInstructions).toContain(`Use ${COMPUTER_USE_MCP_SERVER_NAME} for every GUI task`);
      expect(params.developerInstructions).toContain("openbot_browser.submit_secret");
      expect(params.developerInstructions).toContain("openbot.create_routine");
      expect(params.developerInstructions).toContain("Never use ChatGPT Sites");
      expect(params.developerInstructions).toContain("openbot.attach_files_to_response");
      expect(params.developerInstructions).toContain("sadness, disappointment, frustration, loneliness");
      expect(params.developerInstructions).toContain("An emoji written inside your answer does not count");
      expect(params.developerInstructions).toContain("Omit agentId to target yourself");
      expect.soft(params.developerInstructions).toContain("call openbot.list_agents and openbot.list_sections");
      expect.soft(params.developerInstructions).toContain("Prefer suitable agents in your own section first");
      expect
        .soft(params.developerInstructions)
        .toContain(
          "Choose agents outside it when no suitable section member is available or additional expertise is needed; you do not need to contact a section member first.",
        );
      expect
        .soft(params.developerInstructions)
        .toContain(
          "If you have no section, choose by name, title, and description without giving other ungrouped agents priority.",
        );
      expect
        .soft(params.developerInstructions)
        .toContain(
          "Recipients explicitly named by the user and replies to existing messages take priority over section preference.",
        );
      expect(params.dynamicTools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "namespace", name: "openbot_browser" }),
          expect.objectContaining({
            type: "namespace",
            name: "openbot",
            tools: expect.arrayContaining([
              expect.objectContaining({ name: "attach_files_to_response" }),
              expect.objectContaining({ name: "ask_user" }),
              expect.objectContaining({ name: "list_agents" }),
              expect.objectContaining({ name: "update_profile" }),
              expect.objectContaining({ name: "create_agent" }),
              expect.objectContaining({ name: "list_sections" }),
              expect.objectContaining({ name: "create_section" }),
              expect.objectContaining({ name: "rename_section" }),
              expect.objectContaining({ name: "delete_section" }),
              expect.objectContaining({ name: "assign_agent_section" }),

              expect.objectContaining({ name: "list_routines" }),
              expect.objectContaining({ name: "create_routine" }),
              expect.objectContaining({ name: "update_routine" }),
              expect.objectContaining({ name: "delete_routine" }),
              expect.objectContaining({ name: "test_routine" }),
              expect.objectContaining({ name: "react_to_user_message" }),
            ]),
          }),
        ]),
      );
      const browserTools = (Array.isArray(params.dynamicTools) ? params.dynamicTools : [])
        .filter(isDynamicRecord)
        .find((tool) => tool.type === "namespace" && tool.name === "openbot_browser");
      expect(browserTools).toMatchObject({
        tools: expect.arrayContaining([expect.objectContaining({ name: "request_takeover" })]),
      });
    }
    for (const turn of requests.filter((message) => message.method === "turn/start")) {
      const params = paramsRecord(turn.params);
      if (!params) throw new Error("The fake turn request has no parameters.");
      expect(params).toMatchObject({
        model: "gpt-5.6-luna",
        effort: "low",
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "dangerFullAccess" },
      });
      expect(params.runtimeWorkspaceRoots).toEqual([params.cwd, store.sharedRoot]);
    }
    expect((await store.getOrCreate("chief")).threadId).not.toBe((await store.getOrCreate("sales-outbound")).threadId);
  });

  it("reads usage for the selected agent provider and prefers its model-specific bucket", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
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
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "codex", model: "gpt-5.6-luna" });
    const codex = clients.get("codex");
    if (!codex) throw new Error("Codex test client was not created.");
    codex.accountRateLimits = {
      rateLimits: {
        limitId: "codex",
        secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
      },
      rateLimitsByLimitId: {
        luna: {
          limitId: "luna",
          limitName: "gpt-5.6-luna",
          secondary: { usedPercent: 70, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
        },
      },
    };

    await expect(service.getUsage("chief")).resolves.toMatchObject({
      limits: [{ id: "luna", secondary: { usedPercent: 70 } }],
    });

    await service.updateAgent({ agentId: "chief", provider: "codex", model: "gpt-5.6-sol" });
    await expect(service.getUsage("chief")).resolves.toMatchObject({
      limits: [{ id: "codex", secondary: { usedPercent: 40 } }],
    });

    await service.updateAgent({ agentId: "chief", provider: "claude", model: "claude-sonnet-5" });
    const claude = clients.get("claude");
    if (!claude) throw new Error("Claude test client was not created.");
    claude.accountRateLimits = {
      rateLimits: {
        limitId: "claude",
        secondary: { usedPercent: 55, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
      },
      rateLimitsByLimitId: null,
    };

    await expect(service.getUsage("chief")).resolves.toMatchObject({
      limits: [{ id: "claude", secondary: { usedPercent: 55 } }],
    });
    expect(claude.requests).toContainEqual({
      method: "account/rateLimits/read",
      params: { model: "claude-sonnet-5" },
    });
  });

  it("reads account-wide usage from every connected provider", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { service: agentService } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
      preferredProvider: "codex",
    });
    service = agentService;
    const codex = clients.get("codex");
    const claude = clients.get("claude");
    if (!codex || !claude) throw new Error("Test clients were not created.");
    codex.accountRateLimits = {
      rateLimits: {
        limitId: "codex",
        secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
      },
      rateLimitsByLimitId: {
        luna: {
          limitId: "luna",
          secondary: { usedPercent: 70, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
        },
      },
    };
    claude.accountRateLimits = {
      rateLimits: {
        limitId: "claude",
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_787_040_000 },
        secondary: { usedPercent: 55, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
      },
      rateLimitsByLimitId: null,
    };

    await expect(service.getUsage()).resolves.toMatchObject({
      limits: [
        {
          id: "claude",
          primary: { usedPercent: 100, windowDurationMins: 300 },
          secondary: { usedPercent: 55, windowDurationMins: 10_080 },
        },
        {
          id: "codex",
          secondary: { usedPercent: 15, windowDurationMins: 10_080 },
        },
      ],
    });
    expect((await service.getUsage()).limits.map((limit) => limit.id)).toEqual(["claude", "codex"]);
  });

  it("maps provider browser tool calls to the stable OpenBot thread", async () => {
    const calls: DynamicToolCallParams[] = [];
    const browser = fakeBrowser();
    browser.handleDynamicTool = async (params) => {
      calls.push(params);
      return { success: true, contentItems: [] };
    };
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
      browser,
      preferredProvider: "codex",
    });
    service = agentService;
    await service.sendMessage({ agentId: "chief", text: "Browse" });
    await waitFor(() => Boolean(store.activeProviderSession("chief")));

    const providerThreadId = store.activeProviderSession("chief")?.externalSessionId;
    const openbotThreadId = (await store.getOrCreate("chief")).threadId;
    const client = clients.get("codex");
    if (!providerThreadId || !openbotThreadId || !client) throw new Error("Browser test thread was not created.");
    expect(providerThreadId).not.toBe(openbotThreadId);

    client.emit("request", {
      method: "item/tool/call",
      id: "browser-call",
      params: {
        threadId: providerThreadId,
        turnId: "turn-browser",
        callId: "browser-call",
        namespace: "openbot_browser",
        tool: "list_tabs",
        arguments: {},
      },
    });

    await waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ threadId: openbotThreadId, ownerAgentId: "chief" });
  });

  it("reads the canonical SQLite conversation during an active stream", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "First turn" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    const firstTurnId = service.listQueue("chief").deliveries[0]?.turnId;
    if (!firstTurnId) throw new Error("First turn did not start.");
    await service.interrupt("chief", firstTurnId);
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "interrupted");
    await service.sendMessage({ agentId: "chief", text: "New live turn" });
    await waitFor(() => service?.listQueue("chief").deliveries[1]?.status === "running");

    const snapshot = await service.readConversation("chief");
    expect(snapshot.activeTurnId).toBe(service.listQueue("chief").deliveries[1]?.turnId);
    expect(snapshot.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "Streaming", status: "streaming" })]),
    );
    expect((await protocolMessages(logPath)).filter((message) => message.method === "thread/read")).toHaveLength(0);
  });

  it("does not fail or replay a turn whose start response times out after lifecycle events", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "Finished despite the late response";
    // Auto-complete is 20ms. The RPC timeout has to land after that, and before
    // the delayed start response. 75ms vs 250ms loses that order when CI load
    // delays the fake CLI, and the wait then never sees completed.
    process.env.OPENBOT_FAKE_TURN_START_RESPONSE_DELAY = "1500";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox, requestTimeoutMs: 400 });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Run exactly once" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
    await waitFor(() => events.some((event) => event.type === "error" && event.code === "delivery_start_unconfirmed"));

    expect(service.listQueue("chief").deliveries[0]).toMatchObject({
      status: "completed",
      error: null,
    });
    expect((await protocolMessages(logPath)).filter((message) => message.method === "turn/start")).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "delivery_start_unconfirmed" }));
  });

  it("keeps a completed turn idle when its start response arrives after lifecycle events", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "Finished before the start response";
    process.env.OPENBOT_FAKE_TURN_START_RESPONSE_DELAY = "100";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Run exactly once" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");
    const deliveryId = service.listQueue("chief").deliveries[0]?.id;

    // The fake answers `turn/start` on a delay, so a second completed turn is the
    // barrier proving the first turn's late start response was already written and
    // processed: both responses travel the same pipe, in order.
    await service.sendMessage({ agentId: "chief", text: "Run once more" });
    await waitFor(
      () => service?.listQueue("chief").deliveries.filter((entry) => entry.status === "completed").length === 2,
    );

    const delivery = service.listQueue("chief").deliveries.find((entry) => entry.id === deliveryId);
    if (!delivery?.turnId) throw new Error("The completed delivery did not have a turn.");
    expect((await service.readConversation("chief")).activeTurnId).toBeNull();
    expect(
      store.database.connection
        .prepare("SELECT status, completed_at FROM projection_turns WHERE turn_id = ?")
        .get(delivery.turnId),
    ).toMatchObject({ status: "completed", completed_at: expect.any(String) });
  });
});
