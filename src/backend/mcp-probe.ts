import { basename } from "node:path";
import { type OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AccessDeniedError, UnauthorizedClientError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { causeHelpers } from "./effect-boundary";
import {
  isLoopback,
  type McpOAuthAuthority,
  type McpSignIn,
  normalizeResource,
  secureOAuthFetch,
} from "./mcp-oauth-provider";
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

/**
 * Where the person who could finish a sign-in is, for a test that cannot open a browser itself.
 * `here`: on this computer, one Sign in away. `host`: a remote caller, whose host must sign in.
 * `null`: nobody asked, and the server's refusal is reported as it is.
 */
export type McpSignInPlace = "here" | "host";

export const testMcpServer = Effect.fnUntraced(function* (
  config: McpServerConfig,
  timeoutMs = MCP_PROBE_TIMEOUT_MS,
  tools: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES,
  oauth?: Pick<McpOAuthAuthority, "accessToken" | "signIn">,
  signInPlace: McpSignInPlace | null = null,
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
        return yield* probeMcpServerEffect(server, timeoutMs, signIn, signInPlace);
      }),
    (signIn) => Effect.sync(() => signIn?.abandon()),
  );
});

/** The last refusal an http server answered a connection without a sign-in provider. */
interface McpChallenge {
  status: number;
  /** Whether `WWW-Authenticate` names the Bearer scheme, which is what an OAuth server asks for. */
  bearer: boolean;
  /** Where the request ended up after any redirect. */
  url: string;
}

/** Connect, count, and close; a requested OAuth sign-in gets one fresh connection. */
const probeMcpServerEffect = Effect.fnUntraced(function* (
  server: UsableMcpServer,
  timeoutMs: number,
  signIn: McpSignIn | null,
  signInPlace: McpSignInPlace | null,
): Effect.fn.Return<McpProbeResult> {
  const { config } = server;
  if (server.error !== undefined) return { toolCount: 0, error: boundedError(server.error) };
  const seen: { challenge: McpChallenge | null } = { challenge: null };
  const record = (next: McpChallenge) => {
    seen.challenge = next;
  };
  const failure = (error: unknown): McpProbeResult => {
    const described = describeProbeFailure(error, config, timeoutMs, signIn, seen.challenge, signInPlace);
    return { toolCount: 0, error: boundedError(redactMcpValues(described, probeSecrets(server, signIn))) };
  };
  const startedAt = Date.now();
  const first = yield* Effect.result(connectAndCountEffect(server, timeoutMs, signIn?.provider, record));
  if (Result.isSuccess(first)) return { toolCount: first.success, error: null };
  // A server on the 2025-03 MCP authorization spec answers 401 with no challenge at all; its OAuth
  // metadata at the origin is what says a sign-in, not a key, is wanted. Only a refusal the sentence
  // would explain is followed up, and only public documents are read: no credential is sent.
  const unexplained = seen.challenge;
  if (!signIn && signInPlace !== null && unexplained?.status === 401 && !unexplained.bearer)
    // The same Test deadline covers the lookup: it gets only the time the connection left.
    seen.challenge = {
      ...unexplained,
      bearer: yield* advertisesOAuth(config.url, timeoutMs - (Date.now() - startedAt)),
    };
  if (!signIn || !(first.failure.cause instanceof UnauthorizedError)) return failure(first.failure.cause);
  // The person's sign-in has its own deadline; the retried connection gets a fresh transport.
  const retry = yield* Effect.result(
    signIn
      .complete()
      .pipe(toMcpProbeFailure, Effect.andThen(connectAndCountEffect(server, timeoutMs, signIn.provider, record))),
  );
  return Result.isFailure(retry) ? failure(retry.failure.cause) : { toolCount: retry.success, error: null };
});

/**
 * The sentence for a failed probe, before secrets are removed.
 *
 * The SDK reports a token the server refused right after a sign-in as a bare 401, which would read
 * as "check the API key" to someone who has just signed in. And a server that answers a Bearer
 * challenge to a probe that could not sign in wants a sign-in, not a key: that is what Granola
 * answers, and the header fields alone gave the user no way forward.
 */
