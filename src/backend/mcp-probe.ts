import { basename } from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernHttpTransport,
} from "@modelcontextprotocol/client";
import { getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  AccessDeniedError,
  InvalidClientError,
  InvalidClientMetadataError,
  InvalidGrantError,
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
  type AuthorizationServerLookup,
  isLoopback,
  MCP_TOKEN_TIMEOUT_MS,
  type McpOAuthAuthority,
  type McpSignIn,
  namesAuthorizationServer,
  normalizeResource,
  secureOAuthFetch,
} from "./mcp-oauth-provider";
import { insufficientScopeChallenge } from "./mcp-oauth-proxy";
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

const MCP_PROBE_TIMEOUT_MS = 30_000;

export const MCP_STDIO_PROBE_TIMEOUT_MS = 60_000;

function probeTimeoutMs(config: McpServerConfig) {
  return config.transport === "stdio" ? MCP_STDIO_PROBE_TIMEOUT_MS : MCP_PROBE_TIMEOUT_MS;
}

interface McpProbeResult {
  toolCount: number;
  error: string | null;
}

type McpProbeNeed = "sign_in" | "key";

const MCP_PROBE_TOOL_NAMES = 50;

export interface McpProbeOutcome extends McpProbeResult {
  tools: string[];
  needs: McpProbeNeed | null;
}

class McpProbeFailure extends Schema.TaggedError<McpProbeFailure>()("McpProbeFailure", {
  cause: Schema.Defect(),
}) {}

const { io: probeIo, rewrap: toMcpProbeFailure } = causeHelpers(McpProbeFailure);

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

export const MCP_TOOL_CALL_TIMEOUT_MS = 5 * 60_000;

export type McpToolCallResult = Awaited<ReturnType<Client["callTool"]>>;
export type McpToolArguments = NonNullable<CallToolRequest["params"]["arguments"]>;

