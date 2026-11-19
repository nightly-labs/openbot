import { basename } from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernHttpTransport,
} from "@modelcontextprotocol/client";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  AccessDeniedError,
  InvalidClientError,
  InvalidClientMetadataError,
  UnauthorizedClientError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { type CallToolRequest, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { z } from "zod";
import { causeHelpers } from "./effect-boundary";
import {
  isLoopback,
  MCP_TOKEN_TIMEOUT_MS,
  type McpOAuthAuthority,
  type McpSignIn,
  namesAuthorizationServer,
  normalizeResource,
  secureOAuthFetch,
} from "./mcp-oauth-provider";
import {
  clearMcpCommandCache,
  type McpShapeFailed,
  type McpToolRuntimes,
  mcpHandoffHeaders,
  mcpLaunchEnvironment,
  NO_MCP_TOOL_RUNTIMES,
  type ResolvedMcpServer,
  type UsableMcpServer,
  usableMcpServer,
} from "./mcp-provider-shapes";
import { redactMcpSecrets, redactMcpValues } from "./mcp-redaction";

/**
 * The deadline for an http server, from the handshake to the last tool page. A hosted server can
 * need more than 10 seconds to start (#9625). Codex gives each MCP step 30 seconds, so a server that
 * passes this test also starts in a Codex turn.
 */
const MCP_PROBE_TIMEOUT_MS = 30_000;

/**
 * The deadline for a stdio server. Its first start can download the package and all its
 * dependencies: `npx -y firecrawl-mcp` fetches about 170 packages before the server answers.
 */
export const MCP_STDIO_PROBE_TIMEOUT_MS = 60_000;

function probeTimeoutMs(config: McpServerConfig) {
  return config.transport === "stdio" ? MCP_STDIO_PROBE_TIMEOUT_MS : MCP_PROBE_TIMEOUT_MS;
}

interface McpProbeResult {
  toolCount: number;
  error: string | null;
}

/** What the user must give before the server answers: an OAuth sign-in, or a key in a header or the environment. */
type McpProbeNeed = "sign_in" | "key";

/** The most tool names an agent is told: enough to see what a server does, short enough for one tool result. */
const MCP_PROBE_TOOL_NAMES = 50;

/**
 * The probe result as an agent reads it: the first tool names, and what the user must give when the
 * server refused. The panel and the Team API keep `McpProbeResult`, whose shape they decode.
 */
export interface McpProbeOutcome extends McpProbeResult {
  tools: string[];
  needs: McpProbeNeed | null;
}

/**
 * Tests one configuration, saved or not: connects, counts the tools, and disconnects.
 *
 * Only a user asking for it starts this. OpenBot does not test by itself, because a connection is
 * not free - an http server can want an OAuth sign-in, a cold `npx` can download for most of the
 * stdio deadline, and a server can do real work at startup. The answer is reported once and not
 * stored.
 */
// SDK errors can quote credentials. Internal operations have no tracing spans; only the
// redacted McpProbeResult crosses the probe boundary.
class McpProbeFailure extends Schema.TaggedError<McpProbeFailure>()("McpProbeFailure", {
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
  timeoutMs = probeTimeoutMs(config),
  tools: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES,
  oauth?: Pick<McpOAuthAuthority, "accessToken" | "signIn">,
  signInPlace: McpSignInPlace | null = null,
) {
  const { toolCount, error } = yield* inspectMcpServer(config, timeoutMs, tools, oauth, signInPlace);
  return { toolCount, error } satisfies McpProbeResult;
});

/** `testMcpServer` with the tool names and the need an agent reads. */
export const inspectMcpServer = Effect.fnUntraced(function* (
  config: McpServerConfig,
  timeoutMs = probeTimeoutMs(config),
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
          // The probe runs in this process, so it holds the token itself and never uses the proxy.
          oauth
            ? (subject) =>
                oauth
                  .accessToken(subject.url)
                  .pipe(Effect.map((authorization) => ({ url: subject.url, authorization, proxied: false })))
            : undefined,
        );
        return yield* probeMcpServerEffect(server, timeoutMs, signIn, signInPlace);
      }),
    (signIn) => Effect.sync(() => signIn?.abandon()),
  );
});

/** A call rarely takes long. The limit only stops a tool that never answers, as for GitHub's server. */
const MCP_TOOL_CALL_TIMEOUT_MS = 5 * 60_000;

export type McpToolCallResult = Awaited<ReturnType<Client["callTool"]>>;
export type McpToolArguments = NonNullable<CallToolRequest["params"]["arguments"]>;

/**
 * Runs one tool of a server for an agent whose provider left that tool out (#7427). Silent like
 * `inspectMcpServer`: the stored sign-in only, never a browser. One connection for the call, closed
 * after it. A failure is a sentence with the secrets masked.
 */