function describeProbeFailure(
  error: unknown,
  config: McpServerConfig,
  timeoutMs: number,
  signIn: McpSignIn | null,
  challenge: McpChallenge | null,
  signInPlace: McpSignInPlace | null,
): string {
  if (signIn?.cancelled()) return sourceText("error.backend.mcpSignInCancelled");
  if (signIn?.registrationFailed() && isRegistrationRefusal(error)) return REGISTRATION_REFUSED;
  if (signIn && httpStatus(error) === 401) return sourceText("error.backend.mcpSignInNotAccepted");
  // A key the user pasted into a header is theirs to fix; the sign-in would not replace it.
  if (challenge?.status === 401 && challenge.bearer && !hasAuthorizationHeader(config)) {
    const described = describeSignInChallenge(config.url, challenge.url, signInPlace);
    if (described) return described;
  }
  return describeMcpError(error, config, timeoutMs);
}

/**
 * What to say to a server that wants an OAuth sign-in the probe could not start, or `null` when
 * nobody asked and the refusal is reported as it is.
 *
 * A plain-http address is not upgraded behind the user's back: the agents reach the server at the
 * address the row holds, so a test that passed over https would hide that every agent still fails.
 * The sentence names the https address instead, without its query, which can carry a key.
 */
export function describeSignInChallenge(url: string, finalUrl: string, place: McpSignInPlace | null): string | null {
  if (place === null) return null;
  if (!normalizeResource(url))
    return sourceText("error.backend.mcpSignInNeedsHttps", { url: httpsAddress(finalUrl, url) });
  return place === "host" ? sourceText("error.backend.mcpSignInOnHost") : sourceText("error.backend.mcpSignInRequired");
}

/** The https form of the address a redirect reached, or of the one the user typed. */
function httpsAddress(finalUrl: string, url: string): string {
  const target = URL.canParse(finalUrl) && finalUrl.startsWith("https:") ? new URL(finalUrl) : new URL(url);
  target.protocol = "https:";
  target.search = "";
  target.hash = "";
  return target.toString();
}

function hasAuthorizationHeader(config: McpServerConfig): boolean {
  return config.headers.some(({ key }) => key.trim().toLowerCase() === "authorization");
}

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
  onChallenge: (challenge: McpChallenge) => void,
) {
  return yield* Effect.acquireUseRelease(
    Effect.try({
      try: () => ({
        client: new Client({ name: "openbot-probe", version: "1" }, { capabilities: {} }),
        transport: createTransport(server, authProvider, onChallenge),
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

function createTransport(
  server: ResolvedMcpServer,
  authProvider: OAuthClientProvider | undefined,
  onChallenge: (challenge: McpChallenge) => void,
): Transport {
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
      fetch: authProvider ? secureOAuthFetch() : challengeRecordingFetch(onChallenge),
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

/**
 * The platform fetch, noting each refusal on the way past. Without a sign-in provider the SDK keeps
 * only the status of a refusal, and the `WWW-Authenticate` header is what tells a server that wants
 * an OAuth sign-in apart from one that wants a key.
 */
function challengeRecordingFetch(onChallenge: (challenge: McpChallenge) => void): FetchLike {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401 || response.status === 403) {
      onChallenge({
        status: response.status,
        // `Headers.get` joins several challenges with commas, so Bearer may follow another scheme.
        bearer: /(?:^|,)\s*bearer\b/iu.test(response.headers.get("www-authenticate") ?? ""),
        url: response.url || input.toString(),
      });
    }
    return response;
  };
}

/** Whether the server's origin publishes OAuth metadata, read without any credential. */
const advertisesOAuth = Effect.fnUntraced(function* (url: string, remainingMs: number) {
  if (remainingMs <= 0) return false;
  const { origin } = new URL(url);
  const lookups = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"].map((path) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(`${origin}${path}`, { signal, headers: { accept: "application/json" } });
        await response.body?.cancel();
        return response.ok && (response.headers.get("content-type") ?? "").includes("json");
      },
      catch: (cause) => new McpProbeFailure({ cause }),
    }).pipe(Effect.catch(() => Effect.succeed(false))),
  );
  const found = yield* Effect.all(lookups, { concurrency: "unbounded" }).pipe(
    Effect.timeoutOrElse({ duration: remainingMs, orElse: () => Effect.succeed([false]) }),
  );
  return found.some(Boolean);
});

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
  const described = describeMcpErrorText(error, config, timeoutMs);
  // A bridge that never answers is the case the native connection replaces: say where to go.
  const bridgeUrl = mcpRemoteBridgeUrl(config);
  if (bridgeUrl === null || !(error instanceof McpTimeout || isConnectionClosed(error))) return described;
  return sourceText("error.backend.mcpRemoteBridge", { reason: described, url: bridgeUrl });
}

