import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  COMPUTER_USE_MCP_SERVER_ID,
  COMPUTER_USE_MCP_SERVER_NAME,
  GITHUB_CONNECTOR_MCP_SERVER_ID,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { McpGateway } from "../src/backend/agent/mcp-gateway";
import {
  agentFallbackMcpServers,
  findAgentMcpTool,
  handleMcpServerTool,
  type MarketplaceAppServer,
  type McpServerToolName,
  marketplaceAppStatus,
  mcpFallbackRunsServer,
  mcpServersFromGateway,
  mcpToolCallResponse,
} from "../src/backend/agent/mcp-tools";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CATALOG_PIN_MOVES, McpServerStore } from "../src/backend/mcp-server-store";
import { startStdioMcpRelay } from "../src/backend/mcp-stdio-relay";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { catalogPluginSlug, loadCatalogPluginServers } from "../src/main/analytics-plugin-catalog";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-mcp-tools-e2e");
const URL_SECRET = "url-secret-7f3a91";
const HEADER_SECRET = "header-secret-2c8d40";

type Mode = "open" | "sign-in" | "key" | "guarded";

function asTransport(inner: {
  start(): Promise<void>;
  send: Transport["send"];
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"] | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;
}): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return transport;
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

async function mcpServer(mode: Mode): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (mode === "guarded")
        return json(
          response,
          401,
          { error: "a valid API key is required" },
          { "www-authenticate": 'Bearer realm="e2e"' },
        );
      if (mode === "sign-in" && path === "/.well-known/oauth-authorization-server") {
        const origin = `http://${request.headers.host}`;
        return json(response, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          response_types_supported: ["code"],
        });
      }
      if (path !== "/mcp") return json(response, 404, { error: "not found" });
      if (mode === "sign-in")
        return json(response, 401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="e2e"' });
      if (mode === "key" && request.headers.authorization !== `Bearer ${HEADER_SECRET}`)
        return json(response, 401, { error: "unauthorized" });
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const message: {
        id?: number | string;
        method: string;
        params?: { name?: string; arguments?: unknown };
      } = JSON.parse(await body(request));
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "initialize")
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "e2e", version: "1" },
          },
        });
      if (message.method === "tools/list") {
        const tool = (name: string) => ({ name, description: name, inputSchema: { type: "object", properties: {} } });
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [tool("search"), tool("read_page"), tool("create_page")] },
        });
      }
      if (message.method === "tools/call") {
        const name = message.params?.name ?? "";
        const text = `${name} ${JSON.stringify(message.params?.arguments ?? {})}`;
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text }], isError: name === "missing" },
        });
      }
      return json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } });
    })().catch((error: unknown) => response.writeHead(500).end(String(error)));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

async function closedUrl(): Promise<string> {
  const server = await mcpServer("open");
  await server.close();
  return server.url;
}

interface ToolAnswer {
  status?: string;
  error?: string;
  toolCount?: number;
  tools?: string[];
  servers?: Array<{ name: string; headerNames?: string[]; builtIn?: boolean; forYou?: boolean }>;
  enabled?: boolean;
  removed?: boolean;
  setupSteps?: string[];
  next?: string;
}