export const callMcpServerTool = Effect.fnUntraced(function* (
  config: McpServerConfig,
  name: string,
  args: McpToolArguments,
  tools: McpToolRuntimes,
  oauth?: Pick<McpOAuthAuthority, "accessToken">,
): Effect.fn.Return<{ result: McpToolCallResult } | { error: string }, McpShapeFailed> {
  const server = yield* usableMcpServer(
    config,
    tools,
    oauth
      ? (subject) =>
          oauth
            .accessToken(subject.url)
            .pipe(Effect.map((authorization) => ({ url: subject.url, authorization, proxied: false })))
      : undefined,
  );
  if (server.error !== undefined) return { error: boundedError(server.error) };
  const timeoutMs = probeTimeoutMs(config);
  const called = yield* Effect.result(
    Effect.acquireUseRelease(
      Effect.try({
        try: () => ({
          client: new Client({ name: "openbot", version: "1" }, { capabilities: {} }),
          transport: createTransport(server, null, () => undefined),
        }),
        catch: (cause) => new McpProbeFailure({ cause }),
      }),
      ({ client, transport }) =>
        probeIo((signal) => client.connect(transport, { signal })).pipe(
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(new McpProbeFailure({ cause: new McpTimeout(timeoutMs) })),
          }),
          Effect.andThen(
            probeIo((signal) =>
              client.callTool({ name, arguments: args }, undefined, { signal, timeout: MCP_TOOL_CALL_TIMEOUT_MS }),
            ),
          ),
        ),
      ({ client, transport }) => closeQuietlyEffect(client, transport),
    ),
  );
  if (Result.isSuccess(called)) return { result: called.success };
  const described = describeMcpError(called.failure.cause, config);
  return { error: boundedError(redactMcpValues(described, probeSecrets(server, null))) };
});

/** The last refusal an http server answered a connection without a sign-in provider. */
interface McpChallenge {
  status: number;
  /**
   * Whether the refusal asks for an OAuth sign-in: a 401 whose `WWW-Authenticate` names the Bearer
   * scheme, or a refusal that the server's public OAuth metadata explains.
   */
  bearer: boolean;
  /** Whether the challenge names `resource_metadata`, the document of an OAuth sign-in. */
  resourceMetadata: boolean;
  /**
   * A Bearer challenge from an origin that publishes no OAuth metadata: the server wants a token
   * in the `Authorization` header, not a sign-in. Laravel's MCP server with Sanctum answers so (#9176).
   */
  keyOnly?: boolean;
  /** A 403 whose Bearer challenge is `insufficient_scope`: the token needs a scope that a new sign-in asks for. */
  insufficientScope?: boolean;
  /** Where the request ended up after any redirect. */
  url: string;
}

