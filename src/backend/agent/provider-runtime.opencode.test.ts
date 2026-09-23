import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  createFakeOpencode,
  createTestService,
  FakeAgentClient,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";
import type { AgentStore } from "../agent-store";

import type { CustomProviderConfig } from "../opencode-config";
import { getString } from "../protocol";
import { DrainScheduler } from "./drain-scheduler";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("ProviderRuntime: OpenCode reconnect and custom endpoints", () => {
  it("reconnects OpenCode without a browser and refuses to replace an active client", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", false);
        if (provider === "opencode") clients.push(client);
        return client;
      },
    });
    await service.initialize();
    const openExternal = vi.fn(async () => undefined);
    await service.connectProvider("opencode", openExternal);
    expect(openExternal).not.toHaveBeenCalled();
    expect(clients).toHaveLength(2);
    expect(clients[0]?.running).toBe(false);
    expect(clients[1]?.running).toBe(true);
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "opencode/example-model" });
    await service.sendMessage({ agentId: "chief", text: "Start a task." });
    await waitFor(() => clients[1]?.requests.some((request) => request.method === "turn/start") === true);
    await expect(service.connectProvider("opencode", openExternal)).rejects.toThrow("Wait for it to finish");
    expect(clients).toHaveLength(2);
    expect(clients[1]?.running).toBe(true);
  });

  it("keeps another provider's live delivery running when OpenCode reconnects", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, "", false),
      preferredProvider: "codex",
    });
    service = agentService;
    await service.sendMessage({ agentId: "chief", text: "Keep working." });
    const running = service;
    await waitFor(async () => Boolean((await running.readConversation("chief")).activeTurnId));
    const turnId = (await service.readConversation("chief")).activeTurnId;
    await service.connectProvider("opencode", vi.fn());
    expect(service.listQueue("chief").deliveries[0]?.status).toBe("running");
    expect((await service.readConversation("chief")).activeTurnId).toBe(turnId);
  });

  it.each([false, true])("holds queued OpenCode turns during reconnect and resumes them (failure=%s)", async (fail) => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reconnecting = false;
    let checkingAccount = false;
    const clients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", true, true, {}, async (method) => {
          if (provider !== "opencode" || !reconnecting || method !== "account/read") return;
          checkingAccount = true;
          await gate;
          if (fail) throw new Error("Reconnect failed.");
        });
        if (provider === "opencode") clients.push(client);
        return client;
      },
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "opencode/example-model" });
    reconnecting = true;
    const connection = service.connectProvider("opencode", vi.fn());
    await waitFor(() => checkingAccount);
    const drain = vi.spyOn(DrainScheduler.prototype, "drainAgent");
    try {
      await service.sendMessage({ agentId: "chief", text: "Run after reconnect." });
      await waitFor(() => drain.mock.calls.length > 0);
      await drain.mock.results[0]?.value;
      expect(clients[0]?.requests.filter((request) => request.method === "turn/start")).toEqual([]);
    } finally {
      drain.mockRestore();
      release?.();
    }
    if (fail) await expect(connection).rejects.toThrow("Reconnect failed.");
    else await connection;
    const activeClient = clients[fail ? 0 : 1];
    await waitFor(() => activeClient?.requests.some((request) => request.method === "turn/start") === true);
    const running = service;
    await waitFor(() => running.listQueue("chief").deliveries[0]?.status === "completed");
  });
  const STUDIO_LOCAL: CustomProviderConfig = {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: null,
    models: [{ id: "glm-5-air", name: "GLM 5 Air" }],
    headers: [],
  };

  function startWithEndpoints(
    endpoints: CustomProviderConfig[],
    clients: FakeAgentClient[],
    options: { preferred?: AgentProvider; autoComplete?: boolean; openCodeSignedIn?: boolean } = {},
  ): { service: AgentService; store: AgentStore } {
    const { store, mailbox } = stores(root);
    const service = createTestService({
      store,
      mailbox,
      preferredProvider: options.preferred ?? "opencode",
      clientFactory: (provider) => {
        const signedIn = provider !== "opencode" || (options.openCodeSignedIn ?? true);
        const client = new FakeAgentClient(provider, "DONE", options.autoComplete ?? true, signedIn);
        if (provider === "opencode") clients.push(client);
        return client;
      },
      bundledExecutables: {},
      prepareAgentWorkspace: async () => undefined,
      hostedSites: null,
      sidebarLayout: null,
      preferredModel: null,
      credentials: { apiKey: () => null, customProviders: () => endpoints, mcpServers: () => [] },
    });
    return { service, store };
  }

  // The config only reaches OpenCode through a spawn, so a saved endpoint needs the process replaced
  // rather than reconfigured. `connectProvider` cannot do it: it returns early for a provider that is
  // already connected.
  it("replaces the OpenCode process, refreshes its models and keeps the thread", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const endpoints: CustomProviderConfig[] = [];
    const clients: FakeAgentClient[] = [];
    const fixture = startWithEndpoints(endpoints, clients);
    service = fixture.service;
    const running = service;
    await running.initialize();
    await fixture.store.getOrCreate("chief");
    await running.updateAgent({ agentId: "chief", provider: "opencode", model: "opencode/example-model" });
    await running.sendMessage({ agentId: "chief", text: "First task." });
    await waitFor(() => running.listQueue("chief").deliveries[0]?.status === "completed");
    const first = clients.at(-1);
    const session = fixture.store.activeProviderSession("chief")?.externalSessionId;
    expect(session).toBeTruthy();

    endpoints.push(STUDIO_LOCAL);
    await expect(running.reloadOpenCodeConfig()).resolves.toBe("restarted");

    const replacement = clients.at(-1);
    expect(replacement).not.toBe(first);
    expect(first?.running).toBe(false);
    expect(replacement?.running).toBe(true);
    // Without this the endpoint is configured and its models are still missing from every picker.
    expect(replacement?.requests.some((request) => request.method === "model/list")).toBe(true);

    // The thread outlives the process: the loaded threads are cleared, so the next delivery resumes
    // the same provider session on the new client instead of reusing a session it never opened.
    await running.sendMessage({ agentId: "chief", text: "Second task." });
    await waitFor(() => replacement?.requests.some((request) => request.method === "turn/start") === true);
    const resumed = replacement?.requests.find((request) => request.method === "thread/resume");
    expect(getString(resumed?.params, "threadId")).toBe(session);
    await waitFor(() => running.listQueue("chief").deliveries.at(-1)?.status === "completed");
  });

  // A save is never refused for a busy provider - the endpoint is already stored - so the honest
  // answer is that the models arrive later. Killing the CLI here would end the user's turn.
  it("leaves a running turn alone and reports skipped-busy", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const clients: FakeAgentClient[] = [];
    const fixture = startWithEndpoints([STUDIO_LOCAL], clients, { autoComplete: false });
    service = fixture.service;
    const running = service;
    await running.initialize();
    await fixture.store.getOrCreate("chief");
    await running.updateAgent({ agentId: "chief", provider: "opencode", model: "opencode/example-model" });
    await running.sendMessage({ agentId: "chief", text: "Keep working." });
    await waitFor(() => clients[0]?.requests.some((request) => request.method === "turn/start") === true);

    await expect(running.reloadOpenCodeConfig()).resolves.toBe("skipped-busy");
    expect(clients).toHaveLength(1);
    expect(clients[0]?.running).toBe(true);
  });

  // OpenCode reports "not signed in" for a refused key or an unreachable base URL exactly as it does
  // for a missing account, so the default advice would send the user to `opencode auth login` for a
  // typo in their own endpoint.
  it("names the endpoint when OpenCode will not start a session, and has nothing to restart", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const clients: FakeAgentClient[] = [];
    service = startWithEndpoints([STUDIO_LOCAL], clients, { preferred: "codex", openCodeSignedIn: false }).service;
    const running = service;
    await running.initialize();

    expect(running.getStatus().providers).toContainEqual(
      expect.objectContaining({
        id: "opencode",
        state: "sign-in-required",
        message:
          "OpenCode could not start a session. Check your custom provider's base URL and API key, or add an OpenCode Go key if you also use OpenCode's own models.",
      }),
    );
    // Signed out, OpenCode keeps no client. A save must not read as a failure: the next spawn - the
    // next Connect press - reads the config.
    await expect(running.reloadOpenCodeConfig()).resolves.toBe("not-running");
  });
});
