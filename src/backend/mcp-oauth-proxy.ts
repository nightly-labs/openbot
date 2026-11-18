// The loopback MCP address that agents reach for the http servers this machine signed in to. It
// adds the OAuth token upstream, so a provider process holds a bearer for this address only, and
// it renews a token that the server refuses during a session.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
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

/**
 * The headers of the Streamable HTTP transport. Every other header of the provider stays here.
 * A server of revision 2026-07-28 refuses a request without `Mcp-Method` and, for a named call,
 * `Mcp-Name`. The proxy does not change the method or the name, so the provider's values stay true.
 */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "mcp-method",
  "mcp-name",
  "last-event-id",
];
/** The `Mcp-Param-{Name}` headers that a tool of revision 2026-07-28 asks for in its input schema. */
const FORWARDED_REQUEST_HEADER_PREFIX = "mcp-param-";
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
  /** The row address. Its fragment, when it has one, names the account of the sign-in. */
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
  /**
   * Whether the sign-in of `url` ended after a refusal: the refresh was refused, there was no
   * refresh token, or the user signed out. It is the opposite of the row's "Signed in". A server can
   * refuse a request when the sign-in is still good, for example for a tool that the account cannot
   * use, and then a new sign-in alone does not help.
   */
  signInEnded: (url: string) => boolean;
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
 * client in the `clientInfo` of `initialize`. Each route has its own bearer, made
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
  /**
   * The paths whose last `initialize` did not give the provider a good answer, and whether
   * `reportedFailedStart` already marked that failure.
   */
  readonly #failedStarts = new Map<string, boolean>();
  /** How many times each path was handed out again after a failed `initialize`. */
  readonly #attempts = new Map<string, number>();

  constructor(options: McpOAuthProxyOptions) {
    this.#options = options;
  }

  /**
   * The address and the bearer of `route` for the agent with `agentKey` (`mcpOAuthProxyAgentKey`),
   * after the listener is up. Every caller shares one start, so two hand-offs at once do not bind
   * two ports.
   *
   * **A new address after a failed start.** OpenCode 2.3.0 keeps one connection for each server
   * name in a folder and connects again only when the server's settings change. One `initialize`
   * that failed, such as during an expired sign-in, hid the server's tools from each chat of the
   * agent until OpenCode restarted (#9526). The next hand-off of such a path adds `?attempt=N`, so
   * the provider connects again. The bearer stays the same, and each earlier address stays valid.
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
    let attempt = this.#attempts.get(path) ?? 0;
    if (this.#failedStarts.delete(path)) this.#attempts.set(path, ++attempt);
    return { url: `http://127.0.0.1:${port}/mcp/${path}${attempt > 0 ? `?attempt=${attempt}` : ""}`, bearer };
  });

  /**
   * Whether a provider's last `initialize` on `route`, for any agent, failed after its last hand-off
   * and `reportedFailedStart` was not called for it. A path that is not handed out again thus does
   * not make each later test refresh the agents.
   */
  failedStart(route: string): boolean {
    for (const [path, reported] of this.#failedStarts) if (!reported && onRoute(path, route)) return true;
    return false;
  }

  /** Marks the failed starts on `route` as handled, after the agents were refreshed for them. */
  reportedFailedStart(route: string): void {
    for (const path of this.#failedStarts.keys()) if (onRoute(path, route)) this.#failedStarts.set(path, true);
  }

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
    this.#failedStarts.clear();
    this.#attempts.clear();
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
    // The query is the `attempt` of `route`: each address of a path has the same bearer.
    const [, route, agentKey] =
      /^\/mcp\/([0-9a-f]{32})(?:\/([0-9a-f]{32}))?(?:\?[^#]*)?$/u.exec(request.url ?? "") ?? [];
    if (!route) return refuse(response, 403);
    const path = agentKey ? `${route}/${agentKey}` : route;
    if (!authorized(request, routeBearer(secret, path))) return refuse(response, 403);
    const method = request.method ?? "";
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      response.writeHead(405, { allow: "POST, GET, DELETE" });
      response.end();
      return;
    }
    const read = method === "POST" ? yield* readBody(request) : null;
    if (read === "too-large") return refuse(response, 413);
    // A start counts when the server answered it with a 2xx. One that ends in any other way, the
    // provider's own timeout included, is a failed start.
    const start = { answered: false };
    const relay = this.#relay(request, response, method, read, route, agentKey ?? null, controller, start);
    if (!read || initializeRequest(read, request) === null) return yield* relay;
    yield* relay.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (start.answered) this.#failedStarts.delete(path);
          else this.#failedStarts.set(path, false);
        }),
      ),
    );
  });

  /** Sends one request upstream and its answer back. `start.answered`: the server answered with a 2xx. */
  readonly #relay = Effect.fn("McpOAuthProxy.relay")(function* (
    this: McpOAuthProxy,
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    read: Buffer | null,
    route: string,
    agentKey: string | null,
    controller: AbortController,
    start: { answered: boolean },
  ): Effect.fn.Return<void, McpOperationError> {
    const target = yield* this.#options.target(route);
    if (!target) return refuseRequests(response, method, read, sourceText("error.backend.mcpOAuthSignInNeeded"));
    const client = this.#options.client;
    const body = read && client ? yield* mcpSync(() => withClientInfo(read, request, client, agentKey)) : read;
    const upstream = yield* this.#forward(target, request, method, body, controller);
    if (!(upstream instanceof Response)) {
      // A renewed token that the server refused proves a good sign-in. A renewal that failed for now
      // keeps the sign-in, and the next request tries again; a sign-in that cannot be renewed ended.
      const ended = this.#options.signInEnded(target.url);
      logger.warn("The MCP server refused a request with the sign-in of this computer.", {
        challengeError: upstream.challengeError,
        renewed: upstream.renewed,
        signInActive: !ended,
      });
      const message = ended
        ? sourceText("error.backend.mcpOAuthSignInNeeded")
        : upstream.renewed
          ? sourceText("error.backend.mcpOAuthRequestRefused")
          : sourceText("error.backend.mcpOAuthRenewalFailed");
      return refuseRequests(response, method, body, message);
    }
    // A notification has no answer, but the MCP Go SDK, which the Antigravity CLI uses, closes the
    // whole connection when a server refuses one with a 400 that is not a JSON-RPC error. Executor
    // refused `notifications/roots/list_changed`, and the agent lost all of its tools (#10322). A 400
    // does not end the server's session (a 404 does), so the proxy accepts the notification, as the
    // MCP TypeScript SDK server accepts each body of notifications only.
    const refused = upstream.status === 400 && method === "POST" ? notificationMethods(body) : null;
    if (refused) {
      yield* discard(upstream);
      logger.warn("The MCP server refused a notification. The sign-in proxy accepted it.", { methods: refused });
      response.writeHead(202);
      response.end();
      return;
    }
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    response.writeHead(upstream.status, headers);
    response.flushHeaders();
    start.answered = upstream.ok;
    if (!upstream.body) {
      response.end();
      return;
    }
    const stream = upstream.body;
    yield* mcpCall(() => pipeBody(stream, response, controller.signal));
  });

  /** The upstream answer, with one renewed token after a 401, or the last 401 when no token was taken. */
  readonly #forward = Effect.fn("McpOAuthProxy.forward")(function* (
    this: McpOAuthProxy,
    target: McpOAuthProxyTarget,
    request: IncomingMessage,
    method: string,
    body: Buffer | null,
    controller: AbortController,
  ): Effect.fn.Return<Response | UpstreamRefusal, McpOperationError> {
    const first = yield* send(target, target.token, request, method, body, controller);
    if (first.status !== 401) return first;
    yield* discard(first);
    const renewed = yield* this.#options.refresh(target.url, target.token);
    if (!renewed) return { challengeError: challengeError(first), renewed: false };
    const second = yield* send(target, renewed, request, method, body, controller);
    if (second.status !== 401) return second;
    yield* discard(second);
    return { challengeError: challengeError(second), renewed: true };
  });
}