/** Connect, count, and close; a requested OAuth sign-in gets one fresh connection. */
const probeMcpServerEffect = Effect.fnUntraced(function* (
  server: UsableMcpServer,
  timeoutMs: number,
  signIn: McpSignIn | null,
  signInPlace: McpSignInPlace | null,
): Effect.fn.Return<McpProbeOutcome> {
  const { config } = server;
  if (server.error !== undefined) return { toolCount: 0, error: boundedError(server.error), tools: [], needs: null };
  const seen: { challenge: McpChallenge | null } = { challenge: null };
  const record = (next: McpChallenge) => {
    seen.challenge = next;
  };
  const failure = (error: unknown, signedIn = false): McpProbeOutcome => {
    const accountRefused = refusesSignedInAccount(error, server, signIn, seen.challenge, signedIn);
    const described = describeProbeFailure(error, config, signIn, seen.challenge, signInPlace, accountRefused);
    return {
      toolCount: 0,
      error: boundedError(redactMcpValues(described, probeSecrets(server, signIn))),
      tools: [],
      // Neither a key nor another press of Sign in changes a refused account.
      needs: signIn || accountRefused ? null : probeNeed(config, seen.challenge),
    };
  };
  const found = (listed: ListedTools): McpProbeOutcome => ({
    toolCount: listed.count,
    error: null,
    tools: listed.names,
    needs: null,
  });
  // The person's sign-in has its own deadline; the retried connection gets a fresh transport.
  const afterSignIn = Effect.fnUntraced(function* (active: McpSignIn) {
    const retry = yield* Effect.result(
      active
        .complete()
        .pipe(toMcpProbeFailure, Effect.andThen(connectAndCountEffect(server, timeoutMs, active, record))),
    );
    return Result.isFailure(retry) ? failure(retry.failure.cause, true) : found(retry.success);
  });
  const startedAt = Date.now();
  // In a sign-in, the SDK answers a 401 inside this connection: it reads the OAuth documents and
  // registers OpenBot before the page address exists. That start gets the time `begin` gives it, on
  // top of the server's own, or a slow host ends the sign-in before any page opens (#9741).
  const firstTimeoutMs = signIn ? timeoutMs + MCP_TOKEN_TIMEOUT_MS : timeoutMs;
  const first = yield* Effect.result(connectAndCountEffect(server, firstTimeoutMs, signIn, record));
  if (Result.isSuccess(first)) {
    // The user pressed Sign in, and the server answered without a sign-in: it can still want one
    // to run a tool. Its sign-in starts here, or the press ends with nothing opened and nothing said.
    if (!signIn) return found(first.success);
    const begun = yield* Effect.result(signIn.begin());
    if (Result.isFailure(begun)) return failure(begun.failure.cause);
    return begun.success ? yield* afterSignIn(signIn) : found(first.success);
  }
  // A server on the 2025-03 MCP authorization spec answers 401 with no challenge at all, and some
  // OAuth servers, such as Adobe's (#9232), answer 403; their public OAuth metadata is what says a
  // sign-in, not a key, is wanted. Only a refusal the sentence would explain is followed up,
  // and only public documents are read: no credential is sent.
  //
  // A Bearer challenge alone does not say OAuth either: a token server answers the same (#9176).
  // Without a `resource_metadata` link, only metadata the server publishes says a sign-in exists.
  // A lookup that could not finish keeps the sign-in, as before.
  const unexplained = seen.challenge;
  if (!signIn && signInPlace !== null && unexplained && !hasCredentialHeader(config)) {
    // The same Test deadline covers the lookup: it gets only the time the connection left.
    const lookupMs = timeoutMs - (Date.now() - startedAt);
    if (unexplained.status === 401 && !unexplained.bearer)
      seen.challenge = {
        ...unexplained,
        bearer: (yield* advertisesOAuth(config.url, lookupMs, ORIGIN_METADATA)) === true,
      };
    else if (unexplained.status === 401 && !unexplained.resourceMetadata)
      seen.challenge = {
        ...unexplained,
        keyOnly: (yield* advertisesOAuth(config.url, lookupMs, signInMetadata(config.url))) === false,
      };
    // A 403 is a sign-in only where Sign in can start one, and Sign in starts none while a token is
    // saved: a server that refuses that token refuses the account.
    else if (unexplained.status === 403 && !server.authorization)
      seen.challenge = { ...unexplained, bearer: yield* offersSignIn(config.url, lookupMs) };
  }
  // A server of revision 2026-07-28 alone answers the 2025 handshake with 400, while the agents,
  // which speak that revision, use its tools (#9234). Only then is that revision tried, in the time
  // the first connection left; a server that passed before keeps the same single connection. When
  // the second answer fails too, the first one is what the user reads.
  const remainingMs = timeoutMs - (Date.now() - startedAt);
  if (!signIn && config.transport === "http" && httpStatus(first.failure.cause) === 400 && remainingMs > 0) {
    const modern = yield* Effect.result(connectAndCountModernEffect(server, remainingMs));
    if (Result.isSuccess(modern)) return found(modern.success);
  }
  if (!signIn) return failure(first.failure.cause);
  if (first.failure.cause instanceof UnauthorizedError) return yield* afterSignIn(signIn);
  // The SDK starts a sign-in only on a 401, so a 403 with no key of the user's ends the press with
  // nothing opened. Its sign-in starts here, as for a server that answered.
  if (httpStatus(first.failure.cause) !== 403 || hasCredentialHeader(config)) return failure(first.failure.cause);
  const begun = yield* Effect.result(signIn.begin());
  if (Result.isFailure(begun)) return failure(begun.failure.cause);
  return begun.success ? yield* afterSignIn(signIn) : failure(first.failure.cause);
});

/**
 * The sentence for a failed probe, before secrets are removed.
 *
 * The SDK reports a token the server refused right after a sign-in as a bare 401, which would read
 * as "check the API key" to someone who has just signed in. And a server that answers a Bearer
 * challenge to a probe that could not sign in wants a sign-in, not a key: that is what Granola
 * answers, and the header fields alone gave the user no way forward. Adobe's answers 403, which its
 * OAuth metadata explains in the same way (#9232). A key pasted into a header is the exception:
 * Composio Connect ignores a key in the wrong header and sends the same challenge. A Bearer
 * challenge from a server that publishes no OAuth metadata (`keyOnly`) wants a key too: Coolify
 * answers so (#9176).
 */
