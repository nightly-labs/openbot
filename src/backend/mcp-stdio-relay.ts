import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import {
  CallToolResultSchema,
  ErrorCode,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCErrorResponse,
  type JSONRPCResultResponse,
  type RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { cliSpawnTarget } from "./cli";
import { MCP_TOOL_CALL_TIMEOUT_MS, type McpToolArguments, type McpToolCallResult } from "./mcp-probe";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";
import { endProcessGroupOnExit, PROVIDER_PROCESS_GROUP } from "./provider-process-group";

export interface StdioMcpLaunch {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  onStartAbandoned?: () => void;
}

export type RelayedMcpToolOutcome = { result: McpToolCallResult } | { error: string };

export interface StdioMcpRelay {
  url: string;
  token: string;
  close: () => Effect.Effect<void, ProviderClientOperationError>;
  callTool: (name: string, args: McpToolArguments) => Effect.Effect<RelayedMcpToolOutcome | null>;
}

type OwnAnswer = (answer: JSONRPCResultResponse | JSONRPCErrorResponse | null) => void;

interface RunningServer {
  child: ChildProcess;
  initialized: boolean;
  own: Map<RequestId, OwnAnswer>;
}

const STOP_GRACE_MS = 2_000;

const OUTPUT_DRAIN_MS = 1_000;

export const startStdioMcpRelay = Effect.fn("StdioMcpRelay.start")(function* (launch: StdioMcpLaunch) {
  const token = randomBytes(32).toString("base64url");
  const expected = Buffer.from(`Bearer ${token}`);
  const transports = new Set<StreamableHTTPServerTransport>();
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const children = new Set<ChildProcess>();
  const running: RunningServer[] = [];
  let closing = false;

  const authorized = (request: IncomingMessage) => {
    const header = Buffer.from(request.headers.authorization ?? "");
    return header.length === expected.length && timingSafeEqual(header, expected);
  };

  const open = () => {
    let child: ChildProcess | null = null;
    let live: RunningServer | null = null;
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
        const own = new Map<RequestId, OwnAnswer>();
        const started = startServer(launch, transport, pending, own);
        const entry: RunningServer = { child: started, initialized: false, own };
        const forget = () => {
          children.delete(started);
          const index = running.indexOf(entry);
          if (index >= 0) running.splice(index, 1);
        };
        children.add(started);
        running.push(entry);
        started.once("exit", forget);
        started.once("error", forget);
        child = started;
        live = entry;
      }
      if (isJSONRPCRequest(message)) pending.add(message.id);
      if (live && isJSONRPCNotification(message) && message.method === "notifications/initialized")
        live.initialized = true;
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

  const callTool = (name: string, args: McpToolArguments) =>
    Effect.callback<RelayedMcpToolOutcome | null>((resume, signal) => {
      const target = running.findLast((entry) => entry.initialized && entry.child.stdin?.writable === true);
      if (closing || !target) return resume(Effect.succeed(null));
      const id = `openbot-${randomBytes(12).toString("hex")}`;
      target.own.set(id, (answer) => {
        target.own.delete(id);
        resume(Effect.succeed(relayedOutcome(answer)));
      });
      target.child.stdin?.write(
        serializeMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
      );
      signal.addEventListener("abort", () => {
        if (!target.own.delete(id)) return;
        target.child.stdin?.write(
          serializeMessage({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } }),
        );
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: MCP_TOOL_CALL_TIMEOUT_MS,
        orElse: () =>
          Effect.succeed({
            error: sourceText("error.backend.mcpServerNoAnswer", { seconds: MCP_TOOL_CALL_TIMEOUT_MS / 1000 }),
          }),
      }),
    );

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
    callTool,
  } satisfies StdioMcpRelay;
});

function relayedOutcome(answer: JSONRPCResultResponse | JSONRPCErrorResponse | null): RelayedMcpToolOutcome {
  if (answer === null) return { error: sourceText("error.backend.mcpServerStoppedDuringCall") };
  if (!isJSONRPCResultResponse(answer)) return { error: answer.error.message };
  const decoded = CallToolResultSchema.safeParse(answer.result);
  return decoded.success ? { result: decoded.data } : { error: decoded.error.message };
}

function startServer(
  launch: StdioMcpLaunch,
  transport: StreamableHTTPServerTransport,
  pending: Set<RequestId>,
  own: Map<RequestId, OwnAnswer>,
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
    for (const answer of [...own.values()]) answer(null);
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
      if ((isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) && message.id !== undefined) {
        const ownAnswer = own.get(message.id);
        if (ownAnswer) {
          ownAnswer(message);
          continue;
        }
        pending.delete(message.id);
      }
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
