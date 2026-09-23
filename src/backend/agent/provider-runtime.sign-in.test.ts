import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "../agent-service";
import {
  createFakeClaude,
  createFakeCodex,
  createFakeGrok,
  createPendingFakeClaude,
  createTestService,
  FakeAgentClient,
  readTextOrEmpty,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("ProviderRuntime: sign-in", () => {
  it("connects ChatGPT through the Codex App Server and promotes the authenticated client", async () => {
    const { store, mailbox } = stores(root);
    const codexClients: FakeAgentClient[] = [];
    const openExternal = vi.fn(async () => undefined);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(
          provider,
          provider === "codex" ? "CODEX_DONE" : "CLAUDE_DONE",
          true,
          provider !== "codex",
        );
        if (provider === "codex") codexClients.push(client);
        return client;
      },
    });
    await service.initialize();

    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "sign-in-required" }),
    );
    const connecting = await service.connectProvider("codex", openExternal);

    expect(connecting.providers).toContainEqual(
      expect.objectContaining({
        id: "codex",
        state: "sign-in-required",
        connectionState: "connecting",
        version: "0.144.1",
      }),
    );
    expect(openExternal).toHaveBeenCalledWith("https://auth.openai.test/connect");
    expect(codexClients).toHaveLength(2);
    expect(codexClients[1]?.requests).toContainEqual({
      method: "account/login/start",
      params: {
        type: "chatgpt",
        appBrand: "chatgpt",
        codexStreamlinedLogin: true,
        useHostedLoginSuccessPage: true,
      },
    });

    await service.connectProvider("codex", openExternal);
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(codexClients).toHaveLength(3);
    expect(codexClients[1]?.requests).toContainEqual({
      method: "account/login/cancel",
      params: { loginId: "login-1" },
    });
    expect(codexClients[1]?.running).toBe(false);
    codexClients[1]?.completeLogin(true);
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", connectionState: "connecting" }),
    );
    codexClients[2]?.completeLogin(true);
    await waitFor(
      () => service?.getStatus().providers?.find((provider) => provider.id === "codex")?.state === "available",
    );

    expect(service.getStatus().phase).toBe("ready");
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "available", email: "codex@example.com" }),
    );
  });

  it.each([
    { target: "claude", pathVariable: "OPENBOT_CLAUDE_PATH", createCli: createFakeClaude },
    { target: "grok", pathVariable: "OPENBOT_GROK_PATH", createCli: createFakeGrok },
  ] as const)("connects $target through the bundled CLI login command", async ({ target, pathVariable, createCli }) => {
    process.env[pathVariable] = await createCli(root);
    const { store, mailbox } = stores(root);
    let clients = 0;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: target,
      clientFactory: (provider) => {
        const authenticated = provider === target ? clients > 0 : true;
        if (provider === target) clients += 1;
        return new FakeAgentClient(provider, "DONE", true, authenticated);
      },
    });
    await service.initialize();

    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: target, state: "sign-in-required" }),
    );

    const connecting = await service.connectProvider(target, async () => undefined);

    expect(connecting.providers).toContainEqual(
      expect.objectContaining({ id: target, state: "sign-in-required", connectionState: "connecting" }),
    );
    await waitFor(() => clients === 2);
    await waitFor(
      () => service?.getStatus().providers?.find((provider) => provider.id === target)?.state === "available",
    );
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: target, state: "available", email: `${target}@example.com` }),
    );
  });
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
});
