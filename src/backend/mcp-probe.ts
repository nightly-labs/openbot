import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { mcpEnvironment, type UsableMcpServer, usableMcpServer } from "./mcp-provider-shapes";
import { redactMcpSecrets } from "./mcp-redaction";

export const MCP_PROBE_TIMEOUT_MS = 10_000;

export interface McpProbeResult {
  toolCount: number;
  error: string | null;
}

/**
 * Tests one configuration, saved or not: connects, counts the tools, and disconnects.
 *
 * Only a user asking for it starts this. OpenBot does not test by itself, because a connection is
 * not free - an http server can want an OAuth sign-in, a cold `npx` can take longer than the
 * deadline below, and a server can do real work at startup. The answer is reported once and not
 * stored.
 */
export async function testMcpServer(
  config: McpServerConfig,
  timeoutMs = MCP_PROBE_TIMEOUT_MS,
): Promise<McpProbeResult> {
  // Nothing cancels a test from outside: it ends on its own within the deadline, and a child that
  // outlives its transport is killed below either way.
  const controller = new AbortController();
  return probeMcpServer(await usableMcpServer(config), controller.signal, timeoutMs);
}

/**
 * Connects to one already-resolved MCP server once, counts its tools, and disconnects.
 *
 * The providers make their own connections when an agent starts; a probe never becomes the
 * connection an agent talks to.
 */
export async function probeMcpServer(
  server: UsableMcpServer,
  signal: AbortSignal,
  timeoutMs = MCP_PROBE_TIMEOUT_MS,
): Promise<McpProbeResult> {
  const { config } = server;
  if (server.error) return { toolCount: 0, error: server.error };

  const client = new Client({ name: "openbot-probe", version: "1" }, { capabilities: {} });
  const transport = createTransport(server);
  try {
    const count = await withDeadline(
      (async () => {
        await client.connect(transport);
        const { tools } = await client.listTools();
        return tools.length;
      })(),
      signal,
      timeoutMs,
    );
    return { toolCount: count, error: null };
  } catch (error) {
    return { toolCount: 0, error: describeMcpError(error, config, timeoutMs) };
  } finally {
    await closeQuietly(client, transport);
  }
}

function createTransport(server: UsableMcpServer): Transport {
  const { config } = server;
  if (config.transport === "http") {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: Object.fromEntries(config.headers.map(({ key, value }) => [key, value])) },
    });
  }
  return new StdioClientTransport({
    command: server.command ?? config.command,
    args: config.args,
    ...(config.workingDirectory ? { cwd: config.workingDirectory } : {}),
    // The SDK default first, then the names the user asked to pass through, then the user's own
    // pairs. `envPassthrough` has no other meaning anywhere in OpenBot; this is where it is spent.
    env: {
      ...getDefaultEnvironment(),
      ...mcpEnvironment(config),
    },
    stderr: "pipe",
  });
}

function withDeadline<T>(work: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new McpTimeout(timeoutMs)), timeoutMs);
    const onAbort = () => reject(new Error("The connection was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * A child that ignores a closed stdin would otherwise outlive the panel that started it, so the
 * transport's own close is followed by a signal to its process.
 */
async function closeQuietly(client: Client, transport: Transport): Promise<void> {
  try {
    await client.close();
  } catch {
    // The transport is closed next either way.
  }
  try {
    await transport.close();
  } catch {
    // Nothing left to do: the process kill below is the last resort.
  }
  const pid = transport instanceof StdioClientTransport ? transport.pid : null;
  if (pid === null) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone, which is the outcome this wanted.
  }
}

class McpTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms.`);
  }
}

/** The failure, in the words the panel shows. Secrets are removed before the text leaves here. */
export function describeMcpError(error: unknown, config: McpServerConfig, timeoutMs: number): string {
  if (error instanceof McpTimeout) return `The server did not answer in ${Math.round(timeoutMs / 1000)} seconds.`;
  const status = httpStatus(error);
  if (status !== null) return `The server answered ${status}.`;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT")) return `Command not found: ${config.command}`;
  return redactMcpSecrets(message, config);
}

function httpStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  // `code` on an SDK transport error is the HTTP status; on a Node system error it is a string
  // such as `ECONNREFUSED`, which the number check below rejects.
  const code = isDynamicRecord(error) ? error.code : undefined;
  if (typeof code === "number" && code >= 100 && code < 600) return code;
  const match = /\b(4\d\d|5\d\d)\b/u.exec(error.message);
  return match ? Number(match[1]) : null;
}