/** Whether `path`, a route with or without an agent key, belongs to `route`. */
function onRoute(path: string, route: string): boolean {
  return path === route || path.startsWith(`${route}/`);
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

/** The `initialize` request in a body, or `null` for any other body, a batch included. */
function initializeRequest(body: Buffer, request: IncomingMessage): DynamicRecord | null {
  if (
    body.length > MAX_INITIALIZE_BYTES ||
    !request.headers["content-type"]?.toLowerCase().includes("json") ||
    !body.includes('"initialize"')
  )
    return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  return isDynamicRecord(parsed) && parsed.method === "initialize" ? parsed : null;
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
  const parsed = initializeRequest(body, request);
  if (parsed === null || !isDynamicRecord(parsed.params)) return body;
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
): Effect.fn.Return<Response, McpOperationError> {
  const headers = yield* mcpSync(() => upstreamHeaders(target, token, request));
  const origin = new URL(target.url).origin;
  let url = new URL(target.url);
  // The fragment names the account on this machine. It does not go upstream.
  url.hash = "";
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

function upstreamHeaders(target: McpOAuthProxyTarget, token: string, request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const { key, value } of target.headers) {
    if (key.trim().toLowerCase() !== "authorization") headers.set(key.trim(), value);
  }
  // A `User-Agent` that the user wrote on the row is kept. The provider's own does not go upstream.
  // There is no `OpenBot/<version>` default: n8n answers each `User-Agent` with "bot" in it
  // with an empty 204 (#6497). `clientInfo` names OpenBot.
  // Node gives the request header names in lowercase.
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      isString(value) &&
      (FORWARDED_REQUEST_HEADERS.includes(name) || name.startsWith(FORWARDED_REQUEST_HEADER_PREFIX))
    )
      headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${token}`);
  return headers;
}

/**
 * A fetch that is abandoned when the headers take longer than `timeoutMs`. The body has no limit.
 * A connection that could not be opened is tried once more in the same time limit: a VPN or a
 * busy network can drop one new connection in many, and nothing reached the server (#8947).
 */
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
    } catch (error) {
      if (controller.signal.aborted || !notConnected(error)) throw error;
      logger.info("A connection to the MCP server could not be opened. It is tried once more.", {
        cause: toLogValue(error),
      });
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Whether `fetch` failed before a connection was open, so that no part of the request left this
 * computer. A reset or a closed socket can come after the server read the request, and a tool call
 * must not run twice, so neither is in this set.
 */
function notConnected(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 4; current = current.cause, depth += 1) {
    if (isDynamicRecord(current)) {
      const { code, syscall } = current;
      if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "EAI_AGAIN" || syscall === "connect") return true;
    }
    // Node tries each address of a host and gives an `AggregateError` when none of them connects.
    if (current instanceof AggregateError && current.errors.length > 0 && current.errors.every(notConnected))
      return true;
  }
  return false;
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

/** A request that the server refused with a 401 after the token was renewed, or could not be. */
interface UpstreamRefusal {
  /** The `error` of the server's Bearer challenge, such as `invalid_token`, for the log only. */
  challengeError: string | null;
  /** Whether the refused request had a token that was renewed after the first refusal. */
  renewed: boolean;
}

/** The `error` value of the `WWW-Authenticate` header. It is a short code, never a credential. */
function challengeError(answer: Response): string | null {
  return /\berror="?([\w.-]{1,64})/u.exec(answer.headers.get("www-authenticate") ?? "")?.[1] ?? null;
}

/**
 * The answer when the server will not take the sign-in that OpenBot holds for the route: a
 * JSON-RPC error with `message` for each request in the body, so the agent reads why the tool
 * failed and the provider does not sign in by itself. A body with notifications only is accepted,
 * as a server would.
 */
function refuseRequests(response: ServerResponse, method: string, body: Buffer | null, message: string): void {
  if (method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end();
    return;
  }
  const { batch, requests } = jsonRpcRequests(body);
  const errors = requests.map((id) => ({ jsonrpc: "2.0", id, error: { code: SIGN_IN_NEEDED_CODE, message } }));
  if (errors.length === 0) {
    response.writeHead(202);
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(batch ? errors : errors[0]));
}

/**
 * The methods of a body that holds only notifications, or `null`. `notifications/initialized`
 * gives `null`: a server that refuses it did not start the session, and the provider must know.
 */
function notificationMethods(body: Buffer | null): string[] | null {
  let parsed: unknown = null;
  try {
    parsed = body && body.length > 0 ? JSON.parse(body.toString("utf8")) : null;
  } catch {
    return null;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const methods: string[] = [];
  for (const item of messages) {
    if (!isDynamicRecord(item) || !isString(item.method) || "id" in item) return null;
    if (item.method === "notifications/initialized") return null;
    methods.push(item.method);
  }
  return methods.length > 0 ? methods : null;
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
