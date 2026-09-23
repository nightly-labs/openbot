// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProcessExitError, type AgentProvider } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createFakeCodex,
  createFakeGrok,
  createFakeOpencode,
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
import type { AgentStore } from "../agent-store";
import { McpServerStore } from "../mcp-server-store";
import type { CustomProviderConfig } from "../opencode-config";
import { getString } from "../protocol";
import { DIAGNOSTIC_TEXT_LIMIT } from "../stderr-diagnostics";
import { DrainScheduler } from "./drain-scheduler";
import { isUsageLimitDiagnostic } from "./provider-runtime";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("ProviderRuntime: account checks and login", () => {
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

  it("checks providers concurrently and publishes each completed row", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
    const { store, mailbox } = stores(root);
    const delays: Record<AgentProvider, number> = { codex: 60, claude: 5, grok: 30, opencode: 0 };
    const availableOrder: AgentProvider[] = [];
    const seen = new Set<AgentProvider>();
    const accountReads = new Set<AgentProvider>();
    let releaseAccountReads: (() => void) | undefined;
    const allAccountReadsStarted = new Promise<void>((resolve) => {
      releaseAccountReads = resolve;
    });
    const waitForConcurrentAccountReads = async (method: string, provider: AgentProvider) => {
      if (method !== "account/read") return;
      accountReads.add(provider);
      if (accountReads.size === 3) releaseAccountReads?.();
      await allAccountReadsStarted;
    };
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) =>
        new FakeAgentClient(
          provider,
          "DONE",
          true,
          true,
          { "account/read": delays[provider] },
          waitForConcurrentAccountReads,
        ),
    });
    service.on("event", (event) => {
      if (event.type !== "status") return;
      for (const provider of event.status.providers ?? []) {
        if (provider.state !== "available" || seen.has(provider.id)) continue;
        seen.add(provider.id);
        availableOrder.push(provider.id);
      }
    });

    await Promise.race([
      service.initialize(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Provider account checks did not start concurrently.")), 3_000),
      ),
    ]);

    expect(availableOrder).toEqual(["claude", "grok", "codex"]);

    // The CLI also reports gpt-reserve, gpt-5.5, gpt-5.4-mini and codex-auto-review, the models
    // this product does not offer.
    expect(
      service
        .listModels()
        .filter((model) => model.provider === "codex")
        .map((model) => model.id),
    ).toEqual(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.4", "gpt-5.3-codex-spark"]);
  });
  async function opencodeModelIds(storedKey: string | null, catalog?: string[]): Promise<string[]> {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        // Zen and Go reach OpenBot as one catalog, and the stored key is a Go key: the Go models
        // stay while the Zen ones the key does not buy leave, which is what makes the split a
        // decision this app has to make rather than one it can read off the response.
        if (provider === "opencode") {
          const ids = catalog ?? [
            "opencode/big-pickle",
            "opencode/claude-opus-5",
            "opencode/spark-free",
            "opencode-go/kimi-k3",
          ];
          client.modelList = () => ({ data: ids.map((model) => ({ model })) });
        }
        return client;
      },
      bundledExecutables: {},
      prepareAgentWorkspace: async () => undefined,
      hostedSites: null,
      sidebarLayout: null,
      preferredModel: null,
      credentials: { apiKey: () => storedKey, customProviders: () => [], mcpServers: () => [] },
    });
    await service.initialize();
    return service
      .listModels()
      .filter((model) => model.provider === "opencode")
      .map((model) => model.id);
  }

  it("keeps the OpenCode Go models the stored key buys, and drops the paid Zen ones it does not", async () => {
    expect(await opencodeModelIds("go-key")).toEqual([
      "opencode/big-pickle",
      "opencode/spark-free",
      "opencode-go/kimi-k3",
    ]);
  });

  it("keeps the OpenCode Zen models when the user's own OpenCode sign-in is what lists them", async () => {
    expect(await opencodeModelIds(null)).toEqual([
      "opencode/big-pickle",
      "opencode/spark-free",
      "opencode/claude-opus-5",
      "opencode-go/kimi-k3",
    ]);
  });

  it("leads the OpenCode catalog with the free models, Muse first", async () => {
    // An agent that has chosen no model runs whatever comes first, and OpenCode reports the
    // services the user signed in to before its own. So the order carries four claims: Muse leads,
    // no billed model outranks a free one, OpenCode's own paid models outrank a third-party
    // sign-in OpenBot cannot refresh, and the CLI's order survives inside one tier.
    expect(
      await opencodeModelIds(null, [
        "openai/gpt-5.3-codex-spark",
        "opencode/big-pickle",
        "opencode/nemotron-3.5-lightning-free",
        "opencode/mimo-v2.5-free",
        "opencode/muse-spark-1.3-contributor-free",
      ]),
    ).toEqual([
      "opencode/muse-spark-1.3-contributor-free",
      "opencode/big-pickle",
      "opencode/nemotron-3.5-lightning-free",
      "opencode/mimo-v2.5-free",
      "openai/gpt-5.3-codex-spark",
    ]);
  });

  it("keeps the CLI version with sign-in-required and no models when OpenCode reports no account", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, "DONE", false, provider !== "opencode"),
      preferredProvider: "opencode",
    });
    service = agentService;
    // The version comes from the resolve step while the models come from the later discovery, so a
    // connected CLI with no account keeps its version on the row while the catalog stays empty.
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({
        id: "opencode",
        state: "sign-in-required",
        version: expect.any(String),
        message: expect.stringContaining("OpenCode"),
      }),
    );
    expect(service.listModels().filter((model) => model.provider === "opencode")).toEqual([]);
  });

  it("restarts OpenCode on a changed key before it reports the change", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    let storedKey: string | null = null;
    const clients: FakeAgentClient[] = [];
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") {
          client.modelList = () => ({
            data: ["opencode/big-pickle", "opencode/claude-opus-5", "opencode-go/kimi-k3"].map((model) => ({
              model,
            })),
          });
          clients.push(client);
        }
        return client;
      },
      bundledExecutables: {},
      prepareAgentWorkspace: async () => undefined,
      hostedSites: null,
      sidebarLayout: null,
      preferredModel: null,
      credentials: { apiKey: () => storedKey, customProviders: () => [], mcpServers: () => [] },
    });
    await service.initialize();

    await service.changeProviderCredential("opencode", async () => {
      storedKey = "go-key";
    });

    // A CLI reads its key at spawn, so only a new process can list what the key buys. The paid
    // Zen model leaves the catalog only when that process is the one reporting it, while the
    // free and Go models stay.
    expect(clients).toHaveLength(2);
    expect(clients[0]?.running).toBe(false);
    expect(
      service
        .listModels()
        .filter((model) => model.provider === "opencode")
        .map((model) => model.id),
    ).toEqual(["opencode/big-pickle", "opencode-go/kimi-k3"]);
  });

  it("uses startup fallbacks when provider discovery is unavailable", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        client.modelList = () => {
          throw new Error("Discovery unavailable");
        };
        return client;
      },
    });
    const fallback = service.listModels();
    await service.initialize();
    expect(service.listModels()).toEqual(fallback);
  });

  it.each(["codex", "claude", "grok"] as const)(
    "discovers and refreshes %s models without losing the catalog on failure",
    async (provider) => {
      process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
      process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
      const { store, mailbox } = stores(root);
      const client = new FakeAgentClient(provider);
      const id = provider === "codex" ? "gpt-6-astra" : `${provider}-future-model`;
      let response: unknown = {
        data: [
          {
            model: id,
            displayName: "Discovered model",
            defaultReasoningEffort: "high",
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          },
          { model: "hidden-model", hidden: true, displayName: "Hidden model" },
        ],
      };
      let failure = false;
      let queried = false;
      client.modelList = () => {
        queried = true;
        if (failure) throw new Error("Discovery unavailable");
        return response;
      };
      service = createTestService({
        store,
        mailbox,
        preferredProvider: provider,
        clientFactory: (candidate) => (candidate === provider ? client : new FakeAgentClient(candidate)),
      });
      await service.initialize();
      const catalog = () => service?.listModels().filter((model) => model.provider === provider);
      // A model the CLI marks hidden is still offered: the CLI runs it, so the picker lists it.
      expect(catalog()).toEqual([
        {
          provider,
          id,
          name: "Discovered model",
          description: expect.any(String),
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: ["high"],
        },
        {
          provider,
          id: "hidden-model",
          name: "Hidden model",
          description: expect.any(String),
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["medium"],
        },
      ]);

      const refresh = async () => {
        queried = false;
        const current = service;
        if (!current) throw new Error("Service not initialized");
        const published = new Promise<void>((resolve) => {
          const listener = (event: { type: string }) => {
            if (event.type !== "status" || !queried) return;
            current.off("event", listener);
            resolve();
          };
          current.on("event", listener);
        });
        await current.refreshProviders();
        await published;
      };
      failure = true;
      await refresh();
      expect(catalog()?.map((model) => model.id)).toEqual([id, "hidden-model"]);
      failure = false;
      response = { data: [{ model: id }, { model: "newly-available" }] };
      await refresh();
      expect(catalog()?.map((model) => model.id)).toEqual([id, "newly-available"]);
      response = { data: [] };
      await refresh();
      expect(catalog()).toEqual([]);
      failure = true;
      await refresh();
      expect(catalog()).toEqual([]);
    },
  );

  it("keeps the whole display name the provider CLI reports", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex");
    client.modelList = () => ({
      data: [
        { model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
        { model: "gpt-6-astra", displayName: "GPT-6 Astra" },
      ],
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    expect(
      service
        .listModels()
        .filter((model) => model.provider === "codex")
        .map((model) => model.name),
    ).toEqual(["GPT-5.6 Sol", "GPT-6 Astra"]);
  });

  it("names a Claude model by the model, not by the pick Claude Code calls it", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("claude");
    client.modelList = () => ({
      data: [
        { model: "claude-sonnet-5", displayName: "Default (recommended)" },
        { model: "claude-haiku-4-5-20251001", displayName: "Haiku" },
        { model: "claude-fable-5-1[1m]", displayName: "Fable" },
        { model: "claude-next", displayName: "Next" },
      ],
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "claude",
      clientFactory: () => client,
    });
    await service.initialize();
    expect(
      service
        .listModels()
        .filter((model) => model.provider === "claude")
        .map((model) => model.name),
    ).toEqual(["Claude Sonnet 5", "Claude Haiku 4.5", "Claude Fable 5.1 (1M context)", "Next"]);
  });

  it("collects all ChatGPT pages and keeps the previous catalog when pagination fails", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex");
    let repeat = false;
    client.modelList = (params) => {
      const cursor = getString(params, "cursor");
      return cursor
        ? { data: [{ model: "gpt-6-astra" }, { model: "gpt-5.6-sol" }], nextCursor: repeat ? "page-2" : null }
        : { data: [{ model: repeat ? "partial-result" : "gpt-5.6-sol" }], nextCursor: "page-2" };
    };
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    expect(
      service
        .listModels()
        .filter((model) => model.provider === "codex")
        .map((model) => model.id),
    ).toEqual(["gpt-5.6-sol", "gpt-6-astra"]);
    expect(client.requests).toContainEqual({
      method: "model/list",
      params: { limit: 100, includeHidden: true, cursor: "page-2" },
    });
    const previous = service.listModels();
    repeat = true;
    // initialize awaits metadata discovery, unlike the background provider Refresh action.
    await service.stop();
    await service.initialize();
    expect(service.listModels()).toEqual(previous);
  });

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

  it("reports an updated CLI that stops at start as broken, with its reason, not as signed out", async () => {
    const managed = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    const exit = new AgentProcessExitError("Claude stopped before it answered (exit code 3).", "Error: bad config");
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "claude",
      clientFactory: (provider) =>
        new FakeAgentClient(provider, "", true, true, {}, async (method, from) => {
          if (from === "claude" && method === "initialize") throw exit;
        }),
      bundledExecutables: { claude: managed },
    });
    await service.initialize();

    const message =
      "OpenBot could not update the Claude CLI. Claude stopped before it answered (exit code 3). Error: bad config";
    await expect(service.updateProviderCli("claude", async () => managed)).rejects.toThrow(message);
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "error", message }),
    );
  });

  it("keeps an MCP secret the stopped CLI quoted out of the update failure", async () => {
    const managed = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    let claudeClients = 0;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "claude",
      // The running client starts; its replacement stops and quotes the server's secret on stderr.
      clientFactory: (provider) => {
        const replacement = provider === "claude" && ++claudeClients > 1;
        return new FakeAgentClient(provider, "", true, true, {}, async (method) => {
          if (replacement && method === "initialize") {
            // Past the shortening, so a cut before redaction would leave a prefix of the secret.
            throw new AgentProcessExitError(
              "Claude stopped before it answered (exit code 3).",
              `${"x".repeat(285)} rejected abcdef123456`,
            );
          }
        });
      },
      bundledExecutables: { claude: managed },
    });
    await service.initialize();
    new McpServerStore(store.database).save({
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
    });

    const message = `OpenBot could not update the Claude CLI. Claude stopped before it answered (exit code 3). ${"x".repeat(285)} rejected •••`;
    await expect(service.updateProviderCli("claude", async () => managed)).rejects.toThrow(message);
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "available", message }),
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

  it("keeps an MCP credential out of the provider status a crashed CLI leaves behind", async () => {
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
    const messages: (string | null)[] = [];
    service.on("event", (event) => {
      if (event.type !== "status") return;
      for (const provider of event.status.providers ?? []) {
        if (provider.id === "codex" && provider.state === "error") messages.push(provider.message);
      }
    });

    // The CLI quotes what it was given as it dies, and its last words become the provider status
    // the renderer shows beside the provider.
    client.emit("exit", new Error("Codex App Server exited: rejected abcdef123456"));

    await waitFor(() => messages.length > 0);
    expect(messages[0]).toBe("Codex App Server exited: rejected •••");
  });

  it("keeps Grok's telemetry export failure out of the chat it was switched into", async () => {
    process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
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
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "grok", model: "grok-4.5" });
    const client = clients.get("grok");
    if (!client) throw new Error("Grok did not start.");

    // Verbatim, with the colour the CLI writes on a pipe already removed by the stderr reader. A
    // computer that cannot reach the collector writes this on every flush while the turn runs, and
    // the user met it as a "Provider error" toast right after switching the chat to Grok.
    client.emit(
      "diagnostic",
      '2026-09-14T08:28:39.022673Z ERROR name="BatchSpanProcessor.ExporterError" error="Operation failed: HTTP export failed: network error"',
    );
    // Grok's own network failure is not telemetry, and stays visible.
    client.emit("diagnostic", "ERROR grok: the model endpoint could not be reached");

    await waitFor(() => events.some((event) => event.type === "error"));
    expect(events.filter((event) => event.type === "error")).toEqual([
      expect.objectContaining({ message: "ERROR grok: the model endpoint could not be reached" }),
    ]);

    // The chat is on Grok and still runs a turn: the export failed, the agent's work did not.
    await service.sendMessage({ agentId: "chief", text: "Continue on Grok." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    expect(service.listAgents().find((agent) => agent.id === "chief")?.provider).toBe("grok");
  });

  it("keeps Grok's failed tool call out of the provider error toast", async () => {
    process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
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
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "grok", model: "grok-4.5" });
    const client = clients.get("grok");
    if (!client) throw new Error("Grok did not start.");

    // As reported in #692: an embedded-browser click that returned an error, which the agent reads
    // as the tool's result and can retry.
    client.emit(
      "diagnostic",
      "tool_error: tool_output_error tool_name='use_tool' effective_tool_name='openbot_browser__click' model_id='grok-4.7' error_kind='tool_output_error'",
    );
    client.emit("diagnostic", "ERROR grok: the model endpoint could not be reached");

    await waitFor(() => events.some((event) => event.type === "error"));
    expect(events.filter((event) => event.type === "error")).toEqual([
      expect.objectContaining({ message: "ERROR grok: the model endpoint could not be reached" }),
    ]);
  });

  it.each([
    "Grok Build usage balance exhausted",
    "insufficient_quota",
    "Your credit balance is too low to access the Anthropic API",
    "You have exceeded your current quota",
    "Billing hard limit has been reached",
  ])("recognizes an exhausted provider usage limit: %s", (message) => {
    expect(isUsageLimitDiagnostic(message)).toBe(true);
  });

  it.each([
    "402 Payment Required",
    "429 Too Many Requests",
    "The provider failed to reach the model endpoint",
    "Authentication failed",
  ])("does not hide another provider failure: %s", (message) => {
    expect(isUsageLimitDiagnostic(message)).toBe(false);
  });

  it("replaces Grok's repeated exhausted-balance errors with one usage refresh", async () => {
    process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
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
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "grok", model: "grok-4.5" });
    const client = clients.get("grok");
    if (!client) throw new Error("Grok did not start.");
    client.accountRateLimits = {
      rateLimits: {
        limitId: "grok",
        secondary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
      },
      rateLimitsByLimitId: null,
    };
    const usageReadsBefore = client.requests.filter((request) => request.method === "account/rateLimits/read").length;
    events.length = 0;

    client.emit(
      "diagnostic",
      '2026-09-18T08:54:24.476465Z ERROR error=Internal error: {"message":"API error (status 402 Payment Required): Grok Build usage balance exhausted","http_status":402}',
    );
    client.emit(
      "diagnostic",
      '2026-09-18T08:54:24.476222Z ERROR error=Internal error: {"message":"API error (status 402 Payment Required): Grok Build usage balance exhausted","http_status":402}',
    );
    client.emit("notification", {
      method: "error",
      params: {
        message:
          'responses API error status=402 Payment Required error_message=Grok Build usage balance exhausted body_preview={"error":"Grok Build usage balance exhausted"} model_id=grok-4.6',
      },
    });

    await waitFor(() => events.some((event) => event.type === "usage-changed"));
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(client.requests.filter((request) => request.method === "account/rateLimits/read")).toHaveLength(
      usageReadsBefore + 1,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "usage-changed",
        usage: expect.objectContaining({
          limits: [expect.objectContaining({ id: "grok", secondary: expect.objectContaining({ usedPercent: 100 }) })],
        }),
      }),
    );
  });

  it("refuses to replace a CLI that is running a turn", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Keep working." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    // The updater would replace the binary under the running turn, so it is not started at all.
    await expect(
      service.updateProviderCli("codex", async () => {
        throw new Error("Busy provider started an install.");
      }),
    ).rejects.toThrow(/working on a turn/u);

    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "available", version: "0.144.1" }),
    );
  });

  it("keeps the old key while the provider is working on a turn", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Keep working." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    // Writing the key and then failing to restart would leave a key on disk that no process uses,
    // under a dialog that reports the save as failed. So a busy provider is refused first.
    let changed = false;
    await expect(
      service.changeProviderCredential("codex", async () => {
        changed = true;
      }),
    ).rejects.toThrow(/working on a turn/u);
    expect(changed).toBe(false);
  });

  it("delivers messages again after a key change that could not be saved", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await expect(
      service.changeProviderCredential("codex", async () => {
        throw new Error("System secret storage is unavailable.");
      }),
    ).rejects.toThrow("System secret storage is unavailable.");

    // The change holds deliveries while it runs. A failed save must release them, or the agent
    // stays silent until the app restarts.
    await service.sendMessage({ agentId: "chief", text: "Still there?" });
    await waitFor(() => events.some((event) => event.type === "turn-completed"));
  });

  it("refuses to replace a CLI that is running a channel turn", async () => {
    const { service: agentService, store } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, "", false),
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
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: "send",
        text: "Work in the channel.",
        recipientAgentId: "chief",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    // A channel turn runs on a thread of its own, so the conversation of the agent holds no turn id
    // while the CLI works. The delivery has reached its turn, so no counter reports it either.
    // The assignment holds the turn id the provider answered with, so the CLI is on a turn. The
    // channel keeps that turn out of the conversation of the agent, and the delivery has left the
    // counter of the deliveries that are starting.
    await waitFor(() => service?.channels.store.assignments("channel-1").some((item) => item.turnId));

    await expect(
      service.updateProviderCli("codex", async () => {
        throw new Error("Busy provider started an install.");
      }),
    ).rejects.toThrow(/working on a turn/u);
  });

  it("refuses to replace a CLI while a delivery is on its way to a turn", async () => {
    let releaseTurnStart: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseTurnStart = resolve;
    });
    let turnStartReached = false;
    const { service: agentService } = await startService(root, {
      preferredProvider: "codex",
      client: (provider) =>
        new FakeAgentClient(provider, "", false, true, {}, async (method, target) => {
          if (method !== "turn/start" || target !== "codex") return;
          turnStartReached = true;
          await blocked;
        }),
    });
    service = agentService;
    void service.sendMessage({ agentId: "chief", text: "Keep working." });
    // The delivery has no turn id yet, and the client it is about to prompt must not be replaced.
    await waitFor(() => turnStartReached);

    await expect(
      service.updateProviderCli("codex", async () => {
        throw new Error("Busy provider started an install.");
      }),
    ).rejects.toThrow(/working on a turn/u);

    releaseTurnStart?.();
  });

  it("refuses to replace a CLI that is compacting a thread", async () => {
    let releaseCompaction: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });
    let compactionReached = false;
    let client: FakeAgentClient | undefined;
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const created = new FakeAgentClient(provider, "", true, true, {}, async (method, target) => {
          if (method !== "thread/compact/start" || target !== "codex") return;
          compactionReached = true;
          await blocked;
        });
        if (provider === "codex") client = created;
        return created;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "First large task" });
    await waitFor(() => events.some((event) => event.type === "turn-completed"));

    // A pressured thread compacts before its next message, and that compaction is a provider turn
    // the agent never owns: it holds no active turn id, so only its own guard reports it.
    client?.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "codex-session-1",
        tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 },
      },
    });
    void service.sendMessage({ agentId: "chief", text: "Run after compaction" });
    await waitFor(() => compactionReached);

    await expect(
      service.updateProviderCli("codex", async () => {
        throw new Error("Busy provider started an install.");
      }),
    ).rejects.toThrow(/working on a turn/u);

    releaseCompaction?.();
  });

  it("delivers a message queued while a failed update held the CLI", async () => {
    let failInstall: ((error: Error) => void) | undefined;
    const gate = new Promise<string>((_resolve, reject) => {
      failInstall = reject;
    });
    const claude = await createUpdatableFakeClaude(root, "2.1.250");
    process.env.OPENBOT_CLAUDE_PATH = claude.executable;
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "claude",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    const running = service;
    const started: string[] = [];
    service.on("event", (event) => {
      if (event.type === "turn-started") started.push(event.agentId);
    });
    await service.initialize();
    const agent = await service.createAgent(CREATE_AGENT_INPUT);
    // The agent's own first message has to be delivered and finished, or it is the turn the
    // assertion below sees.
    await waitFor(() => started.includes(agent.id));
    await waitFor(async () => (await running.readConversation(agent.id)).activeTurnId === null);
    const turnsBefore = started.filter((agentId) => agentId === agent.id).length;

    let installing = false;
    const update = service.updateProviderCli("claude", () => {
      installing = true;
      return gate;
    });
    await waitFor(() => installing);
    await service.sendMessage({ agentId: agent.id, text: "Take this when you are back." });
    // The CLI under the client is being replaced, so the delivery waits in the mailbox.
    expect(started.filter((agentId) => agentId === agent.id)).toHaveLength(turnsBefore);

    failInstall?.(new Error("Runtime download failed."));
    // A refused update replaces no client, so nothing else would deliver what it held back.
    await expect(update).rejects.toThrow(/Runtime download failed/u);

    await waitFor(() => started.filter((agentId) => agentId === agent.id).length > turnsBefore);
  });

  // The replacement puts the provider back on the binary now on disk in one of two ways: it swaps
  // the client of a provider that has one, and it connects one whose client is gone. Neither is a
  // start, so neither may run restart recovery over the other providers' live deliveries.
  for (const claudeSignedIn of [true, false]) {
    it(`leaves another provider's running turn alone while a CLI ${
      claudeSignedIn ? "is replaced" : "with no client is connected again"
    }`, async () => {
      const claude = await createUpdatableFakeClaude(root, "2.1.250");
      process.env.OPENBOT_CLAUDE_PATH = claude.executable;
      const { store, mailbox } = stores(root);
      service = createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: (provider) => new FakeAgentClient(provider, "", false, claudeSignedIn || provider !== "claude"),
      });
      const running = service;
      const events: AgentEvent[] = [];
      service.on("event", (event) => events.push(event));
      await service.initialize();
      await service.sendMessage({ agentId: "chief", text: "Keep working." });
      await waitFor(() => events.some((event) => event.type === "turn-started"));
      const turnId = (await running.readConversation("chief")).activeTurnId;

      // Claude is idle, so its CLI is replaced. Restart recovery would settle every unresolved
      // delivery, and this one belongs to a turn Codex is still running.
      process.env.OPENBOT_CLAUDE_PATH = join(root, "missing-claude");
      await service.updateProviderCli("claude", async () => claude.executable);

      expect(running.listQueue("chief").deliveries[0]?.status).toBe("running");
      expect((await running.readConversation("chief")).activeTurnId).toBe(turnId);
    });
  }

  it("keeps the owner of a CLI whose provider is signed out", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, undefined, true, provider !== "claude"),
      preferredProvider: "codex",
    });
    service = agentService;

    // Signed out, the provider keeps no client, so the row would name no owner - and an unowned CLI
    // is read as the managed copy, which sends the user's own install to a download.
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "sign-in-required", cliSource: "system" }),
    );
  });

  it("reports installation failure without replacing the working client", async () => {
    const managed = await createFakeClaude(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider),
      preferredProvider: "claude",
      bundledExecutables: { claude: managed },
    });
    service = agentService;
    await expect(
      service.updateProviderCli("claude", async () => {
        throw new Error("Runtime verification failed.");
      }),
    ).rejects.toThrow("Runtime verification failed.");
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "available", version: "2.1.246" }),
    );
  });
});

describe.sequential("ProviderRuntime: custom provider reload", () => {
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
