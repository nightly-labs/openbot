import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import {
  ErrorCode,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { cliSpawnTarget } from "./cli";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";
import { endProcessGroupOnExit, PROVIDER_PROCESS_GROUP } from "./provider-process-group";

export interface StdioMcpLaunch {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  onStartAbandoned?: () => void;
}

export interface StdioMcpRelay {
  url: string;
  token: string;
  close: () => Effect.Effect<void, ProviderClientOperationError>;
}

const STOP_GRACE_MS = 2_000;

const OUTPUT_DRAIN_MS = 1_000;

export const startStdioMcpRelay = Effect.fn("StdioMcpRelay.start")(function* (launch: StdioMcpLaunch) {
  const token = randomBytes(32).toString("base64url");
  const expected = Buffer.from(`Bearer ${token}`);
  const transports = new Set<StreamableHTTPServerTransport>();
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const children = new Set<ChildProcess>();
  let closing = false;

  const authorized = (request: IncomingMessage) => {
    const header = Buffer.from(request.headers.authorization ?? "");
    return header.length === expected.length && timingSafeEqual(header, expected);
  };

  const open = () => {
    let child: ChildProcess | null = null;
    const pending = new Set<RequestId>();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomBytes(16).toString("hex"),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });
    transports.add(transport);
    transport.onmessage = (message) => {
      if (!child) {
        const started = startServer(launch, transport, pending);
        children.add(started);
        started.once("exit", () => children.delete(started));
        started.once("error", () => children.delete(started));
        child = started;
      }
      if (isJSONRPCRequest(message)) pending.add(message.id);
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
    if (!existing)
      response.once("close", () => {
        if (response.writableFinished || closing) return;
        launch.onStartAbandoned?.();
        void transport.close().catch(() => undefined);
      });
    void transport
      .handleRequest(request, response)
      .catch(() => {
        if (!response.headersSent) response.writeHead(500).end();
      })
      .finally(() => {
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
        closing = true;
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        server.closeAllConnections();
        await Promise.all([...transports].map((transport) => transport.close().catch(() => undefined)));
        await Promise.all([...children].map(stopServer));
        await closed;
      }),
  } satisfies StdioMcpRelay;
});

function startServer(
  launch: StdioMcpLaunch,
  transport: StreamableHTTPServerTransport,
  pending: Set<RequestId>,
): ChildProcess {
  const target = cliSpawnTarget(launch.command, launch.args);
  const child = spawn(target.command, target.args, {
    ...(launch.cwd ? { cwd: launch.cwd } : {}),
    env: launch.env,
    stdio: ["pipe", "pipe", "ignore"],
    detached: PROVIDER_PROCESS_GROUP,
    windowsVerbatimArguments: target.windowsVerbatimArguments,
    windowsHide: true,
  });
  endProcessGroupOnExit(child);
  const buffer = new ReadBuffer();
  const end = () => {
    const message = sourceText("error.backend.mcpServerStoppedDuringCall");
    const answers = [...pending].map((id) =>
      transport.send({ jsonrpc: "2.0", id, error: { code: ErrorCode.InternalError, message } }).catch(() => undefined),
    );
    pending.clear();
    void Promise.all(answers)
      .then(() => transport.close())
      .catch(() => undefined);
  };
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
        continue;
      }
      if (!message) break;
      if ((isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) && message.id !== undefined)
        pending.delete(message.id);
      void transport.send(message).catch(() => undefined);
    }
  });
  child.stdin?.on("error", () => undefined);
  child.once("error", end);
  child.once("exit", () => {
    const stdout = child.stdout;
    if (!stdout || stdout.readableEnded || stdout.destroyed) return end();
    const drained = () => {
      clearTimeout(limit);
      end();
    };
    const limit = setTimeout(drained, OUTPUT_DRAIN_MS);
    stdout.once("end", drained);
    stdout.once("close", drained);
  });
  return child;
}

function stopServer(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => {
      try {
        process.kill(PROVIDER_PROCESS_GROUP ? -pid : pid, "SIGKILL");
      } catch {}
    }, STOP_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.stdin?.end();
    child.kill("SIGTERM");
  });
}