function describeProbeFailure(
  error: unknown,
  config: McpServerConfig,
  signIn: McpSignIn | null,
  challenge: McpChallenge | null,
  signInPlace: McpSignInPlace | null,
  /** A 403 to OpenBot's own sign-in, see `refusesSignedInAccount`. */
  accountRefused: boolean,
): string {
  if (signIn?.cancelled()) return sourceText("error.backend.mcpSignInCancelled");
  const otherAddress = signIn?.otherAddress();
  if (otherAddress) return sourceText("error.backend.mcpSignInOtherAddress", { url: otherAddress });
  // With no metadata, the SDK registers at a guessed address, and a token server answers that with
  // a status such as Laravel's 419, or 401. The sign-in never existed; the key is what it wants.
  if (signIn?.signInServerMissing()) return BEARER_KEY;
  if (signIn && isRegistrationRefusal(error, signIn))
    return signIn.registrationUnsupported() ? REGISTRATION_UNAVAILABLE : REGISTRATION_REFUSED;
  if (accountRefused) return sourceText("error.backend.mcpSignInAccountRefused");
  const status = httpStatus(error);
  if (signIn && status === 401) return sourceText("error.backend.mcpSignInNotAccepted");
  // The token endpoint refused the grant. Its status says nothing about the address the user typed.
  if (signIn?.exchangeFailed() && status !== null && status >= 400 && status < 500)
    return sourceText("error.backend.mcpSignInNotAccepted");
  // A Bearer server that takes a token, or an `Authorization` value without its `Bearer` word.
  if (challenge?.status === 401 && challenge.bearer && (challenge.keyOnly || authorizationWithoutScheme(config)))
    return BEARER_KEY;
  // A key the user pasted into a header is theirs to fix; the sign-in would not replace it.
  if (challenge?.bearer && !hasCredentialHeader(config)) {
    const described = describeSignInChallenge(config.url, challenge.url, signInPlace);
    if (described) return described;
  }
  return describeMcpError(error, config);
}

/**
 * Whether a 403 refuses the account of OpenBot's own sign-in: the one the person has just finished,
 * or the saved one that a Test sends. The token was accepted as a sign-in, so the service refuses
 * the account itself, not a key. GitLab answers so to a saved sign-in (#9372), and Adobe Analytics
 * to an account with no access to an organization of its product (#9232). A key the user pasted
 * into a header is theirs to fix, as before.
 *
 * Two 403s are not the account's: one from the token endpoint, which refused the grant before any
 * account was checked, and an `insufficient_scope` challenge, which a new sign-in with the scope
 * answers. The SDK starts that sign-in itself when Sign in sends the saved token.
 */
function refusesSignedInAccount(
  error: unknown,
  server: UsableMcpServer,
  signIn: McpSignIn | null,
  challenge: McpChallenge | null,
  signedIn: boolean,
): boolean {
  if (httpStatus(error) !== 403 || signIn?.exchangeFailed() || challenge?.insufficientScope) return false;
  return signedIn || (Boolean(server.authorization) && !hasCredentialHeader(server.config));
}

/**
 * What to say to a server that wants an OAuth sign-in the probe could not start, or `null` when
 * nobody asked and the refusal is reported as it is.
 *
 * A plain-http address is not upgraded behind the user's back: the agents reach the server at the
 * address the row holds, so a test that passed over https would hide that every agent still fails.
 * The sentence names the https address instead, without its query, which can carry a key.
 */
