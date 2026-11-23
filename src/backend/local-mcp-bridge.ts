import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  CancelledNotificationSchema,
  type JSONRPCMessage,
  JSONRPCMessageSchema,
  ListToolsRequestSchema,
  type RequestId,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { isString } from "@openbot/contracts/runtime-values";
import { Deferred, Effect, Exit } from "effect";
import { runCauseEffect } from "./effect-boundary";
import { type McpOperationError, mcpCall, mcpFailure, mcpResult, mcpSync } from "./mcp-effects";
import { type DynamicToolResult, PROVIDER_STOPPED_WAITING } from "./protocol";
import type { ProviderClientOperationError } from "./provider-client-effects";

interface DynamicToolDefinition {
  type: "function";
  name: string;
  description?: string;
  inputSchema: Tool["inputSchema"];
}

export interface DynamicToolNamespace {
  type: "namespace";
  name: string;
  description?: string;
  tools: DynamicToolDefinition[];
}

export interface LocalMcpSession {
  readonly servers: Array<{
    type: "http";
    name: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
  }>;
  setThreadId(threadId: string): void;
  reached(): boolean;
  dropped(sentAt: number, limitMs: number): boolean;
  listedWithin(from: number, limitMs: number, namespace?: string): boolean;
  renew(): LocalMcpSession["servers"];
  close(): void;
}

const LOCAL_MCP_PROGRESS_INTERVAL_MS = 20_000;

const LOCAL_MCP_UNEXTENDED_DETACH_MS = 45_000;

const OPENCODE_SESSION_META = "ai.opencode/sessionID";

const DROP_JUDGE_MARGIN_MS = 2_000;

const LISTED_TIMES_KEPT = 16;

const LOCAL_MCP_KEEP_ALIVE_MS = 95_000;

function keepIdleConnections(server: HttpServer): HttpServer {
  server.keepAliveTimeout = LOCAL_MCP_KEEP_ALIVE_MS;
  const inFlight = new WeakMap<object, number>();
  server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    const socket = request.socket;
    inFlight.set(socket, (inFlight.get(socket) ?? 0) + 1);
    response.once("close", () => {
      const left = (inFlight.get(socket) ?? 1) - 1;
      inFlight.set(socket, left);
      if (left === 0 && !server.listening) socket.end();
    });
  });
  return server;
}

interface BridgeMember {
  threadId: string;
  activeTurnId: () => string | null;
  namespaces: ReadonlyMap<string, DynamicToolNamespace>;
}

interface BridgeRoute {
  namespace: DynamicToolNamespace;
  members: BridgeMember[];
  shareKey: string | null;
  call: (
    params: {
      threadId: string;
      turnId: string;
      callId: string;
      namespace: string;
      tool: string;
      arguments: unknown;
    },
    signal: AbortSignal,
    detachAfterMs: number | undefined,
    subagent: boolean,
  ) => Effect.Effect<DynamicToolResult, ProviderClientOperationError>;
  running: Map<RequestId, AbortController>;
  reached: boolean;
  tokens: string[];
  sentBy: BridgeMember;
  listedAt: number | null;
  listedTimes: number[];
  dropped: boolean;
}

export class LocalMcpBridge {
  #server: HttpServer | null = null;
  #port: number | null = null;
  #listening: Deferred.Deferred<void, McpOperationError> | null = null;
  #closes = 0;
  #closing: Deferred.Deferred<void, McpOperationError> | null = null;
  readonly #routes = new Map<string, BridgeRoute>();
  readonly #shared = new Map<string, string>();

