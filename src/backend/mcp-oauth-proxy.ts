import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { Effect, Exit, Semaphore } from "effect";
import { runCauseEffect } from "./effect-boundary";
import { McpOperationError, mcpCall, mcpSync } from "./mcp-effects";

const logger = createOpenBotLogger("mcp-oauth-proxy");

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const POST_HEADER_TIMEOUT_MS = 5 * 60_000;
const OTHER_HEADER_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const SIGN_IN_NEEDED_CODE = -32001;
const MAX_INITIALIZE_BYTES = 64 * 1024;
const MAX_AGENT_NAME_LENGTH = 80;

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "mcp-method",
  "mcp-name",
  "last-event-id",
];
const FORWARDED_REQUEST_HEADER_PREFIX = "mcp-param-";
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control", "mcp-session-id", "mcp-protocol-version"];

export interface McpOAuthProxySettings {
  port: number | null;
  secret: string;
}

export interface McpOAuthProxySettingsStore {
  read: () => McpOAuthProxySettings | null;
  write: (settings: McpOAuthProxySettings) => Effect.Effect<void, McpOperationError>;
}

export interface McpOAuthProxyTarget {
  url: string;
  headers: ReadonlyArray<{ key: string; value: string }>;
  token: string;
}

export interface McpOAuthProxyOptions {
  settings: McpOAuthProxySettingsStore | null;
  target: (route: string) => Effect.Effect<McpOAuthProxyTarget | null, McpOperationError>;
  refresh: (url: string, rejected: string) => Effect.Effect<string | null, McpOperationError>;
  scopeRefused: (url: string, rejected: string, scope: string | null) => Effect.Effect<void, McpOperationError>;
  signInEnded: (url: string) => boolean;
  client?: McpOAuthProxyClient;
}

interface McpOAuthProxyClient {
  version: string;
  agentName: (agentKey: string) => string | null;
}

export interface McpOAuthProxyRoute {
  url: string;
  bearer: string;
}

export class McpOAuthProxy {
  readonly #options: McpOAuthProxyOptions;
  readonly #starting = Semaphore.makeUnsafe(1);
  #server: HttpServer | null = null;
  #port: number | null = null;
  #secret: string | null = null;
  readonly #broken = new Map<string, boolean>();
  readonly #attempts = new Map<string, number>();

  constructor(options: McpOAuthProxyOptions) {
    this.#options = options;
  }

  readonly route = Effect.fn("McpOAuthProxy.route")(function* (
    this: McpOAuthProxy,
    route: string,
    agentKey: string | null = null,
  ): Effect.fn.Return<McpOAuthProxyRoute, McpOperationError> {
    const { port, secret } = yield* this.#start();
    const path = agentKey ? `${route}/${agentKey}` : route;
    const bearer = routeBearer(secret, path);
    registerSecretValue(bearer);
    const attempt = (this.#attempts.get(path) ?? 0) + (this.#broken.delete(path) ? 1 : 0);
    this.#attempts.set(path, attempt);
    return { url: `http://127.0.0.1:${port}/mcp/${path}${attempt > 0 ? `?attempt=${attempt}` : ""}`, bearer };
  });

  broken(route: string): boolean {
    for (const [path, reported] of this.#broken) if (!reported && onRoute(path, route)) return true;
    return false;
  }

  reportedBreak(route: string): void {
    for (const path of this.#broken.keys()) if (onRoute(path, route)) this.#broken.set(path, true);
  }

  restart(route: string): void {
    for (const path of this.#attempts.keys())
      if (onRoute(path, route) && !this.#broken.has(path)) this.#broken.set(path, true);
  }

  readonly identity = Effect.fn("McpOAuthProxy.identity")(function* (this: McpOAuthProxy) {
    const { port, secret } = yield* this.#start();
    return createHash("sha256").update(`${port}\u0000${secret}`).digest("hex");
  });

  readonly close = Effect.fn("McpOAuthProxy.close")(function* (this: McpOAuthProxy) {
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    this.#secret = null;
    this.#broken.clear();
    this.#attempts.clear();
    if (!server) return;
    yield* Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
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
    if (port === null || secret === null || !allowedHost(request.headers.host, port)) return refuse(response, 403);
    const controller = new AbortController();
    response.once("close", () => controller.abort());
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
    const exchange: ProxyExchange = { answered: false, lost: false };
    const initialize = read !== null && initializeRequest(read, request) !== null;
    yield* this.#relay(request, response, method, read, route, agentKey ?? null, controller, exchange).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (initialize) {
            if (Exit.isSuccess(exit) && exchange.answered) this.#broken.delete(path);
            else this.#broken.set(path, false);
            return;
          }
          const clientLeft = response.destroyed && !response.writableFinished;
          const lost = exchange.lost || (Exit.isFailure(exit) && !clientLeft);
          if (method === "POST" && lost && !this.#broken.has(path)) this.#broken.set(path, false);
        }),
      ),
    );
  });

  readonly #relay = Effect.fn("McpOAuthProxy.relay")(function* (
    this: McpOAuthProxy,
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    read: Buffer | null,
    route: string,
    agentKey: string | null,
    controller: AbortController,
    exchange: ProxyExchange,
  ): Effect.fn.Return<void, McpOperationError> {
    const target = yield* this.#options.target(route);
    if (!target)
      return refuseRequests(exchange, response, method, read, sourceText("error.backend.mcpOAuthSignInNeeded"));
    const client = this.#options.client;
    const body = read && client ? yield* mcpSync(() => withClientInfo(read, request, client, agentKey)) : read;
    const { answer: upstream, token } = yield* this.#forward(target, request, method, body, controller);
    if (upstream instanceof Response && upstream.status === 403) {
      const scope = insufficientScopeChallenge(upstream.headers.get("www-authenticate") ?? "");
      if (scope !== undefined) {
        yield* discard(upstream);
        yield* this.#options.scopeRefused(target.url, token, scope);
        logger.warn("The MCP server asked for more access than the sign-in of this computer gives.");
        return refuseRequests(exchange, response, method, body, sourceText("error.backend.mcpOAuthScopeNeeded"));
      }
    }
    if (!(upstream instanceof Response)) {
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
      return refuseRequests(exchange, response, method, body, message);
    }
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
    exchange.answered = upstream.ok;
    exchange.lost = upstream.status >= 500;
    if (!upstream.body) {
      response.end();
      return;
    }
    const stream = upstream.body;
    yield* mcpCall(() => pipeBody(stream, response, controller.signal));
  });

  readonly #forward = Effect.fn("McpOAuthProxy.forward")(function* (
    this: McpOAuthProxy,
    target: McpOAuthProxyTarget,
    request: IncomingMessage,
    method: string,
    body: Buffer | null,
    controller: AbortController,
  ): Effect.fn.Return<{ answer: Response | UpstreamRefusal; token: string }, McpOperationError> {
    const first = yield* send(target, target.token, request, method, body, controller);
    if (first.status !== 401) return { answer: first, token: target.token };
    yield* discard(first);
    const renewed = yield* this.#options.refresh(target.url, target.token);
    if (!renewed) return { answer: { challengeError: challengeError(first), renewed: false }, token: target.token };
    const second = yield* send(target, renewed, request, method, body, controller);
    if (second.status !== 401) return { answer: second, token: renewed };
    yield* discard(second);
    return { answer: { challengeError: challengeError(second), renewed: true }, token: renewed };
  });
}

