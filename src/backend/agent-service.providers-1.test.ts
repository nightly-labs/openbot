// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentEvent,
  COMPUTER_USE_MCP_SERVER_ID,
  COMPUTER_USE_MCP_SERVER_NAME,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  paramsRecord,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { loginShellPath, type McpToolRuntimes, NO_MCP_TOOL_RUNTIMES } from "./mcp-provider-shapes";
import { SidebarLayoutStore } from "./sidebar-layout-store";

let root: string;
let service: AgentService | null = null;

/**
 * What a stdio MCP server is launched with: this user's own `PATH`, then the configuration's pairs.
 * The `PATH` is what makes a command found through a login shell runnable outside a terminal.
 */
async function launchEnvironment(pairs: Record<string, string> = {}): Promise<Record<string, string>> {
  const path = await loginShellPath();
  return { ...(path ? { PATH: path } : {}), ...pairs };
}

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: providers (1/3)", () => {
  it("runs a channel turn in a separate session and returns to the unchanged normal conversation", async () => {
    const { service: agentService, store } = await startService(root, {
      provider: "codex",
      output: "CODEX_DONE",
      preferredProvider: "codex",
    });
    service = agentService;
    await service.sendMessage({ agentId: "chief", text: "This is my normal conversation." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const agent = service.listAgents().find((item) => item.id === "chief");
    if (!agent?.threadId) throw new Error("Normal conversation did not start.");
    const normalSession = store.activeProviderSession(agent.id)?.externalSessionId;
    const before = await service.readConversation(agent.id);
    const actor = { id: "human", name: "Alex" };
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: agent.id }],
          leadAgentId: agent.id,
        },
      },
      actor,
    );
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: "send",
        text: "Work only in this channel.",
        recipientAgentId: agent.id,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await waitFor(() => service?.channels.store.tasks("channel-1")[0]?.state === "completed");
    expect(
      service.channels.store
        .messages("channel-1")
        .filter((item) => item.author.kind === "agent")
        .map((item) => item.message.text),
    ).toEqual(["CODEX_DONE"]);
    expect((await service.readConversation(agent.id)).messages).toEqual(before.messages);
    expect(store.activeProviderSession(agent.id)?.externalSessionId).toBe(normalSession);
    expect(store.list().find((item) => item.id === agent.id)?.threadId).toBe(agent.threadId);
    const execution = service.channels.store.context("channel-1", agent.id);
    expect(store.database.activeProviderSession(execution.threadId, agent.provider)?.externalSessionId).not.toBe(
      normalSession,
    );
    await service.sendMessage({ agentId: agent.id, text: "Continue in the normal conversation." });
    await waitFor(() => service?.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"));
    expect(store.activeProviderSession(agent.id)?.externalSessionId).toBe(normalSession);
  });

  it("resumes a channel session after the profile or the memories of the agent change", async () => {
    const {
      service: agentService,
      client,
      store,
    } = await startService(root, {
      provider: "codex",
      output: "CODEX_DONE",
      preferredProvider: "codex",
    });
    service = agentService;
    await store.getOrCreate("chief");
    const actor = { id: "human", name: "Alex" };
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: "chief" }],
          leadAgentId: "chief",
        },
      },
      actor,
    );
    const ask = async (operationId: string, text: string, tasks: number): Promise<void> => {
      await service?.channels.command(
        {
          type: "send",
          channelId: "channel-1",
          operationId,
          text,
          recipientAgentId: "chief",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      );
      // The count is part of the wait: the request of this ask has to reach the channel before the
      // tasks of the ask before it can answer for it.
      await waitFor(() => {
        const open = service?.channels.store.tasks("channel-1") ?? [];
        return open.length === tasks && open.every((task) => task.state === "completed");
      });
    };
    await ask("first", "Start the shared work.", 1);
    const execution = service.channels.store.context("channel-1", "chief");
    const channelSession = store.database.activeProviderSession(execution.threadId, "codex")?.externalSessionId;
    if (!channelSession) throw new Error("The channel turn started no provider session.");
    const lastChannelResume = (): string =>
      JSON.stringify(
        client.requests
          .filter((request) => request.method === "thread/resume")
          .filter((request) => paramsRecord(request.params)?.threadId === channelSession)
          .at(-1)?.params ?? "no resume of the channel session",
      );

    // The developer instructions are written when the session loads, so a memory the agent saved
    // after that reaches the channel only when the next turn loads the session again.
    service.createMemory({ agentId: "chief", text: "The user prefers concise status updates." });
    await ask("second", "Continue the shared work.", 2);
    expect(lastChannelResume()).toContain("The user prefers concise status updates.");

    await service.updateAgent({ agentId: "chief", description: "Owns the quarterly report." });
    await ask("third", "Report on the shared work.", 3);
    expect(lastChannelResume()).toContain("Owns the quarterly report.");

    // The profile dialog saves through a second path, which holds the same standing instructions.
    const sidebar = new SidebarLayoutStore(join(root, "sidebar.json"));
    await sidebar.initialize();
    await service.saveProfile(
      {
        operationId: randomUUID(),
        agentId: "chief",
        draft: {
          name: "Chief",
          title: "Local teammate",
          description: "Runs the weekly review.",
          avatarSeed: "first-bot",
          avatarHue: null,
          sectionId: null,
        },
      },
      sidebar,
    );
    await ask("fourth", "Review the shared work.", 4);
    expect(lastChannelResume()).toContain("Runs the weekly review.");
  });

  it("keeps an agent with active channel work from being deleted", async () => {
    const { service: agentService, store } = await startService(root, {
      provider: "codex",
      output: "",
      autoComplete: false,
      preferredProvider: "codex",
    });
    service = agentService;
    await store.getOrCreate("chief");
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-busy",
        operationId: "create-busy",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: "chief" }],
          leadAgentId: "chief",
        },
      },
      { id: "human", name: "Alex" },
    );
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-busy",
        operationId: "send-busy",
        text: "Continue working",
        recipientAgentId: "chief",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      { id: "human", name: "Alex" },
    );
    await waitFor(() => service?.channels.store.tasks("channel-busy")[0]?.state === "running");
    expect(service.listQueue("chief").deliveries).toEqual([]);
    await expect(service.deleteAgent("chief")).rejects.toThrow("Stop the agent");
    expect(service.listAgents().some((agent) => agent.id === "chief")).toBe(true);
  });

  it("refreshes outdated Codex tools while preserving the agent and conversation, then resumes unchanged tools", async () => {
    const { store, mailbox } = stores(root);
    let rejectTurn = false;
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method === "turn/start" && rejectTurn) throw new Error("Provider rejected the handoff turn.");
    });
    const startService = async () => {
      const next = createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: () => client,
      });
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

  it("gives Codex its MCP servers and replaces the session when the set changes", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    const startService = async () => {
      const next = createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: () => client,
      });
      await next.initialize();
      return next;
    };
    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;
    expect(paramsRecord(client.requests.find((request) => request.method === "thread/start")?.params)?.config).toBe(
      undefined,
    );

    // Codex ignores the configuration on resume, so a new MCP server has to force a new session.
    service.saveMcpServer({
      config: {
        id: "",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["ready"],
        env: [{ key: "TOKEN", value: "secret" }],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    });
    await service.stop();
    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(starts).toHaveLength(2);
    expect(paramsRecord(starts[1]?.params)?.config).toEqual({
      mcp_servers: {
        Filesystem: { command: "/bin/echo", args: ["ready"], env: await launchEnvironment({ TOKEN: "secret" }) },
      },
    });
  });

  // A server Codex cannot be given used to vanish: the adapter skipped it, the provider never saw
  // it, and so nothing anywhere failed. The user is told once, and told again only if they change
  // the list - not once per turn.
  it("reports the MCP server Codex cannot start in a working directory, once", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    const events: AgentEvent[] = [];
    service = createTestService({ store, mailbox, preferredProvider: "codex", clientFactory: () => client });
    service.on("event", (event) => events.push(event));
    await service.initialize();
    service.saveMcpServer({
      config: {
        id: "",
        name: "Local SQLite",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["ready"],
        env: [],
        envPassthrough: [],
        workingDirectory: "/tmp",
        url: "",
        headers: [],
      },
    });

    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const reported = events.filter((event) => event.type === "error" && event.code === "mcp_server_not_started");
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      agentId: undefined,
      message: expect.stringContaining('did not get the MCP server "Local SQLite"'),
    });

    // Reported, and still not sent: the point of the report is that the server is missing.
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(paramsRecord(starts.at(-1)?.params)?.config).toBe(undefined);

    await service.sendMessage({ agentId: "chief", text: "Again." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    expect(events.filter((event) => event.type === "error" && event.code === "mcp_server_not_started")).toHaveLength(1);
  });

  /* The token OpenBot mints is never on a row, so the stored configuration cannot name it. It still
     reaches a provider process, and that process quotes what it sent when a request fails. */
  it("hands a signed-in http server its bearer token and keeps that token out of the error it causes", async () => {
    const { store, mailbox } = stores(root);
    const token = "minted-access-token-abc";
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      // Quoted bare, the way a CLI reports the request it failed on. No shared pattern covers it:
      // only the value itself, remembered at hand-off, can take it out again.
      if (method === "turn/start") throw new Error(`upstream refused the token ${token}`);
    });
    const events: AgentEvent[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
      credentials: {
        apiKey: () => null,
        customProviders: () => [],
        mcpServers: () => [],
        mcpOAuth: {
          accessToken: async (url) => (url === "https://mcp.example.com/mcp" ? token : null),
          signIn: () => null,
          forget: async () => undefined,
        },
      },
    });
    service.on("event", (event) => events.push(event));
    await service.initialize();
    service.saveMcpServer({
      config: {
        id: "",
        name: "Signed in",
        transport: "http",
        enabled: true,
        command: "",
        args: [],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "https://mcp.example.com/mcp",
        headers: [],
      },
    });

    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "failed"));

    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(paramsRecord(starts.at(-1)?.params)?.config).toEqual({
      mcp_servers: {
        "Signed in": { url: "https://mcp.example.com/mcp", http_headers: { Authorization: `Bearer ${token}` } },
      },
    });
    const reported = events.filter((event) => event.type === "error");
    expect(reported.length).toBeGreaterThan(0);
    for (const event of reported) expect(event.message).not.toContain(token);
    expect(service.listQueue("chief").deliveries.at(-1)?.error ?? "").not.toContain(token);
  });

  // A manifest written by an older adapter holds the same stored set as today, so the fingerprint
  // has to carry the adapter: without it the stale session resumes forever with the servers it
  // was given. A manifest that matches nothing - deleted or predating the version - forces the
  // same replacement, with the public thread and its history intact.
  it("replaces a Codex session whose tool manifest predates the adapter", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;
    if (!firstSession) throw new Error("The Codex session did not start.");
    await writeFile(
      join(root, "user-data", "provider-toolsets", createHash("sha256").update(firstSession).digest("hex")),
      "stale-manifest",
    );

    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    expect(client.releasedThreads).toEqual([firstSession]);
    expect(client.requests.filter((request) => request.method === "thread/start")).toHaveLength(2);
  });

  // A session started before Bun finished downloading drops its `npx` servers, while the
  // configured set alone reads unchanged. The tool fingerprint folds the runtimes in as well, so
  // the next turn replaces the session once its servers can actually start - without it the old
  // session would resume forever with the tools it was given.
  it("replaces a Codex session started before the tool runtime was ready", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    let toolRuntimes: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
      credentials: {
        apiKey: () => null,
        customProviders: () => [],
        mcpServers: () => [],
        mcpToolRuntimes: () => toolRuntimes,
      },
    });
    await service.initialize();
    service.saveMcpServer({
      config: {
        id: "",
        name: "Npx tool",
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: ["-y", "some-tool"],
        // An isolated `PATH` stands in for a machine with no Node: the command is looked up in
        // this list, so `npx` is missing until the managed runtime joins it.
        env: [{ key: "PATH", value: "/nonexistent-test-dir" }],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    });

    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;
    if (!firstSession) throw new Error("The Codex session did not start.");
    // No runtime yet, so the server is dropped from the session while the stored row stays.
    const firstStart = client.requests.filter((request) => request.method === "thread/start").at(-1);
    expect(paramsRecord(firstStart?.params)?.config ?? {}).not.toHaveProperty("mcp_servers");

    // Bun finishes downloading between the turns. Nothing about the stored set changed.
    toolRuntimes = { binDirectories: ["/tmp/fake-bun-bin"], commandAliases: { npx: "/tmp/fake-bun-bin/bunx" } };

    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    expect(client.releasedThreads).toEqual([firstSession]);
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(starts).toHaveLength(2);
    const config = paramsRecord(starts.at(-1)?.params)?.config;
    expect(isDynamicRecord(config) ? config.mcp_servers : undefined).toMatchObject({
      "Npx tool": expect.anything(),
    });
  });

  // Save, remove and toggle all go through the same refresh, so one of them proves the mechanism.
  // Without it a loaded session keeps the tools it was given until the app restarts: the reason the
  // test above had to stop and start the service to see its new server.
  // A managed tool runtime becoming ready spends the same refresh: sessions that dropped their
  // stdio servers before it finished downloading are replaced on the next turn.
  it("starts a fresh provider session after the tool runtimes become ready", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;
    if (!firstSession) throw new Error("The Codex session did not start.");

    service.refreshAllAgentRuntimes();

    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    expect(client.releasedThreads).toEqual([firstSession]);
  });

  // Two rows on one URL are one account to the server: removing either row keeps the other's
  // sign-in. Compared normalized, as the store keys it - a trailing slash names the same account.
  it("keeps the shared sign-in until the last row on its URL is removed", async () => {
    const { store, mailbox } = stores(root);
    const forget = vi.fn(async (_url: string) => undefined);
    service = createTestService({
      store,
      mailbox,
      credentials: {
        apiKey: () => null,
        customProviders: () => [],
        mcpServers: () => [],
        mcpOAuth: {
          accessToken: async () => null,
          signIn: () => null,
          forget,
        },
      },
    });
    await service.initialize();
    const httpConfig = (name: string, url: string): McpServerConfig => ({
      id: "",
      name,
      transport: "http",
      enabled: true,
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url,
      headers: [],
    });
    const [first] = service.saveMcpServer({ config: httpConfig("Stripe", "https://mcp.stripe.com") });
    const [second] = service
      .saveMcpServer({ config: httpConfig("Stripe copy", "https://mcp.stripe.com/") })
      .filter((config) => config.name === "Stripe copy");
    if (!first || !second) throw new Error("The Stripe rows were not saved.");

    service.removeMcpServer({ mcpServerId: first.id });
    expect(forget).not.toHaveBeenCalled();

    service.removeMcpServer({ mcpServerId: second.id });
    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith("https://mcp.stripe.com/");
  });

  it("starts a fresh provider session for the next turn after an MCP server changes", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;

    service.saveMcpServer({
      config: {
        id: "",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["ready"],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    });
    service.saveMcpServer({
      config: {
        id: "",
        name: "Database",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["--database", "./data.db"],
        env: [],
        envPassthrough: [],
        workingDirectory: root,
        url: "",
        headers: [],
      },
    });

    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    // The replaced session is closed in the client as well. Left open, it would keep the MCP servers
    // it started, and every further change would add another set of processes.
    expect(client.releasedThreads).toEqual([firstSession]);
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(starts).toHaveLength(2);
    // `Database` is left out: the Codex configuration shape for a working directory is unconfirmed,
    // and a server told to open `./data.db` from the wrong place creates a second database.
    expect(paramsRecord(starts[1]?.params)?.config).toEqual({
      mcp_servers: { Filesystem: { command: "/bin/echo", args: ["ready"], env: await launchEnvironment() } },
    });
  });

  // One append in `enabledMcpServers` is what gives Codex, Claude and the ACP providers the same
  // Computer Use tools, so the Codex thread configuration proving it stands for all three. It also
  // proves the name is not a reserved one: `usableMcpServers` drops those on the way out.
  it("hands the provider the Computer Use entry while the driver runs, and nothing when it stops", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    let driverRunning = true;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
      computerUseMcpServer: () =>
        driverRunning
          ? {
              id: COMPUTER_USE_MCP_SERVER_ID,
              name: COMPUTER_USE_MCP_SERVER_NAME,
              transport: "stdio",
              enabled: true,
              command: "/opt/cua/bin/cua-driver",
              args: ["mcp", "--socket", "/tmp/openbot-test.sock"],
              env: [{ key: "CUA_DRIVER_EMBEDDED", value: "1" }],
              envPassthrough: [],
              workingDirectory: "",
              url: "",
              headers: [],
            }
          : null,
    });
    await service.initialize();

    expect(service.enabledMcpServers().map((entry) => entry.name)).toEqual([COMPUTER_USE_MCP_SERVER_NAME]);
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const [start] = client.requests.filter((request) => request.method === "thread/start");
    expect(paramsRecord(start?.params)?.config).toEqual({
      mcp_servers: {
        [COMPUTER_USE_MCP_SERVER_NAME]: {
          command: "/opt/cua/bin/cua-driver",
          args: ["mcp", "--socket", "/tmp/openbot-test.sock"],
          env: await launchEnvironment({ CUA_DRIVER_EMBEDDED: "1" }),
        },
      },
    });

    driverRunning = false;
    expect(service.enabledMcpServers()).toEqual([]);
  });

  /*
   * The second door. Codex merges the servers of `~/.codex/config.toml` into the set it is given,
   * so a name there reaches an agent without passing the MCP panel, and two computers holding the
   * same OpenBot settings answer "which servers does my agent have" differently.
   *
   * The replacement half is not decoration: nothing tells OpenBot that the file changed, Codex
   * ignores MCP configuration on resume, and a session that keeps the old set makes the panel a
   * lie until the app restarts.
   */
  it("turns off the MCP servers Codex declares in its own file, and replaces a session when they change", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    // `Filesystem` is in both places, and the panel's entry is the one that wins: a name the user
    // can see and edit must not resolve to a command from a file OpenBot does not show.
    client.configRead = {
      config: {
        mcp_servers: { "Local notes": { command: "/usr/bin/notes" }, Filesystem: { command: "/usr/bin/other" } },
      },
    };
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    service.saveMcpServer({
      config: {
        id: "",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["ready"],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    });
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;
    if (!firstSession) throw new Error("The Codex session did not start.");
    const starts = () => client.requests.filter((request) => request.method === "thread/start");
    // The file's own name carries no command, which is what turning it off means, and OpenBot's
    // entry is whole.
    expect(paramsRecord(starts().at(-1)?.params)?.config).toEqual({
      mcp_servers: {
        "Local notes": { enabled: false },
        Filesystem: { command: "/bin/echo", args: ["ready"], env: await launchEnvironment() },
      },
    });

    client.configRead = {
      config: {
        mcp_servers: { "Local notes": { command: "/usr/bin/notes" }, Scratch: { command: "/usr/bin/scratch" } },
      },
    };
    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    expect(client.releasedThreads).toEqual([firstSession]);
    expect(starts()).toHaveLength(2);
    expect(paramsRecord(starts().at(-1)?.params)?.config).toMatchObject({
      mcp_servers: { "Local notes": { enabled: false }, Scratch: { enabled: false } },
    });
  });

  // The same refresh asks one question of each thread: is a turn running on it. `readConversation`
  // answers that too, but it loads and parses every message of the thread to do it, so a settings
  // change would read the whole history of every agent on the main process and throw it away.
  it("does not read a conversation to find whether a thread is busy", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;

    const readConversation = vi.spyOn(store.database, "readConversation");
    const readActiveTurnId = vi.spyOn(store.database, "readActiveTurnId");
    service.saveMcpServer({
      config: {
        id: "",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["ready"],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    });
    // The refresh did reach the question - otherwise the first expectation would pass on a path that
    // never ran - and it answered it from the thread row alone.
    expect(readActiveTurnId).toHaveBeenCalled();
    expect(readConversation).not.toHaveBeenCalled();
    readConversation.mockRestore();
    readActiveTurnId.mockRestore();

    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
  });

  // The queue keeps a failed delivery's reason in the database and shows it again in the app, so a
  // provider that rejects a start by quoting what it was sent would store the credential for good.
  it("keeps an MCP credential out of the reason a failed delivery keeps", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method === "thread/start") throw new Error("Rejected abcdef123456 from Filesystem.");
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    service.saveMcpServer({
      config: {
        id: "",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: [],
        env: [{ key: "API_KEY", value: "abcdef123456" }],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    });

    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.some((delivery) => delivery.status === "failed"));
    const failed = service.listQueue("chief").deliveries.find((delivery) => delivery.status === "failed");
    expect(failed?.error).toBe("Rejected ••• from Filesystem.");
  });

  // The refresh mark is spent on the sessions the table holds, and a session that is still starting
  // is in no table. Without the wait, the change would be marked as applied to a session that was
  // given the set as it was before it.
  it("starts a fresh session when an MCP server changes while the first session starts", async () => {
    const { store, mailbox } = stores(root);
    let started = false;
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method !== "thread/start" || started) return;
      started = true;
      service?.saveMcpServer({
        config: {
          id: "",
          name: "Filesystem",
          transport: "stdio",
          enabled: true,
          command: "/bin/echo",
          args: ["ready"],
          env: [],
          envPassthrough: [],
          workingDirectory: "",
          url: "",
          headers: [],
        },
      });
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;

    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );

    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    // Released, which only the refresh path does: a session replaced for an outdated tool
    // fingerprint is retired without a release, so this names the mark that was held back.
    expect(client.releasedThreads).toEqual([firstSession]);
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(starts).toHaveLength(2);
    expect(paramsRecord(starts[1]?.params)?.config).toEqual({
      mcp_servers: { Filesystem: { command: "/bin/echo", args: ["ready"], env: await launchEnvironment() } },
    });
  });

  // The turn start is the second wait a change can land in: the session exists by then, and it has
  // no turn id until the provider answers. A refresh spent there would close the session the turn
  // is about to run on, and its completion would reach nobody.
  it("keeps a session routed when an MCP server changes while a turn starts", async () => {
    const { store, mailbox } = stores(root);
    let changed = false;
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method !== "turn/start" || changed) return;
      changed = true;
      service?.saveMcpServer({
        config: {
          id: "",
          name: "Filesystem",
          transport: "stdio",
          enabled: true,
          command: "/bin/echo",
          args: ["ready"],
          env: [],
          envPassthrough: [],
          workingDirectory: "",
          url: "",
          headers: [],
        },
      });
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "Start." });
    // Completed, not left running: the turn that was starting still owns its routing.
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;
    expect(client.releasedThreads).toEqual([]);

    // The change is not lost either: the next turn is the one that applies it.
    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    expect(client.releasedThreads).toEqual([firstSession]);
  });

  // The timeout branch of a turn start keeps the delivery waiting for lifecycle events instead of
  // sending the work again. Those events are the only way that delivery can end, and they arrive on
  // the routing a refresh removes.
});