function describeMcpErrorText(error: unknown, config: McpServerConfig, timeoutMs: number): string {
  if (error instanceof McpTimeout)
    return sourceText("error.backend.mcpServerNoAnswer", { seconds: Math.round(timeoutMs / 1000) });
  // Only a sign-in reaches this: without an `authProvider` the transport reports the raw 401 below.
  if (error instanceof UnauthorizedError) return sourceText("error.backend.mcpSignInNotAccepted");
  // The child exited before the handshake: the process failed to start, not the network.
  if (config.transport === "stdio" && isConnectionClosed(error)) return sourceText("error.backend.mcpServerExited");
  const status = httpStatus(error);
  if (config.transport === "http") {
    const described = describeConnectionFailure(error, status, config.url);
    if (described) return described;
  }
  if (status !== null) return httpStatusMessage(status);
  if (config.transport === "http" && isNetworkFailure(error)) return sourceText("error.backend.mcpServerUnreachable");
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT")) return sourceText("error.backend.mcpCommandNotFound", { command: config.command });
  return redactMcpSecrets(message, config);
}

/**
 * The address an `mcp-remote` bridge forwards to, as origin and path, or `null` when the command
 * is not that bridge. Covers `npx mcp-remote <url>`, `mcp-remote@<version>` and an installed
 * `mcp-remote` binary.
 */
function mcpRemoteBridgeUrl(config: McpServerConfig): string | null {
  if (config.transport !== "stdio") return null;
  const words = [basename(config.command), ...config.args];
  const bridge = words.findIndex((word) => /^mcp-remote(@\S*)?$/u.test(word.trim()));
  if (bridge === -1) return null;
  for (const word of words.slice(bridge + 1)) {
    if (!URL.canParse(word.trim())) continue;
    const url = new URL(word.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return `${url.origin}${url.pathname}`;
  }
  return null;
}

function isConnectionClosed(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.ConnectionClosed;
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
]);

/** A request that never reached a server: Node's fetch rejects with `fetch failed` and the system code as the cause. */
function isNetworkFailure(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 4; current = current.cause, depth++) {
    const code = isDynamicRecord(current) ? current.code : undefined;
    if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return true;
    if (current instanceof TypeError && current.message === "fetch failed") return true;
  }
  return false;
}

/**
 * What an http connection that failed below MCP says, or `null` for the general sentences.
 *
 * A local server, such as the one in the Figma desktop app, refuses the connection while it is
 * turned off, and "check your network" sends the user the wrong way. Something that answers but
 * not in MCP over Streamable HTTP - a web page, a closed socket, another protocol - is told apart
 * from a server that is not there.
 */
function describeConnectionFailure(error: unknown, status: number | null, url: string): string | null {
  if (status === 405) return sourceText("error.backend.mcpServerIncompatible");
  for (let current = error, depth = 0; current instanceof Error && depth < 4; current = current.cause, depth++) {
    const code = isDynamicRecord(current) ? current.code : undefined;
    if (code === "ECONNREFUSED" && URL.canParse(url) && isLoopback(new URL(url).hostname))
      return sourceText("error.backend.mcpLocalServerOff", { address: new URL(url).origin });
    if (code === "EACCES" || code === "EPERM") return sourceText("error.backend.mcpServerBlocked");
    if (isProtocolMismatch(current, code)) return sourceText("error.backend.mcpServerIncompatible");
  }
  return null;
}

/**
 * An answer that is not MCP over Streamable HTTP: a content type the transport does not read, a body
 * that is not JSON-RPC, a socket closed with no response, or bytes that are not HTTP/1.1.
 */
function isProtocolMismatch(error: Error, code: unknown): boolean {
  if (error instanceof StreamableHTTPError) return error.code === -1;
  if (error instanceof SyntaxError || error.name === "ZodError" || error.name === "HTTPParserError") return true;
  return code === "UND_ERR_SOCKET" || (typeof code === "string" && code.startsWith("HPE_"));
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
