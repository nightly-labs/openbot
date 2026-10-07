import { type OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AccessDeniedError, UnauthorizedClientError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { causeHelpers } from "./effect-boundary";
import { type McpOAuthAuthority, type McpSignIn, secureOAuthFetch } from "./mcp-oauth-provider";
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
// SDK errors can quote credentials. Internal operations have no tracing spans; only the
// redacted McpProbeResult crosses the probe boundary.
export class McpProbeFailure extends Schema.TaggedError<McpProbeFailure>()("McpProbeFailure", {
  cause: Schema.Defect(),
}) {}

const { io: probeIo, rewrap: toMcpProbeFailure } = causeHelpers(McpProbeFailure);

export const testMcpServer = Effect.fnUntraced(function* (
  config: McpServerConfig,
  timeoutMs = MCP_PROBE_TIMEOUT_MS,
  tools: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES,
  oauth?: McpOAuthAuthority,
) {
  clearMcpCommandCache();
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => (config.transport === "http" ? (oauth?.signIn(config.url) ?? null) : null)),
    (signIn) =>
      Effect.gen(function* () {
        const server = yield* usableMcpServer(
          config,
          tools,
          oauth ? (subject) => oauth.accessToken(subject.url) : undefined,
        );
        return yield* probeMcpServerEffect(server, timeoutMs, signIn);
      }),
    (signIn) => Effect.sync(() => signIn?.abandon()),
  );
});

/** Connect, count, and close; a requested OAuth sign-in gets one fresh connection. */
const probeMcpServerEffect = Effect.fnUntraced(function* (
  server: UsableMcpServer,
  timeoutMs: number,
  signIn: McpSignIn | null,
): Effect.fn.Return<McpProbeResult> {
  const { config } = server;
  if (server.error !== undefined) return { toolCount: 0, error: boundedError(server.error) };
  const failure = (error: unknown): McpProbeResult => {
    const refused = signIn?.registrationFailed() && isRegistrationRefusal(error);
    const described = refused ? REGISTRATION_REFUSED : describeMcpError(error, config, timeoutMs);
    return { toolCount: 0, error: boundedError(redactMcpValues(described, probeSecrets(server, signIn))) };
  };
  const first = yield* Effect.result(connectAndCountEffect(server, timeoutMs, signIn?.provider));
  if (Result.isSuccess(first)) return { toolCount: first.success, error: null };
  if (!signIn || !(first.failure.cause instanceof UnauthorizedError)) return failure(first.failure.cause);
  // The person's sign-in has its own deadline; the retried connection gets a fresh transport.
  const retry = yield* Effect.result(
    signIn
      .complete()
      .pipe(toMcpProbeFailure, Effect.andThen(connectAndCountEffect(server, timeoutMs, signIn.provider))),
  );
  return Result.isFailure(retry) ? failure(retry.failure.cause) : { toolCount: retry.success, error: null };
});

/**
 * Every secret this probe could have sent.
 *
 * `server.authorization` is the one read before the connection, and on a first sign-in it is
 * `null`: the credentials the retry spends are minted in between, by the sign-in itself. The
 * sign-in keeps its own ledger of them - the access and refresh tokens, the client secret, the
 * authorization code and the PKCE verifier - because a token endpoint states a refusal in
 * `error_description`, the SDK makes that text the error it throws, and a server that quotes back
 * what it rejected would otherwise put that value on the panel. The ledger is used rather than the
 * stored record because a recoverable refusal clears the record first.
 */
function probeSecrets(server: UsableMcpServer, signIn: McpSignIn | null): string[] {
  const values = server.authorization ? [server.authorization] : [];
  return [...values, ...(signIn?.secrets() ?? [])];
}

/** One connection, from the handshake to the tool count, closed again whatever it answered. */
const connectAndCountEffect = Effect.fnUntraced(function* (
  server: ResolvedMcpServer,
  timeoutMs: number,
  authProvider: OAuthClientProvider | undefined,
) {
  return yield* Effect.acquireUseRelease(
    Effect.try({
      try: () => ({
        client: new Client({ name: "openbot-probe", version: "1" }, { capabilities: {} }),
        transport: createTransport(server, authProvider),
      }),
      catch: (cause) => new McpProbeFailure({ cause }),
    }),
    ({ client, transport }) =>
      Effect.gen(function* () {
        yield* probeIo((signal) => client.connect(transport, { signal }));
        return yield* countToolsEffect(client);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(new McpProbeFailure({ cause: new McpTimeout(timeoutMs) })),
        }),
      ),
    ({ client, transport }) => closeQuietlyEffect(client, transport),
  );
});

