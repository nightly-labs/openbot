// Runs the silent MCP OAuth paths end to end on the real `McpOAuth`: the real SDK exchange, the real
// `secureOAuthFetch` and the real logger, against a local OAuth server on the loopback address. The
// storage is a map that decodes each record as the store on disk does. No account or key is used.
//
// The proxy cases run the real `McpGateway` and its `McpOAuthProxy` on a temporary database, with
// the SDK MCP client as the provider and an SDK Streamable HTTP server as the signed-in MCP server.
// The provider payload is the one `codexMcpServers` and `claudeMcpServers` build for a spawn.
// `bun scripts/mcp-oauth-e2e.ts`. Writes .openbot-build/mcp-oauth-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect } from "effect";
import { McpGateway } from "../src/backend/agent/mcp-gateway";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { toMcpOperationError } from "../src/backend/mcp-effects";
import {
  McpOAuth,
  type McpOAuthRecord,
  mcpOAuthRecordSchema,
  normalizeResource,
  secureOAuthFetch,
} from "../src/backend/mcp-oauth-provider";
import type { McpOAuthProxySettings } from "../src/backend/mcp-oauth-proxy";
import { claudeMcpServers, codexMcpServers, usableMcpServers } from "../src/backend/mcp-provider-shapes";
import { McpServerStore } from "../src/backend/mcp-server-store";
import { AddressLookupError, isPublicAddress } from "../src/backend/network-address";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-oauth-e2e");
const REDIRECT_URL = "http://127.0.0.1:28417/mcp-auth";
const DEADLINE_MS = 10_000;

type TokenMode = "rotate" | "invalid_grant" | "invalid_client" | "drop";

interface Hit {
  method: string;
  path: string;
  body: Record<string, string>;
}

/** The authorization server and the MCP resource's metadata. Each case sets how `/token` answers. */
async function startAuthorizationServer() {
  const hits: Hit[] = [];
  const waiters: Array<{ done: () => boolean; resolve: () => void }> = [];
  let tokenMode: TokenMode = "rotate";
  let revokeStatus = 200;
  // Runs when a refresh reaches `/token`, before the answer: a case puts a sign-in in that wait.
  let beforeToken: () => void = () => undefined;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", base);
    const body = Object.fromEntries(new URLSearchParams(await readBody(request)));
    hits.push({ method: request.method ?? "GET", path: url.pathname, body });
    for (const waiter of waiters.splice(0))
      if (waiter.done()) waiter.resolve();
      else waiters.push(waiter);
    answer(url.pathname, request, response);
  });
  function answer(path: string, request: IncomingMessage, response: ServerResponse) {
    if (path === "/.well-known/oauth-authorization-server")
      return json(response, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        revocation_endpoint: `${base}/revoke`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    if (path === "/.well-known/oauth-protected-resource/mcp")
      return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (path === "/register") return json(response, 201, { client_id: "registered", redirect_uris: [REDIRECT_URL] });
    if (path === "/revoke") return json(response, revokeStatus, {});
    // Larger than the OAuth body limit: one with a declared length, one counted as it arrives.
    if (path === "/big-declared") return json(response, 200, { padding: "x".repeat(2 * 1024 * 1024) });
    // A redirect status with no `Location` is an answer, not a hop, so the limit applies to it.
    if (path === "/big-streamed" || path === "/big-redirect") {
      response.writeHead(path === "/big-redirect" ? 302 : 200, { "content-type": "application/json" });
      for (let chunk = 0; chunk < 32; chunk++) response.write("x".repeat(64 * 1024));
      return response.end();
    }
    // MCP traffic that leaves for another origin.
    if (path === "/redirect-away") {
      response.writeHead(307, { location: `${base.replace("127.0.0.1", "localhost")}/big-streamed` });
      return response.end();
    }
    if (path === "/token" && request.method === "POST") {
      beforeToken();
      if (tokenMode === "drop") return request.socket.destroy();
      if (tokenMode === "invalid_grant") return json(response, 400, { error: "invalid_grant" });
      if (tokenMode === "invalid_client") return json(response, 401, { error: "invalid_client" });
      return json(response, 200, {
        access_token: "access-rotated",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-rotated",
      });
    }
    json(response, 404, {});
  }
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    hits,
    setTokenMode: (mode: TokenMode) => {
      tokenMode = mode;
    },
    setRevokeStatus: (status: number) => {
      revokeStatus = status;
    },
    setBeforeToken: (run: () => void) => {
      beforeToken = run;
    },
    reset: () => {
      hits.splice(0);
      beforeToken = () => undefined;
    },
    /** Resolves when the hits satisfy `done`, and fails at the deadline. */
    waitFor: (done: () => boolean) =>
      new Promise<void>((resolveWait, reject) => {
        if (done()) return resolveWait();
        const timer = setTimeout(() => reject(new Error("The authorization server was not reached.")), DEADLINE_MS);
        waiters.push({
          done,
          resolve: () => {
            clearTimeout(timer);
            resolveWait();
          },
        });
      }),
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      text += chunk;
    });
    request.on("end", () => done(text));
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

