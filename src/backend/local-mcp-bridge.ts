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
import type { DynamicToolResult } from "./protocol";
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
  /** Whether the client sent a request to each of `servers` since the session opened. */
  reached(): boolean;
  close(): void;
}

/**
 * How often a tool call that is still running tells the client it is alive. An MCP client times out
 * a call that sends nothing: opencode after 60 seconds, unless a progress notification resets the
 * deadline. `ask_user` waits for the user, which can take much longer.
 */
const LOCAL_MCP_PROGRESS_INTERVAL_MS = 20_000;

/**
 * The `_meta` key in which OpenCode 2.1.4 names the session that makes a tool call. Its ACP session
 * id is that session id, so a call on a token that a directory's sessions share finds its own thread.
 */
const OPENCODE_SESSION_META = "ai.opencode/sessionID";

/** One session that a token serves. A token shared by a directory serves each session in it. */
interface BridgeMember {
  threadId: string;
  activeTurnId: () => string | null;
  /** The tools of this session, by server name. Sessions in one directory can have different tools. */
  namespaces: ReadonlyMap<string, DynamicToolNamespace>;
}

interface BridgeRoute {
  namespace: DynamicToolNamespace;
  /**
   * The sessions in the order they opened. A call goes to the one that the client names, else to the
   * one in a turn, else to the last. With more than one in a turn and no name, the call is refused.
   */
  members: BridgeMember[];
  /** The key in `#shared`, for a token that a directory's sessions share. */
  shareKey: string | null;
  /**
   * `signal` aborts when the client abandons the call: it sent `notifications/cancelled` (an MCP
   * client does this when its own timeout ends) or closed the response stream. Nothing reads the
   * result after that, so the owner must stop waiting for the user.
   */
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
  ) => Effect.Effect<DynamicToolResult, ProviderClientOperationError>;
  /**
   * The calls still running, by JSON-RPC id. Each POST gets a new MCP server, so the POST that
   * carries `notifications/cancelled` cannot reach the call through the SDK and finds it here.
   */
  running: Map<RequestId, AbortController>;
  /** Whether the client sent a request with this token. */
  reached: boolean;
}

export class LocalMcpBridge {
  #server: HttpServer | null = null;
  #port: number | null = null;
  #listening: Deferred.Deferred<void, McpOperationError> | null = null;
  /** Counts the closes, so a session asked for before a close does not register after it. */
  #closes = 0;
  #closing: Deferred.Deferred<void, McpOperationError> | null = null;
  readonly #routes = new Map<string, BridgeRoute>();
  /** The token of each shared route, by directory and server name. */
  readonly #shared = new Map<string, string>();

