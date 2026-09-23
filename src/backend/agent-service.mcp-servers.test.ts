import {
  type AgentEvent,
  COMPUTER_USE_MCP_SERVER_ID,
  COMPUTER_USE_MCP_SERVER_NAME,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  paramsRecord,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { loginShellPath } from "./mcp-provider-shapes";

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

describe.sequential("AgentService: MCP servers", () => {
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
});
