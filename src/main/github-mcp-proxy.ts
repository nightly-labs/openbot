import { Effect } from "effect";
import { GitHubOperationError, githubCall } from "./github-effects";
// The GitHub MCP server that agents reach on this computer. It forwards to GitHub's remote MCP
// server with the token for each call: the bot token of the repository that the call names, or
// the user token.

import { timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { readJsonBody } from "../backend/local-mcp-bridge";

const logger = createOpenBotLogger("github-mcp-proxy");

/** A GitHub call rarely takes long. The limit only stops a call that GitHub never answers. */
const UPSTREAM_TIMEOUT_MS = 5 * 60_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface GitHubMcpProxyOptions {
  /** GitHub's remote MCP server. */
  upstreamUrl: string;
  /** The bearer that agents send. It stays the same across restarts, so a resumed session keeps working. */
  secret: () => string;
  /** The user token, or null while the connection is not active. */
  userToken: () => Effect.Effect<string | null, GitHubOperationError>;
  /** The bot token of `owner/name`, or null when the user token applies. */
  botToken: (owner: string, name: string) => string | null;
}

interface Upstream {
  client: Client;
  ready: Effect.Effect<void, GitHubOperationError>;
}

/**
 * A loopback MCP server with GitHub's tools. Each POST gets a new MCP server with no session, as in
 * `LocalMcpBridge`. Upstream, one MCP client runs for each token, because GitHub binds an MCP session
 * to the token that opened it.
 *
 * A tool call with `owner` and `repo` arguments, and a resource read of a `repo://owner/name/` URI,
 * use the bot token of that repository when there is one. Every other request uses the user token.
 */
export class GitHubMcpProxy {
  readonly #options: GitHubMcpProxyOptions;
  readonly #upstreams = new Map<string, Upstream>();
  #server: HttpServer | null = null;
  #port: number | null = null;

  constructor(options: GitHubMcpProxyOptions) {
    this.#options = options;
  }

  /** The URL that agents are given, or null before `start`. */
  url(): string | null {
    return this.#port === null ? null : `http://127.0.0.1:${this.#port}/mcp`;
  }

  /**
   * Listens on `preferredPort` when it is free, so a resumed session finds the same URL, and on a new
   * port when it is not. Returns the port.
   */
  readonly start = Effect.fn("GitHubMcpProxy.start")(function* (this: GitHubMcpProxy, preferredPort: number | null) {
    if (this.#port !== null) return this.#port;
    const server = yield* this.#listen(preferredPort ?? 0).pipe(
      Effect.catch((error) => (preferredPort === null ? Effect.fail(error) : this.#listen(0))),
    );
    const address = server.address();
    if (!address || isString(address)) {
      server.close();
      return yield* new GitHubOperationError({ cause: new Error("The GitHub MCP proxy has no loopback port.") });
    }
    this.#server = server;
    this.#port = address.port;
    return address.port;
  });

  readonly retain = Effect.fn("GitHubMcpProxy.retain")(function* (this: GitHubMcpProxy, tokens: ReadonlySet<string>) {
    const removed: Client[] = [];
    for (const [token, upstream] of this.#upstreams) {
      if (tokens.has(token)) continue;
      this.#upstreams.delete(token);
      removed.push(upstream.client);
    }
    yield* Effect.forEach(removed, (client) => githubCall(() => client.close()).pipe(Effect.catch(() => Effect.void)), {
      concurrency: "unbounded",
    });
  });

  readonly stop = Effect.fn("GitHubMcpProxy.stop")(function* (this: GitHubMcpProxy) {
    yield* this.retain(new Set());
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    if (server)
      yield* Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
      });
  });

  #listen(port: number): Effect.Effect<HttpServer, GitHubOperationError> {
    return Effect.callback((resume) => {
      const server = createServer((request, response) => {
        void Effect.runPromise(this.#handleEffect(request, response).pipe(Effect.mapError((error) => error.cause)));
      });
      let transferred = false;
      const failed = (cause: Error) => resume(Effect.fail(new GitHubOperationError({ cause })));
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

  readonly #handleEffect = Effect.fn("GitHubMcpProxy.handle")(function* (
    this: GitHubMcpProxy,
    request: IncomingMessage,
    response: ServerResponse,
  ): Effect.fn.Return<void, GitHubOperationError> {
    if (!this.#authorized(request)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" });
      response.end();
      return;
    }
    const userToken = yield* this.#options.userToken();
    if (!userToken) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "github_not_connected" }));
      return;
    }
    const mcp = yield* this.#serverForEffect(userToken).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.sync(() => {
          logger.warn("GitHub's MCP server could not be reached.", { cause: toLogValue(error) });
          return null;
        }),
      ),
    );
    if (!mcp) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "github_unreachable" }));
      return;
    }
    // No `sessionIdGenerator`: each POST is one stateless request.
    const transport = new StreamableHTTPServerTransport({});
    yield* Effect.gen(function* () {
      yield* githubCall(() => mcp.connect(transport));
      const body = yield* readJsonBody(request, MAX_BODY_BYTES).pipe(
        Effect.mapError((error) => new GitHubOperationError({ cause: error.cause })),
      );
      yield* githubCall(() => transport.handleRequest(request, response, body));
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          if (!response.headersSent) {
            response.writeHead(500, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: { code: -32603, message: "Internal GitHub MCP proxy error." },
              }),
            );
          }
        }),
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          yield* githubCall(() => transport.close()).pipe(Effect.catch(() => Effect.void));
          yield* githubCall(() => mcp.close()).pipe(Effect.catch(() => Effect.void));
        }),
      ),
    );
  });

  /** The MCP server for one POST, with GitHub's instructions and capabilities. */
  readonly #serverForEffect = Effect.fn("GitHubMcpProxy.serverFor")(function* (
    this: GitHubMcpProxy,
    userToken: string,
  ): Effect.fn.Return<Server, GitHubOperationError> {
    const user = yield* this.#upstream(userToken);
    const capabilities = user.getServerCapabilities() ?? {};
    const instructions = user.getInstructions();
    const mcp = new Server(
      { name: "github", version: "1.0.0" },
      {
        capabilities: {
          tools: {},
          ...(capabilities.prompts ? { prompts: {} } : {}),
          ...(capabilities.resources ? { resources: {} } : {}),
        },
        ...(instructions ? { instructions } : {}),
      },
    );
    const forward = <T>(token: string, call: (client: Client) => Promise<T>) =>
      Effect.runPromise(this.#call(token, call).pipe(Effect.mapError((error) => error.cause)));
    mcp.setRequestHandler(ListToolsRequestSchema, ({ params }, extra) =>
      forward(userToken, (client) => client.listTools(params, requestOptions(extra.signal))),
    );
    mcp.setRequestHandler(CallToolRequestSchema, ({ params }, extra) => {
      const args = params.arguments;
      const owner = isDynamicRecord(args) && isString(args.owner) ? args.owner : null;
      const name = isDynamicRecord(args) && isString(args.repo) ? args.repo : null;
      const token = (owner && name && this.#options.botToken(owner, name)) || userToken;
      return forward(token, (client) => client.callTool(params, undefined, requestOptions(extra.signal)));
    });
    if (capabilities.prompts) {
      mcp.setRequestHandler(ListPromptsRequestSchema, ({ params }, extra) =>
        forward(userToken, (client) => client.listPrompts(params, requestOptions(extra.signal))),
      );
      mcp.setRequestHandler(GetPromptRequestSchema, ({ params }, extra) =>
        forward(userToken, (client) => client.getPrompt(params, requestOptions(extra.signal))),
      );
    }
    if (capabilities.resources) {
      mcp.setRequestHandler(ListResourcesRequestSchema, ({ params }, extra) =>
        forward(userToken, (client) => client.listResources(params, requestOptions(extra.signal))),
      );
      mcp.setRequestHandler(ListResourceTemplatesRequestSchema, ({ params }, extra) =>
        forward(userToken, (client) => client.listResourceTemplates(params, requestOptions(extra.signal))),
      );
      mcp.setRequestHandler(ReadResourceRequestSchema, ({ params }, extra) => {
        const [, owner, name] = /^repo:\/\/([^/]+)\/([^/]+)\//u.exec(params.uri) ?? [];
        const token = (owner && name && this.#options.botToken(owner, name)) || userToken;
        return forward(token, (client) => client.readResource(params, requestOptions(extra.signal)));
      });
    }
    return mcp;
  });

  /** One call on the client of `token`. A session that GitHub ended opens again once. */
  readonly #call = Effect.fn("GitHubMcpProxy.call")(function* <T>(
    this: GitHubMcpProxy,
    token: string,
    call: (client: Client) => Promise<T>,
  ): Effect.fn.Return<T, GitHubOperationError> {
    const client = yield* this.#upstream(token);
    return yield* githubCall(() => call(client)).pipe(
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          const error = failure.cause;
          if (!(error instanceof StreamableHTTPError && error.code === 404)) return yield* failure;
          yield* this.#drop(token, client);
          const replacement = yield* this.#upstream(token);
          return yield* githubCall(() => call(replacement));
        }),
      ),
    );
  });

  readonly #upstream = Effect.fn("GitHubMcpProxy.upstream")(function* (
    this: GitHubMcpProxy,
    token: string,
  ): Effect.fn.Return<Client, GitHubOperationError> {
    let upstream = this.#upstreams.get(token);
    if (!upstream) {
      const client = new Client({ name: "openbot-github-proxy", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(this.#options.upstreamUrl), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      upstream = { client, ready: yield* Effect.cached(githubCall(() => client.connect(transport))) };
      this.#upstreams.set(token, upstream);
    }
    const current = upstream;
    yield* current.ready.pipe(Effect.tapError(() => this.#drop(token, current.client)));
    return current.client;
  });

  /** Closes `client` only while it is the client of `token`: a parallel call can have opened a new one. */
  readonly #drop = Effect.fn("GitHubMcpProxy.drop")(function* (this: GitHubMcpProxy, token: string, client: Client) {
    const upstream = this.#upstreams.get(token);
    if (upstream?.client !== client) return;
    this.#upstreams.delete(token);
    yield* githubCall(() => client.close()).pipe(Effect.catch(() => Effect.void));
  });

  #authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return false;
    const candidate = Buffer.from(header.slice("Bearer ".length));
    const secret = Buffer.from(this.#options.secret());
    return candidate.length === secret.length && timingSafeEqual(candidate, secret);
  }
}

function requestOptions(signal: AbortSignal): RequestOptions {
  return { signal, timeout: UPSTREAM_TIMEOUT_MS, resetTimeoutOnProgress: true };
}