interface Call {
  name: string;
  tool: McpServerToolName | "suggest_marketplace_app";
  arguments: unknown;
  approved: boolean;
  success: boolean;
  result: ToolAnswer;
  approvals: string[];
  signInCards: string[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-agent-mcp-tools-"));
const database = new OpenBotDatabase(root);
const servers: Record<Mode, { url: string; close: () => Promise<void> }> = {
  open: await mcpServer("open"),
  "sign-in": await mcpServer("sign-in"),
  key: await mcpServer("key"),
  guarded: await mcpServer("guarded"),
};
const calls: Call[] = [];
let refreshes = 0;
let keysFromPerson = true;
const report: {
  passed: boolean;
  calls: Call[];
  refreshes: number;
  failures: string[];
  relayedStdio?: { pid: string; calls: number };
} = {
  passed: false,
  calls,
  refreshes: 0,
  failures: [],
};

try {
  await runCauseEffect(database.initialize());
  const store = new McpServerStore(database);
  const gateway = new McpGateway({
    servers: store,
    credentials: NO_PROVIDER_CREDENTIALS,
    computerUseMcpServer: () => null,
    logger: createOpenBotLogger("agent-service", () => undefined),
    hooks: {
      emitError: () => undefined,
      refreshAllAgentRuntimes: () =>
        Effect.sync(() => {
          refreshes += 1;
        }),
    },
  });
  const tools = mcpServersFromGateway(gateway);

  const call = async (name: string, tool: McpServerToolName, args: unknown, approved = true, using = tools) => {
    const approvals: string[] = [];
    const signInCards: string[] = [];
    const response = await runCauseEffect(
      handleMcpServerTool(using, {
        tool,
        agentId: "agent-a",
        arguments: args,
        approve: (reason) =>
          Effect.sync(() => {
            approvals.push(reason);
            return approved;
          }),
        keysFromPerson: () => Effect.succeed(keysFromPerson),
        requestSignIn: (config) =>
          Effect.sync(() => {
            signInCards.push(config.id);
          }),
      }),
    );
    const text = response.contentItems[0]?.type === "inputText" ? response.contentItems[0].text : "{}";
    const entry: Call = {
      name,
      tool,
      arguments: args,
      approved,
      success: response.success,
      result: JSON.parse(text),
      approvals,
      signInCards,
    };
    calls.push(entry);
    return entry;
  };
  const appStatus = async (name: string, appId: string, app: MarketplaceAppServer) => {
    const signInCards: string[] = [];
    const response = await runCauseEffect(
      marketplaceAppStatus(tools, app, (config) =>
        Effect.sync(() => {
          signInCards.push(config.id);
        }),
      ),
    );
    const text = response.contentItems[0]?.type === "inputText" ? response.contentItems[0].text : "{}";
    const entry: Call = {
      name,
      tool: "suggest_marketplace_app",
      arguments: { app: appId },
      approved: true,
      success: response.success,
      result: JSON.parse(text),
      approvals: [],
      signInCards,
    };
    calls.push(entry);
    return entry;
  };
  const row = (name: string): McpServerConfig | undefined => store.list().find((config) => config.name === name);

  const empty = await call("list empty", "list_mcp_servers", {});
  assert.deepEqual(empty.result, { servers: [] });

  const declined = await call(
    "declined add saves nothing",
    "save_mcp_server",
    { name: "docs", url: servers.open.url },
    false,
  );
  assert.equal(declined.success, false);
  assert.equal(declined.approvals.length, 1);
  assert.equal(row("docs"), undefined);
  assert.equal(refreshes, 0);

  const added = await call("add a server that answers", "save_mcp_server", {
    name: "docs",
    url: `${servers.open.url}?token=${URL_SECRET}`,
  });
  assert.equal(added.result.status, "ready");
  assert.deepEqual(added.result.tools, ["search", "read_page", "create_page"]);
  assert.equal(added.result.toolCount, 3);
  assert.match(added.approvals[0] ?? "", /Every agent on this server/u);
  assert.equal(row("docs")?.enabled, true);
  assert.equal(refreshes, 1);

  const signIn = await call("add a server that needs a sign-in", "save_mcp_server", {
    name: "calendar",
    url: servers["sign-in"].url,
  });
  assert.equal(signIn.result.status, "needs_sign_in");
  assert.deepEqual(signIn.signInCards, [row("calendar")?.id]);

  const key = await call("add a server that needs a key", "save_mcp_server", { name: "crm", url: servers.key.url });
  assert.equal(key.result.status, "needs_key");
  assert.equal(key.signInCards.length, 0);
  assert.ok(row("crm"), "a server that needs a key is saved for the user to add it");

  const guarded = await call("a server that wants its key on every path needs a key", "save_mcp_server", {
    name: "billing",
    url: servers.guarded.url,
  });
  assert.equal(guarded.result.status, "needs_key");
  assert.equal(guarded.signInCards.length, 0);
  assert.ok(row("billing"), "a server that wants its key on every path is saved for the user to add it");

  const down = await call("a server that does not answer is not saved", "save_mcp_server", {
    name: "down",
    url: await closedUrl(),
  });
  assert.equal(down.success, false);
  assert.equal(row("down"), undefined);

  const keys = [{ key: "Authorization", value: `Bearer ${HEADER_SECRET}` }];
  const wrongKey = await call("a wrong key the user gave still needs a key", "save_mcp_server", {
    name: "crm",
    headers: [{ name: "Authorization", value: "Bearer wrong-token-91c2" }],
  });
  assert.equal(wrongKey.result.status, "needs_key");
  const wrongHeaders = row("crm")?.headers;
  keysFromPerson = false;
  const injected = await call("keys that the user did not give are refused", "save_mcp_server", {
    name: "crm",
    headers: [{ name: "Authorization", value: `Bearer ${HEADER_SECRET}` }],
  });
  keysFromPerson = true;
  assert.equal(injected.success, false);
  assert.equal(injected.approvals.length, 0);
  assert.deepEqual(row("crm")?.headers, wrongHeaders);
  const keyed = await call("the agent sets the key the user gave", "save_mcp_server", {
    name: "crm",
    headers: [{ name: "authorization", value: `Bearer ${HEADER_SECRET}` }],
  });
  assert.equal(keyed.result.status, "ready");
  assert.match(keyed.approvals[0] ?? "", /headers: authorization\.$/u);
  assert.deepEqual(keyed.result.tools, ["search", "read_page", "create_page"]);
  assert.deepEqual(row("crm")?.headers, [{ key: "authorization", value: `Bearer ${HEADER_SECRET}` }]);
  const crm = row("crm");
  assert.ok(crm);
  store.save({ ...crm, headers: keys });
  const stdioHeaders = await call("a stdio server takes no headers", "save_mcp_server", {
    name: "local_headers",
    command: "node",
    headers: [{ name: "Authorization", value: `Bearer ${HEADER_SECRET}` }],
  });
  assert.equal(stdioHeaders.success, false);
  assert.equal(stdioHeaders.approvals.length, 0);
  assert.equal(row("local_headers"), undefined);
  const moved = await call("keys do not move to another server", "save_mcp_server", {
    name: "crm",
    url: servers.open.url,
  });
  assert.equal(moved.success, false);
  assert.equal(moved.approvals.length, 0);
  assert.equal(row("crm")?.url, servers.key.url);
  const transport = await call("keys do not move to another transport", "save_mcp_server", {
    name: "crm",
    command: "node",
  });
  assert.equal(transport.success, false);
  assert.deepEqual(row("crm")?.headers, keys);

  const program = store.save({
    ...crm,
    id: "",
    name: "local_tool",
    transport: "stdio",
    command: "npx",
    args: ["-y", "good-package"],
    env: [{ key: "API_TOKEN", value: HEADER_SECRET }],
    headers: [],
    url: "",
  });
  const otherProgram = await call("keys do not move to another program", "save_mcp_server", {
    name: "local_tool",
    args: ["-y", "other-package"],
  });
  assert.equal(otherProgram.success, false);
  assert.equal(otherProgram.approvals.length, 0);
  assert.deepEqual(row("local_tool")?.args, program.args);

  const edited = await call("an edit keeps the headers", "save_mcp_server", {
    name: "crm",
    url: `${servers.key.url}?region=eu`,
  });
  assert.equal(edited.result.status, "ready");
  assert.match(edited.approvals[0] ?? "", /^Change the MCP server crm/u);
  assert.deepEqual(row("crm")?.headers, keys);
  const movedWithKeys = await call("new keys go with a new address", "save_mcp_server", {
    name: "crm",
    url: servers.open.url,
    headers: [{ name: "Authorization", value: `Bearer ${HEADER_SECRET}` }],
  });
  assert.equal(movedWithKeys.result.status, "ready");
  assert.equal(row("crm")?.url, servers.open.url);
  assert.deepEqual(row("crm")?.headers, keys);
  keysFromPerson = false;
  const cleared = await call("an empty value removes a header", "save_mcp_server", {
    name: "crm",
    headers: [{ name: "AUTHORIZATION", value: "" }],
  });
  keysFromPerson = true;
  assert.equal(cleared.success, true);
  assert.deepEqual(row("crm")?.headers, []);
  store.save({ ...(row("crm") ?? crm), headers: keys });

  const listed = await call("list shows no secret", "list_mcp_servers", {});
  const crmListed = listed.result.servers?.find((entry) => entry.name === "crm");
  assert.deepEqual(crmListed?.headerNames, ["Authorization"]);
  assert.equal(crmListed?.forYou, true, "A server with no selected agents goes to every agent.");

  const crmId = row("crm")?.id;
  const limited = mcpServersFromGateway(gateway, undefined, undefined, (mcpServerId, agentId) =>
    mcpServerId === crmId ? agentId === "agent-b" : true,
  );
  const limitedListed = await call(
    "list shows the servers the agent does not get",
    "list_mcp_servers",
    {},
    true,
    limited,
  );
  const forYou = Object.fromEntries((limitedListed.result.servers ?? []).map((entry) => [entry.name, entry.forYou]));
  assert.equal(forYou.crm, false);
  assert.equal(forYou.docs, true);

  const off = await call("turn a server off", "set_mcp_server_enabled", { name: "docs", enabled: false });
  assert.equal(off.success, true);
  assert.equal(row("docs")?.enabled, false);

  const tested = await call("test a saved server", "test_mcp_server", { name: "docs" });
  assert.equal(tested.result.status, "ready");
  assert.equal(tested.approvals.length, 0);

  const setupSteps = ["Open the desktop app.", "Turn on its MCP server."];
  const disabledApp = row("docs");
  assert.ok(disabledApp);
  const disabled = await appStatus("an installed app that is off", "notion", { config: disabledApp, setupSteps: [] });
  assert.equal(disabled.result.status, "disabled");
  assert.equal(disabled.signInCards.length, 0);

  const calendar = row("calendar");
  assert.ok(calendar);
  const appSignIn = await appStatus("an installed app that needs a sign-in", "atlassian", {
    config: calendar,
    setupSteps: [],
  });
  assert.equal(appSignIn.result.status, "needs_sign_in");
  assert.deepEqual(appSignIn.signInCards, [calendar.id]);

  const localApp = store.save({ ...calendar, id: "", name: "figma-desktop", url: await closedUrl() });
  const notRunning = await appStatus("an installed local app that is not running", "figma", {
    config: localApp,
    setupSteps,
  });
  assert.equal(notRunning.result.status, "not_running");
  assert.deepEqual(notRunning.result.setupSteps, setupSteps);
  assert.equal(notRunning.signInCards.length, 0);

  const readyApp = store.save({ ...calendar, id: "", name: "wiki", url: servers.open.url });
  const ready = await appStatus("an installed app that answers", "linear", { config: readyApp, setupSteps });
  assert.equal(ready.result.status, "ready");
  assert.deepEqual(ready.result.tools, ["search", "read_page", "create_page"]);
  assert.equal(ready.result.setupSteps, undefined);

  const unknown = await call("an unknown name", "test_mcp_server", { name: "nothing" });
  assert.equal(unknown.success, false);

  const removed = await call("remove a server", "remove_mcp_server", { name: "calendar" });
  assert.equal(removed.success, true);
  assert.equal(row("calendar"), undefined);

  const githubGateway = new McpGateway({
    servers: store,
    credentials: NO_PROVIDER_CREDENTIALS,
    computerUseMcpServer: () => null,
    githubConnector: {
      mcpServer: () => ({
        id: GITHUB_CONNECTOR_MCP_SERVER_ID,
        name: "github",
        transport: "http",
        enabled: true,
        command: "",
        args: [],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: servers.open.url,
        headers: [],
      }),
      mcpAuthorization: () => Effect.succeed(null),
    },
    logger: createOpenBotLogger("agent-service", () => undefined),
    hooks: { emitError: () => undefined, refreshAllAgentRuntimes: () => Effect.void },
  });
  const githubTools = mcpServersFromGateway(githubGateway);
  assert.ok(githubGateway.enabled().some((config) => config.name === "github"));
  const githubListed = await call("the GitHub connection is listed", "list_mcp_servers", {}, true, githubTools);
  assert.deepEqual(
    githubListed.result.servers?.find((entry) => entry.name === "github"),
    { name: "github", transport: "http", enabled: true, builtIn: true },
  );
  const githubTested = await call(
    "the GitHub connection is not tested",
    "test_mcp_server",
    { name: "github" },
    true,
    githubTools,
  );
  assert.equal(githubTested.success, false);
  assert.match(githubTested.result.error ?? "", /part of OpenBot/u);
  const githubRemoved = await call(
    "the GitHub connection is not removed",
    "remove_mcp_server",
    { name: "github" },
    true,
    githubTools,
  );
  assert.equal(githubRemoved.success, false);
  assert.equal(githubRemoved.approvals.length, 0);

  const reserved = await call("a reserved name is refused", "save_mcp_server", {
    name: "openbot",
    url: servers.open.url,
  });
  assert.equal(reserved.success, false);
  assert.equal(reserved.approvals.length, 0, "an invalid server is corrected before the user is asked");

  const catalog = await Effect.runPromise(
    loadCatalogPluginServers(resolve(import.meta.dirname, "../resources/plugin-catalog")),
  );
  const npxConfig = (name: string, args: readonly string[]): McpServerConfig => ({
    id: "",
    name,
    transport: "stdio",
    enabled: false,
    command: "npx",
    args: [...args],
    env: [{ key: "ICLOUD_MODE", value: "local" }],
    envPassthrough: [],
    workingDirectory: root,
    url: "",
    headers: [],
  });
  const npxRow = (name: string, args: readonly string[]) => store.save(npxConfig(name, args));
  for (const pin of CATALOG_PIN_MOVES) {
    const listed = catalog.find((server) => server.name === pin.name);
    assert.ok(listed, `${pin.name} is in the shipped catalog`);
    const current = catalogPluginSlug(npxConfig(pin.name, pin.current), catalog, homedir());
    assert.equal(current, listed.slug, `${pin.name} moves to the pin of the shipped catalog`);
    for (const earlier of pin.earlier) {
      const installed = npxRow(pin.name, earlier);
      const renamed = npxRow(`${pin.name}-mine`, earlier);
      const edited = npxRow(`${pin.name}-edited`, [...earlier, "--verbose"]);
      gateway.migrateCatalogRows();
      const moved = store.get(installed.id);
      assert.deepEqual(
        moved,
        { ...installed, args: [...pin.current] },
        "only the arguments of the installed row change",
      );
      assert.equal(moved && catalogPluginSlug(moved, catalog, homedir()), listed.slug);
      assert.deepEqual(store.get(renamed.id), renamed, "a renamed row stays");
      assert.deepEqual(store.get(edited.id), edited, "changed arguments stay");
      gateway.migrateCatalogRows();
      assert.deepEqual(store.get(installed.id), moved, "a second start changes nothing");
      for (const row of [installed, renamed, edited]) store.remove(row.id);
    }
  }

  const fallback = store.save({ ...calendar, id: "", name: "Product Hunt", url: servers.open.url });
  const agentTools = mcpServersFromGateway(gateway, undefined, () => [fallback]);
  for (const name of ["Product_Hunt.get_leaderboard", "Product Hunt.get_leaderboard"]) {
    const found = findAgentMcpTool(agentTools.forAgent("agent"), name);
    assert.equal(found?.config.id, fallback.id, name);
    assert.equal(found?.tool, "get_leaderboard", name);
  }
  assert.equal(findAgentMcpTool([fallback], "other.get_leaderboard"), null, "another server's name");
  assert.equal(findAgentMcpTool([fallback], "mcp_Product_Hunt_get_leaderboard"), null, "the ambiguous mcp_ form");
  const ran = await runCauseEffect(agentTools.callTool(fallback, "get_leaderboard", { limit: 3 }));
  assert.ok("result" in ran, "the tool runs on the saved row");
  assert.deepEqual(mcpToolCallResponse(ran.result), {
    success: true,
    contentItems: [{ type: "inputText", text: 'get_leaderboard {"limit":3}' }],
  });
  const failed = await runCauseEffect(agentTools.callTool(fallback, "missing", {}));
  assert.ok("result" in failed && !mcpToolCallResponse(failed.result).success, "a tool error stays a failure");
  const offline = store.save({ ...calendar, id: "", name: "offline", url: await closedUrl() });
  const unreachable = await runCauseEffect(agentTools.callTool(offline, "get_leaderboard", {}));
  assert.ok("error" in unreachable, "a server that is down is a sentence");

  const stdioProgram = join(root, "stdio-mcp-server.js");
  await writeFile(
    stdioProgram,
    `let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id === undefined) continue;
    const result =
      message.method === "initialize"
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "local", version: "1" } }
        : message.method === "tools/call"
          ? { content: [{ type: "text", text: message.params.name + " key=" + (process.env.LOCAL_KEY === "set") }] }
          : {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`,
  );
  const stdioRow = store.save({
    ...calendar,
    id: "",
    name: "local_stdio",
    transport: "stdio",
    command: process.execPath,
    args: [stdioProgram],
    env: [{ key: "LOCAL_KEY", value: "set" }],
    headers: [],
    url: "",
  });
  assert.equal(mcpFallbackRunsServer(stdioRow, { access: "full" }), true, "stdio for Full access");
  assert.equal(mcpFallbackRunsServer(stdioRow, { access: "workspace" }), false, "no stdio for Workspace only");
  assert.equal(mcpFallbackRunsServer(fallback, { access: "workspace" }), true, "http for Workspace only");
  const stdioRan = await runCauseEffect(agentTools.callTool(stdioRow, "get_messages", {}));
  assert.ok("result" in stdioRan, "the stdio tool runs on the saved row");
  assert.deepEqual(mcpToolCallResponse(stdioRan.result), {
    success: true,
    contentItems: [{ type: "inputText", text: "get_messages key=true" }],
  });

  // Antigravity leaves out most Computer Use tools, so tool_call runs them for an agent that has it (#12340).
  const computerUse: McpServerConfig = {
    ...stdioRow,
    id: COMPUTER_USE_MCP_SERVER_ID,
    name: COMPUTER_USE_MCP_SERVER_NAME,
  };
  const unsaved: McpServerConfig = { ...stdioRow, id: "not-saved", name: "not_saved" };
  const fallbackFor = (agent: { access: "full" | "workspace"; computerUse?: boolean }) =>
    agentFallbackMcpServers([computerUse, stdioRow, unsaved], new Set([stdioRow.id]), agent);
  const hidden = findAgentMcpTool(fallbackFor({ access: "full" }), "computer_use.list_windows");
  assert.equal(hidden?.config.id, COMPUTER_USE_MCP_SERVER_ID, "Computer Use for a Full access agent");
  assert.equal(hidden?.tool, "list_windows");
  assert.equal(
    findAgentMcpTool(fallbackFor({ access: "full", computerUse: false }), "computer_use.list_windows"),
    null,
    "no Computer Use when it is off for the agent",
  );
  assert.deepEqual(
    fallbackFor({ access: "workspace" }).map((config) => config.id),
    [],
    "no stdio server, Computer Use included, for Workspace only",
  );
  assert.deepEqual(
    fallbackFor({ access: "full" }).map((config) => config.id),
    [COMPUTER_USE_MCP_SERVER_ID, stdioRow.id],
    "an unsaved row stays out",
  );
  const computerUseRan = await runCauseEffect(agentTools.callTool(computerUse, "list_windows", {}));
  assert.ok("result" in computerUseRan, "the Computer Use tool runs");
  assert.deepEqual(mcpToolCallResponse(computerUseRan.result), {
    success: true,
    contentItems: [{ type: "inputText", text: "list_windows key=true" }],
  });
  store.remove(stdioRow.id);

  const statefulProgram = join(root, "stateful-mcp-server.js");
  await writeFile(
    statefulProgram,
    `let buffer = "";
let calls = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id === undefined) continue;
    const result =
      message.method === "initialize"
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stateful", version: "1" } }
        : message.method === "tools/call"
          ? { content: [{ type: "text", text: "pid=" + process.pid + " calls=" + ++calls }] }
          : {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`,
  );
  const relay = await runCauseEffect(
    startStdioMcpRelay({
      command: process.execPath,
      args: [statefulProgram],
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      cwd: root,
    }),
  );
  try {
    assert.equal(
      await runCauseEffect(relay.callTool("figma_execute", {})),
      null,
      "no running server before the provider connects",
    );
    const provider = new Client({ name: "provider", version: "1" });
    await provider.connect(
      asTransport(
        new StreamableHTTPClientTransport(new URL(relay.url), {
          requestInit: { headers: { Authorization: `Bearer ${relay.token}` } },
        }),
      ),
    );
    const first = await provider.callTool({ name: "figma_get_status", arguments: {} });
    const firstText = mcpToolCallResponse(first).contentItems[0];
    assert.ok(
      firstText?.type === "inputText" && firstText.text.endsWith(" calls=1"),
      "the provider runs the first call",
    );
    const [pid = ""] = firstText.text.split(" ");
    const hidden = await runCauseEffect(relay.callTool("figma_execute", { code: "1" }));
    assert.ok(hidden && "result" in hidden, "the hidden tool runs through the relay");
    assert.deepEqual(
      mcpToolCallResponse(hidden.result).contentItems,
      [{ type: "inputText", text: `${pid} calls=2` }],
      "the hidden tool runs in the server process of the provider",
    );
    const after = mcpToolCallResponse(await provider.callTool({ name: "figma_get_status", arguments: {} }));
    assert.deepEqual(
      after.contentItems,
      [{ type: "inputText", text: `${pid} calls=3` }],
      "the provider keeps its session",
    );
    report.relayedStdio = { pid, calls: 3 };
    await provider.close();
  } finally {
    await runCauseEffect(relay.close());
  }

  const everything = JSON.stringify(calls.map(({ result, approvals }) => ({ result, approvals })));
  assert.ok(!everything.includes(URL_SECRET), "the address query reached the agent");
  assert.ok(!everything.includes(HEADER_SECRET), "a header value reached the agent");
  report.passed = true;
} catch (error) {
  report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  report.refreshes = refreshes;
  await Promise.all(Object.values(servers).map((server) => server.close()));
  database.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${calls.length} calls. Report: ${join(OUT, "report.json")}\n`);
if (!report.passed) {
  process.stderr.write(`${report.failures.join("\n")}\n`);
  process.exit(1);
}