export const callMcpServerTool = Effect.fnUntraced(function* (
  config: McpServerConfig,
  name: string,
  args: McpToolArguments,
  tools: McpToolRuntimes,
  oauth?: Pick<McpOAuthAuthority, "accessToken">,
): Effect.fn.Return<{ result: McpToolCallResult } | { error: string; refusedScope?: string | null }, McpShapeFailed> {
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
  const seen: { challenge: McpChallenge | null } = { challenge: null };
  const called = yield* Effect.result(
    Effect.acquireUseRelease(
      Effect.try({
        try: () => ({
          client: new Client({ name: "openbot", version: "1" }, { capabilities: {} }),
          transport: createTransport(server, null, (challenge) => {
            seen.challenge = challenge;
          }),
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
  const error = boundedError(redactMcpValues(described, probeSecrets(server, null)));
  const scope = seen.challenge?.scope;
  return scope === undefined ? { error } : { error, refusedScope: scope };
});

interface McpChallenge {
  status: number;
  bearer: boolean;
  resourceMetadata: boolean;
  keyOnly?: boolean;
  insufficientScope?: boolean;
  scope?: string | null;
  url: string;
}

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
      needs: signIn || accountRefused ? null : probeNeed(config, seen.challenge),
    };
  };
  const found = (listed: ListedTools): McpProbeOutcome => ({
    toolCount: listed.count,
    error: null,
    tools: listed.names,
    needs: null,
  });
  const afterSignIn = Effect.fnUntraced(function* (active: McpSignIn) {
    const retry = yield* Effect.result(
      active
        .complete()
        .pipe(toMcpProbeFailure, Effect.andThen(connectAndCountEffect(server, timeoutMs, active, record))),
    );
    return Result.isFailure(retry) ? failure(retry.failure.cause, true) : found(retry.success);
  });
  const startedAt = Date.now();
  const firstTimeoutMs = signIn ? timeoutMs + MCP_TOKEN_TIMEOUT_MS : timeoutMs;
  const first = yield* Effect.result(connectAndCountEffect(server, firstTimeoutMs, signIn, record));
  if (Result.isSuccess(first)) {
    if (!signIn) return found(first.success);
    const begun = yield* Effect.result(signIn.begin());
    if (Result.isFailure(begun)) return failure(begun.failure.cause);
    return begun.success ? yield* afterSignIn(signIn) : found(first.success);
  }
  const unexplained = seen.challenge;
  if (!signIn && signInPlace !== null && unexplained && !hasCredentialHeader(config)) {
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
    else if (unexplained.status === 403 && !server.authorization)
      seen.challenge = {
        ...unexplained,
        bearer: yield* offersSignIn(config.url, lookupMs, lookupAfterRefusal(unexplained)),
      };
  }
  const remainingMs = timeoutMs - (Date.now() - startedAt);
  if (!signIn && config.transport === "http" && httpStatus(first.failure.cause) === 400 && remainingMs > 0) {
    const modern = yield* Effect.result(connectAndCountModernEffect(server, remainingMs));
    if (Result.isSuccess(modern)) return found(modern.success);
  }
  if (!signIn) return failure(first.failure.cause);
  if (first.failure.cause instanceof UnauthorizedError) return yield* afterSignIn(signIn);
  if (httpStatus(first.failure.cause) !== 403 || hasCredentialHeader(config)) return failure(first.failure.cause);
  const begun = yield* Effect.result(signIn.begin("this-server"));
  if (Result.isFailure(begun)) return failure(begun.failure.cause);
  return begun.success ? yield* afterSignIn(signIn) : failure(first.failure.cause);
});

function describeProbeFailure(
  error: unknown,
  config: McpServerConfig,
  signIn: McpSignIn | null,
  challenge: McpChallenge | null,
  signInPlace: McpSignInPlace | null,
  accountRefused: boolean,
): string {
  if (signIn?.cancelled()) return sourceText("error.backend.mcpSignInCancelled");
  const otherAddress = signIn?.otherAddress();
  if (otherAddress) return sourceText("error.backend.mcpSignInOtherAddress", { url: otherAddress });
  if (signIn?.signInServerMissing()) return BEARER_KEY;
  if (signIn && isRegistrationRefusal(error, signIn))
    return signIn.registrationUnsupported() ? REGISTRATION_UNAVAILABLE : REGISTRATION_REFUSED;
  if (accountRefused) return sourceText("error.backend.mcpSignInAccountRefused");
  const status = httpStatus(error);
  if (signIn && status === 401) return sourceText("error.backend.mcpSignInNotAccepted");
  if (signIn?.exchangeFailed() && error instanceof InvalidGrantError)
    return sourceText("error.backend.mcpSignInGrantRefused");
  if (signIn?.exchangeFailed() && status !== null && status >= 400 && status < 500)
    return sourceText("error.backend.mcpSignInNotAccepted");
  if (challenge?.status === 401 && challenge.bearer && (challenge.keyOnly || authorizationWithoutScheme(config)))
    return BEARER_KEY;
  if (challenge?.bearer && !hasCredentialHeader(config)) {
    const described = describeSignInChallenge(config.url, challenge.url, signInPlace);
    if (described) return described;
  }
  return describeMcpError(error, config);
}

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

function describeSignInChallenge(url: string, finalUrl: string, place: McpSignInPlace | null): string | null {
  if (place === null) return null;
  if (!normalizeResource(url))
    return sourceText("error.backend.mcpSignInNeedsHttps", { url: httpsAddress(finalUrl, url) });
  return place === "host" ? sourceText("error.backend.mcpSignInOnHost") : sourceText("error.backend.mcpSignInRequired");
}

function httpsAddress(finalUrl: string, url: string): string {
  const target = URL.canParse(finalUrl) && finalUrl.startsWith("https:") ? new URL(finalUrl) : new URL(url);
  target.protocol = "https:";
  target.search = "";
  target.hash = "";
  return target.toString();
}

function probeNeed(config: McpServerConfig, challenge: McpChallenge | null): McpProbeNeed | null {
  if (!challenge || !isAccessRefusal(challenge.status)) return null;
  if (!challenge.bearer || challenge.keyOnly || hasCredentialHeader(config)) return "key";
  return normalizeResource(config.url) ? "sign_in" : null;
}

export function hasCredentialHeader(config: McpServerConfig): boolean {
  return config.headers.some(({ key, value }) => CREDENTIAL_HEADER.test(key) && value.trim().length > 0);
}

function authorizationWithoutScheme(config: McpServerConfig): boolean {
  return config.headers.some(
    ({ key, value }) => key.trim().toLowerCase() === "authorization" && /^\S+$/u.test(value.trim()),
  );
}

const BEARER_KEY = sourceText("error.backend.mcpServerBearerKey");

const CREDENTIAL_HEADER = /auth|key|token|secret/i;

function probeSecrets(server: UsableMcpServer, signIn: McpSignIn | null): string[] {
  const values = server.authorization ? [server.authorization] : [];
  return [...values, ...(signIn?.secrets() ?? [])];
}

const PROBE_CLIENT_INFO = { name: "openbot-probe", version: "1" };

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

const LISTED_TOOLS_PAGE = z.object({
  tools: z.array(z.object({ name: z.string() })),
  nextCursor: z.string().optional(),
});

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

const countOverEffect = Effect.fnUntraced(function* (timeoutMs: number, open: () => ProbeConnection) {
  return yield* Effect.acquireUseRelease(
    Effect.try({ try: open, catch: (cause) => new McpProbeFailure({ cause }) }),
    ({ client, transport, connect }) =>
      Effect.gen(function* () {
        yield* probeIo(connect).pipe(Effect.mapError(unreadableInitialize));
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

const MCP_STDERR_SHOWN = 1_000;

const MCP_STDERR_KEPT = 8_000;

const MCP_STDERR_SETTLE_MS = 250;

class TailedStdioTransport extends StdioClientTransport {
  #output = "";
  #cut = false;
  #source: Readable | null = null;
  readonly #ended: Promise<void>;

  constructor(server: StdioServerParameters) {
    super({ ...server, stderr: "pipe" });
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

  output() {
    return Effect.promise(() => this.#ended).pipe(
      Effect.timeoutOption(MCP_STDERR_SETTLE_MS),
      Effect.map(() => ({ text: stripVTControlCharacters(this.#output).trim(), cut: this.#cut })),
    );
  }

  override async close() {
    await super.close();
    this.#source?.destroy();
  }
}

interface ListedTools {
  count: number;
  names: string[];
}

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

export function boundedError(text: string): string {
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
    const headers = authProvider
      ? Object.fromEntries(config.headers.map(({ key, value }) => [key, value]))
      : mcpHandoffHeaders(server);
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
    ...(server.workingDirectory ? { cwd: server.workingDirectory } : {}),
    env: {
      ...getDefaultEnvironment(),
      ...mcpLaunchEnvironment(server),
    },
  });
}

function challengeRecordingFetch(onChallenge: (challenge: McpChallenge) => void): FetchLike {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401 || response.status === 403) {
      const challenge = response.headers.get("www-authenticate") ?? "";
      const bearer = /(?:^|,)\s*bearer\b/iu.test(challenge);
      const scope = response.status === 403 ? insufficientScopeChallenge(challenge) : undefined;
      const insufficientScope = scope !== undefined;
      onChallenge({
        status: response.status,
        bearer: (response.status === 401 && bearer) || insufficientScope,
        insufficientScope,
        ...(scope !== undefined ? { scope } : {}),
        resourceMetadata: /\bresource_metadata\s*=/iu.test(challenge),
        url: response.url || input.toString(),
      });
    }
    return response;
  };
}

const ORIGIN_METADATA = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"];

function signInMetadata(url: string): string[] {
  const path = new URL(url).pathname.replace(/\/+$/u, "");
  const resource = path ? [`/.well-known/oauth-protected-resource${path}`] : [];
  return [...resource, ...ORIGIN_METADATA, "/.well-known/openid-configuration"];
}

const advertisesOAuth = Effect.fnUntraced(function* (url: string, remainingMs: number, paths: readonly string[]) {
  if (remainingMs <= 0) return null;
  const { origin } = new URL(url);
  const lookups = paths.map((path) =>
    Effect.tryPromise({
      try: async (signal): Promise<boolean | null> => {
        const response = await fetch(`${origin}${path}`, { signal, headers: { accept: "application/json" } });
        await response.body?.cancel();
        if (response.ok) return (response.headers.get("content-type") ?? "").includes("json");
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

function lookupAfterRefusal(challenge: McpChallenge | null): AuthorizationServerLookup {
  return challenge?.insufficientScope ? "this-server-or-origin" : "this-server";
}

const offersSignIn = Effect.fnUntraced(function* (url: string, remainingMs: number, lookup: AuthorizationServerLookup) {
  if (remainingMs <= 0) return false;
  const controller = new AbortController();
  const fetchFn: FetchLike = (input, init) => fetch(input, { ...init, signal: controller.signal });
  return yield* namesAuthorizationServer(normalizeResource(url) ?? url, fetchFn, lookup).pipe(
    Effect.map((issuer) => issuer !== null),
    Effect.timeoutOrElse({ duration: remainingMs, orElse: () => Effect.succeed(false) }),
    Effect.catch(() => Effect.succeed(false)),
    Effect.ensuring(Effect.sync(() => controller.abort())),
  );
});

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

class McpInitializeUnreadable extends Error {
  constructor() {
    super("The server answered initialize with a result that is not an MCP initialize result.");
  }
}

function unreadableInitialize(failure: McpProbeFailure): McpProbeFailure {
  return failure.cause instanceof z.core.$ZodError
    ? new McpProbeFailure({ cause: new McpInitializeUnreadable() })
    : failure;
}

class McpServerExit extends Error {
  constructor(
    readonly output: string,
    readonly cut: boolean,
  ) {
    super("The MCP server stopped before it answered.");
  }
}

function serverOutput(error: McpServerExit, config: McpServerConfig): string {
  const output = redactMcpSecrets(error.output, config).trim();
  if (!error.cut && output.length <= MCP_STDERR_SHOWN) return output;
  return `…${output.slice(-MCP_STDERR_SHOWN).replace(/^[\uDC00-\uDFFF]/u, "")}`;
}

function describeMcpError(error: unknown, config: McpServerConfig): string {
  const described = describeMcpErrorText(error, config);
  const bridgeUrl = mcpRemoteBridgeUrl(config);
  if (
    bridgeUrl === null ||
    !(error instanceof McpTimeout || error instanceof McpServerExit || isConnectionClosed(error))
  )
    return described;
  return sourceText("error.backend.mcpRemoteBridge", { reason: described, url: bridgeUrl });
}

function describeMcpErrorText(error: unknown, config: McpServerConfig): string {
  if (error instanceof McpTimeout)
    return sourceText("error.backend.mcpServerNoAnswer", { seconds: Math.round(error.timeoutMs / 1000) });
  if (error instanceof UnauthorizedError) return sourceText("error.backend.mcpSignInNotAccepted");
  if (error instanceof McpServerExit && isPackageDownloadFailure(error.output))
    return sourceText("error.backend.mcpServerDownloadFailed");
  if (error instanceof McpServerExit)
    return sourceText("error.backend.mcpServerExitedWithOutput", { detail: serverOutput(error, config) });
  if (config.transport === "stdio" && isConnectionClosed(error)) return sourceText("error.backend.mcpServerExited");
  if (config.transport === "http") {
    const described = describeConnectionFailure(error, config.url);
    if (described) return described;
  }
  const status = httpStatus(error);
  if (status !== null) return httpStatusMessage(status);
  if (config.transport === "http" && isNetworkFailure(error)) return sourceText("error.backend.mcpServerUnreachable");
  if (config.transport === "http" && error instanceof McpInitializeUnreadable)
    return hasCredentialHeader(config)
      ? sourceText("error.backend.mcpServerKeyNotAccepted")
      : sourceText("error.backend.mcpServerIncompatible");
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT")) return sourceText("error.backend.mcpCommandNotFound", { command: config.command });
  return redactMcpSecrets(message, config);
}

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

const BUN_DOWNLOAD_FAILURE = /error: \w+ downloading (?:package manifest|tarball) /u;
const NPM_DOWNLOAD_FAILURE =
  /npm (?:ERR!|error) (?:code|errno) (?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b/u;

function isPackageDownloadFailure(output: string): boolean {
  return BUN_DOWNLOAD_FAILURE.test(output) || NPM_DOWNLOAD_FAILURE.test(output);
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

function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  for (let current = error; current instanceof Error && chain.length < 4; current = current.cause) chain.push(current);
  return chain;
}

function systemCode(error: Error): string | null {
  const code = isDynamicRecord(error) ? error.code : undefined;
  return typeof code === "string" ? code : null;
}

function isNetworkFailure(error: unknown): boolean {
  return causeChain(error).some((current) => {
    const code = systemCode(current);
    if (code !== null && NETWORK_ERROR_CODES.has(code)) return true;
    return current instanceof TypeError && current.message === "fetch failed";
  });
}

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

function isProtocolMismatch(error: Error, code: string | null): boolean {
  if (error instanceof StreamableHTTPError) return error.code === -1 || error.code === 405;
  return error.name === "HTTPParserError" || (code?.startsWith("HPE_") ?? false);
}

const REGISTRATION_REFUSED = sourceText("error.backend.mcpRegistrationRefused");

const REGISTRATION_UNAVAILABLE = sourceText("error.backend.mcpSignInAppNeeded");

function isAccessRefusal(status: number | null): boolean {
  return status === 401 || status === 403;
}

function isRegistrationRefusal(error: unknown, signIn: McpSignIn): boolean {
  if (signIn.registrationUnsupported()) return true;
  const status = signIn.registrationStatus();
  if (isAccessRefusal(status)) return true;
  if (signIn.registrationRedirectRefused()) return true;
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

function httpStatusMessage(status: number): string {
  if (isAccessRefusal(status)) return sourceText("error.backend.mcpServerHttpCredentials", { status });
  if (status === 404 || status === 410) return sourceText("error.backend.mcpServerHttpUrl", { status });
  return `The server answered ${status}.`;
}

function httpStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const code = isDynamicRecord(error) ? error.code : undefined;
  if (typeof code === "number" && code >= 100 && code < 600) return code;
  const match = /\b(4\d\d|5\d\d)\b/u.exec(error.message);
  return match ? Number(match[1]) : null;
}
