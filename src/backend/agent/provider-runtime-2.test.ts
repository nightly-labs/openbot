// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  createFakeClaude,
  createFakeCodex,
  createPendingFakeClaude,
  createTestService,
  createUpdatableFakeClaude,
  FakeAgentClient,
  readTextOrEmpty,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";
import { DIAGNOSTIC_TEXT_LIMIT } from "../stderr-diagnostics";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("ProviderRuntime: account checks and login (2/3)", () => {
  it("restores the connect action when the login page cannot open", async () => {
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, "DONE", true, provider !== "codex"),
      preferredProvider: "codex",
    });
    service = agentService;

    await expect(
      service.connectProvider("codex", async () => Promise.reject(new Error("browser failed"))),
    ).rejects.toThrow("could not open");
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "sign-in-required" }),
    );
  });

  // Computer Use used to come from a Codex `plugin/list` probe, so every activation recomputed it
  // and a provider that was not Codex set it back to `unavailable`. The driver is now this app's
  // own child, and no provider knows anything about it.
  it("keeps the pushed Computer Use capability across a provider connection", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "DONE", true, true),
    });
    await service.initialize();
    service.setComputerUseCapability("ready");

    await service.connectProvider("codex", async () => undefined);

    expect(service.getStatus().capabilities.computerUse).toBe("ready");
  });

  it("cancels a ChatGPT login that does not complete", async () => {
    const { store, mailbox } = stores(root);
    const codexClients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", true, provider !== "codex");
        if (provider === "codex") codexClients.push(client);
        return client;
      },
    });
    await service.initialize();
    vi.useFakeTimers();
    await service.connectProvider("codex", async () => undefined);

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(codexClients[1]?.requests).toContainEqual({
      method: "account/login/cancel",
      params: { loginId: "login-1" },
    });
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({
        id: "codex",
        state: "sign-in-required",
        message: expect.stringContaining("timed out"),
      }),
    );
  });

  /**
   * The sign-in the user finishes elsewhere. What is asserted here is the contract the dialog is
   * built on: a code comes back, a deadline comes with it, and the account arrives the same way a
   * browser sign-in's does - in the provider's status, not in the reply.
   */
  it("signs in to ChatGPT with a code typed on another device", async () => {
    const { store, mailbox } = stores(root);
    const codexClients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", true, provider !== "codex");
        if (provider === "codex") codexClients.push(client);
        return client;
      },
    });
    await service.initialize();

    const started = await service.startProviderCodeLogin("codex");

    expect(started).toEqual({
      kind: "code",
      userCode: "TEST-CODE",
      verificationUrl: "https://auth.openai.test/device",
      expiresAt: expect.any(Number),
    });
    expect(started.kind === "code" && started.expiresAt).toBeGreaterThan(Date.now());
    expect(codexClients[1]?.requests).toContainEqual({
      method: "account/login/start",
      // No `appBrand`: the device-code variant of this request does not take one.
      params: { type: "chatgptDeviceCode" },
    });
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "sign-in-required", connectionState: "connecting" }),
    );

    codexClients[1]?.completeLogin(true);

    await waitFor(
      () => service?.getStatus().providers?.find((provider) => provider.id === "codex")?.state === "available",
    );
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "available", email: "codex@example.com" }),
    );
  });

  it("tells ChatGPT to drop the code when the user cancels the sign-in", async () => {
    const { store, mailbox } = stores(root);
    const codexClients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", true, provider !== "codex");
        if (provider === "codex") codexClients.push(client);
        return client;
      },
    });
    await service.initialize();
    await service.startProviderCodeLogin("codex");

    await service.cancelProviderCodeLogin("codex");

    expect(codexClients[1]?.requests).toContainEqual({
      method: "account/login/cancel",
      params: { loginId: "login-1" },
    });
    expect(codexClients[1]?.running).toBe(false);
    // Back to the row the user pressed, with nothing left running behind it.
    const codex = service.getStatus().providers?.find((provider) => provider.id === "codex");
    expect(codex).toMatchObject({ state: "sign-in-required", message: null });
    expect(codex?.connectionState).toBeUndefined();
  });

  it("issues a code for an account already on this computer, so another account can be reached", async () => {
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, "DONE", true, true),
      preferredProvider: "codex",
    });
    service = agentService;

    expect(await service.startProviderCodeLogin("codex")).toEqual({
      kind: "code",
      userCode: "TEST-CODE",
      verificationUrl: "https://auth.openai.test/device",
      expiresAt: expect.any(Number),
    });
    // The account in use is untouched while the new one is being signed in to: a user who gives up
    // on the code has to be left with the provider they already had.
    expect(service.getStatus().providers).toContainEqual(expect.objectContaining({ id: "codex", state: "available" }));
  });

  it("refuses a code sign-in for a provider that has none", async () => {
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, "DONE", true, provider !== "claude"),
      preferredProvider: "codex",
    });
    service = agentService;

    await expect(service.startProviderCodeLogin("claude")).rejects.toThrow("cannot be signed in with a code");
  });

  it("runs provider logins independently and Refresh cancels both generations", async () => {
    const claudeLoginLog = join(root, "claude-login.log");
    process.env.OPENBOT_FAKE_CLAUDE_LOGIN_LOG = claudeLoginLog;
    process.env.OPENBOT_CLAUDE_PATH = await createPendingFakeClaude(root);
    const { store, mailbox } = stores(root);
    const codexClients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", true, false);
        if (provider === "codex") codexClients.push(client);
        return client;
      },
    });
    await service.initialize();

    await Promise.all([
      service.connectProvider("codex", async () => undefined),
      service.connectProvider("claude", async () => undefined),
    ]);
    expect(service.getStatus().providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex", connectionState: "connecting" }),
        expect.objectContaining({ id: "claude", connectionState: "connecting" }),
      ]),
    );
    await waitFor(async () => (await readTextOrEmpty(claudeLoginLog)).includes("started"));

    await service.connectProvider("claude", async () => undefined);
    await waitFor(async () => {
      const log = await readTextOrEmpty(claudeLoginLog);
      return log.match(/^started$/gmu)?.length === 2 && log.includes("stopped");
    });
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", connectionState: "connecting" }),
    );

    await service.refreshProviders();

    expect(codexClients[1]?.requests).toContainEqual({
      method: "account/login/cancel",
      params: { loginId: "login-1" },
    });
    expect(codexClients[1]?.running).toBe(false);
    await waitFor(async () => (await readTextOrEmpty(claudeLoginLog)).match(/^stopped$/gmu)?.length === 2);
    expect(service.getStatus().providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex", state: "sign-in-required" }),
        expect.objectContaining({ id: "claude", state: "sign-in-required" }),
      ]),
    );
    expect(service.getStatus().providers?.some((provider) => provider.connectionState === "connecting")).toBe(false);

    // The stale login completion is queued behind the codex connection command
    // that `refreshProviders` runs, so awaiting the refresh proves the service
    // processed it and still refused to sign the cancelled generation in.
    codexClients[1]?.completeLogin(true);
    await service.refreshProviders();
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "sign-in-required" }),
    );
  });

  it("keeps the active ChatGPT client until reconnect succeeds", async () => {
    const { store, mailbox } = stores(root);
    const codexClients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", true, provider !== "codex" || codexClients.length === 0);
        if (provider === "codex") codexClients.push(client);
        return client;
      },
    });
    await service.initialize();
    const activeClient = codexClients[0];

    await service.connectProvider("codex", async () => undefined);
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "available", connectionState: "connecting" }),
    );
    codexClients[1]?.completeLogin(false);
    await waitFor(() => !service?.getStatus().providers?.find((provider) => provider.id === "codex")?.connectionState);
    expect(activeClient?.running).toBe(true);
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "available", message: expect.stringContaining("not completed") }),
    );

    await service.connectProvider("codex", async () => undefined);
    codexClients[2]?.completeLogin(true);
    await waitFor(
      () =>
        service?.getStatus().providers?.find((provider) => provider.id === "codex")?.state === "available" &&
        !service?.getStatus().providers?.find((provider) => provider.id === "codex")?.connectionState,
    );
    expect(activeClient?.running).toBe(false);
    expect(codexClients[2]?.running).toBe(true);
  });

  it.each(["codex", "claude"] as const)(
    "blocks %s updates during sign-in and allows retry after cancellation",
    async (target) => {
      const managed = target === "codex" ? await createFakeCodex(root) : await createFakeClaude(root);
      if (target === "claude") {
        process.env.OPENBOT_FAKE_CLAUDE_LOGIN_LOG = join(root, "pending-claude-login.log");
        process.env.OPENBOT_CLAUDE_PATH = await createPendingFakeClaude(root);
      }
      const { service: agentService } = await startService(root, {
        client: (provider) => new FakeAgentClient(provider),
        preferredProvider: target,
      });
      service = agentService;
      await service.connectProvider(target, async () => undefined);
      const install = vi.fn(async () => managed);

      await expect(service.updateProviderCli(target, install)).rejects.toThrow(
        "Finish or cancel sign-in, then update.",
      );
      expect(install).not.toHaveBeenCalled();
      expect(service.getStatus().providers).toContainEqual(
        expect.objectContaining({ id: target, connectionState: "connecting" }),
      );

      const other = target === "codex" ? "claude" : "codex";
      const otherCli = other === "codex" ? await createFakeCodex(root) : await createFakeClaude(root);
      process.env[`OPENBOT_${other.toUpperCase()}_PATH`] = join(root, "missing-other-override");
      const otherUpdated = await service.updateProviderCli(other, async () => otherCli);
      expect(otherUpdated.providers).toContainEqual(
        expect.objectContaining({ id: other, state: "available", cliSource: "managed" }),
      );

      await service.refreshProviders();
      process.env[`OPENBOT_${target.toUpperCase()}_PATH`] = join(root, "missing-override");
      const updated = await service.updateProviderCli(target, install);
      expect(updated.providers).toContainEqual(
        expect.objectContaining({ id: target, state: "available", cliSource: "managed" }),
      );
    },
  );

  it("activates the downloaded managed CLI instead of running the user's updater", async () => {
    const system = await createUpdatableFakeClaude(root, "2.1.250");
    process.env.OPENBOT_CLAUDE_PATH = system.executable;
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "claude",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "claude") clients.push(client);
        return client;
      },
    });
    await service.initialize();
    const managed = await createFakeClaude(root);
    await writeFile(managed, (await readFile(managed, "utf8")).replaceAll("2.1.246", "2.1.263"));
    // Remove the test's explicit override to model automatic system discovery at startup.
    process.env.OPENBOT_CLAUDE_PATH = join(root, "missing-claude");
    const status = await service.updateProviderCli("claude", async () => managed);
    expect(await readTextOrEmpty(system.started)).toBe("");
    expect(status.providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "available", version: "2.1.263", cliSource: "managed" }),
    );
    expect(clients[0]?.running).toBe(false);
    expect(clients[1]?.running).toBe(true);
  });

  it("keeps the previous client when the replacement cannot authenticate", async () => {
    const managed = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "claude",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "", true, provider !== "claude" || clients.length === 0);
        if (provider === "claude") clients.push(client);
        return client;
      },
      bundledExecutables: { claude: managed },
    });
    await service.initialize();
    await expect(service.updateProviderCli("claude", async () => managed)).rejects.toThrow();
    expect(clients[0]?.running).toBe(true);
    expect(clients[1]?.running).toBe(false);
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", version: "2.1.246", state: "available" }),
    );
  });

  it("logs a provider's MCP server failure and raises the provider's own failures", async () => {
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
      bundledExecutables: {},
      prepareAgentWorkspace: async () => undefined,
      hostedSites: null,
      sidebarLayout: null,
      preferredModel: null,
      credentials: {
        apiKey: () => null,
        customProviders: () => [],
        // A server OpenBot configured. The user asked for this one here, so its failure is theirs
        // to fix and must stay visible.
        mcpServers: () => [
          {
            id: "mcp-1",
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
        ],
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    const client = clients.get("codex");
    if (!client) throw new Error("The fake provider did not start.");

    // Verbatim, because these two lines are what the user met: a per-session MCP server that lost a
    // race with the short session OpenBot opens to read the model list, and an MCP client's own
    // transport giving up. Neither stops the turn and neither is OpenBot's to configure.
    client.emit(
      "diagnostic",
      "Failed to spawn MCP server 'chrome-devtools': session is closing (process scope already reclaimed); MCP server not started",
    );
    client.emit("diagnostic", "ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed");
    client.emit("diagnostic", "ERROR the provider failed to reach the model endpoint");
    // Named in this app's own settings, so the user can act on it and has to be told - and the CLI
    // reports the failure by quoting what it sent, credential and all.
    client.emit("diagnostic", "Failed to spawn MCP server 'Filesystem': rejected abcdef123456");

    await waitFor(() => events.filter((event) => event.type === "error").length === 2);
    expect(events.filter((event) => event.type === "error")).toEqual([
      expect.objectContaining({ message: "ERROR the provider failed to reach the model endpoint" }),
      expect.objectContaining({ message: "Failed to spawn MCP server 'Filesystem': rejected •••" }),
    ]);
  });

  it("redacts an MCP credential a running provider still holds after the user removes the server", async () => {
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
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
    await service.initialize();
    const client = clients.get("codex");
    if (!client) throw new Error("The fake provider did not start.");
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
    // What a spawn reads. The running process keeps this credential until it stops.
    expect(service.enabledMcpServers()).toHaveLength(1);
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));

    // The user removes the server while that process runs, so the store no longer names the value.
    service.removeMcpServer({ mcpServerId: service.listMcpServers()[0]?.id ?? "" });
    client.emit("diagnostic", "Failed to spawn MCP server 'Filesystem': rejected abcdef123456");

    await waitFor(() => events.filter((event) => event.type === "error").length === 1);
    expect(events.filter((event) => event.type === "error")).toEqual([
      expect.objectContaining({ message: "Failed to spawn MCP server 'Filesystem': rejected •••" }),
    ]);
  });

  // A CLI reports a failure by quoting what it sent, and that line can be long enough for the bound
  // on a diagnostic to fall inside the credential. Redacted whole first, the bound cuts text that no
  // longer holds the value; the other way round it would leave the head of one on screen.
  it("redacts an MCP credential a long diagnostic quotes past the length a line is held to", async () => {
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
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
    await service.initialize();
    const client = clients.get("codex");
    if (!client) throw new Error("The fake provider did not start.");
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
    // What a spawn reads. The process holds this server, so its failure stays visible to the user.
    expect(service.enabledMcpServers()).toHaveLength(1);
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));

    // The credential starts just before the bound, so a line shortened first would keep its head.
    const opening = "Failed to spawn MCP server 'Filesystem': rejected ";
    const filler = ".".repeat(DIAGNOSTIC_TEXT_LIMIT - 5 - opening.length);
    client.emit("diagnostic", `${opening}${filler}abcdef123456 after the bound`);

    await waitFor(() => events.filter((event) => event.type === "error").length === 1);
    const [error] = events.filter((event) => event.type === "error");
    expect(error?.type === "error" && error.message.length).toBeLessThanOrEqual(DIAGNOSTIC_TEXT_LIMIT);
    expect(error?.type === "error" && error.message).not.toContain("abcde");
  });

  it("redacts an MCP credential a provider error quotes, not only a diagnostic", async () => {
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
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
    await service.initialize();
    const client = clients.get("codex");
    if (!client) throw new Error("The fake provider did not start.");
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
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));

    // A provider error notification, which takes its own path to the shared error boundary rather
    // than the diagnostic handler. It reaches the renderer, so the value has to go first.
    client.emit("notification", {
      method: "error",
      params: { message: "Filesystem MCP failed: rejected abcdef123456" },
    });

    await waitFor(() => events.filter((event) => event.type === "error").length === 1);
    expect(events.filter((event) => event.type === "error")).toEqual([
      expect.objectContaining({ message: "Filesystem MCP failed: rejected •••" }),
    ]);
  });
});
