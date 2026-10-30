// The loopback MCP address that agents reach for the http servers this machine signed in to. It
// adds the OAuth token upstream, so a provider process holds a bearer for this address only, and
// it renews a token that the server refuses during a session.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import { runCauseEffect } from "./effect-boundary";
import { McpOperationError, mcpCall, mcpSync } from "./mcp-effects";

const logger = createOpenBotLogger("mcp-oauth-proxy");

/** The same limit as the GitHub proxy. The body is kept whole, so a refused request can be sent again. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** A tool call can run long. The limit only stops a server that never answers. */
const POST_HEADER_TIMEOUT_MS = 5 * 60_000;
/** A GET opens a stream and a DELETE ends a session; both answer at once when the server is up. */
const OTHER_HEADER_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
/** The JSON-RPC code that MCP servers use for a request they refuse without a sign-in. */
const SIGN_IN_NEEDED_CODE = -32001;
/** An `initialize` request is small. A larger body goes through as it is. */
const MAX_INITIALIZE_BYTES = 64 * 1024;
/** The longest agent name in the client title, so that a server does not cut "(OpenBot)" off. */
const MAX_AGENT_NAME_LENGTH = 80;

/** The headers of the Streamable HTTP transport. Every other header of the provider stays here. */
const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control", "mcp-session-id", "mcp-protocol-version"];

/** The port and the secret, kept so that a session resumed after a restart reaches the same address. */
export interface McpOAuthProxySettings {
  port: number | null;
  secret: string;
}

export interface McpOAuthProxySettingsStore {
  read: () => McpOAuthProxySettings | null;
  write: (settings: McpOAuthProxySettings) => Effect.Effect<void, McpOperationError>;
}

/** Where one route goes right now. */
export interface McpOAuthProxyTarget {
  url: string;
  /** The headers the user wrote on the row. They are added here, not given to the provider. */
  headers: ReadonlyArray<{ key: string; value: string }>;
  token: string;
}

export interface McpOAuthProxyOptions {
  /** `null` in a test: the port and the secret then change at each start. */
  settings: McpOAuthProxySettingsStore | null;
  /**
   * The upstream of a route, read for each request, or `null` when no enabled row has the route
   * or this machine holds no token for it. A removed, turned-off or signed-out server is refused
   * at once, with no list of routes to keep current.
   */
  target: (route: string) => Effect.Effect<McpOAuthProxyTarget | null, McpOperationError>;
  /** A new token after the server refused `rejected`, or `null`. See `McpOAuth.refreshAccessToken`. */
  refresh: (url: string, rejected: string) => Effect.Effect<string | null, McpOperationError>;
  /** What the proxy tells a server about the client. Without it, the provider's own `clientInfo` goes through. */
  client?: McpOAuthProxyClient;
}

/** The client that a server sees: OpenBot, and the agent of the route when it has one. */
interface McpOAuthProxyClient {
  version: string;
  /** The current name of the agent whose key is `agentKey`, or `null` when no agent has it now. */
  agentName: (agentKey: string) => string | null;
}

/** The address and the bearer that one provider process is given for one route. */
export interface McpOAuthProxyRoute {
  url: string;
  bearer: string;
}

/**
 * A loopback pass-through for the Streamable HTTP transport.
 *
 * Bytes go through unchanged, event streams included, because the provider and the server speak
 * MCP to each other. This class changes the credential, and it names OpenBot and the agent as the
 * client: the `clientInfo` of `initialize` and the `User-Agent`. Each route has its own bearer, made
 * from the secret, so a bearer that one row's provider holds opens no other route. An agent route
 * adds the agent key to the path and to the bearer; the route without one stays valid for the
 * sessions that hold it.
 *
 * **Never a 401.** A provider that gets a 401 starts its own OAuth sign-in against this address,
 * which has no metadata, and reports a broken server. A sign-in that is gone gets a JSON-RPC error
 * that the agent can read instead.
 */
export class McpOAuthProxy {
  readonly #options: McpOAuthProxyOptions;
  readonly #starting = Semaphore.makeUnsafe(1);
  #server: HttpServer | null = null;
  #port: number | null = null;
  #secret: string | null = null;

  constructor(options: McpOAuthProxyOptions) {
    this.#options = options;
  }

  /**
   * The address and the bearer of `route` for the agent with `agentKey` (`mcpOAuthProxyAgentKey`),
   * after the listener is up. Every caller shares one start, so two hand-offs at once do not bind
   * two ports.
   */
  readonly route = Effect.fn("McpOAuthProxy.route")(function* (
    this: McpOAuthProxy,
    route: string,
    agentKey: string | null = null,
  ): Effect.fn.Return<McpOAuthProxyRoute, McpOperationError> {
    const { port, secret } = yield* this.#start();
    const path = agentKey ? `${route}/${agentKey}` : route;
    const bearer = routeBearer(secret, path);
    registerSecretValue(bearer);
    return { url: `http://127.0.0.1:${port}/mcp/${path}`, bearer };
  });