function describeSignInChallenge(url: string, finalUrl: string, place: McpSignInPlace | null): string | null {
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

/**
 * What the refusal asks of the user, decided as `describeProbeFailure` words it: a refusal that asks
 * for a sign-in, to a row with no credential header of its own, wants a sign-in, unless the server
 * publishes no OAuth metadata (`keyOnly`); any other refusal wants a key. A sign-in over plain http
 * needs a new address first, which the error names.
 */
function probeNeed(config: McpServerConfig, challenge: McpChallenge | null): McpProbeNeed | null {
  if (!challenge || !isAccessRefusal(challenge.status)) return null;
  if (!challenge.bearer || challenge.keyOnly || hasCredentialHeader(config)) return "key";
  return normalizeResource(config.url) ? "sign_in" : null;
}

/** A header whose name says it holds a credential, such as `Authorization` or `x-api-key`, has a value. */
export function hasCredentialHeader(config: McpServerConfig): boolean {
  return config.headers.some(({ key, value }) => CREDENTIAL_HEADER.test(key) && value.trim().length > 0);
}

/** An `Authorization` value of one word: the token alone, without the scheme such as `Bearer`. */
function authorizationWithoutScheme(config: McpServerConfig): boolean {
  return config.headers.some(
    ({ key, value }) => key.trim().toLowerCase() === "authorization" && /^\S+$/u.test(value.trim()),
  );
}

const BEARER_KEY = sourceText("error.backend.mcpServerBearerKey");

const CREDENTIAL_HEADER = /auth|key|token|secret/i;

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

/** How the probe names itself to a server, in both protocol versions. */
const PROBE_CLIENT_INFO = { name: "openbot-probe", version: "1" };

/** One connection, from the handshake to the tool count, closed again whatever it answered. */
const connectAndCountEffect = Effect.fnUntraced(function* (
  server: ResolvedMcpServer,
  timeoutMs: number,
  signIn: McpSignIn | null,
  onChallenge: (challenge: McpChallenge) => void,
) {
  return yield* countOverEffect(timeoutMs, () => {
    const client = new Client(PROBE_CLIENT_INFO, { capabilities: {} });
    const transport = createTransport(server, signIn, onChallenge);
    const lister: ProbeClient = {
      listTools: (params, options) => client.request({ method: "tools/list", params }, LISTED_TOOLS_PAGE, options),
      close: () => client.close(),
    };
    return { client: lister, transport, connect: (signal) => client.connect(transport, { signal }) };
  });
});

/**
 * The part of a `tools/list` page that the probe reads.
 *
 * The SDK v1 `listTools` decodes each tool with a schema that refuses a property schema that is not
 * an object, such as `"data": true`, which JSON Schema permits. One such tool failed the whole test
 * and the server was not added (#11931). The provider reads the tool schemas itself, so the probe
 * decodes only the names and the cursor. The SDK v2 client already accepts these schemas.
 */
const LISTED_TOOLS_PAGE = z.object({
  tools: z.array(z.object({ name: z.string() })),
  nextCursor: z.string().optional(),
});

/**
 * `connectAndCountEffect` in MCP revision 2026-07-28, which the 2025 client cannot speak: the SDK v2
 * client sends the `Mcp-Method` and `Mcp-Name` headers that revision requires. Same headers and
 * stored token as the first connection, and no sign-in.
 */
const connectAndCountModernEffect = Effect.fnUntraced(function* (server: ResolvedMcpServer, timeoutMs: number) {
  return yield* countOverEffect(timeoutMs, () => {
    const client = new ModernClient(PROBE_CLIENT_INFO, {
      capabilities: {},
      versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
    });
    const transport = new ModernHttpTransport(new URL(server.config.url), {
      requestInit: { headers: mcpHandoffHeaders(server) },
    });
    return { client, transport, connect: (signal) => client.connect(transport, { signal }) };
  });
});

const MODERN_PROTOCOL_VERSION = "2026-07-28";

/** What the probe uses of an SDK v1 or v2 client. */
interface ProbeClient {
  listTools(
    params: { cursor: string } | undefined,
    options: { signal: AbortSignal },
  ): Promise<{ tools: ReadonlyArray<{ name: string }>; nextCursor?: string | undefined }>;
  close(): Promise<void>;
}

interface ProbeConnection {
  client: ProbeClient;
  transport: Pick<Transport, "close">;
  connect: (signal: AbortSignal) => Promise<void>;
}

/** Opens the connection, counts its tools within the deadline, and closes it whatever it answered. */
const countOverEffect = Effect.fnUntraced(function* (timeoutMs: number, open: () => ProbeConnection) {
  return yield* Effect.acquireUseRelease(
    Effect.try({ try: open, catch: (cause) => new McpProbeFailure({ cause }) }),
    ({ client, transport, connect }) =>
      Effect.gen(function* () {
        yield* probeIo(connect);
        return yield* countToolsEffect(client);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(new McpProbeFailure({ cause: new McpTimeout(timeoutMs) })),
        }),
        Effect.catch((failure) => explainClosedEffect(failure, transport)),
      ),
    ({ client, transport }) => closeQuietlyEffect(client, transport),
  );
});

/** A closed stdio connection fails with what the server wrote to stderr before it stopped. */
const explainClosedEffect = Effect.fnUntraced(function* (
  failure: McpProbeFailure,
  transport: Pick<Transport, "close">,
): Effect.fn.Return<never, McpProbeFailure> {
  if (!(transport instanceof TailedStdioTransport) || !isConnectionClosed(failure.cause))
    return yield* Effect.fail(failure);
  const output = yield* transport.output();
  if (!output.text) return yield* Effect.fail(failure);
  return yield* Effect.fail(new McpProbeFailure({ cause: new McpServerExit(output.text, output.cut) }));
});

/** How much of the end of a stdio server's stderr the panel shows. */
const MCP_STDERR_SHOWN = 1_000;

/**
 * How much of the end is kept before the secrets are removed. Masking finds only whole values, so
 * the shown part is cut after it: a value that this cut splits is at the start, which that cut drops.
 */
const MCP_STDERR_KEPT = 8_000;

/** How long the last stderr lines can arrive after the connection closed. */
const MCP_STDERR_SETTLE_MS = 250;

/**
 * `StdioClientTransport` that keeps the end of the server's stderr.
 *
 * The pipe is read all the time, so a server that writes much to stderr cannot fill the 64 KB
 * buffer and stop before it answers. Only the end is kept: when the server stops, the end holds
 * the reason, such as a variable that the terminal had and the launch did not (#10137).
 */