  /**
   * `directory` is set for an agent that keeps one MCP server of each name for a directory, not for
   * a session. Its sessions in that directory then get one token, which lasts until the last of them
   * closes: a token of their own would be replaced by the newest session's, and closing that session
   * would leave the others with a token that is refused.
   */
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
    const tokens: string[] = [];
    const servers = namespaces.map((namespace) => {
      const shareKey = directory === undefined ? null : JSON.stringify([directory, namespace.name]);
      const sharedToken = shareKey === null ? undefined : this.#shared.get(shareKey);
      const shared = sharedToken === undefined ? undefined : this.#routes.get(sharedToken);
      let token: string;
      if (sharedToken !== undefined && shared) {
        token = sharedToken;
        // The server takes the name and description of the session that opened last.
        shared.namespace = namespace;
        shared.members.push(member);
      } else {
        token = randomBytes(32).toString("base64url");
        this.#routes.set(token, { namespace, members: [member], shareKey, call, running: new Map(), reached: false });
        if (shareKey !== null) this.#shared.set(shareKey, token);
      }
      tokens.push(token);
      return {
        type: "http" as const,
        name: namespace.name,
        url: `http://127.0.0.1:${this.#port}/mcp`,
        headers: [{ name: "Authorization", value: `Bearer ${token}` }],
      };
    });
    return {
      servers,
      setThreadId: (nextThreadId) => {
        member.threadId = nextThreadId;
      },
      reached: () => tokens.every((token) => this.#routes.get(token)?.reached === true),
      close: () => {
        for (const token of tokens) {
          const route = this.#routes.get(token);
          if (!route) continue;
          route.members = route.members.filter((candidate) => candidate !== member);
          if (route.members.length > 0) continue;
          this.#routes.delete(token);
          if (route.shareKey !== null && this.#shared.get(route.shareKey) === token)
            this.#shared.delete(route.shareKey);
        }
      },
    };
  });

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
    // A bind still in flight sets the server when it ends, so it is awaited before the close.
    if (this.#listening) yield* Deferred.await(this.#listening).pipe(Effect.ignore);
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    if (server) yield* mcpCall(() => new Promise<void>((resolve) => server.close(() => resolve())));
    this.#listening = null;
  });

  /** One bind, however many sessions ask for it at once: a second would leave a server listening. */
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
      mcpSync(() => createServer((request, response) => void runCauseEffect(this.#handle(request, response)))),
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
    const route = this.#authorize(request);
    if (!route) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
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
    // The client lists one set for all sessions of a shared token; a call is checked against its own session.
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: listedTools(route).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, ({ params }, extra) =>
      runCauseEffect(
        Effect.gen({ self: this }, function* (): Effect.fn.Return<CallToolResult, McpOperationError> {
          // A shared token does not say which session called. OpenCode names it in `_meta`; without
          // that, the one in a turn did. With two in a turn at once, no one can tell, so the call fails
          // rather than act in the other thread.
          const caller = extra._meta?.[OPENCODE_SESSION_META];
          const inTurn = route.members.filter((candidate) => candidate.activeTurnId() !== null);
          if (inTurn.length > 1 && !route.members.some((candidate) => candidate.threadId === caller))
            return yield* mcpFailure(new Error(`The ${route.namespace.name} call did not name its session.`));
          const member =
            route.members.find((candidate) => candidate.threadId === caller) ?? inTurn[0] ?? route.members.at(-1);
          if (!member) return yield* mcpFailure(new Error(`The ${route.namespace.name} session closed.`));
          // A tool that another session of the directory has, and this one does not, stays refused.
          const tool = member.namespaces
            .get(route.namespace.name)
            ?.tools.find((candidate) => candidate.name === params.name);
          if (!tool) return yield* mcpFailure(new Error(`Unknown ${route.namespace.name} tool: ${params.name}`));
          // The SDK aborts `extra.signal` when this POST's transport closes, which follows a closed
          // response stream. A cancel on another POST aborts `abandoned` through `route.running`.
          const abandoned = new AbortController();
          const abandon = () => abandoned.abort();
          extra.signal.addEventListener("abort", abandon, { once: true });
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
              )
              .pipe(Effect.mapError(({ cause }) => mcpFailure(cause)));
          }).pipe(
            Effect.onInterrupt(() => Effect.sync(abandon)),
            Effect.ensuring(
              Effect.sync(() => {
                clearInterval(keepAlive);
                extra.signal.removeEventListener("abort", abandon);
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

    // No `sessionIdGenerator`: the transport runs stateless, one transport for each request.
    const transport = new StreamableHTTPServerTransport({});
    yield* Effect.gen({ self: this }, function* () {
      try {
        mcpResult(yield* Effect.result(mcpCall(() => mcp.connect(transport))));
        const body = mcpResult(yield* Effect.result(readJsonBody(request)));
        for (const message of Array.isArray(body) ? body : body ? [body] : []) {
          const cancelled = CancelledNotificationSchema.safeParse(message);
          const requestId = cancelled.success ? cancelled.data.params.requestId : undefined;
          if (requestId !== undefined) route.running.get(requestId)?.abort();
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

  #authorize(request: IncomingMessage): BridgeRoute | null {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const candidate = header.slice(7);
    for (const [token, route] of this.#routes) {
      const left = Buffer.from(candidate);
      const right = Buffer.from(token);
      if (left.length === right.length && timingSafeEqual(left, right)) return route;
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

/** The tools of every session of a route, newest session first, each name once. */
function listedTools(route: BridgeRoute): DynamicToolNamespace["tools"] {
  const tools = new Map<string, DynamicToolNamespace["tools"][number]>();
  for (const member of route.members.toReversed())
    for (const tool of member.namespaces.get(route.namespace.name)?.tools ?? [])
      if (!tools.has(tool.name)) tools.set(tool.name, tool);
  return tools.size > 0 ? [...tools.values()] : route.namespace.tools;
}