  /**
   * A digest of the port and the secret, or `null` before the listener is up. The Codex tool
   * manifest records it: a session that holds the address of another port must be replaced, because
   * Codex keeps the configuration of a resumed session.
   */
  readonly identity = Effect.fn("McpOAuthProxy.identity")(function* (this: McpOAuthProxy) {
    const { port, secret } = yield* this.#start();
    return createHash("sha256").update(`${port}\u0000${secret}`).digest("hex");
  });

  readonly close = Effect.fn("McpOAuthProxy.close")(function* (this: McpOAuthProxy) {
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    this.#secret = null;
    if (!server) return;
    yield* Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
      // An event stream stays open as long as the server sends nothing, so `close` alone never ends.
      server.closeAllConnections();
    });
  });

  readonly #start = Effect.fn("McpOAuthProxy.start")(function* (this: McpOAuthProxy) {
    return yield* this.#starting.withPermit(
      Effect.gen({ self: this }, function* () {
        if (this.#port !== null && this.#secret !== null) return { port: this.#port, secret: this.#secret };
        const saved = yield* mcpSync(() => this.#options.settings?.read() ?? null);
        const server = yield* this.#listen(saved?.port ?? 0).pipe(
          Effect.catch((error) => (saved?.port == null ? Effect.fail(error) : this.#listen(0))),
        );
        const address = server.address();
        if (!address || isString(address)) {
          server.close();
          return yield* new McpOperationError({ cause: new Error("The MCP sign-in proxy has no loopback port.") });
        }
        // Sessions resumed with the old address send the old bearers to a port that another program
        // may hold now. A new secret makes those bearers worthless.
        const secret =
          saved && (saved.port === null || saved.port === address.port)
            ? saved.secret
            : randomBytes(32).toString("base64url");
        registerSecretValue(secret);
        this.#server = server;
        this.#port = address.port;
        this.#secret = secret;
        if (this.#options.settings && (saved?.port !== address.port || saved.secret !== secret)) {
          yield* this.#options.settings.write({ port: address.port, secret }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                logger.warn("The MCP sign-in proxy port could not be saved.", { cause: toLogValue(error.cause) });
              }),
            ),
          );
        }
        return { port: address.port, secret };
      }),
    );
  });

  #listen(port: number): Effect.Effect<HttpServer, McpOperationError> {
    return Effect.callback((resume) => {
      const server = createServer((request, response) => {
        void runCauseEffect(this.#handle(request, response));
      });
      let transferred = false;
      const failed = (cause: Error) => resume(Effect.fail(new McpOperationError({ cause })));
      server.once("error", failed);
      server.listen(port, "127.0.0.1", () => {
        transferred = true;
        server.off("error", failed);
        resume(Effect.succeed(server));
      });
      return Effect.sync(() => {
        server.off("error", failed);
        if (!transferred) server.close();
      });
    });
  }

  readonly #handle = Effect.fn("McpOAuthProxy.handle")(function* (
    this: McpOAuthProxy,
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    yield* this.#answer(request, response).pipe(
      // A provider that closed its own connection, an event stream for example, is not a failure.
      Effect.catch((error) => (response.destroyed ? Effect.void : answerFailure(response, error))),
    );
  });

  readonly #answer = Effect.fn("McpOAuthProxy.answer")(function* (
    this: McpOAuthProxy,
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const port = this.#port;
    const secret = this.#secret;
    // A page in a browser can reach a loopback port. It cannot send a matching `Host` through DNS
    // rebinding, and it cannot know a bearer, so both are checked before anything else is read.
    if (port === null || secret === null || !allowedHost(request.headers.host, port)) return refuse(response, 403);
    const controller = new AbortController();
    // The provider closed the connection: the upstream request and its event stream end too. This is
    // set before the first wait, so a close during a token refresh is not missed.
    response.once("close", () => controller.abort());
    const [, route, agentKey] = /^\/mcp\/([0-9a-f]{32})(?:\/([0-9a-f]{32}))?$/u.exec(request.url ?? "") ?? [];
    if (!route || !authorized(request, routeBearer(secret, agentKey ? `${route}/${agentKey}` : route)))
      return refuse(response, 403);
    const method = request.method ?? "";
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      response.writeHead(405, { allow: "POST, GET, DELETE" });
      response.end();
      return;
    }
    const read = method === "POST" ? yield* readBody(request) : null;
    if (read === "too-large") return refuse(response, 413);
    const target = yield* this.#options.target(route);
    if (!target) return signInNeeded(response, method, read);
    const client = this.#options.client;
    const body = read && client ? yield* mcpSync(() => withClientInfo(read, request, client, agentKey ?? null)) : read;
    const upstream = yield* this.#forward(target, request, method, body, controller);
    if (!upstream) return signInNeeded(response, method, body);
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    response.writeHead(upstream.status, headers);
    response.flushHeaders();
    if (!upstream.body) {
      response.end();
      return;
    }
    const stream = upstream.body;
    yield* mcpCall(() => pipeBody(stream, response, controller.signal));
  });

  /** The upstream answer, with one renewed token after a 401. `null` when the sign-in is gone. */
  readonly #forward = Effect.fn("McpOAuthProxy.forward")(function* (
    this: McpOAuthProxy,
    target: McpOAuthProxyTarget,
    request: IncomingMessage,
    method: string,
    body: Buffer | null,
    controller: AbortController,
  ): Effect.fn.Return<Response | null, McpOperationError> {
    const userAgent = this.#options.client ? `OpenBot/${this.#options.client.version}` : null;
    const first = yield* send(target, target.token, request, method, body, controller, userAgent);
    if (first.status !== 401) return first;
    yield* discard(first);
    const renewed = yield* this.#options.refresh(target.url, target.token);
    if (!renewed) return null;
    const second = yield* send(target, renewed, request, method, body, controller, userAgent);
    if (second.status !== 401) return second;
    yield* discard(second);
    return null;
  });
}

