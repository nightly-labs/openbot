import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { Effect } from "effect";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";
import { endProcessGroupOnExit, PROVIDER_PROCESS_GROUP } from "./provider-process-group";

/** A stdio MCP server as its provider would start it. */
export interface StdioMcpLaunch {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
}

export interface StdioMcpRelay {
  url: string;
  /** The bearer token of `url`. A secret: the provider logs must not show it. */
  token: string;
  close: () => Effect.Effect<void, ProviderClientOperationError>;
}

/** How long a server gets after its stdin closes and SIGTERM, before SIGKILL, as Pi gives it. */
const STOP_GRACE_MS = 2_000;

/**
 * Starts a stdio MCP server in OpenBot's process and serves it to one provider over Streamable HTTP
 * on 127.0.0.1, with a bearer token.
 *
 * A Workspace only provider runs in a sandbox, and the MCP servers that it starts run in that
 * sandbox too. The sandbox lets them write only in the workspace, so `npx` cannot write its cache in
 * `~/.npm` and the server does not start (#6191). The Access setting does not limit MCP servers, as
 * for Claude and Codex, so the provider gets this URL in place of the command.
 *
 * Each client session starts its own server process at its first message, and the session ends with
 * that process: the client then gets a 404 and starts a new session, as after a dropped connection.
 * Messages pass unchanged in both directions. A response goes to the request with its id; a request
 * or notification of the server goes to the client's GET stream.
 */
export const startStdioMcpRelay = Effect.fn("StdioMcpRelay.start")(function* (launch: StdioMcpLaunch) {
  const token = randomBytes(32).toString("base64url");
  const expected = Buffer.from(`Bearer ${token}`);
  const transports = new Set<StreamableHTTPServerTransport>();
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  /** The server processes that have not exited. `close` waits for them, as a provider stop waits for its own. */
  const children = new Set<ChildProcess>();

  const authorized = (request: IncomingMessage) => {
    const header = Buffer.from(request.headers.authorization ?? "");
    return header.length === expected.length && timingSafeEqual(header, expected);
  };

  const open = () => {
    let child: ChildProcess | null = null;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomBytes(16).toString("hex"),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });
    transports.add(transport);
    transport.onmessage = (message) => {
      if (!child) {
        const started = startServer(launch, transport);
        children.add(started);
        // A command that cannot start has no process id and sends `error`, not always `exit`.
        started.once("exit", () => children.delete(started));
        started.once("error", () => children.delete(started));
        child = started;
      }
      child.stdin?.write(serializeMessage(message));
    };
    transport.onclose = () => {
      transports.delete(transport);
      if (transport.sessionId) sessions.delete(transport.sessionId);
      if (child) void stopServer(child);
    };
    return transport;
  };

  const handle = (request: IncomingMessage, response: ServerResponse) => {
    if (!authorized(request)) {
      response.writeHead(401).end();
      return;
    }
    const id = request.headers["mcp-session-id"];
    const existing = typeof id === "string" ? sessions.get(id) : undefined;
    if (typeof id === "string" && !existing) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found" } }));
      return;
    }
    const transport = existing ?? open();
    void transport
      .handleRequest(request, response)
      .catch(() => {
        if (!response.headersSent) response.writeHead(500).end();
      })
      .finally(() => {
        // A first request that was not `initialize` made no session.
        if (!existing && !transport.sessionId) void transport.close();
      });
  };

  const server = createServer(handle);
  yield* providerCall(
    () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    return yield* Effect.fail(providerFailure(new Error("The MCP server relay has no port.")));
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    close: () =>
      providerCall(async () => {
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        server.closeAllConnections();
        await Promise.all([...transports].map((transport) => transport.close().catch(() => undefined)));
        await Promise.all([...children].map(stopServer));
        await closed;
      }),
  } satisfies StdioMcpRelay;
});

/** The server process of one session. Its exit ends the session. */
function startServer(launch: StdioMcpLaunch, transport: StreamableHTTPServerTransport): ChildProcess {
  const child = spawn(launch.command, [...launch.args], {
    ...(launch.cwd ? { cwd: launch.cwd } : {}),
    env: launch.env,
    stdio: ["pipe", "pipe", "ignore"],
    detached: PROVIDER_PROCESS_GROUP,
  });
  endProcessGroupOnExit(child);
  const buffer = new ReadBuffer();
  const end = () => void transport.close().catch(() => undefined);
  child.stdout?.on("data", (chunk: Buffer) => {
    try {
      buffer.append(chunk);
    } catch {
      end();
      return;
    }
    for (;;) {
      let message: ReturnType<ReadBuffer["readMessage"]>;
      try {
        message = buffer.readMessage();
      } catch {
        // A line that is not JSON-RPC, such as a log line, is skipped, as the SDK's stdio client does.
        continue;
      }
      if (!message) break;
      void transport.send(message).catch(() => undefined);
    }
  });
  child.stdin?.on("error", () => undefined);
  child.once("error", end);
  child.once("exit", end);
  return child;
}

/**
 * Closes stdin and sends SIGTERM, then SIGKILL to the group after the grace. Ends when the process
 * exits. `endProcessGroupOnExit` then stops the rest of its group.
 */
function stopServer(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => {
      try {
        process.kill(PROVIDER_PROCESS_GROUP ? -pid : pid, "SIGKILL");
      } catch {
        /* The process already exited. */
      }
    }, STOP_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.stdin?.end();
    child.kill("SIGTERM");
  });
}
