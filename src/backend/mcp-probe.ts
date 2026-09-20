import { type OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { McpOAuthAuthority, McpSignIn } from "./mcp-oauth-provider";
import {
  clearMcpCommandCache,
  type McpToolRuntimes,
  mcpHandoffHeaders,
  mcpLaunchEnvironment,
  NO_MCP_TOOL_RUNTIMES,
  type ResolvedMcpServer,
  type UsableMcpServer,
  usableMcpServer,
} from "./mcp-provider-shapes";
import { redactMcpSecrets, redactMcpValues } from "./mcp-redaction";

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
  tools: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES,
  oauth?: McpOAuthAuthority,
): Promise<McpProbeResult> {
  // The user is asking about now, usually straight after installing the thing that was missing, so
  // no command keeps an answer from earlier in this run. Only a test does this: a hand-off wants
  // the answer the probe gave, or the panel and the agent would describe two different servers.
  clearMcpCommandCache();
  // Nothing cancels a test from outside: it ends on its own within the deadline, and a child that
  // outlives its transport is killed below either way.
  const controller = new AbortController();
  /*
   * A sign-in is offered only here, and only for an http server. This is the one path a person is
   * waiting on: at a thread start the same 401 has to stay silent, because a browser window nobody
   * asked for arriving in the middle of an answer is worse than a tool that says it is not signed in.
   */
  const signIn = config.transport === "http" ? (oauth?.signIn(config.url) ?? null) : null;
  try {
    return await probeMcpServer(
      await usableMcpServer(config, tools, oauth ? (subject) => oauth.accessToken(subject.url) : undefined),
      controller.signal,
      timeoutMs,
      signIn,
    );
  } finally {
    signIn?.abandon();
  }
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
  signIn: McpSignIn | null = null,
): Promise<McpProbeResult> {
  const { config } = server;
  // `!== undefined`, not truthiness: the resolved arm declares `error?: undefined`, and only the
  // explicit comparison narrows this union to the arm `connectAndCount` below is given.
  if (server.error !== undefined) return { toolCount: 0, error: boundedError(server.error) };

  /*
   * The token is minted for this connection and never written to the row, so `describeMcpError`,
   * which reads the configuration, cannot know it. A transport reports a failure by quoting what it
   * sent, and this is the one reader that would otherwise put a bearer token on the user's screen.
   */
  const failure = async (error: unknown): Promise<McpProbeResult> => ({
    toolCount: 0,
    error: boundedError(
      redactMcpValues(describeMcpError(error, config, timeoutMs), await probeSecrets(server, signIn)),
    ),
  });

  try {
    return { toolCount: await connectAndCount(server, signal, timeoutMs, signIn?.provider), error: null };
  } catch (error) {
    if (!signIn || !(error instanceof UnauthorizedError)) return failure(error);
    /*
     * The browser is open on the server's own page. The deadline above measures the connection and
     * not the person, so the wait for the grant is the sign-in's own and much longer; the second
     * attempt is a fresh transport, because the first one has already been closed by its failure.
     */
    try {
      await signIn.complete();
      return { toolCount: await connectAndCount(server, signal, timeoutMs, signIn.provider), error: null };
    } catch (retry) {
      return failure(retry);
    }
  }
}

/**
 * Every bearer token this probe could have sent.
 *
 * `server.authorization` is the one read before the connection, and on a first sign-in it is
 * `null`: the token the retry spends is minted in between, by the sign-in itself. Asking the
 * provider for it after the failure is what keeps a server that quotes the credential it refused
 * from putting that credential on the panel.
 */
async function probeSecrets(server: UsableMcpServer, signIn: McpSignIn | null): Promise<string[]> {
  const values = server.authorization ? [server.authorization] : [];
  const minted = await signIn?.provider.tokens();
  if (minted?.access_token) values.push(minted.access_token);
  return values;
}

/** One connection, from the handshake to the tool count, closed again whatever it answered. */
async function connectAndCount(
  server: ResolvedMcpServer,
  signal: AbortSignal,
  timeoutMs: number,
  authProvider: OAuthClientProvider | undefined,
): Promise<number> {
  const client = new Client({ name: "openbot-probe", version: "1" }, { capabilities: {} });
  const transport = createTransport(server, authProvider);
  try {
    return await withDeadline(
      (async () => {
        await client.connect(transport);
        return await countTools(client);
      })(),
      signal,
      timeoutMs,
    );
  } finally {
    await closeQuietly(client, transport);
  }
}

/**
 * Every tool the server offers, not the first page of them.
 *
 * A server with many tools answers `tools/list` one page at a time, and the number on the row is an
 * answer to "what would an agent get". The deadline around this call bounds the walk; a cursor that
 * repeats, and the count the panel can carry, end it as well.
 */
async function countTools(client: Client): Promise<number> {
  const seen = new Set<string>();
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await client.listTools(cursor === undefined ? undefined : { cursor });
    count += page.tools.length;
    if (count >= INPUT_LIMITS.mcpToolCount) return INPUT_LIMITS.mcpToolCount;
    cursor = page.nextCursor;
    if (cursor === undefined || seen.has(cursor)) return count;
    seen.add(cursor);
  }
}

/**
 * The failure text, held to the length the IPC decoder and the remote codec accept.
 *
 * A server can answer with a whole diagnostic, and a command name is allowed to be longer than this
 * on its own. An over-long text is rejected on the way to the panel, which would replace the
 * connection failure the user asked about with a decoding failure.
 */
function boundedError(text: string): string {
  if (text.length <= INPUT_LIMITS.mcpErrorText) return text;
  return `${text.slice(0, INPUT_LIMITS.mcpErrorText - 1)}…`;
}

function createTransport(server: ResolvedMcpServer, authProvider?: OAuthClientProvider): Transport {
  const { config } = server;
  if (config.transport === "http") {
    /*
     * The `authProvider` is what turns a 401 into a sign-in instead of a sentence. Without one the
     * transport reports the refusal, which is what a server with a pasted key should do.
     *
     * With one, the stored token is left out of `requestInit`: a header written there wins over the
     * one the provider adds, so a token the provider has just refreshed would lose to the value this
     * probe read a moment before the refusal.
     */
    const headers = authProvider
      ? Object.fromEntries(config.headers.map(({ key, value }) => [key, value]))
      : mcpHandoffHeaders(server);
    return new StreamableHTTPClientTransport(new URL(config.url), {
      ...(authProvider ? { authProvider } : {}),
      requestInit: { headers },
    });
  }
  return new StdioClientTransport({
    command: server.command ?? config.command,
    args: config.args,
    // The resolved directory, not the stored one: process creation does not expand a leading `~`,
    // which the form's own example uses.
    ...(server.workingDirectory ? { cwd: server.workingDirectory } : {}),
    // The SDK default first, then this user's own `PATH`, the names the user asked to pass through,
    // and the user's own pairs. `envPassthrough` has no other meaning anywhere in OpenBot; this is
    // where it is spent. The launch environment is the providers' as well, so what the panel tests
    // is what an agent starts.
    env: {
      ...getDefaultEnvironment(),
      ...mcpLaunchEnvironment(server),
    },
    // Discarded, not piped. Nothing here reads that pipe, so a server that writes its startup log to
    // stderr - which a Rust or Python server does with a blocking write - fills the 64 KB buffer and
    // stops before it answers the handshake. The probe would report a timeout for a working server.
    stderr: "ignore",
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
  // Only a sign-in reaches this: without an `authProvider` the transport reports the raw 401 below.
  if (error instanceof UnauthorizedError) return "The server did not accept that sign-in.";
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