/** A store that decodes what it is given, as the JSON store does, so unknown fields are dropped. */
function memoryStorage() {
  const records = new Map<string, McpOAuthRecord>();
  return {
    records,
    storage: {
      read: (resource: string) => records.get(resource) ?? null,
      write: (resource: string, record: McpOAuthRecord) =>
        Effect.sync(() => {
          records.set(resource, mcpOAuthRecordSchema.parse(record));
        }),
      clear: (resource: string) =>
        Effect.sync(() => {
          records.delete(resource);
        }),
    },
  };
}

/** A signed-in record whose access token is past its lifetime, so the next read refreshes it. */
function expiredRecord(base: string): McpOAuthRecord {
  return mcpOAuthRecordSchema.parse({
    client: {
      client_id: "client-on-file",
      client_secret: "client-secret-on-file",
      redirect_uris: [REDIRECT_URL],
      issuer: base,
    },
    tokens: {
      access_token: "access-on-file",
      token_type: "Bearer",
      expires_in: 60,
      refresh_token: "refresh-on-file",
      issuer: base,
    },
    obtainedAt: Date.now() - 10 * 60_000,
    discovery: {
      authorizationServerUrl: base,
      resourceMetadataUrl: `${base}/.well-known/oauth-protected-resource/mcp`,
    },
  });
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const auth = await startAuthorizationServer();
  const mcpUrl = `${auth.base}/mcp`;
  const logLines: string[] = [];
  let onLog: () => void = () => undefined;
  /** Resolves when `count` revocation warnings are in the log, and fails at the deadline. */
  const warnings = () => logLines.filter((line) => line.includes("An MCP token was not revoked."));
  const waitForWarnings = (count: number) =>
    new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("The revocation failure was not logged.")), DEADLINE_MS);
      onLog = () => {
        if (warnings().length < count) return;
        clearTimeout(timer);
        done();
      };
      onLog();
    });

  /** One `McpOAuth` per case with a fresh store holding `record`. */
  async function withOAuth<T>(
    record: McpOAuthRecord,
    run: (oauth: McpOAuth, records: Map<string, McpOAuthRecord>) => Promise<T>,
  ) {
    const { records, storage } = memoryStorage();
    records.set(mcpUrl, record);
    const oauth = new McpOAuth({
      storage,
      openExternal: async () => {
        throw new Error("A silent path opened the browser.");
      },
      redirectUrl: REDIRECT_URL,
      logger: createOpenBotLogger("mcp-oauth", (line) => {
        logLines.push(line);
        onLog();
      }),
    });
    auth.reset();
    try {
      return await run(oauth, records);
    } finally {
      await runCauseEffect(oauth.close());
    }
  }
  const registrations = () => auth.hits.filter((hit) => hit.path === "/register").length;

  // A refresh the server accepts stores the rotated token set and hands on the new access token.
  auth.setTokenMode("rotate");
  const refreshed = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const token = await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.equal(token, "access-rotated");
    assert.equal(stored?.tokens?.refresh_token, "refresh-rotated");
    assert.equal(oauth.needsSignIn(mcpUrl), false);
    assert.equal(registrations(), 0);
    return { token: "access-rotated", needsSignIn: false, registrations: 0 };
  });

  // `invalid_grant`: the grant ended. No token is handed on, the client stays, the row asks again.
  auth.setTokenMode("invalid_grant");
  const invalidGrant = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const token = await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.equal(token, null);
    assert.equal(stored?.tokens, undefined);
    assert.equal(stored?.client?.client_id, "client-on-file");
    assert.equal(stored?.discovery?.authorizationServerUrl, auth.base);
    assert.equal(typeof stored?.lostAt, "number");
    assert.equal(oauth.signedIn(mcpUrl), false);
    assert.equal(oauth.needsSignIn(mcpUrl), true);
    assert.equal(registrations(), 0);
    return { token, clientKept: true, discoveryKept: true, needsSignIn: true, registrations: 0 };
  });

  // A sign-in that ends while a refresh waits stores a new grant. The refusal of the old grant
  // that follows does not delete it.
  auth.setTokenMode("invalid_grant");
  const signInDuringRefresh = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const fresh = expiredRecord(auth.base);
    auth.setBeforeToken(() =>
      records.set(mcpUrl, {
        ...fresh,
        tokens: {
          access_token: "access-new",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-new",
          issuer: auth.base,
        },
        obtainedAt: Date.now(),
      }),
    );
    await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.ok(auth.hits.some((hit) => hit.path === "/token"));
    assert.equal(stored?.tokens?.refresh_token, "refresh-new");
    assert.equal(stored?.lostAt, undefined);
    assert.equal(oauth.needsSignIn(mcpUrl), false);
    return { newGrantKept: true, needsSignIn: false };
  });

  // `invalid_client`: the registration goes too, and nothing registers a new one in the background.
  auth.setTokenMode("invalid_client");
  const invalidClient = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const token = await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.equal(token, null);
    assert.equal(stored?.tokens, undefined);
    assert.equal(stored?.client, undefined);
    assert.equal(stored?.discovery?.authorizationServerUrl, auth.base);
    assert.equal(oauth.needsSignIn(mcpUrl), true);
    assert.equal(registrations(), 0);
    return { token, clientDropped: true, needsSignIn: true, registrations: 0 };
  });

  // A dropped connection says nothing about the grant: everything stays and the stored token answers.
  auth.setTokenMode("drop");
  const networkError = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const token = await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.equal(token, "access-on-file");
    assert.equal(stored?.tokens?.refresh_token, "refresh-on-file");
    assert.equal(stored?.client?.client_id, "client-on-file");
    assert.equal(stored?.lostAt, undefined);
    assert.equal(oauth.needsSignIn(mcpUrl), false);
    assert.ok(auth.hits.some((hit) => hit.path === "/token"));
    return { token: "access-on-file", tokensKept: true, needsSignIn: false };
  });

  // Sign-out deletes the tokens first, then revokes the refresh token and the access token.
  auth.setRevokeStatus(200);
  const signOut = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    await runCauseEffect(oauth.signOut(mcpUrl));
    assert.equal(records.has(mcpUrl), false);
    const revoked = () => auth.hits.filter((hit) => hit.path === "/revoke");
    await auth.waitFor(() => revoked().length === 2);
    const [first, second] = revoked();
    assert.deepEqual(first?.body, {
      token: "refresh-on-file",
      token_type_hint: "refresh_token",
      client_id: "client-on-file",
      client_secret: "client-secret-on-file",
    });
    assert.equal(second?.body.token, "access-on-file");
    assert.equal(second?.body.token_type_hint, "access_token");
    assert.equal(oauth.needsSignIn(mcpUrl), false);
    return { cleared: true, revoked: revoked().map((hit) => hit.body.token_type_hint) };
  });

  // A revocation the server refuses is logged by status only: no token reaches the log.
  auth.setRevokeStatus(503);
  logLines.splice(0);
  const revokeRefused = await withOAuth(expiredRecord(auth.base), async (oauth) => {
    await runCauseEffect(oauth.forget(mcpUrl));
    // The scope close in `withOAuth` would interrupt a revocation that has not logged yet.
    await waitForWarnings(2);
    for (const line of logLines)
      for (const secret of ["refresh-on-file", "access-on-file", "client-secret-on-file"])
        assert.ok(!line.includes(secret), "A revocation log line quoted a credential.");
    assert.ok(warnings().every((line) => line.includes("http 503")));
    return { warnings: warnings().length, status: "http 503", credentialsInLog: false };
  });

  const proxy = await proxyCases(auth);
  const network = await networkCases(auth);
  await auth.close();
  const cases = {
    refreshed,
    invalidGrant,
    signInDuringRefresh,
    invalidClient,
    networkError,
    signOut,
    revokeRefused,
    ...proxy,
    ...network,
  };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ok: true, cases }, null, 2)}\n`);
  process.stdout.write(`mcp-oauth-e2e: ${Object.keys(cases).length} cases passed\n`);
}

interface ResourceHit {
  method: string;
  path: string;
  authorization: string | undefined;
  rowKey: string | undefined;
  userAgent: string | undefined;
}

/**
 * The signed-in MCP server: an SDK Streamable HTTP server with one session per client, behind a
 * bearer check that answers 401 as a real server does. `/moved` redirects on the same origin and
 * `/away` to another origin. Each path has its own protected-resource metadata, which a refresh
 * checks against the row's URL.
 */
async function startResourceServer(authorizationServer: string) {
  const hits: ResourceHit[] = [];
  const waiters: Array<() => void> = [];
  const valid = new Set(["access-on-file"]);
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  /** The `clientInfo` of each session, in the order the sessions started. */
  const clients: Array<ReturnType<Server["getClientVersion"]>> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", base);
    const rowKey = request.headers["x-row-key"];
    hits.push({
      method: request.method ?? "GET",
      path: url.pathname,
      authorization: request.headers.authorization,
      rowKey: typeof rowKey === "string" ? rowKey : undefined,
      userAgent: request.headers["user-agent"],
    });
    for (const waiter of waiters.splice(0)) waiter();
    const metadata = /^\/\.well-known\/oauth-protected-resource(\/.*)$/u.exec(url.pathname)?.[1];
    if (metadata)
      return json(response, 200, { resource: `${base}${metadata}`, authorization_servers: [authorizationServer] });
    if (url.pathname === "/moved") {
      response.writeHead(307, { location: "/mcp" });
      return response.end();
    }
    if (url.pathname === "/away") {
      response.writeHead(307, { location: `http://localhost:${port}/mcp` });
      return response.end();
    }
    if (url.pathname !== "/mcp") return json(response, 404, {});
    const bearer = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
    if (!valid.has(bearer)) {
      response.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource${url.pathname}"`,
      });
      return response.end();
    }
    const sessionId = request.headers["mcp-session-id"];
    let transport = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!transport) {
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          sessions.set(id, created);
        },
      });
      const session = mcpServer();
      session.oninitialized = () => clients.push(session.getClientVersion());
      await session.connect(asTransport(created));
      transport = created;
    }
    await transport.handleRequest(request, response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    hits,
    clients,
    valid,
    /** Resolves when the hits satisfy `done`, and fails at the deadline. */
    waitFor: (done: () => boolean, what: string) =>
      new Promise<void>((resolveWait, reject) => {
        const timer = setTimeout(() => reject(new Error(`The MCP server did not see ${what}.`)), DEADLINE_MS);
        const check = () => {
          if (!done()) return void waiters.push(check);
          clearTimeout(timer);
          resolveWait();
        };
        check();
      }),
    close: async () => {
      for (const transport of sessions.values()) await transport.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** `echo` answers with its text; `notify` sends a list change on the session's GET stream. */
function mcpServer() {
  const server = new Server(
    { name: "e2e-resource", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
      { name: "notify", inputSchema: { type: "object" } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "notify") {
      // No related request: the SDK sends it on the standalone GET stream.
      await server.sendToolListChanged();
      return { content: [{ type: "text", text: "sent" }] };
    }
    return { content: [{ type: "text", text: String(request.params.arguments?.text ?? "") }] };
  });
  return server;
}

/** A signed-in record for `url` that is still fresh, so the proxy hands the stored token on unchanged. */
function freshRecord(base: string, url: string): McpOAuthRecord {
  const record = expiredRecord(base);
  const { origin, pathname } = new URL(url);
  return mcpOAuthRecordSchema.parse({
    ...record,
    tokens: { ...record.tokens, expires_in: 3600 },
    obtainedAt: Date.now(),
    discovery: {
      ...record.discovery,
      resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource${pathname}`,
    },
  });
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } },
});

/** The status of one raw POST, with headers that `fetch` would not send, such as another `Host`. */
function rawPost(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((done, reject) => {
    const request = httpRequest(
      url,
      {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
      },
      (response) => {
        response.resume();
        done(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end(INITIALIZE);
  });
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [first] = Array.isArray(result.content) ? result.content : [];
  return first && typeof first === "object" && "text" in first ? String(first.text) : "";
}

/**
 * The SDK transport classes declare their handlers and `sessionId` as `T | undefined`, which
 * `exactOptionalPropertyTypes` does not accept as a `Transport`. This one forwards to such a class.
 */
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

/**
 * The proxy end to end: the provider payload, a tool call and a GET-stream notification through
 * it, a token the server ends during the session, a sign-out, the refused requests, and the
 * address after a restart.
 */
async function proxyCases(auth: Awaited<ReturnType<typeof startAuthorizationServer>>) {
  auth.setTokenMode("rotate");
  auth.setRevokeStatus(200);
  const resource = await startResourceServer(auth.base);
  const root = await mkdtemp(join(tmpdir(), "openbot-mcp-oauth-proxy-"));
  const database = new OpenBotDatabase(root);
  const clients: Client[] = [];
  const gateways: McpGateway[] = [];
  try {
    await runCauseEffect(database.initialize());
    const servers = new McpServerStore(database);
    const row = (name: string, path: string): McpServerConfig =>
      servers.save({
        id: "",
        name,
        transport: "http",
        enabled: true,
        command: "",
        args: [],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: `${resource.base}${path}`,
        headers: [{ key: "X-Row-Key", value: "row-secret" }],
      });
    const direct = row("Resource", "/mcp");
    const moved = row("Moved", "/moved");
    const away = row("Away", "/away");
    const { records, storage } = memoryStorage();
    for (const config of [direct, moved, away]) records.set(config.url, freshRecord(auth.base, config.url));
    const logLines: string[] = [];
    const oauth = new McpOAuth({
      storage,
      openExternal: async () => {
        throw new Error("A proxy path opened the browser.");
      },
      redirectUrl: REDIRECT_URL,
      logger: createOpenBotLogger("mcp-oauth", (line) => logLines.push(line)),
    });
    // A holder, so the type is not narrowed to `null` across the writes in the callbacks.
    const saved: { value: McpOAuthProxySettings | null } = { value: null };
    const settings = {
      read: () => saved.value,
      write: (next: McpOAuthProxySettings) =>
        Effect.sync(() => {
          saved.value = next;
        }),
    };
    // Read at each `initialize`, so a rename here shows in the next session.
    const agents = [
      { id: "agent-research", name: "Research Bot" },
      { id: "chief", name: "Ops\u0007\n\u202eBot" },
    ];
    const startGateway = () => {
      const gateway = new McpGateway({
        servers,
        credentials: {
          ...NO_PROVIDER_CREDENTIALS,
          mcpOAuth: oauth,
          mcpOAuthProxySettings: settings,
          appVersion: "9.9.9-e2e",
        },
        agents: () => agents,
        computerUseMcpServer: () => null,
        logger: createOpenBotLogger("agent-service", (line) => logLines.push(line)),
        hooks: { emitError: () => undefined, refreshAllAgentRuntimes: () => Effect.void },
      });
      gateways.push(gateway);
      return gateway;
    };
    const endpointOf = async (gateway: McpGateway, config: McpServerConfig, agentId: string | null = null) => {
      const endpoint = await runCauseEffect(gateway.endpoint(config, agentId));
      assert.ok(!("error" in endpoint), "The proxy did not start.");
      assert.equal(endpoint.proxied, true);
      assert.ok(endpoint.authorization);
      return { url: endpoint.url, bearer: endpoint.authorization };
    };
    const connect = async (url: string, bearer: string) => {
      const client = new Client({ name: "e2e-provider", version: "1.0.0" });
      clients.push(client);
      await client.connect(
        asTransport(
          new StreamableHTTPClientTransport(new URL(url), {
            requestInit: { headers: { authorization: `Bearer ${bearer}` } },
          }),
        ),
      );
      return client;
    };
    let gateway = startGateway();

    // The payload a provider is spawned with names the proxy only: no token, no header of the row.
    const usable = await runCauseEffect(
      usableMcpServers(
        gateway.enabled(),
        undefined,
        (config, agentId) => gateway.endpoint(config, agentId).pipe(toMcpOperationError),
        "chief",
      ),
    );
    const codex = codexMcpServers(usable);
    const claude = claudeMcpServers(usable);
    assert.deepEqual(codex.dropped, []);
    for (const payload of [JSON.stringify(codex.servers), JSON.stringify(claude.servers)]) {
      for (const secret of ["access-on-file", "refresh-on-file", "row-secret", resource.base])
        assert.ok(!payload.includes(secret), "A provider payload held a credential or the server's own address.");
    }
    const directRoute = await endpointOf(gateway, direct);
    const chiefRoute = await endpointOf(gateway, direct, "chief");
    const port = saved.value?.port;
    assert.ok(port);
    assert.match(directRoute.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/mcp/[0-9a-f]{32}$`, "u"));
    const codexDirect = codex.servers.Resource;
    assert.ok(codexDirect && "url" in codexDirect);
    assert.match(codexDirect.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/mcp/[0-9a-f]{32}/[0-9a-f]{32}$`, "u"));
    assert.equal(codexDirect.url, chiefRoute.url);
    assert.deepEqual(codexDirect.http_headers, { Authorization: `Bearer ${chiefRoute.bearer}` });
    const redacted = `bearer ${directRoute.bearer}`;
    assert.ok(!gateway.redact(redacted).includes(directRoute.bearer));
    assert.ok(!redactText(redacted).includes(directRoute.bearer));
    const handoff = { proxiedRows: Object.keys(codex.servers).length, tokensInPayload: false, bearerRedacted: true };

    // A tool call goes through, and the server gets the row's header and the token from this process.
    const client = await connect(directRoute.url, directRoute.bearer);
    const notified = new Promise<void>((done) =>
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => done()),
    );
    assert.equal(textOf(await client.callTool({ name: "echo", arguments: { text: "through" } })), "through");
    const upstream = resource.hits.filter((hit) => hit.path === "/mcp" && hit.method === "POST");
    assert.ok(upstream.length > 0);
    assert.ok(upstream.every((hit) => hit.authorization === "Bearer access-on-file" && hit.rowKey === "row-secret"));
    const echo = { text: "through", upstreamToken: "access-on-file", rowHeaderUpstream: true };

    // The server sees OpenBot as the client, not the provider, and the agent of the route by name.
    const openbotClient = (title: string) => ({
      name: "openbot",
      title,
      version: "9.9.9-e2e",
      websiteUrl: "https://openbot.run",
    });
    assert.deepEqual(resource.clients.at(-1), openbotClient("OpenBot"));
    assert.ok(upstream.every((hit) => hit.userAgent === "OpenBot/9.9.9-e2e"));
    const titleOf = async (route: { url: string; bearer: string }) => {
      const before = resource.clients.length;
      const named = await connect(route.url, route.bearer);
      assert.equal(textOf(await named.callTool({ name: "echo", arguments: { text: "named" } })), "named");
      assert.equal(resource.clients.length, before + 1);
      const info = resource.clients.at(-1);
      assert.deepEqual(info, openbotClient(info?.title ?? ""));
      return info?.title;
    };
    const researchRoute = await endpointOf(gateway, direct, "agent-research");
    assert.notEqual(researchRoute.url, directRoute.url);
    assert.equal(await titleOf(researchRoute), "Research Bot (OpenBot)");
    assert.equal(await titleOf(chiefRoute), "Ops Bot (OpenBot)");
    const research = agents[0];
    assert.ok(research);
    research.name = "Renamed Bot";
    assert.equal(await titleOf(researchRoute), "Renamed Bot (OpenBot)");
    assert.equal(await titleOf(await endpointOf(gateway, direct, "removed-agent")), "OpenBot");
    // The bearer of a route opens neither the same row for another agent nor the row with no agent.
    const hitsBeforeCross = resource.hits.length;
    assert.equal(await rawPost(researchRoute.url, { authorization: `Bearer ${directRoute.bearer}` }), 403);
    assert.equal(await rawPost(directRoute.url, { authorization: `Bearer ${researchRoute.bearer}` }), 403);
    assert.equal(await rawPost(chiefRoute.url, { authorization: `Bearer ${researchRoute.bearer}` }), 403);
    assert.equal(resource.hits.length, hitsBeforeCross, "A request with another route's bearer reached the server.");
    const clientIdentity = {
      withoutAgent: "OpenBot",
      agent: "Research Bot (OpenBot)",
      controlCharacters: "Ops Bot (OpenBot)",
      renamed: "Renamed Bot (OpenBot)",
      unknownAgent: "OpenBot",
      userAgent: "OpenBot/9.9.9-e2e",
      crossAgentBearers: 403,
    };

    // The GET stream stays open through the proxy and carries a server notification.
    await resource.waitFor(
      () => resource.hits.some((hit) => hit.path === "/mcp" && hit.method === "GET"),
      "a GET stream",
    );
    await client.callTool({ name: "notify", arguments: {} });
    await Promise.race([
      notified,
      new Promise((_, reject) => setTimeout(() => reject(new Error("No notification came through.")), DEADLINE_MS)),
    ]);
    const getStream = { notification: "notifications/tools/list_changed" };

    // Refused at the proxy: another Host, a bearer of another route, and a redirect to another origin.
    const movedRoute = await endpointOf(gateway, moved);
    const awayRoute = await endpointOf(gateway, away);
    const hitsBefore = resource.hits.length;
    assert.equal(
      await rawPost(directRoute.url, {
        host: `rebound.example:${port}`,
        authorization: `Bearer ${directRoute.bearer}`,
      }),
      403,
    );
    assert.equal(await rawPost(directRoute.url, { authorization: `Bearer ${movedRoute.bearer}` }), 403);
    assert.equal(resource.hits.length, hitsBefore, "A refused request reached the server.");
    assert.equal(await rawPost(awayRoute.url, { authorization: `Bearer ${awayRoute.bearer}` }), 502);
    const movedClient = await connect(movedRoute.url, movedRoute.bearer);
    assert.equal(textOf(await movedClient.callTool({ name: "echo", arguments: { text: "moved" } })), "moved");
    const refused = { otherHost: 403, otherRouteBearer: 403, crossOriginRedirect: 502, sameOriginRedirect: "followed" };

    // The server ends the token during the session: one refresh, and the call still succeeds.
    resource.valid.clear();
    resource.valid.add("access-rotated");
    auth.reset();
    assert.equal(textOf(await client.callTool({ name: "echo", arguments: { text: "renewed" } })), "renewed");
    assert.equal(auth.hits.filter((hit) => hit.path === "/token").length, 1);
    assert.equal(resource.hits.at(-1)?.authorization, "Bearer access-rotated");
    const midSessionRefresh = { refreshes: 1, text: "renewed" };

    // After a sign-out the call gets a JSON-RPC error, never a 401 that would start a sign-in.
    await runCauseEffect(gateway.signOut({ mcpServerId: direct.id }));
    const hitsAtSignOut = resource.hits.length;
    const postsBefore = resource.hits.filter((hit) => hit.method === "POST").length;
    const failure = await client.callTool({ name: "echo", arguments: { text: "gone" } }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failure instanceof McpError, "The call after a sign-out did not fail with a JSON-RPC error.");
    assert.equal(failure.code, -32001);
    assert.equal(resource.hits.filter((hit) => hit.method === "POST").length, postsBefore);
    assert.ok(!resource.hits.slice(hitsAtSignOut).some((hit) => hit.path.startsWith("/.well-known")));
    const signedOut = { code: failure.code, upstreamRequests: 0, discoveryRequests: 0 };

    // An expired token with no refresh token is not a current sign-in, but the row stays on its route.
    const fingerprintBeforeExpiry = await runCauseEffect(gateway.proxyFingerprint(servers.listEnabled()));
    const fresh = freshRecord(auth.base, away.url);
    records.set(
      away.url,
      mcpOAuthRecordSchema.parse({
        ...fresh,
        tokens: { access_token: "access-expired", token_type: "Bearer", expires_in: 1 },
        obtainedAt: Date.now() - 60_000,
      }),
    );
    assert.equal(oauth.signedIn(away.url), false);
    assert.deepEqual(await endpointOf(gateway, away), awayRoute);
    assert.equal(await runCauseEffect(gateway.proxyFingerprint(servers.listEnabled())), fingerprintBeforeExpiry);
    const expiredWithoutRefresh = { sameRoute: true, sameFingerprint: true };

    for (const line of logLines)
      for (const secret of [
        "access-on-file",
        "access-rotated",
        "refresh-on-file",
        "row-secret",
        directRoute.bearer,
        researchRoute.bearer,
      ])
        assert.ok(!line.includes(secret), "A log line quoted a credential.");

    // A restart keeps the address and the bearers, so a resumed Codex session still reaches them.
    const movedResearch = await endpointOf(gateway, moved, "agent-research");
    for (const open of clients.splice(0)) await open.close();
    const fingerprint = await runCauseEffect(gateway.proxyFingerprint(servers.listEnabled()));
    assert.ok(fingerprint);
    await runCauseEffect(gateway.close());
    gateway = startGateway();
    const restarted = await endpointOf(gateway, moved);
    assert.deepEqual(restarted, movedRoute);
    assert.deepEqual(await endpointOf(gateway, moved, "agent-research"), movedResearch);
    assert.equal(await runCauseEffect(gateway.proxyFingerprint(servers.listEnabled())), fingerprint);
    await runCauseEffect(gateway.close());

    // A program holds the saved port: a new port and a new secret, and the manifest changes.
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(port, "127.0.0.1", done));
    try {
      gateway = startGateway();
      const moved2 = await endpointOf(gateway, moved);
      assert.notEqual(saved.value?.port, port);
      assert.notEqual(moved2.bearer, movedRoute.bearer);
      assert.notEqual(await runCauseEffect(gateway.proxyFingerprint(servers.listEnabled())), fingerprint);
    } finally {
      await new Promise<void>((done) => blocker.close(() => done()));
    }
    const restart = { samePortAndBearer: true, sameFingerprint: true, busyPortRotatesSecret: true };

    await runCauseEffect(oauth.close());
    return {
      handoff,
      echo,
      getStream,
      clientIdentity,
      refused,
      midSessionRefresh,
      signedOut,
      expiredWithoutRefresh,
      restart,
    };
  } finally {
    for (const open of clients) await open.close();
    for (const open of gateways) await runCauseEffect(open.close());
    await resource.close();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();

/**
 * The network limits of every OAuth request: a public MCP server whose OAuth endpoint is on a
 * private address is refused before any connection, and a body above the limit is not read. The
 * lookup is injected, so the public names resolve without DNS.
 */
async function networkCases(auth: Awaited<ReturnType<typeof startAuthorizationServer>>) {
  const addressTable = {
    "93.184.216.34": true,
    "2606:4700::1111": true,
    "10.0.0.5": false,
    "172.16.0.1": false,
    "192.168.1.1": false,
    "127.0.0.1": false,
    "169.254.169.254": false,
    "100.64.0.1": false,
    "224.0.0.1": false,
    "0.0.0.0": false,
    "::1": false,
    "::": false,
    "fd00::1": false,
    "fe80::1": false,
    "ff02::1": false,
    "::ffff:10.0.0.5": false,
    "::ffff:93.184.216.34": true,
    "[::ffff:a00:5]": false,
  };
  for (const [address, expected] of Object.entries(addressTable))
    assert.equal(isPublicAddress(address), expected, `isPublicAddress(${address})`);

  // `localhost` is a name, so the lookup decides it; the server behind it is the real loopback one.
  const localBase = auth.base.replace("127.0.0.1", "localhost");
  const publicUrl = "https://mcp.public.example/mcp";
  const names: Record<string, readonly string[]> = {
    "mcp.public.example": ["93.184.216.34"],
    "mixed.example": ["93.184.216.34", "10.0.0.5"],
    localhost: ["127.0.0.1"],
  };
  const looked: string[] = [];
  const lookup = (hostname: string) =>
    Effect.suspend(() => {
      looked.push(hostname);
      const addresses = names[hostname];
      return addresses
        ? Effect.succeed(addresses)
        : Effect.fail(new AddressLookupError({ cause: new Error(`No fake address for ${hostname}.`) }));
    });
  const refusal = async (request: Promise<Response>) => {
    try {
      await request;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("The request was not refused.");
  };

  // A public server whose discovery names a loopback endpoint: the refresh never reaches it, and
  // the tokens stay, as for any refresh that did not get an answer.
  auth.reset();
  const resource = normalizeResource(publicUrl);
  assert.ok(resource);
  const { records, storage } = memoryStorage();
  records.set(resource, expiredRecord(localBase));
  const oauth = new McpOAuth({
    storage,
    openExternal: async () => {
      throw new Error("A silent path opened the browser.");
    },
    redirectUrl: REDIRECT_URL,
    lookup,
  });
  const token = await runCauseEffect(oauth.accessToken(publicUrl));
  await runCauseEffect(oauth.close());
  assert.equal(token, "access-on-file");
  assert.equal(records.get(resource)?.tokens?.refresh_token, "refresh-on-file");
  assert.ok(looked.includes("localhost"), "The OAuth endpoint was not checked.");
  assert.equal(auth.hits.length, 0, "A refused OAuth endpoint was reached.");

  const guarded = secureOAuthFetch({ resource: publicUrl, lookup });
  const privateEndpoint = await refusal(guarded(`${localBase}/token`, { method: "POST", body: "grant_type=x" }));
  assert.equal(privateEndpoint, sourceText("error.backend.mcpOAuthPrivateEndpoint", { origin: localBase }));
  const mixed = await refusal(guarded("https://mixed.example/token", { method: "POST" }));
  assert.equal(mixed, sourceText("error.backend.mcpOAuthPrivateEndpoint", { origin: "https://mixed.example" }));
  assert.equal(auth.hits.length, 0, "A refused OAuth endpoint was reached.");

  // A server the user typed on a loopback address keeps its loopback authorization server.
  const local = await secureOAuthFetch({ resource: `${localBase}/mcp`, lookup })(
    `${localBase}/.well-known/oauth-authorization-server`,
  );
  assert.equal(local.status, 200);

  // A body above the limit is refused, with or without a declared length.
  const declared = await refusal(secureOAuthFetch()(`${auth.base}/big-declared`));
  const streamed = await refusal(secureOAuthFetch()(`${auth.base}/big-streamed`));
  const tooLarge = sourceText("error.backend.oauthResponseTooLarge", { origin: auth.base });
  assert.equal(declared, tooLarge);
  assert.equal(streamed, tooLarge);
  assert.equal(await refusal(secureOAuthFetch()(`${auth.base}/big-redirect`)), tooLarge);
  // MCP traffic to the server itself has no limit: the probe sends it through the same fetch.
  const mcpTraffic = await secureOAuthFetch({ resource: `${auth.base}/big-streamed`, mcpTraffic: true })(
    `${auth.base}/big-streamed`,
  );
  assert.equal((await mcpTraffic.text()).length, 2 * 1024 * 1024);
  // A sign-in exchange sends no MCP traffic: an endpoint at the MCP URL itself still has the limit.
  const exchange = await refusal(
    secureOAuthFetch({ resource: `${auth.base}/big-streamed` })(`${auth.base}/big-streamed`),
  );
  assert.equal(exchange, tooLarge);
  // A redirect to another origin leaves the MCP server, so that hop has the limit again.
  const away = await refusal(
    secureOAuthFetch({ resource: `${auth.base}/redirect-away`, mcpTraffic: true })(`${auth.base}/redirect-away`),
  );
  assert.equal(away, sourceText("error.backend.oauthResponseTooLarge", { origin: localBase }));

  return {
    addressClassifier: { checked: Object.keys(addressTable).length },
    privateEndpoint: {
      refusedBeforeConnecting: true,
      tokensKept: true,
      mixedAnswerRefused: true,
      loopbackAllowed: true,
    },
    bodyLimit: {
      declaredRefused: true,
      streamedRefused: true,
      redirectWithoutLocationRefused: true,
      mcpTrafficUnlimited: true,
      exchangeAtMcpUrlLimited: true,
      crossOriginHopLimited: true,
    },
  };
}
