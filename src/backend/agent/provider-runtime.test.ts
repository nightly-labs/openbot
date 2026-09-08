// @vitest-environment node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "../agent-client";
import { AgentService } from "../agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createFakeGrok,
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
  it("checks providers concurrently and publishes each completed row", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
    const { store, mailbox } = stores(root);
    const delays: Record<AgentProvider, number> = { codex: 60, claude: 5, grok: 30 };
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

  it("runs the user's own CLI updater and reports the version the provider now runs", async () => {
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
    await service.initialize();
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", version: "2.1.246", cliSource: "system" }),
    );

    const status = await service.updateProviderCli("claude");

    expect(await readTextOrEmpty(claude.marker)).toContain("updated");
    expect(status.providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "available", version: "2.1.250" }),
    );
  });

  it("refuses to run a self-updater against the CLI copy OpenBot manages", async () => {
    const claude = await createUpdatableFakeClaude(root, "2.1.250");
    const { store, mailbox } = stores(root);
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      30_000,
      "claude",
      (provider) => new FakeAgentClient(provider),
      undefined,
      claude.executable,
    );
    await service.initialize();
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", version: "2.1.246", cliSource: "managed" }),
    );

    await expect(service.updateProviderCli("claude")).rejects.toThrow(/manages/u);

    expect(await readTextOrEmpty(claude.marker)).toBe("");
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "available", version: "2.1.246" }),
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
    await expect(service.updateProviderCli("codex")).rejects.toThrow(/working on a turn/u);

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

    await expect(service.updateProviderCli("codex")).rejects.toThrow(/working on a turn/u);

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

    await expect(service.updateProviderCli("codex")).rejects.toThrow(/working on a turn/u);

    releaseCompaction?.();
  });

  it("delivers a message queued while a failed update held the CLI", async () => {
    const gate = join(root, "claude-update-gate");
    const claude = await createUpdatableFakeClaude(root, "2.1.250", "Installed by Homebrew.", gate);
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

    const update = service.updateProviderCli("claude");
    await waitFor(() => existsSync(claude.started));
    await service.sendMessage({ agentId: agent.id, text: "Take this when you are back." });
    // The CLI under the client is being replaced, so the delivery waits in the mailbox.
    expect(started.filter((agentId) => agentId === agent.id)).toHaveLength(turnsBefore);

    await writeFile(gate, "go");
    // A refused update replaces no client, so nothing else would deliver what it held back.
    await expect(update).rejects.toThrow(/Installed by Homebrew\./u);

    await waitFor(() => started.filter((agentId) => agentId === agent.id).length > turnsBefore);
  });

  it("keeps the CLI's own reason when its updater refuses", async () => {
    const claude = await createUpdatableFakeClaude(root, "2.1.250", "Installed by Homebrew. Run brew upgrade.");
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
    await service.initialize();

    // The caller and the provider row get the same reason: the CLI's own words.
    await expect(service.updateProviderCli("claude")).rejects.toThrow(/Installed by Homebrew\. Run brew upgrade\./u);

    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({
        id: "claude",
        state: "available",
        version: "2.1.246",
        message: expect.stringContaining("Installed by Homebrew. Run brew upgrade."),
      }),
    );
  });
});