function onRoute(path: string, route: string): boolean {
  return path === route || path.startsWith(`${route}/`);
}

function routeBearer(secret: string, route: string): string {
  return createHmac("sha256", secret).update(route).digest("base64url");
}

export function mcpOAuthProxyRoute(mcpServerId: string, url: string): string {
  return createHash("sha256").update(`${mcpServerId}\u0000${url}`).digest("hex").slice(0, 32);
}

export function mcpOAuthProxyAgentKey(agentId: string): string {
  return createHash("sha256").update(`agent\u0000${agentId}`).digest("hex").slice(0, 32);
}

interface ClientInfo {
  name: string;
  title: string;
  version: string;
  websiteUrl: string;
}

function clientInfo(client: McpOAuthProxyClient, agentKey: string | null): ClientInfo {
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

function notConnected(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 4; current = current.cause, depth += 1) {
    if (isDynamicRecord(current)) {
      const { code, syscall } = current;
      if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "EAI_AGAIN" || syscall === "connect") return true;
    }
    if (current instanceof AggregateError && current.errors.length > 0 && current.errors.every(notConnected))
      return true;
  }
  return false;
}

function discard(answer: Response): Effect.Effect<void> {
  return mcpCall(() => answer.body?.cancel()).pipe(Effect.catch(() => Effect.void));
}

async function pipeBody(body: ReadableStream<Uint8Array>, response: ServerResponse, signal: AbortSignal) {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(value)) await once(response, "drain", { signal });
    }
    response.end();
  } finally {
    reader.releaseLock();
  }
}

interface ProxyExchange {
  answered: boolean;
  lost: boolean;
}

interface UpstreamRefusal {
  challengeError: string | null;
  renewed: boolean;
}

function challengeError(answer: Response): string | null {
  return /\berror="?([\w.-]{1,64})/u.exec(answer.headers.get("www-authenticate") ?? "")?.[1] ?? null;
}

export function insufficientScopeChallenge(challenge: string): string | null | undefined {
  if (!/(?:^|,)\s*bearer\b/iu.test(challenge) || !/\berror\s*=\s*"?insufficient_scope\b/iu.test(challenge))
    return undefined;
  const scope = /(?:^|[\s,])scope\s*=\s*(?:"([^"]{0,512})"|([^\s,"]{1,512})(?=[\s,]|$))/iu.exec(challenge);
  return (scope?.[1] ?? scope?.[2])?.trim() || null;
}

function refuseRequests(
  exchange: ProxyExchange,
  response: ServerResponse,
  method: string,
  body: Buffer | null,
  message: string,
): void {
  exchange.lost = true;
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