class TailedStdioTransport extends StdioClientTransport {
  #output = "";
  #cut = false;
  #source: Readable | null = null;
  readonly #ended: Promise<void>;

  constructor(server: StdioServerParameters) {
    super({ ...server, stderr: "pipe" });
    // The SDK gives this stream before `start`, so no early line is lost.
    const stream = this.stderr;
    const decoder = new StringDecoder("utf8");
    const keep = (text: string) => {
      const output = this.#output + text;
      this.#cut ||= output.length > MCP_STDERR_KEPT;
      this.#output = output.slice(-MCP_STDERR_KEPT);
    };
    this.#ended = new Promise((resolve) => {
      if (!stream) return resolve();
      stream.on("pipe", (source: Readable) => {
        this.#source = source;
      });
      stream.on("data", (chunk: Buffer) => keep(decoder.write(chunk)));
      stream.once("end", () => {
        keep(decoder.end());
        resolve();
      });
      stream.once("close", () => resolve());
      stream.on("error", () => resolve());
    });
  }

  /** The kept stderr, after the stream ends or the short wait passes: a descendant can keep it open. */
  output() {
    return Effect.promise(() => this.#ended).pipe(
      Effect.timeoutOption(MCP_STDERR_SETTLE_MS),
      // Colour codes of a terminal logger are not text the panel can show.
      Effect.map(() => ({ text: stripVTControlCharacters(this.#output).trim(), cut: this.#cut })),
    );
  }

  /** A descendant that got stderr can keep it open after the server is killed: release this end. */
  override async close() {
    await super.close();
    this.#source?.destroy();
  }
}

interface ListedTools {
  count: number;
  /** The first names, up to `MCP_PROBE_TOOL_NAMES`. */
  names: string[];
}

/** Count all pages within the connection deadline, without repeating a cursor. */
const countToolsEffect = Effect.fnUntraced(function* (client: ProbeClient) {
  const seen = new Set<string>();
  const names: string[] = [];
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = yield* probeIo((signal) =>
      client.listTools(cursor === undefined ? undefined : { cursor }, { signal }),
    );
    for (const tool of page.tools) if (names.length < MCP_PROBE_TOOL_NAMES) names.push(tool.name.slice(0, 128));
    count += page.tools.length;
    if (count >= INPUT_LIMITS.mcpToolCount) return { count: INPUT_LIMITS.mcpToolCount, names } satisfies ListedTools;
    cursor = page.nextCursor;
    if (cursor === undefined || seen.has(cursor)) return { count, names } satisfies ListedTools;
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
  signIn: McpSignIn | null,
  onChallenge: (challenge: McpChallenge) => void,
): Transport {
  const { config } = server;
  const authProvider = signIn?.provider;
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
     * It is also where the SDK registers, so it keeps the status of that answer.
     */
    return new StreamableHTTPClientTransport(new URL(config.url), {
      fetch: signIn
        ? signIn.watchRegistration(secureOAuthFetch({ resource: config.url, mcpTraffic: true }))
        : challengeRecordingFetch(onChallenge),
      ...(authProvider ? { authProvider } : {}),
      requestInit: { headers },
    });
  }
  return new TailedStdioTransport({
    command: server.command ?? config.command,
    args: server.args,
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
      const challenge = response.headers.get("www-authenticate") ?? "";
      const bearer = /(?:^|,)\s*bearer\b/iu.test(challenge);
      // A step-up challenge (RFC 6750) asks for a token with more scope, which only a sign-in gives.
      const insufficientScope =
        response.status === 403 && bearer && /\berror\s*=\s*"?insufficient_scope\b/iu.test(challenge);
      onChallenge({
        status: response.status,
        // `Headers.get` joins several challenges with commas, so Bearer may follow another scheme.
        // A 403 that names Bearer can refuse a key as well: only the server's metadata decides it,
        // except a step-up challenge.
        bearer: (response.status === 401 && bearer) || insufficientScope,
        insufficientScope,
        resourceMetadata: /\bresource_metadata\s*=/iu.test(challenge),
        url: response.url || input.toString(),
      });
    }
    return response;
  };
}

/** The OAuth metadata documents at the origin root. */
const ORIGIN_METADATA = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"];

/**
 * Every place the SDK looks for the metadata of a sign-in, so that "none" is a claim about the
 * whole server: the RFC 9728 path form of the server's address, and OpenID discovery.
 */
function signInMetadata(url: string): string[] {
  const path = new URL(url).pathname.replace(/\/+$/u, "");
  const resource = path ? [`/.well-known/oauth-protected-resource${path}`] : [];
  return [...resource, ...ORIGIN_METADATA, "/.well-known/openid-configuration"];
}

/**
 * Whether the server's origin publishes OAuth metadata at one of `paths`, read without any
 * credential. `null` when a read failed or the time ran out, and no other read found metadata.
 */
const advertisesOAuth = Effect.fnUntraced(function* (url: string, remainingMs: number, paths: readonly string[]) {
  if (remainingMs <= 0) return null;
  const { origin } = new URL(url);
  const lookups = paths.map((path) =>
    Effect.tryPromise({
      try: async (signal): Promise<boolean | null> => {
        const response = await fetch(`${origin}${path}`, { signal, headers: { accept: "application/json" } });
        await response.body?.cancel();
        if (response.ok) return (response.headers.get("content-type") ?? "").includes("json");
        // A missing document says "none". So does a 401: a sign-in reads this document without a
        // credential, as `namesAuthorizationServer` does, so a server that wants its key here has
        // no sign-in to open (#10547). A firewall's 403, a 429 or a server error says nothing.
        return response.status === 404 || response.status === 410 || response.status === 401 ? false : null;
      },
      catch: (cause) => new McpProbeFailure({ cause }),
    }).pipe(Effect.catch(() => Effect.succeed(null))),
  );
  const found: readonly (boolean | null)[] = yield* Effect.all(lookups, { concurrency: "unbounded" }).pipe(
    Effect.timeoutOrElse({ duration: remainingMs, orElse: () => Effect.succeed([null]) }),
  );
  if (found.includes(true)) return true;
  return found.includes(null) ? null : false;
});

/**
 * Whether Sign in could open a page for this server: the metadata read of `McpSignIn.begin`, without
 * any credential. A read that fails or gets no answer in the time left is a no.
 */
const offersSignIn = Effect.fnUntraced(function* (url: string, remainingMs: number) {
  if (remainingMs <= 0) return false;
  const controller = new AbortController();
  const fetchFn: FetchLike = (input, init) => fetch(input, { ...init, signal: controller.signal });
  return yield* namesAuthorizationServer(normalizeResource(url) ?? url, fetchFn).pipe(
    Effect.map((issuer) => issuer !== null),
    Effect.timeoutOrElse({ duration: remainingMs, orElse: () => Effect.succeed(false) }),
    Effect.catch(() => Effect.succeed(false)),
    Effect.ensuring(Effect.sync(() => controller.abort())),
  );
});

/** Close both SDK resources and kill a stdio child if it survives transport close. */
const closeQuietlyEffect = Effect.fnUntraced(function* (client: ProbeClient, transport: Pick<Transport, "close">) {
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

/** A stdio server that stopped before it answered, with the end of what it wrote to stderr. */
class McpServerExit extends Error {
  constructor(
    readonly output: string,
    /** Whether the server wrote more than `output`. */
    readonly cut: boolean,
  ) {
    super("The MCP server stopped before it answered.");
  }
}

/** The end of the server's stderr that the panel shows, with the secrets removed before the cut. */
function serverOutput(error: McpServerExit, config: McpServerConfig): string {
  const output = redactMcpSecrets(error.output, config).trim();
  if (!error.cut && output.length <= MCP_STDERR_SHOWN) return output;
  // A cut can split a character in two: its lone second half is dropped.
  return `…${output.slice(-MCP_STDERR_SHOWN).replace(/^[\uDC00-\uDFFF]/u, "")}`;
}

/** The failure, in the words the panel shows. Secrets are removed before the text leaves here. */
function describeMcpError(error: unknown, config: McpServerConfig): string {
  const described = describeMcpErrorText(error, config);
  // A bridge that never answers is the case the native connection replaces: say where to go.
  const bridgeUrl = mcpRemoteBridgeUrl(config);
  if (
    bridgeUrl === null ||
    !(error instanceof McpTimeout || error instanceof McpServerExit || isConnectionClosed(error))
  )
    return described;
  return sourceText("error.backend.mcpRemoteBridge", { reason: described, url: bridgeUrl });
}

function describeMcpErrorText(error: unknown, config: McpServerConfig): string {
  // The deadline that ran out: a sign-in's first connection has a longer one than the test.
  if (error instanceof McpTimeout)
    return sourceText("error.backend.mcpServerNoAnswer", { seconds: Math.round(error.timeoutMs / 1000) });
  // Only a sign-in reaches this: without an `authProvider` the transport reports the raw 401 below.
  if (error instanceof UnauthorizedError) return sourceText("error.backend.mcpSignInNotAccepted");
  // What the server wrote before it stopped says why, also when the command works in a terminal
  // (#10137). The probe secrets do not hold the configured values, so they are removed here.
  if (error instanceof McpServerExit)
    return sourceText("error.backend.mcpServerExitedWithOutput", { detail: serverOutput(error, config) });
  // The child exited before the handshake: the process failed to start, not the network.
  if (config.transport === "stdio" && isConnectionClosed(error)) return sourceText("error.backend.mcpServerExited");
  if (config.transport === "http") {
    const described = describeConnectionFailure(error, config.url);
    if (described) return described;
  }
  const status = httpStatus(error);
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

/** The error and the causes Node's fetch nests under it, such as `fetch failed` over `ECONNREFUSED`. */
function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  for (let current = error; current instanceof Error && chain.length < 4; current = current.cause) chain.push(current);
  return chain;
}

/** A system or undici code such as `ECONNREFUSED`. A transport's numeric HTTP status is not one. */
function systemCode(error: Error): string | null {
  const code = isDynamicRecord(error) ? error.code : undefined;
  return typeof code === "string" ? code : null;
}

/** A request that never reached a server: Node's fetch rejects with `fetch failed` and the system code as the cause. */
function isNetworkFailure(error: unknown): boolean {
  return causeChain(error).some((current) => {
    const code = systemCode(current);
    if (code !== null && NETWORK_ERROR_CODES.has(code)) return true;
    return current instanceof TypeError && current.message === "fetch failed";
  });
}

/**
 * What an http connection that failed below MCP says, or `null` for the general sentences.
 *
 * A local server, such as the one in the Figma desktop app, refuses the connection while it is
 * turned off, and "check your network" sends the user the wrong way. Something that answers but
 * not in MCP over Streamable HTTP is told apart from a server that is not there.
 */
function describeConnectionFailure(error: unknown, url: string): string | null {
  for (const current of causeChain(error)) {
    const code = systemCode(current);
    if (code === "ECONNREFUSED" && URL.canParse(url)) {
      const address = new URL(url);
      if (isLoopback(address.hostname))
        return sourceText("error.backend.mcpLocalServerOff", { address: address.origin });
    }
    if (code === "EACCES" || code === "EPERM") return sourceText("error.backend.mcpServerBlocked");
    if (isProtocolMismatch(current, code)) return sourceText("error.backend.mcpServerIncompatible");
  }
  return null;
}

/**
 * An answer that is not MCP over Streamable HTTP: a 405 to the POST, a content type the transport
 * does not read, or bytes that are not HTTP/1.1.
 *
 * Only the transport's own errors and the HTTP parser count. A `SyntaxError` or a schema error can
 * also come from a sign-in server or from one bad result of a real MCP server, and a closed socket
 * can be the network.
 */
function isProtocolMismatch(error: Error, code: string | null): boolean {
  if (error instanceof StreamableHTTPError) return error.code === -1 || error.code === 405;
  return error.name === "HTTPParserError" || (code?.startsWith("HPE_") ?? false);
}

/**
 * A refused registration is the service's choice, not the user's credentials: Figma, for one,
 * registers only the MCP clients it approved. "Try again" and the API key cannot change it.
 */
const REGISTRATION_REFUSED = sourceText("error.backend.mcpRegistrationRefused");

/**
 * The sign-in server has no registration at all, as Google's has (#8398). A sign-in app is then the
 * only client it can accept, so the sentence names it: a local MCP server is not the way forward.
 */
const REGISTRATION_UNAVAILABLE = sourceText("error.backend.mcpRegistrationUnavailable");

function isAccessRefusal(status: number | null): boolean {
  return status === 401 || status === 403;
}

/**
 * Whether the server refused to register OpenBot. Only an error from a registration counts: the
 * same error classes from the token endpoint mean that the server refused a client it issued.
 *
 * The SDK keeps the status only when the refusal body is not an OAuth error. A body such as
 * `{"error":"access_denied"}` arrives as its error class, with the status gone.
 *
 * RevenueCat answers each registration it did not approve with 400 `invalid_client` ("The client
 * is not registered.").
 *
 * Omnisend answers each name it did not approve with 400 `invalid_client_metadata` ("unknown
 * application: OpenBot", #7722), and Tessie answers the same error with "No dynamic client
 * registration template matched this request." (#9372). The services' words differ, so the error
 * class decides, not the text: the user cannot change the metadata that OpenBot sends either.
 */
function isRegistrationRefusal(error: unknown, signIn: McpSignIn): boolean {
  if (signIn.registrationUnsupported()) return true;
  const status = signIn.registrationStatus();
  if (isAccessRefusal(status)) return true;
  // YNAB answers each address it did not approve with 400 `invalid_redirect_uri` (#8417).
  if (signIn.registrationRedirectRefused()) return true;
  // The SDK also registers when it drops a client bound to another issuer. `registrationFailed`
  // misses that registration, and the watched status shows it.
  if (!signIn.registrationFailed() && status === null) return false;
  if (
    error instanceof AccessDeniedError ||
    error instanceof UnauthorizedClientError ||
    error instanceof InvalidClientError ||
    error instanceof InvalidClientMetadataError
  )
    return true;
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