  readonly createSession = Effect.fn("LocalMcpBridge.createSession")(function* (
    this: LocalMcpBridge,
    threadId: string,
    namespaces: DynamicToolNamespace[],
    activeTurnId: () => string | null,
    call: BridgeRoute["call"],
    directory?: string,
  ): Effect.fn.Return<LocalMcpSession, McpOperationError> {
    const closes = this.#closes;
    if (this.#closing) return yield* mcpFailure(new Error("The local OpenBot MCP bridge closed."));
    yield* this.#listen();
    if (closes !== this.#closes) return yield* mcpFailure(new Error("The local OpenBot MCP bridge closed."));
    const member: BridgeMember = {
      threadId,
      activeTurnId,
      namespaces: new Map(namespaces.map((namespace) => [namespace.name, namespace])),
    };
    const routes = namespaces.map((namespace) => {
      const shareKey = directory === undefined ? null : JSON.stringify([directory, namespace.name]);
      const sharedToken = shareKey === null ? undefined : this.#shared.get(shareKey);
      const shared = sharedToken === undefined ? undefined : this.#routes.get(sharedToken);
      if (shared) {
        shared.namespace = namespace;
        shared.members.push(member);
        if (shared.dropped) this.#renewToken(shared, member);
        return shared;
      }
      const token = randomBytes(32).toString("base64url");
      const route: BridgeRoute = {
        namespace,
        members: [member],
        shareKey,
        call,
        running: new Map(),
        reached: false,
        tokens: [token],
        sentBy: member,
        listedAt: null,
        listedTimes: [],
        dropped: false,
      };
      this.#routes.set(token, route);
      if (shareKey !== null) this.#shared.set(shareKey, token);
      return route;
    });
    const servers = () =>
      routes.map((route) => ({
        type: "http" as const,
        name: route.namespace.name,
        url: `http://127.0.0.1:${this.#port}/mcp`,
        headers: [{ name: "Authorization", value: `Bearer ${route.tokens.at(-1)}` }],
      }));
    const current = servers();
    return {
      servers: current,
      setThreadId: (nextThreadId) => {
        member.threadId = nextThreadId;
      },
      reached: () => routes.every((route) => route.reached),
      dropped: (sentAt, limitMs) => {
        const now = Date.now();
        let dropped = false;
        for (const route of routes) {
          if (route.sentBy !== member || route.dropped) continue;
          route.dropped =
            route.listedAt === null
              ? now - sentAt >= limitMs - DROP_JUDGE_MARGIN_MS
              : route.listedAt - sentAt >= limitMs;
          dropped ||= route.dropped;
        }
        return dropped;
      },
      listedWithin: (from, limitMs, namespace) =>
        routes.some(
          (route) =>
            (namespace === undefined || route.namespace.name === namespace) &&
            route.listedTimes.some((at) => at >= from && at - from <= limitMs),
        ),
      renew: () => {
        for (const route of routes) if (route.dropped) this.#renewToken(route, member);
        current.splice(0, current.length, ...servers());
        return current;
      },
      close: () => {
        for (const route of routes) {
          route.members = route.members.filter((candidate) => candidate !== member);
          if (route.members.length > 0) continue;
          for (const token of route.tokens) this.#routes.delete(token);
          if (route.shareKey !== null && route.tokens.includes(this.#shared.get(route.shareKey) ?? ""))
            this.#shared.delete(route.shareKey);
        }
      },
    };
  });

  #renewToken(route: BridgeRoute, member: BridgeMember): void {
    const token = randomBytes(32).toString("base64url");
    route.tokens.push(token);
    route.sentBy = member;
    route.listedAt = null;
    route.listedTimes = [];
    route.dropped = false;
    this.#routes.set(token, route);
    if (route.shareKey !== null) this.#shared.set(route.shareKey, token);
  }

  readonly close = Effect.fn("LocalMcpBridge.close")(function* (this: LocalMcpBridge) {
    if (this.#closing) return yield* Deferred.await(this.#closing);
    this.#closes += 1;
    this.#routes.clear();
    this.#shared.clear();
    const closing = Deferred.makeUnsafe<void, McpOperationError>();
    this.#closing = closing;
    yield* this.#shutDown().pipe(
      Effect.onExit((exit) =>
        Effect.gen({ self: this }, function* () {
          yield* Deferred.done(closing, exit);
          if (this.#closing === closing) this.#closing = null;
        }),
      ),
    );
  }, Effect.uninterruptible);

  readonly #shutDown = Effect.fn("LocalMcpBridge.shutDown")(function* (
    this: LocalMcpBridge,
  ): Effect.fn.Return<void, McpOperationError> {
    if (this.#listening) yield* Deferred.await(this.#listening).pipe(Effect.ignore);
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    if (server) yield* mcpCall(() => new Promise<void>((resolve) => server.close(() => resolve())));
    this.#listening = null;
  });

  readonly #listen = Effect.fn("LocalMcpBridge.listen")(function* (this: LocalMcpBridge) {
    if (this.#listening) return yield* Deferred.await(this.#listening);
    const listening = Deferred.makeUnsafe<void, McpOperationError>();
    this.#listening = listening;
    yield* this.#bind().pipe(
      Effect.onExit((exit) =>
        Effect.gen({ self: this }, function* () {
          yield* Deferred.done(listening, exit);
          if (Exit.isFailure(exit) && this.#listening === listening) this.#listening = null;
        }),
      ),
    );
  }, Effect.uninterruptible);

  readonly #bind = Effect.fn("LocalMcpBridge.bind")(function* (
    this: LocalMcpBridge,
  ): Effect.fn.Return<void, McpOperationError> {
    let retained = false;
    yield* Effect.acquireUseRelease(
      mcpSync(() =>
        keepIdleConnections(createServer((request, response) => void runCauseEffect(this.#handle(request, response)))),
      ),
      (server) =>
        Effect.gen({ self: this }, function* () {
          yield* mcpCall(
            () =>
              new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(0, "127.0.0.1", () => {
                  server.off("error", reject);
                  resolve();
                });
              }),
          ).pipe(Effect.uninterruptible);
          const address = server.address();
          if (!address || isString(address))
            return yield* mcpFailure(new Error("Unable to bind the local OpenBot MCP bridge."));
          this.#server = server;
          this.#port = address.port;
          retained = true;
        }),
      (server) =>
        retained
          ? Effect.void
          : mcpCall(() => new Promise<void>((resolve) => server.close(() => resolve()))).pipe(Effect.orDie),
    );
  });

  readonly #handle = Effect.fn("LocalMcpBridge.handle")(function* (
    this: LocalMcpBridge,
    request: IncomingMessage,
    response: ServerResponse,
  ): Effect.fn.Return<void, McpOperationError> {
    const authorized = this.#authorize(request);
    if (!authorized) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const { route, token } = authorized;
    route.reached = true;
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" });
      response.end();
      return;
    }

