import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  createFakeClaude,
  createFakeGrok,
  createFakeOpencode,
  createTestService,
  FakeAgentClient,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
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

describe.sequential("ProviderRuntime: model catalog", () => {
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
});
