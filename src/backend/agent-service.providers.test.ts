// @vitest-environment node
import { mkdir, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "./agent-client";
import { AgentService } from "./agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createFakeGrok,
  FakeAgentClient,
  fakeBrowser,
  firstInputText,
  notification,
  paramsRecord,
  protocolMessages,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import type { DynamicToolCallParams } from "./protocol";

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

describe.sequential("AgentService: providers", () => {
  it("refreshes outdated Codex tools while preserving the agent and conversation, then resumes unchanged tools", async () => {
    const { store, mailbox } = stores(root);
    let rejectTurn = false;
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method === "turn/start" && rejectTurn) throw new Error("Provider rejected the handoff turn.");
    });
    const startService = async () => {
      const next = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
      await next.initialize();
      return next;
    };
    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Remember that my researchers cover tennis and football." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const original = service.listAgents().find((agent) => agent.id === "chief");
    const originalSession = store.activeProviderSession("chief")?.externalSessionId;
    if (!original || !originalSession) throw new Error("The original session did not start.");
    await service.stop();
    const directory = join(store.database.userDataPath, "provider-toolsets");
    const [manifest] = await readdir(directory);
    if (!manifest) throw new Error("The session tool manifest was not saved.");
    await writeFile(join(directory, manifest), "old-toolset");

    rejectTurn = true;
    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Group my researchers." });
    await waitFor(() => service?.listQueue("chief").deliveries.some((delivery) => delivery.status === "failed"));
    await service.stop();
    rejectTurn = false;
    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Try grouping them again." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    const replacement = store.activeProviderSession("chief")?.externalSessionId;
    expect(replacement).not.toBe(originalSession);
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      id: original.id,
      threadId: original.threadId,
      workspacePath: original.workspacePath,
    });
    expect(
      (await service.readConversation("chief")).messages.some((message) =>
        message.text.includes("tennis and football"),
      ),
    ).toBe(true);
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(starts).toHaveLength(2);
    expect(paramsRecord(starts[1]?.params)?.dynamicTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "openbot",
          tools: expect.arrayContaining([expect.objectContaining({ name: "create_section" })]),
        }),
      ]),
    );
    const turns = client.requests.filter((request) => request.method === "turn/start");
    expect(JSON.stringify(turns.at(-1)?.params)).toContain("tennis and football");
    await service.stop();

    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).toBe(replacement);
    expect(client.requests.filter((request) => request.method === "thread/start")).toHaveLength(2);
  });

  it.each<AgentProvider>(["codex", "claude", "grok"])(
    "delivers the quiet collaboration policy to %s on startup and after restart",
    async (provider) => {
      process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
      process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
      const { store, mailbox } = stores(root);
      for (const method of ["thread/start", "thread/resume"]) {
        const clients = new Map<AgentProvider, FakeAgentClient>();
        service = new AgentService(store, mailbox, fakeBrowser(), 30_000, provider, (selectedProvider) => {
          const client = new FakeAgentClient(selectedProvider);
          clients.set(selectedProvider, client);
          return client;
        });
        await service.initialize();
        if (method === "thread/start") {
          await store.getOrCreate("chief");
          await service.updateAgent({
            agentId: "chief",
            provider,
            model: provider === "codex" ? "gpt-5.6-luna" : provider === "claude" ? "claude-sonnet-5" : "grok-4.5",
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
        expect(instructions).toContain("explicitly send the result back");
        expect(instructions).toContain("Do not create acknowledgement loops");
        expect(instructions).not.toContain("When you receive a reply, summarize it for the user");
        await service.stop();
      }
    },
  );

  it("derives live progress from the provider-neutral turn and tool lifecycle", async () => {
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

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
    service = new AgentService(store, mailbox, fakeBrowser());
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

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
      ],
      capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
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
      expect(params.developerInstructions).toContain("Use the installed Computer Use plugin only");
      expect(params.developerInstructions).toContain("When you use openbot_browser");
      expect(params.developerInstructions).toContain("openbot.create_routine");
      expect(params.developerInstructions).toContain("Never use ChatGPT Sites");
      expect(params.developerInstructions).toContain("openbot.attach_files_to_response");
      expect(params.developerInstructions).toContain("sadness, disappointment, frustration, loneliness");
      expect(params.developerInstructions).toContain("An emoji written inside your answer does not count");
      expect(params.developerInstructions).toContain("Omit agentId to target yourself");
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
        effort: "medium",
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
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

  it("maps provider browser tool calls to the stable OpenBot thread", async () => {
    const calls: DynamicToolCallParams[] = [];
    const browser = fakeBrowser();
    browser.handleDynamicTool = async (params) => {
      calls.push(params);
      return { success: true, contentItems: [] };
    };
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, browser, 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
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
});