    const mcp = new Server(
      { name: route.namespace.name, version: "0.1.0" },
      {
        capabilities: { tools: {} },
        ...(route.namespace.description === undefined ? {} : { instructions: route.namespace.description }),
      },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      if (token === route.tokens.at(-1)) {
        const now = Date.now();
        route.listedAt ??= now;
        route.listedTimes = [...route.listedTimes, now].slice(-LISTED_TIMES_KEPT);
      }
      return {
        tools: listedTools(route).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });
    mcp.setRequestHandler(CallToolRequestSchema, ({ params }, extra) =>
      runCauseEffect(
        Effect.gen({ self: this }, function* (): Effect.fn.Return<CallToolResult, McpOperationError> {
          const caller = extra._meta?.[OPENCODE_SESSION_META];
          const inTurn = route.members.filter((candidate) => candidate.activeTurnId() !== null);
          if (inTurn.length > 1 && !route.members.some((candidate) => candidate.threadId === caller))
            return yield* mcpFailure(new Error(`The ${route.namespace.name} call did not name its session.`));
          const member =
            route.members.find((candidate) => candidate.threadId === caller) ?? inTurn[0] ?? route.members.at(-1);
          if (!member) return yield* mcpFailure(new Error(`The ${route.namespace.name} session closed.`));
          const tool = member.namespaces
            .get(route.namespace.name)
            ?.tools.find((candidate) => candidate.name === params.name);
          if (!tool) return yield* mcpFailure(new Error(`Unknown ${route.namespace.name} tool: ${params.name}`));
          const abandoned = new AbortController();
          const abandon = () => abandoned.abort();
          const stopWaiting = () => abandoned.abort(PROVIDER_STOPPED_WAITING);
          extra.signal.addEventListener("abort", stopWaiting, { once: true });
          route.running.set(extra.requestId, abandoned);
          const progressToken = extra._meta?.progressToken;
          let progress = 0;
          const keepAlive =
            progressToken === undefined
              ? undefined
              : setInterval(() => {
                  progress += 1;
                  extra
                    .sendNotification({ method: "notifications/progress", params: { progressToken, progress } })
                    .catch(() => undefined);
                }, LOCAL_MCP_PROGRESS_INTERVAL_MS);
          const result = yield* Effect.gen({ self: this }, function* () {
            return yield* route
              .call(
                {
                  threadId: member.threadId,
                  turnId: member.activeTurnId() ?? randomUUID(),
                  callId: randomUUID(),
                  namespace: route.namespace.name,
                  tool: tool.name,
                  arguments: params.arguments ?? {},
                },
                abandoned.signal,
                progressToken === undefined ? LOCAL_MCP_UNEXTENDED_DETACH_MS : undefined,
                typeof caller === "string" && caller !== member.threadId,
              )
              .pipe(Effect.mapError(({ cause }) => mcpFailure(cause)));
          }).pipe(
            Effect.onInterrupt(() => Effect.sync(abandon)),
            Effect.ensuring(
              Effect.sync(() => {
                clearInterval(keepAlive);
                extra.signal.removeEventListener("abort", stopWaiting);
                if (route.running.get(extra.requestId) === abandoned) route.running.delete(extra.requestId);
              }),
            ),
          );
          const content: CallToolResult["content"] = [];
          for (const item of result.contentItems) {
            if (item.type === "inputText") {
              content.push({ type: "text", text: item.text });
              continue;
            }
            const [, mimeType, data] = item.imageUrl.match(/^data:([^;]+);base64,(.+)$/s) ?? [];
            if (mimeType !== undefined && data !== undefined) content.push({ type: "image", mimeType, data });
          }
          return {
            isError: !result.success,
            content,
          };
        }),
      ),
    );