/** The bearer of one route: a keyed digest, so no table of bearers is kept or written anywhere. */
function routeBearer(secret: string, route: string): string {
  return createHmac("sha256", secret).update(route).digest("base64url");
}

/** The route of one row. A new URL is a new route, so a session that holds the old one is refused. */
export function mcpOAuthProxyRoute(mcpServerId: string, url: string): string {
  return createHash("sha256").update(`${mcpServerId}\u0000${url}`).digest("hex").slice(0, 32);
}

/** The path segment of one agent. Agent ids are not all hex, and the path does not show them. */
export function mcpOAuthProxyAgentKey(agentId: string): string {
  return createHash("sha256").update(`agent\u0000${agentId}`).digest("hex").slice(0, 32);
}

interface ClientInfo {
  name: string;
  title: string;
  version: string;
  websiteUrl: string;
}

/**
 * OpenBot as the MCP client. The name is fixed, so a server can know OpenBot; the title names the
 * agent, read at each `initialize`, so a rename shows in the next session.
 */
function clientInfo(client: McpOAuthProxyClient, agentKey: string | null): ClientInfo {
  // Control characters and line breaks would break a label that a server shows on one line, and
  // direction marks could make it read as the name of another agent.
  const agentName = agentKey ? client.agentName(agentKey) : null;
  const name = agentName
    ? Array.from(agentName.replace(/[\p{Cc}\p{Zl}\p{Zp}\u200E\u200F\u202A-\u202E\u2066-\u2069]+/gu, " ").trim())
        .slice(0, MAX_AGENT_NAME_LENGTH)
        .join("")
        .trim()
    : null;
  return {
    name: "openbot",
    title: name ? `${name} (OpenBot)` : "OpenBot",
    version: client.version,
    websiteUrl: "https://openbot.run",
  };
}

/**
 * The body with OpenBot as the `clientInfo` when it is an `initialize` request. Any other body is
 * returned as it is. MCP does not let `initialize` be part of a batch, so a batch is not read.
 */
function withClientInfo(
  body: Buffer,
  request: IncomingMessage,
  client: McpOAuthProxyClient,
  agentKey: string | null,
): Buffer {
  if (
    body.length > MAX_INITIALIZE_BYTES ||
    !request.headers["content-type"]?.toLowerCase().includes("json") ||
    !body.includes('"initialize"')
  )
    return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (!isDynamicRecord(parsed) || parsed.method !== "initialize" || !isDynamicRecord(parsed.params)) return body;
  const params = { ...parsed.params, clientInfo: clientInfo(client, agentKey) };
  return Buffer.from(JSON.stringify({ ...parsed, params }));
}

function allowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function authorized(request: IncomingMessage, bearer: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(bearer);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function refuse(response: ServerResponse, status: number): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: status === 413 ? "request_too_large" : "forbidden" }));
}

/** The whole request body, or `"too-large"`. */
const readBody = Effect.fn("McpOAuthProxy.readBody")(function* (request: IncomingMessage) {
  return yield* mcpCall(async () => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        return "too-large" as const;
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  });
});

/**
 * One request to the server, after the same-origin 307 and 308 redirects. Any other redirect is
 * refused: it would send the token to another address, or change a POST into a GET.
 */
