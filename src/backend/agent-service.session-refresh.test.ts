// @vitest-environment node
import { createHash } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  notification,
  paramsRecord,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { loginShellPath, type McpToolRuntimes, NO_MCP_TOOL_RUNTIMES } from "./mcp-provider-shapes";

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

describe.sequential("AgentService: provider session refresh", () => {
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
  it("keeps a session routed while an unconfirmed turn start waits", async () => {
    const { store, mailbox } = stores(root);
    let timedOut = false;
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method !== "turn/start" || timedOut) return;
      timedOut = true;
      throw new Error("Codex request timed out: turn/start");
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    const errors: string[] = [];
    service.on("event", (event) => {
      if (event.type === "error") errors.push(event.code);
    });

    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => errors.includes("delivery_start_unconfirmed"));
    const session = store.activeProviderSession("chief")?.externalSessionId;
    if (!session) throw new Error("The unconfirmed start left no provider session.");

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
    expect(client.releasedThreads).toEqual([]);

    // The turn the provider did start after all, reported the only way it can be: its events.
    const turnId = "turn-after-the-timeout";
    client.emit("notification", notification("turn/started", { threadId: session, turn: { id: turnId } }));
    client.emit(
      "notification",
      notification("turn/completed", { threadId: session, turn: { id: turnId, status: "completed" } }),
    );

    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
  });

  // The manifest is the only record that survives a restart, and the in-memory refresh mark does
  // not. A manifest written from the set that arrived during the start would describe a session
  // that never got it, and the resume check would then accept that session for good.
  it("records the MCP set a session was given, not one that arrived while it started", async () => {
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
    const start = async () => {
      const next = createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: () => client,
      });
      await next.initialize();
      return next;
    };
    service = await start();
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;

    // The restart drops the held refresh, so the manifest alone decides whether the session is kept.
    await service.stop();
    service = await start();
    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );

    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(starts).toHaveLength(2);
    expect(paramsRecord(starts[1]?.params)?.config).toEqual({
      mcp_servers: { Filesystem: { command: "/bin/echo", args: ["ready"], env: await launchEnvironment() } },
    });
  });
});
