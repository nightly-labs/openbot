import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  createFakeGrok,
  createTestService,
  FakeAgentClient,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";
import { DIAGNOSTIC_TEXT_LIMIT } from "../stderr-diagnostics";
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

describe.sequential("ProviderRuntime: diagnostics and redaction", () => {
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
});