const send = Effect.fn("McpOAuthProxy.send")(function* (
  target: McpOAuthProxyTarget,
  token: string,
  request: IncomingMessage,
  method: string,
  body: Buffer | null,
  controller: AbortController,
  userAgent: string | null,
): Effect.fn.Return<Response, McpOperationError> {
  const headers = yield* mcpSync(() => upstreamHeaders(target, token, request, userAgent));
  const origin = new URL(target.url).origin;
  let url = new URL(target.url);
  for (let hop = 0; ; hop += 1) {
    const answer = yield* upstreamFetch(
      url,
      { method, headers, ...(body ? { body: new Uint8Array(body) } : {}), redirect: "manual" },
      controller,
      method === "POST" ? POST_HEADER_TIMEOUT_MS : OTHER_HEADER_TIMEOUT_MS,
    );
    if (answer.status < 300 || answer.status >= 400) return answer;
    yield* discard(answer);
    const location = answer.headers.get("location");
    const next =
      location && (answer.status === 307 || answer.status === 308) && URL.canParse(location, url)
        ? new URL(location, url)
        : null;
    if (!next || next.origin !== origin || hop >= MAX_REDIRECTS)
      return yield* new McpOperationError({ cause: new Error("The MCP server redirected to another address.") });
    url = next;
  }
});

function upstreamHeaders(
  target: McpOAuthProxyTarget,
  token: string,
  request: IncomingMessage,
  userAgent: string | null,
): Headers {
  const headers = new Headers();
  for (const { key, value } of target.headers) {
    if (key.trim().toLowerCase() !== "authorization") headers.set(key.trim(), value);
  }
  // A `User-Agent` that the user wrote on the row is kept. The provider's own does not go upstream.
  if (userAgent && !headers.has("user-agent")) headers.set("user-agent", userAgent);
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers[name];
    if (isString(value)) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${token}`);
  return headers;
}

/** A fetch that is abandoned when the headers take longer than `timeoutMs`. The body has no limit. */
function upstreamFetch(
  url: URL,
  init: RequestInit,
  controller: AbortController,
  timeoutMs: number,
): Effect.Effect<Response, McpOperationError> {
  return mcpCall(async () => {
    const timer = setTimeout(() => controller.abort(new Error("The MCP server did not answer in time.")), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  });
}

function discard(answer: Response): Effect.Effect<void> {
  return mcpCall(() => answer.body?.cancel()).pipe(Effect.catch(() => Effect.void));
}

/** Writes the upstream body as it arrives, so each event of a stream reaches the provider at once. */
async function pipeBody(body: ReadableStream<Uint8Array>, response: ServerResponse, signal: AbortSignal) {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // `once` removes its listeners when either event comes, and rejects when the provider is gone.
      if (!response.write(value)) await once(response, "drain", { signal });
    }
    response.end();
  } finally {
    reader.releaseLock();
  }
}

/**
 * The answer when OpenBot holds no usable sign-in for the route: a JSON-RPC error for each request
 * in the body, so the agent reads why the tool is not there and the provider does not sign in by
 * itself. A body with notifications only is accepted, as a server would.
 */
function signInNeeded(response: ServerResponse, method: string, body: Buffer | null): void {
  if (method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end();
    return;
  }
  const { batch, requests } = jsonRpcRequests(body);
  const message = sourceText("error.backend.mcpOAuthSignInNeeded");
  const errors = requests.map((id) => ({ jsonrpc: "2.0", id, error: { code: SIGN_IN_NEEDED_CODE, message } }));
  if (errors.length === 0) {
    response.writeHead(202);
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(batch ? errors : errors[0]));
}

type JsonRpcId = string | number | null;

/** The ids of the JSON-RPC requests in a body, and whether it was a batch. Notifications have no id. */
function jsonRpcRequests(body: Buffer | null): { batch: boolean; requests: JsonRpcId[] } {
  let parsed: unknown = null;
  try {
    parsed = body && body.length > 0 ? JSON.parse(body.toString("utf8")) : null;
  } catch {
    parsed = null;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  return {
    batch: Array.isArray(parsed),
    requests: messages.flatMap((item) =>
      isDynamicRecord(item) &&
      isString(item.method) &&
      (isString(item.id) || typeof item.id === "number" || item.id === null)
        ? [item.id]
        : [],
    ),
  };
}

/**
 * A server that cannot be reached, a refused redirect, or a stream that broke. The cause stays in
 * the log; a stream that already started is cut, so the provider sees the end of it.
 */
function answerFailure(response: ServerResponse, error: McpOperationError): Effect.Effect<void> {
  return Effect.sync(() => {
    logger.warn("An MCP request through the sign-in proxy failed.", { cause: toLogValue(error.cause) });
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(502, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: sourceText("error.backend.mcpServerUnreachable") },
      }),
    );
  });
}
