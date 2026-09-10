// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "../agent-client";
import { AgentService } from "../agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createFakeCodex,
  createFakeGrok,
  createFakeOpencode,
  createPendingFakeClaude,
  createUpdatableFakeClaude,
  FakeAgentClient,
  fakeBrowser,
  readTextOrEmpty,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";

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

describe.sequential("ProviderRuntime: account checks and login", () => {
  it("reconnects OpenCode without a browser and refuses to replace an active client", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider, "DONE", false);
      if (provider === "opencode") clients.push(client);
      return client;
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
    const { store, mailbox } = stores(root);
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) => new FakeAgentClient(provider, "", false),
    );
    await service.initialize();
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider, "DONE", true, true, {}, async (method) => {
        if (provider !== "opencode" || !reconnecting || method !== "account/read") return;
        checkingAccount = true;
        await gate;
        if (fail) throw new Error("Reconnect failed.");
      });
      if (provider === "opencode") clients.push(client);
      return client;
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
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) =>
        new FakeAgentClient(
          provider,
          "DONE",
          true,
          true,
          { "account/read": delays[provider] },
          waitForConcurrentAccountReads,
        ),
    );
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
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "opencode",
      (provider) => {
        const client = new FakeAgentClient(provider);
        // Zen and Go reach OpenBot as one catalog, which is what makes the split a decision this
        // app has to make rather than one it can read off the response.
        if (provider === "opencode") {
          const ids = catalog ?? ["opencode/big-pickle", "opencode/claude-opus-5", "opencode-go/kimi-k3"];
          client.modelList = () => ({ data: ids.map((model) => ({ model })) });
        }
        return client;
      },
      {},
      async () => undefined,
      null,
      null,
      { apiKey: () => storedKey },
    );
    await service.initialize();
    return service
      .listModels()
      .filter((model) => model.provider === "opencode")
      .map((model) => model.id);
  }

  it("hides the OpenCode Go models that the key OpenBot supplied does not buy", async () => {
    expect(await opencodeModelIds("zen-key")).toEqual(["opencode/big-pickle", "opencode/claude-opus-5"]);
  });

  it("keeps the OpenCode Go models when the user's own OpenCode sign-in is what lists them", async () => {
    expect(await opencodeModelIds(null)).toEqual([
      "opencode/big-pickle",
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
      "opencode/nemotron-3.5-lightning-free",
      "opencode/mimo-v2.5-free",
      "opencode/big-pickle",
      "openai/gpt-5.3-codex-spark",
    ]);
  });

  it("uses startup fallbacks when provider discovery is unavailable", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      client.modelList = () => {
        throw new Error("Discovery unavailable");
      };
      return client;
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
      service = new AgentService(store, mailbox, fakeBrowser(), 30_000, provider, (candidate) =>
        candidate === provider ? client : new FakeAgentClient(candidate),
      );
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "claude", () => client);
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(
        provider,
        provider === "codex" ? "CODEX_DONE" : "CLAUDE_DONE",
        true,
        provider !== "codex",
      );
      if (provider === "codex") codexClients.push(client);
      return client;
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, target, (provider) => {
      const authenticated = provider === target ? clients > 0 : true;
      if (provider === target) clients += 1;
      return new FakeAgentClient(provider, "DONE", true, authenticated);
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
    const { store, mailbox } = stores(root);
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) => new FakeAgentClient(provider, "DONE", true, provider !== "codex"),
    );
    await service.initialize();

    await expect(
      service.connectProvider("codex", async () => Promise.reject(new Error("browser failed"))),
    ).rejects.toThrow("could not open");
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "sign-in-required" }),
    );
  });

  it("cancels a ChatGPT login that does not complete", async () => {
    const { store, mailbox } = stores(root);
    const codexClients: FakeAgentClient[] = [];
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "DONE", true, provider !== "codex");
      if (provider === "codex") codexClients.push(client);
      return client;
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

  it("runs provider logins independently and Refresh cancels both generations", async () => {
    const claudeLoginLog = join(root, "claude-login.log");
    process.env.OPENBOT_FAKE_CLAUDE_LOGIN_LOG = claudeLoginLog;
    process.env.OPENBOT_CLAUDE_PATH = await createPendingFakeClaude(root);
    const { store, mailbox } = stores(root);
    const codexClients: FakeAgentClient[] = [];
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "DONE", true, false);
      if (provider === "codex") codexClients.push(client);
      return client;
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "DONE", true, provider !== "codex" || codexClients.length === 0);
      if (provider === "codex") codexClients.push(client);
      return client;
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
      const { store, mailbox } = stores(root);
      service = new AgentService(
        store,
        mailbox,
        fakeBrowser(),
        30_000,
        target,
        (provider) => new FakeAgentClient(provider),
      );
      await service.initialize();
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "claude", (provider) => {
      const client = new FakeAgentClient(provider);
      if (provider === "claude") clients.push(client);
      return client;
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
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "claude",
      (provider) => {
        const client = new FakeAgentClient(provider, "", true, provider !== "claude" || clients.length === 0);
        if (provider === "claude") clients.push(client);
        return client;
      },
      { claude: managed },
    );
    await service.initialize();
    await expect(service.updateProviderCli("claude", async () => managed)).rejects.toThrow();
    expect(clients[0]?.running).toBe(true);
    expect(clients[1]?.running).toBe(false);
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", version: "2.1.246", state: "available" }),
    );
  });

  it("refuses to replace a CLI that is running a turn", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) => new FakeAgentClient(provider, "", false),
    );
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

  it("refuses to replace a CLI while a delivery is on its way to a turn", async () => {
    let releaseTurnStart: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseTurnStart = resolve;
    });
    let turnStartReached = false;
    const { store, mailbox } = stores(root);
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) =>
        new FakeAgentClient(provider, "", false, true, {}, async (method, target) => {
          if (method !== "turn/start" || target !== "codex") return;
          turnStartReached = true;
          await blocked;
        }),
    );
    await service.initialize();
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const created = new FakeAgentClient(provider, "", true, true, {}, async (method, target) => {
        if (method !== "thread/compact/start" || target !== "codex") return;
        compactionReached = true;
        await blocked;
      });
      if (provider === "codex") client = created;
      return created;
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
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "claude",
      (provider) => new FakeAgentClient(provider),
    );
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
      service = new AgentService(
        store,
        mailbox,
        fakeBrowser(),
        30_000,
        "codex",
        (provider) => new FakeAgentClient(provider, "", false, claudeSignedIn || provider !== "claude"),
      );
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
    const { store, mailbox } = stores(root);
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "codex",
      (provider) => new FakeAgentClient(provider, undefined, true, provider !== "claude"),
    );
    await service.initialize();

    // Signed out, the provider keeps no client, so the row would name no owner - and an unowned CLI
    // is read as the managed copy, which sends the user's own install to a download.
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "sign-in-required", cliSource: "system" }),
    );
  });

  it("reports installation failure without replacing the working client", async () => {
    const managed = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "claude",
      (provider) => new FakeAgentClient(provider),
      { claude: managed },
    );
    await service.initialize();
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