    const transport = new StreamableHTTPServerTransport({});
    yield* Effect.gen({ self: this }, function* () {
      try {
        mcpResult(yield* Effect.result(mcpCall(() => mcp.connect(transport))));
        const body = mcpResult(yield* Effect.result(readJsonBody(request)));
        for (const message of Array.isArray(body) ? body : body ? [body] : []) {
          const cancelled = CancelledNotificationSchema.safeParse(message);
          const requestId = cancelled.success ? cancelled.data.params.requestId : undefined;
          if (requestId !== undefined) route.running.get(requestId)?.abort(PROVIDER_STOPPED_WAITING);
        }
        mcpResult(yield* Effect.result(mcpCall(() => transport.handleRequest(request, response, body))));
      } catch {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32603, message: "Internal MCP bridge error." },
            }),
          );
        }
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* mcpCall(() => transport.close()).pipe(Effect.catch(() => Effect.void));
          yield* mcpCall(() => mcp.close()).pipe(Effect.catch(() => Effect.void));
        }),
      ),
    );
  });

  #authorize(request: IncomingMessage): { route: BridgeRoute; token: string } | null {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const candidate = header.slice(7);
    for (const [token, route] of this.#routes) {
      const left = Buffer.from(candidate);
      const right = Buffer.from(token);
      if (left.length === right.length && timingSafeEqual(left, right)) return { route, token };
    }
    return null;
  }
}
export const readJsonBody = Effect.fn("LocalMcpBridge.readJsonBody")(function* (
  request: IncomingMessage,
  maxBytes = 1_000_000,
): Effect.fn.Return<JSONRPCMessage | JSONRPCMessage[] | undefined, McpOperationError> {
  const chunks: Buffer[] = [];
  let size = 0;
  const iterator = request[Symbol.asyncIterator]();
  let finished = false;
  yield* Effect.gen(function* () {
    while (true) {
      const next = yield* mcpCall(() => iterator.next());
      if (next.done) {
        finished = true;
        break;
      }
      const buffer = yield* mcpSync(() => (Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value)));
      size += buffer.length;
      if (size > maxBytes) return yield* mcpFailure(new Error("MCP request body is too large."));
      chunks.push(buffer);
    }
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (!finished) {
          request.destroy();
          yield* mcpCall(() => iterator.return?.()).pipe(Effect.catch(() => Effect.void));
        }
      }),
    ),
  );
  if (chunks.length === 0) return undefined;
  return yield* mcpSync(() => {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const decode = (item: unknown): JSONRPCMessage => {
      const parsed = JSONRPCMessageSchema.safeParse(item);
      if (!parsed.success) throw new Error("Invalid MCP JSON-RPC message.");
      return parsed.data;
    };
    return Array.isArray(value) ? value.map(decode) : decode(value);
  });
});

function listedTools(route: BridgeRoute): DynamicToolNamespace["tools"] {
  const tools = new Map<string, DynamicToolNamespace["tools"][number]>();
  for (const member of route.members.toReversed())
    for (const tool of member.namespaces.get(route.namespace.name)?.tools ?? [])
      if (!tools.has(tool.name)) tools.set(tool.name, tool);
  return tools.size > 0 ? [...tools.values()] : route.namespace.tools;
}