/** Count all pages within the connection deadline, without repeating a cursor. */
const countToolsEffect = Effect.fnUntraced(function* (client: Client) {
  const seen = new Set<string>();
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = yield* probeIo((signal) =>
      client.listTools(cursor === undefined ? undefined : { cursor }, { signal }),
    );
    count += page.tools.length;
    if (count >= INPUT_LIMITS.mcpToolCount) return INPUT_LIMITS.mcpToolCount;
    cursor = page.nextCursor;
    if (cursor === undefined || seen.has(cursor)) return count;
    seen.add(cursor);
  }
});

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
    /*
     * The transport does OAuth of its own: a 401 on a token this probe believed was still valid
     * makes it call `auth()` through its own fetch, which spends the refresh token and the client
     * secret at the discovered endpoint. That is the same exchange the explicit paths guard, so it
     * gets the same fetch - without it a discovery document could name a plain-text token endpoint
     * and this one request would still honour it. A provider is only attached to a URL that already
     * passed `normalizeResource`, so the guard refuses nothing this probe could otherwise reach.
     */
    return new StreamableHTTPClientTransport(new URL(config.url), {
      ...(authProvider ? { authProvider, fetch: secureOAuthFetch() } : {}),
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

/** Close both SDK resources and kill a stdio child if it survives transport close. */
const closeQuietlyEffect = Effect.fnUntraced(function* (client: Client, transport: Transport) {
  yield* probeIo(() => client.close()).pipe(Effect.catch(() => Effect.void));
  yield* probeIo(() => transport.close()).pipe(Effect.catch(() => Effect.void));
  const pid = transport instanceof StdioClientTransport ? transport.pid : null;
  if (pid === null) return;
  yield* Effect.try({ try: () => process.kill(pid, "SIGKILL"), catch: (cause) => new McpProbeFailure({ cause }) }).pipe(
    Effect.catch(() => Effect.void),
  );
});

class McpTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms.`);
  }
}

/** The failure, in the words the panel shows. Secrets are removed before the text leaves here. */
export function describeMcpError(error: unknown, config: McpServerConfig, timeoutMs: number): string {
  if (error instanceof McpTimeout)
    return sourceText("error.backend.mcpServerNoAnswer", { seconds: Math.round(timeoutMs / 1000) });
  // Only a sign-in reaches this: without an `authProvider` the transport reports the raw 401 below.
  if (error instanceof UnauthorizedError) return sourceText("error.backend.mcpSignInNotAccepted");
  const status = httpStatus(error);
  if (status !== null) return httpStatusMessage(status);
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT")) return sourceText("error.backend.mcpCommandNotFound", { command: config.command });
  return redactMcpSecrets(message, config);
}

/**
 * A refused registration is the service's choice, not the user's credentials: Figma, for one,
 * registers only the MCP clients it approved. "Try again" and the API key cannot change it.
 */
const REGISTRATION_REFUSED = sourceText("error.backend.mcpRegistrationRefused");

function isAccessRefusal(status: number | null): boolean {
  return status === 401 || status === 403;
}

/**
 * The SDK keeps the status only when the refusal body is not an OAuth error. A body such as
 * `{"error":"access_denied"}` arrives as its error class, with the status gone.
 */
function isRegistrationRefusal(error: unknown): boolean {
  if (error instanceof AccessDeniedError || error instanceof UnauthorizedClientError) return true;
  return isAccessRefusal(httpStatus(error));
}

/** What the user can change. A link from a service such as Composio stops working when it is deleted. */
function httpStatusMessage(status: number): string {
  if (isAccessRefusal(status)) return sourceText("error.backend.mcpServerHttpCredentials", { status });
  if (status === 404 || status === 410) return sourceText("error.backend.mcpServerHttpUrl", { status });
  return `The server answered ${status}.`;
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
