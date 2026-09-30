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
  userToken: () => Promise<string | null>;
  /** The bot token of `owner/name`, or null when the user token applies. */
  botToken: (owner: string, name: string) => string | null;
}

interface Upstream {
  client: Client;
  ready: Promise<void>;
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
  async start(preferredPort: number | null): Promise<number> {
    if (this.#port !== null) return this.#port;
    let server: HttpServer;
    try {
      server = await this.#listen(preferredPort ?? 0);
    } catch (error) {
      if (preferredPort === null) throw error;
      server = await this.#listen(0);
    }
    const address = server.address();
    if (!address || isString(address)) {
      server.close();
      throw new Error("The GitHub MCP proxy has no loopback port.");
    }
    this.#server = server;
    this.#port = address.port;
    return address.port;
  }

  /** Closes the upstream clients of tokens that no longer apply. */
  retain(tokens: ReadonlySet<string>): void {
    for (const [token, upstream] of this.#upstreams) {
      if (tokens.has(token)) continue;
      this.#upstreams.delete(token);
      void upstream.client.close().catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    this.retain(new Set());
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  #listen(port: number): Promise<HttpServer> {
    const server = createServer((request, response) => void this.#handle(request, response));
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve(server);
      });
    });
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
    const userToken = await this.#options.userToken();
    if (!userToken) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "github_not_connected" }));
      return;
    }
    const mcp = await this.#serverFor(userToken).catch((error: unknown) => {
      logger.warn("GitHub's MCP server could not be reached.", { cause: toLogValue(error) });
      return null;
    });
    if (!mcp) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "github_unreachable" }));
      return;
    }
    // No `sessionIdGenerator`: each POST is one stateless request.
    const transport = new StreamableHTTPServerTransport({});
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, await readJsonBody(request, MAX_BODY_BYTES));
    } catch {
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
    } finally {
      await transport.close().catch(() => undefined);
      await mcp.close().catch(() => undefined);
    }
  }

  /** The MCP server for one POST, with GitHub's instructions and capabilities. */
  async #serverFor(userToken: string): Promise<Server> {
    const user = await this.#upstream(userToken);
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
    const forward = <T>(token: string, call: (client: Client) => Promise<T>) => this.#call(token, call);
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
  }

  /** One call on the client of `token`. A session that GitHub ended opens again once. */
  async #call<T>(token: string, call: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.#upstream(token);
    try {
      return await call(client);
    } catch (error) {
      if (!(error instanceof StreamableHTTPError && error.code === 404)) throw error;
      this.#drop(token, client);
      return call(await this.#upstream(token));
    }
  }

  async #upstream(token: string): Promise<Client> {
    let upstream = this.#upstreams.get(token);
    if (!upstream) {
      const client = new Client({ name: "openbot-github-proxy", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(this.#options.upstreamUrl), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      upstream = { client, ready: client.connect(transport) };
      this.#upstreams.set(token, upstream);
    }
    try {
      await upstream.ready;
    } catch (error) {
      this.#drop(token, upstream.client);
      throw error;
    }
    return upstream.client;
  }

  /** Closes `client` only while it is the client of `token`: a parallel call can have opened a new one. */
  #drop(token: string, client: Client): void {
    const upstream = this.#upstreams.get(token);
    if (upstream?.client !== client) return;
    this.#upstreams.delete(token);
    void client.close().catch(() => undefined);
  }

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
