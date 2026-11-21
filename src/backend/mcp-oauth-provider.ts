import { randomUUID } from "node:crypto";
import {
  auth,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  refreshAuthorization,
  selectClientAuthMethod,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  InvalidClientError,
  InvalidGrantError,
  OAuthError,
  ServerError,
  TemporarilyUnavailableError,
  TooManyRequestsError,
  UnauthorizedClientError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  type AuthorizationServerMetadata,
  type OAuthClientInformationFull,
  OAuthClientInformationFullSchema,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MCP_SIGN_IN_TIMEOUT_MS, relayCallbackQuery } from "@openbot/contracts/ipc";
import { mcpAccountFragment } from "@openbot/contracts/mcp-accounts";
import { sourceText } from "@openbot/i18n/source";
import type { Logger } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Result, Scope } from "effect";
import { z } from "zod";
import { runCauseEffect } from "./effect-boundary";
import { readLimitedBody } from "./limited-body";
import { McpOperationError, mcpCall, mcpFailure, mcpSync, toMcpOperationError } from "./mcp-effects";
import {
  type AddressLookup,
  type AddressLookupError,
  hostAddresses,
  isPublicAddress,
  systemAddressLookup,
} from "./network-address";
import { withTimeout } from "./with-timeout";

const MCP_CLIENT_METADATA_URL = "https://openbot.run/oauth/mcp-client.json";

const MCP_CLIENT_NAME = "OpenBot";

export const MCP_OAUTH_RELAY_URL = "https://openbot.run/oauth/mcp-callback";

interface BuiltInMcpClient {
  resource: string;
  issuer: string;
  clientId: string;
  redirectUrl: string;
}

const BUILT_IN_MCP_CLIENTS: readonly BuiltInMcpClient[] = [
  {
    resource: "https://mcp.facebook.com/ads",
    issuer: "https://www.facebook.com/ads",
    clientId: "1479376854168579",
    redirectUrl: MCP_OAUTH_RELAY_URL,
  },
];

function builtInResourceKey(url: string): string | null {
  const resource = normalizeResource(url);
  if (!resource) return null;
  const parsed = new URL(resource);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function builtInMcpClients(resource: string): readonly BuiltInMcpClient[] {
  const key = builtInResourceKey(resource);
  return key === null ? [] : BUILT_IN_MCP_CLIENTS.filter((client) => builtInResourceKey(client.resource) === key);
}

function builtInMcpClient(resource: string, issuer: string | undefined): BuiltInMcpClient | undefined {
  if (!issuer) return undefined;
  return builtInMcpClients(resource).find((client) => issuersMatch(client.issuer, issuer));
}

function signInAppRedirectUrl(resource: string, own: string): string {
  return builtInMcpClients(resource)[0]?.redirectUrl ?? own;
}

export const MCP_OAUTH_CALLBACK_PATH = "/callback";

export const mcpOAuthRecordSchema = z.object({
  app: z
    .object({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1).optional(),
      scope: z.string().min(1).optional(),
      issuer: z.string().optional(),
    })
    .optional(),
  client: OAuthClientInformationFullSchema.optional(),
  tokens: OAuthTokensSchema.optional(),
  obtainedAt: z.number().optional(),
  discovery: z
    .object({
      authorizationServerUrl: z.string(),
      resourceMetadataUrl: z.string().optional(),
    })
    .optional(),
  lostAt: z.number().optional(),
});

export type McpOAuthRecord = z.infer<typeof mcpOAuthRecordSchema>;
type McpOAuthApp = NonNullable<McpOAuthRecord["app"]>;
type McpRefreshOutcome = "refreshed" | "lost" | "kept" | "unusable";
const KEPT: McpRefreshOutcome = "kept";

export interface McpOAuthAppSummary {
  clientId: string;
  secretSaved: boolean;
  scope: string;
}

export interface McpOAuthAppInput {
  clientId: string;
  clientSecret: string | null;
  scope: string;
}

export interface McpOAuthStorage {
  read: (resource: string) => McpOAuthRecord | null;
  write: (resource: string, record: McpOAuthRecord) => Effect.Effect<void, McpOperationError>;
  clear: (resource: string) => Effect.Effect<void, McpOperationError>;
}

export interface McpOAuthOptions {
  storage: McpOAuthStorage;
  openExternal: (url: string) => Promise<void>;
  redirectUrl: string;
  deepLinkRedirectUrl?: () => string | undefined;
  signInTimeoutMs?: number;
  refreshTimeoutMs?: number;
  revocationTimeoutMs?: number;
  logger?: Pick<Logger, "warn">;
  lookup?: AddressLookup;
}

export const MCP_TOKEN_TIMEOUT_MS = 10_000;

const TOKEN_REFRESH_MARGIN_MS = 60_000;

const MCP_REVOCATION_TIMEOUT_MS = 5_000;

export type McpSignInOffer = "none" | "offered" | "refused";

export interface McpSignIn {
  readonly provider: OAuthClientProvider;
  begin: () => Effect.Effect<boolean, McpOperationError>;
  complete: () => Effect.Effect<void, McpOperationError>;
  abandon: () => void;
  secrets: () => string[];
  registrationFailed: () => boolean;
  registrationUnsupported: () => boolean;
  signInServerMissing: () => boolean;
  registrationStatus: () => number | null;
  registrationRedirectRefused: () => boolean;
  watchRegistration: (fetch: FetchLike) => FetchLike;
  cancelled: () => boolean;
  exchangeFailed: () => boolean;
}

export type McpSignInOpener = (url: string) => Promise<void>;

export type McpSignInAddressOutcome = "received" | "ended" | "invalid";

export interface McpOAuthAuthority {
  accessToken: (url: string) => Effect.Effect<string | null, McpOperationError>;
  refreshAccessToken: (url: string, rejected: string) => Effect.Effect<string | null, McpOperationError>;
  signIn: (url: string, open?: McpSignInOpener, deepLinkRedirectUrl?: string) => McpSignIn | null;
  cancelSignIn: (url: string) => boolean;
  signInLink: (url: string) => string | null;
  receiveSignInAddress: (url: string, address: string) => McpSignInAddressOutcome;
  signedIn: (url: string) => boolean;
  needsSignIn: (url: string) => boolean;
  hasSignIn: (url: string) => boolean;
  signInOffer: (url: string) => Effect.Effect<McpSignInOffer>;
  signOut: (url: string) => Effect.Effect<void, McpOperationError>;
  forget: (url: string) => Effect.Effect<void, McpOperationError>;
  readonly redirectUrl: string;
  signInAppRedirectUrl: (url: string) => string;
  signInApp: (url: string) => McpOAuthAppSummary | null;
  saveSignInApp: (url: string, app: McpOAuthAppInput) => Effect.Effect<boolean, McpOperationError>;
  removeSignInApp: (url: string) => Effect.Effect<boolean, McpOperationError>;
}

export class McpOAuth implements McpOAuthAuthority {
  readonly #options: McpOAuthOptions;
  readonly #waiting = new Map<string, (code: string | null) => void>();
  readonly #openedElsewhere = new Set<string>();
  readonly #exchanges = new Map<string, Deferred.Deferred<boolean>>();
  readonly #attempts = new Map<string, () => void>();
  readonly #pages = new Map<string, McpOAuthClientProvider>();
  readonly #unanswered = new Map<string, string>();
  readonly #scope = Scope.makeUnsafe();
  readonly #refreshing = new Map<string, Fiber.Fiber<McpRefreshOutcome>>();
  readonly #generations = new Map<string, number>();

  constructor(options: McpOAuthOptions) {
    const refusal = describeUnusableRedirectUrl(options.redirectUrl);
    if (refusal) throw new Error(refusal);
    this.#options = options;
  }

  readonly accessToken = Effect.fn("McpOAuth.accessToken")(function* (
    this: McpOAuth,
    url: string,
  ): Effect.fn.Return<string | null, McpOperationError> {
    const key = mcpOAuthAccountKey(url);
    if (!key) return null;
    const stored = yield* mcpSync(() => this.#options.storage.read(key));
    if (!stored?.tokens) return null;
    const fallback = stored.tokens.access_token;
    if (!expiringSoon(stored)) return fallback;
    if (!credentialIssuer(stored.tokens, stored)) return fallback;
    yield* this.#refresh(key);
    return yield* mcpSync(() => this.#options.storage.read(key)?.tokens?.access_token ?? null);
  }).bind(this);

  readonly refreshAccessToken = Effect.fn("McpOAuth.refreshAccessToken")(function* (
    this: McpOAuth,
    url: string,
    rejected: string,
  ): Effect.fn.Return<string | null, McpOperationError> {
    const key = mcpOAuthAccountKey(url);
    if (!key) return null;
    const stored = yield* mcpSync(() => this.#options.storage.read(key));
    if (!stored?.tokens) return null;
    if (stored.tokens.access_token !== rejected) return stored.tokens.access_token;
    if (!stored.tokens.refresh_token || !credentialIssuer(stored.tokens, stored))
      return yield* this.#end(key, rejected);
    if ((yield* this.#refresh(key)) === "unusable") return yield* this.#end(key, rejected);
    const next = yield* mcpSync(() => this.#options.storage.read(key)?.tokens?.access_token ?? null);
    return next === rejected ? null : next;
  }).bind(this);

  readonly #end = Effect.fn("McpOAuth.end")(function* (this: McpOAuth, key: string, rejected: string) {
    const stored = yield* mcpSync(() => this.#options.storage.read(key));
    if (!stored?.tokens) return null;
    if (stored.tokens.access_token !== rejected) return stored.tokens.access_token;
    const { tokens: _tokens, obtainedAt: _obtainedAt, ...kept } = stored;
    yield* this.#options.storage.write(key, { ...kept, lostAt: Date.now() });
    return null;
  });

  readonly #refresh = Effect.fn("McpOAuth.refresh")(function* (this: McpOAuth, key: string) {
    const running = this.#refreshing.get(key);
    const timeoutMs = this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS;
    if (running) return yield* this.#awaitRefresh(running);
    const controller = new AbortController();
    const operation = this.#provider(key, null)
      .refresh(this.#fetch(key, controller.signal))
      .pipe(
        Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.succeed(KEPT) }),
        Effect.catch(() => Effect.succeed(KEPT)),
        Effect.ensuring(Effect.sync(() => controller.abort())),
      );
    const exchange = yield* Effect.forkIn(operation, this.#scope, { startImmediately: true });
    this.#refreshing.set(key, exchange);
    exchange.addObserver(() => {
      if (this.#refreshing.get(key) === exchange) this.#refreshing.delete(key);
    });
    return yield* this.#awaitRefresh(exchange);
  });

  #fetch(key: string, signal: AbortSignal): FetchLike {
    const { lookup } = this.#options;
    return secureOAuthFetch({ signal, resource: mcpOAuthServerUrl(key), ...(lookup ? { lookup } : {}) });
  }

  readonly #awaitRefresh = Effect.fn("McpOAuth.awaitRefresh")((exchange: Fiber.Fiber<McpRefreshOutcome>) =>
    Fiber.join(exchange).pipe(
      Effect.timeoutOrElse({
        duration: this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS,
        orElse: () => Effect.succeed(KEPT),
      }),
    ),
  );

  readonly close = Effect.fn("McpOAuth.close")(() =>
    Scope.close(this.#scope, Exit.void).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const cancel of [...this.#attempts.values()]) cancel();
          this.#pages.clear();
          this.#waiting.clear();
          this.#openedElsewhere.clear();
        }),
      ),
    ),
  );

  signIn(url: string, open?: McpSignInOpener, deepLinkRedirectUrl?: string): McpSignIn | null {
    const key = mcpOAuthAccountKey(url);
    if (!key) return null;
    this.#attempts.get(key)?.();
    const unanswered = this.#unanswered.get(key);
    this.#unanswered.delete(key);
    const state = randomUUID();
    const grant = Deferred.makeUnsafe<string, Error>();
    let refused = false;
    this.#waiting.set(state, (code) => {
      refused = code === null;
      Deferred.doneUnsafe(
        grant,
        code === null ? Effect.fail(new Error(sourceText("error.backend.mcpSignInRefused"))) : Effect.succeed(code),
      );
    });
    if (open) this.#openedElsewhere.add(state);
    const exchanged = Deferred.makeUnsafe<boolean>();
    this.#exchanges.set(state, exchanged);
    let abandoned = false;
    let cancelled = false;
    let exchangeFailed = false;
    const resource = mcpOAuthServerUrl(key);
    const provider = this.#provider(key, state, () => abandoned, open, unanswered, deepLinkRedirectUrl);
    const abandon = () => {
      const unansweredNow = provider.openedRedirectUrl ?? unanswered;
      if (!abandoned && this.#waiting.has(state) && unansweredNow) this.#unanswered.set(key, unansweredNow);
      abandoned = true;
      this.#waiting.delete(state);
      this.#openedElsewhere.delete(state);
      Deferred.doneUnsafe(exchanged, Effect.succeed(false));
      this.#exchanges.delete(state);
      if (this.#attempts.get(key) === cancel) this.#attempts.delete(key);
      if (this.#pages.get(key) === provider) this.#pages.delete(key);
    };
    const cancel = () => {
      if (refused) return;
      cancelled = true;
      Deferred.doneUnsafe(grant, Effect.fail(new Error(sourceText("error.backend.mcpSignInCancelled"))));
      abandon();
    };
    this.#attempts.set(key, cancel);
    this.#pages.set(key, provider);
    return {
      provider,
      begin: () =>
        Effect.gen({ self: this }, function* () {
          if (cancelled || abandoned || this.#options.storage.read(key)?.tokens) return false;
          const controller = new AbortController();
          const fetchFn = provider.watchRegistration(this.#fetch(key, controller.signal));
          return yield* withTimeout(
            Effect.gen(function* () {
              if (!(yield* namesAuthorizationServer(resource, fetchFn))) return false;
              return (yield* mcpCall(() => auth(provider, { serverUrl: resource, fetchFn }))) === "REDIRECT";
            }),
            this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS,
            sourceText("error.backend.mcpSignInResponseTimedOut"),
          ).pipe(Effect.mapError(mcpFailure), Effect.ensuring(Effect.sync(() => controller.abort())));
        }),
      complete: () =>
        Effect.gen({ self: this }, function* () {
          if (cancelled) return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInCancelled")));
          if (abandoned) return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInAbandonedGeneric")));
          const controller = new AbortController();
          yield* Effect.gen({ self: this }, function* () {
            const code = yield* withTimeout(
              Deferred.await(grant),
              this.#options.signInTimeoutMs ?? MCP_SIGN_IN_TIMEOUT_MS,
              sourceText("error.backend.mcpSignInTimedOut"),
            ).pipe(Effect.mapError(mcpFailure));
            provider.recordSecret(code);
            provider.beginCodeExchange();
            yield* withTimeout(
              mcpCall(() =>
                auth(provider, {
                  serverUrl: resource,
                  authorizationCode: code,
                  fetchFn: this.#fetch(key, controller.signal),
                }),
              ).pipe(
                Effect.tapError(() =>
                  Effect.sync(() => {
                    exchangeFailed = true;
                  }),
                ),
              ),
              this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS,
              sourceText("error.backend.mcpSignInResponseTimedOut"),
            ).pipe(Effect.mapError(mcpFailure));
            Deferred.doneUnsafe(exchanged, Effect.succeed(true));
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                controller.abort();
                abandon();
              }),
            ),
          );
        }),
      abandon,
      secrets: () => provider.secrets(),
      registrationFailed: () => provider.registrationPending,
      registrationUnsupported: () => provider.registrationUnsupported,
      signInServerMissing: () => provider.signInServerMissing,
      registrationStatus: () => provider.registrationStatus,
      registrationRedirectRefused: () => provider.redirectRefused,
      watchRegistration: (fetch) => provider.watchRegistration(fetch),
      cancelled: () => cancelled,
      exchangeFailed: () => exchangeFailed,
    };
  }

  receiveAuthorizationCode(state: string, code: string): boolean {
    const deliver = this.#waiting.get(state);
    if (!deliver) return false;
    this.#waiting.delete(state);
    deliver(code);
    return true;
  }

  refuseAuthorization(state: string): boolean {
    const deliver = this.#waiting.get(state);
    if (!deliver) return false;
    this.#waiting.delete(state);
    deliver(null);
    return true;
  }

  openedElsewhere(state: string): boolean {
    return this.#openedElsewhere.has(state);
  }

  grantExchange(state: string): Effect.Effect<boolean> | null {
    const exchanged = this.#exchanges.get(state);
    return exchanged ? Deferred.await(exchanged) : null;
  }

  cancelSignIn(url: string): boolean {
    const key = mcpOAuthAccountKey(url);
    const cancel = key ? this.#attempts.get(key) : undefined;
    cancel?.();
    return cancel !== undefined;
  }

  signInLink(url: string): string | null {
    const key = mcpOAuthAccountKey(url);
    return (key && this.#pages.get(key)?.openedUrl) ?? null;
  }

  receiveSignInAddress(url: string, address: string): McpSignInAddressOutcome {
    const page = this.signInLink(url);
    const state = page ? URL.parse(page)?.searchParams.get("state") : null;
    if (!state || !this.#waiting.has(state)) return "ended";
    const query = relayCallbackQuery(address, state);
    if (query === null) return "invalid";
    const code = new URLSearchParams(query).get("code");
    const received = code ? this.receiveAuthorizationCode(state, code) : this.refuseAuthorization(state);
    return received ? "received" : "ended";
  }

  signedIn(url: string): boolean {
    const key = mcpOAuthAccountKey(url);
    const record = key === null ? undefined : this.#options.storage.read(key);
    return Boolean(record?.tokens && (record.tokens.refresh_token || !expiringSoon(record, 0)));
  }

  needsSignIn(url: string): boolean {
    const key = mcpOAuthAccountKey(url);
    const record = key === null ? undefined : this.#options.storage.read(key);
    return record?.lostAt !== undefined && !record.tokens;
  }

  hasSignIn(url: string): boolean {
    const key = mcpOAuthAccountKey(url);
    const record = key === null ? undefined : this.#options.storage.read(key);
    return record?.tokens !== undefined || record?.lostAt !== undefined;
  }

  readonly signInOffer = Effect.fn("McpOAuth.signInOffer")(function* (this: McpOAuth, url: string) {
    const key = mcpOAuthAccountKey(url);
    const record = key === null ? undefined : this.#options.storage.read(key);
    if (!key || record?.tokens) return "none";
    const controller = new AbortController();
    const fetchFn = this.#fetch(key, controller.signal);
    const timeoutMs = this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS;
    return yield* Effect.gen(function* () {
      const issuer = yield* namesAuthorizationServer(mcpOAuthServerUrl(key), fetchFn).pipe(
        Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.succeed(null) }),
        Effect.catch(() => Effect.succeed(null)),
      );
      if (!issuer) return "none";
      const client = record?.client;
      if (record?.app || (client && (typeof client.issuer !== "string" || issuersMatch(client.issuer, issuer))))
        return "offered";
      return (yield* acceptsNewClient(issuer, fetchFn, timeoutMs)) ? "offered" : "refused";
    }).pipe(Effect.ensuring(Effect.sync(() => controller.abort())));
  });

  get redirectUrl(): string {
    return this.#options.redirectUrl;
  }

  signInAppRedirectUrl(url: string): string {
    return signInAppRedirectUrl(url, this.#options.redirectUrl);
  }

  readonly forget = Effect.fn("McpOAuth.forget")(function* (this: McpOAuth, url: string) {
    const key = mcpOAuthAccountKey(url);
    if (!key) return;
    const record = this.#options.storage.read(key);
    this.#invalidate(key);
    yield* this.#options.storage.clear(key);
    yield* this.#revoke(key, record);
  }).bind(this);

  readonly signOut = Effect.fn("McpOAuth.signOut")(function* (this: McpOAuth, url: string) {
    const key = mcpOAuthAccountKey(url);
    if (!key) return;
    const record = this.#options.storage.read(key);
    const app = record?.app;
    this.#invalidate(key);
    if (app) yield* this.#options.storage.write(key, { app });
    else yield* this.#options.storage.clear(key);
    yield* this.#revoke(key, record);
  }).bind(this);

  #revoke(key: string, record: McpOAuthRecord | null): Effect.Effect<void> {
    const tokens = record?.tokens;
    if (!record || !tokens) return Effect.void;
    const issuer = credentialIssuer(tokens, record);
    const client = revocationClient(record, issuer);
    if (!issuer || !client) return Effect.void;
    const timeoutMs = this.#options.revocationTimeoutMs ?? MCP_REVOCATION_TIMEOUT_MS;
    const logger = this.#options.logger;
    const origin = new URL(key).origin;
    const controller = new AbortController();
    const fetchFn = this.#fetch(key, controller.signal);
    const revocation = Effect.gen(function* () {
      const metadata = yield* mcpCall(() => discoverAuthorizationServerMetadata(issuer, { fetchFn })).pipe(
        Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.succeed(undefined) }),
      );
      const endpoint = revocationEndpoint(metadata);
      if (!endpoint) return;
      for (const [token, hint] of [
        [tokens.refresh_token, "refresh_token"],
        [tokens.access_token, "access_token"],
      ] as const) {
        if (!token) continue;
        const status = yield* revokeToken(endpoint, token, hint, client, metadata, fetchFn).pipe(
          Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.succeed("timeout") }),
          Effect.catch((error) => Effect.succeed(errorKind(error))),
        );
        if (status !== "ok") logger?.warn("An MCP token was not revoked.", { origin, hint, status });
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => logger?.warn("An MCP token was not revoked.", { origin, status: errorKind(error) })),
      ),
      Effect.ensuring(Effect.sync(() => controller.abort())),
    );
    return Effect.forkIn(revocation, this.#scope, { startImmediately: true }).pipe(Effect.asVoid);
  }

  signInApp(url: string): McpOAuthAppSummary | null {
    const key = mcpOAuthAccountKey(url);
    const app = key ? this.#options.storage.read(key)?.app : undefined;
    return app ? { clientId: app.clientId, secretSaved: app.clientSecret !== undefined, scope: app.scope ?? "" } : null;
  }

  readonly saveSignInApp = Effect.fn("McpOAuth.saveSignInApp")(function* (
    this: McpOAuth,
    url: string,
    input: McpOAuthAppInput,
  ): Effect.fn.Return<boolean, McpOperationError> {
    const key = mcpOAuthAccountKey(url);
    if (!key) return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInAppUrl")));
    const record = this.#options.storage.read(key) ?? {};
    const clientId = input.clientId.trim();
    const scope = input.scope.trim();
    const clientSecret = input.clientSecret === null ? record.app?.clientSecret : input.clientSecret || undefined;
    const app: McpOAuthApp = {
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      ...(scope ? { scope } : {}),
    };
    const sameClient =
      record.app !== undefined && record.app.clientId === app.clientId && record.app.clientSecret === app.clientSecret;
    const issuer =
      sameClient || (app.clientSecret && app.clientSecret === record.app?.clientSecret)
        ? record.app?.issuer
        : undefined;
    const boundApp = { ...app, ...(issuer ? { issuer } : {}) };
    if (sameClient) {
      yield* this.#options.storage.write(key, { ...record, app: boundApp });
      return false;
    }
    this.#invalidate(key);
    yield* this.#options.storage.write(key, {
      app: boundApp,
      ...(record.discovery ? { discovery: record.discovery } : {}),
    });
    return record.tokens !== undefined;
  }).bind(this);

  readonly removeSignInApp = Effect.fn("McpOAuth.removeSignInApp")(function* (
    this: McpOAuth,
    url: string,
  ): Effect.fn.Return<boolean, McpOperationError> {
    const key = mcpOAuthAccountKey(url);
    const record = key ? this.#options.storage.read(key) : null;
    if (!key || !record?.app) return false;
    this.#invalidate(key);
    yield* this.#options.storage.write(key, record.discovery ? { discovery: record.discovery } : {});
    return true;
  }).bind(this);

  #invalidate(key: string): void {
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    this.#attempts.get(key)?.();
    this.#unanswered.delete(key);
  }

  #provider(
    key: string,
    state: string | null,
    isAbandoned: () => boolean = () => false,
    open?: McpSignInOpener,
    unansweredRedirectUrl?: string,
    openedDeepLinkRedirectUrl?: string,
  ): McpOAuthClientProvider {
    const generation = this.#generations.get(key) ?? 0;
    const storage = this.#options.storage;
    const stored = storage.read(key);
    const ensureCurrent = (): void => {
      if ((this.#generations.get(key) ?? 0) !== generation)
        throw new Error(sourceText("error.backend.mcpSignInForgotten"));
      if (isAbandoned()) throw new Error(sourceText("error.backend.mcpSignInAbandoned"));
    };
    const guarded: McpOAuthStorage = {
      read: (candidate) => storage.read(candidate),
      write: (candidate, record) =>
        Effect.gen({ self: this }, function* () {
          yield* mcpSync(ensureCurrent);
          yield* storage.write(candidate, record);
        }),
      clear: (candidate) =>
        Effect.gen({ self: this }, function* () {
          yield* mcpSync(ensureCurrent);
          yield* storage.clear(candidate);
        }),
    };
    return new McpOAuthClientProvider({
      key,
      resource: mcpOAuthServerUrl(key),
      state,
      storage: guarded,
      redirectUrl: this.#options.redirectUrl,
      deepLinkRedirectUrl: open ? () => openedDeepLinkRedirectUrl : this.#options.deepLinkRedirectUrl,
      openExternal: open ?? this.#options.openExternal,
      isAbandoned,
      legacyIssuer: legacyIssuer(stored),
      hasUnboundCredentials: hasUnboundCredentials(stored),
      unansweredRedirectUrl,
    });
  }
}

interface ClientProviderOptions {
  key: string;
  resource: string;
  state: string | null;
  storage: McpOAuthStorage;
  redirectUrl: string;
  deepLinkRedirectUrl?: (() => string | undefined) | undefined;
  openExternal: (url: string) => Promise<void>;
  isAbandoned: () => boolean;
  legacyIssuer: string | undefined;
  hasUnboundCredentials: boolean;
  unansweredRedirectUrl?: string | undefined;
}

class McpOAuthClientProvider implements OAuthClientProvider {
  readonly #options: ClientProviderOptions;
  #codeVerifier: string | null = null;
  readonly #secrets = new Set<string>();
  #exchangingCode = false;
  #appRefused = false;
  #registeredClient: OAuthClientInformationFull | undefined;
  #activeIssuer: string | undefined;
  #discoveryState: OAuthDiscoveryState | undefined;
  clientMetadataUrl?: string;
  #registrationPending = false;
  #registrationStatus: number | null = null;
  #redirectRefused = false;

  constructor(options: ClientProviderOptions) {
    this.#options = options;
    this.#localhostRedirectUrl = localhostRedirectUrl(options.redirectUrl);
    const { unansweredRedirectUrl: unanswered } = options;
    this.#deepLinkRedirectUrl =
      unanswered === this.#localhostRedirectUrl ? (options.deepLinkRedirectUrl?.() ?? null) : null;
    this.#retryRedirectUrl = this.#deepLinkRedirectUrl ?? this.#otherRedirectName(unanswered);
  }

  readonly #localhostRedirectUrl: string | null;
  readonly #deepLinkRedirectUrl: string | null;
  readonly #retryRedirectUrl: string | null;
  #openedRedirectUrl: string | null = null;
  #openedUrl: string | null = null;

  #otherRedirectName(redirectUrl: string | null | undefined): string | null {
    const localhost = this.#localhostRedirectUrl;
    if (!localhost) return null;
    if (redirectUrl === this.#options.redirectUrl) return localhost;
    return redirectUrl === localhost ? this.#options.redirectUrl : null;
  }

  get redirectUrl(): string {
    const record = this.#record();
    const own = this.#options.redirectUrl;
    if (record.app) return signInAppRedirectUrl(this.#options.resource, own);
    const builtIn = builtInMcpClient(this.#options.resource, this.#activeIssuer);
    if (builtIn) return builtIn.redirectUrl;
    const client = this.#registeredClient ?? record.client;
    if (!client) return own;
    const deepLink = this.#deepLinkRedirectUrl;
    if (deepLink && client.redirect_uris.includes(deepLink)) return deepLink;
    const localhost = this.#localhostRedirectUrl;
    if (localhost && registersAddress(client.redirect_uris, localhost)) return localhost;
    if (registersAddress(client.redirect_uris, own)) return own;
    for (const address of [own, localhost]) {
      const callback = address ? callbackRedirectUrl(address) : null;
      if (callback && registersAddress(client.redirect_uris, callback)) return callback;
    }
    return own;
  }

  get clientMetadata(): OAuthClientMetadata & { application_type: "native" } {
    const { app } = this.#record();
    const scope = app ? app.scope : this.#authorizationServerScope();
    const methods = this.#discoveryState?.authorizationServerMetadata?.token_endpoint_auth_methods_supported;
    return {
      client_name: MCP_CLIENT_NAME,
      client_uri: "https://openbot.run",
      logo_uri: "https://openbot.run/icon-512x512.png",
      redirect_uris: [this.#retryRedirectUrl ?? this.#options.redirectUrl],
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...tokenEndpointAuthMethod(methods),
      ...(scope ? { scope } : {}),
    };
  }

  #authorizationServerScope(): string | undefined {
    const discovery = this.#discoveryState;
    if (!discovery || discovery.resourceMetadata) return undefined;
    return discovery.authorizationServerMetadata?.scopes_supported?.join(" ") || undefined;
  }

  state(): string {
    const { state } = this.#options;
    if (!state) throw new Error(sourceText("error.backend.mcpSignInNoBrowser"));
    return state;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    const record = this.#record();
    if (record.app) {
      const { issuer } = record.app;
      if (issuer && this.#activeIssuer && !issuersMatch(issuer, this.#activeIssuer))
        throw new Error(sourceText("error.backend.mcpSignInAppIssuerChanged"));
      if (this.#appRefused) throw new Error(sourceText("error.backend.mcpSignInAppRefused"));
      this.recordSecret(record.app.clientSecret);
      return {
        client_id: record.app.clientId,
        ...(record.app.clientSecret ? { client_secret: record.app.clientSecret } : {}),
        redirect_uris: [signInAppRedirectUrl(this.#options.resource, this.#options.redirectUrl)],
        ...(issuer ? { issuer } : {}),
      };
    }
    const builtIn = builtInMcpClient(this.#options.resource, this.#activeIssuer);
    if (builtIn)
      return {
        client_id: builtIn.clientId,
        redirect_uris: [builtIn.redirectUrl],
        token_endpoint_auth_method: "none",
        issuer: builtIn.issuer,
      };
    const client = this.#registeredClient ?? this.#credential(record.client);
    this.recordSecret(record.client?.client_secret);
    if (!client) {
      if (this.#exchangingCode) throw new Error(sourceText("error.backend.mcpSignInClientRefused"));
      return this.#register();
    }
    if (!this.#options.state || this.#exchangingCode) return client;
    const discovery = this.#discoveryState;
    if (client.client_id === MCP_CLIENT_METADATA_URL && discovery?.authorizationServerMetadata?.registration_endpoint)
      return this.#register();
    const retry = this.#retryRedirectUrl;
    if (retry && client.client_id !== MCP_CLIENT_METADATA_URL && !registersAddress(client.redirect_uris, retry))
      return this.#register();
    const scopeAllowed =
      !client.scope ||
      !discovery?.resourceMetadata?.scopes_supported?.length ||
      !scopeWithOfflineAccess(client.scope, discovery.authorizationServerMetadata);
    if (registersAddress(client.redirect_uris, this.redirectUrl) && scopeAllowed) return client;
    return this.#register();
  }

  get openedRedirectUrl(): string | null {
    return this.#openedRedirectUrl;
  }

  get openedUrl(): string | null {
    return this.#openedUrl;
  }

  get registrationPending(): boolean {
    return this.#registrationPending;
  }

  get registrationUnsupported(): boolean {
    const metadata = this.#discoveryState?.authorizationServerMetadata;
    return this.#registrationPending && metadata !== undefined && !metadata.registration_endpoint;
  }

  get signInServerMissing(): boolean {
    const discovery = this.#discoveryState;
    return (
      this.#registrationPending &&
      this.#registrationStatus !== null &&
      discovery !== undefined &&
      !discovery.authorizationServerMetadata &&
      !discovery.resourceMetadata
    );
  }

  get registrationStatus(): number | null {
    return this.#registrationStatus;
  }

  get redirectRefused(): boolean {
    return this.#redirectRefused;
  }

  watchRegistration(fetch: FetchLike): FetchLike {
    return async (input, init) => {
      const registrationUrl = this.#registrationUrl();
      const registering =
        init?.method === "POST" && registrationUrl !== null && new URL(String(input)).href === registrationUrl;
      if (!registering) return fetch(input, init);
      const request = this.#withOfflineAccessRegistration(init);
      let response = await fetch(input, request);
      for (const retry of this.#withOtherRedirectNames(request)) {
        if (!(await refusesRedirectAddress(response))) break;
        response = await fetch(input, retry);
      }
      const callback = response.status === 401 || response.status === 403 ? this.#withCallbackPath(request) : null;
      const retried = callback ? await fetch(input, callback) : null;
      if (retried?.ok) response = retried;
      this.#registrationStatus = response.status;
      const redirectRefused = (await registrationErrorCode(response)) === "invalid_redirect_uri";
      this.#redirectRefused = redirectRefused;
      if (!this.#documentReplacesRefusal(response.status)) return response;
      this.#redirectRefused = false;
      await response.body?.cancel();
      return Response.json(
        {
          client_id: MCP_CLIENT_METADATA_URL,
          redirect_uris: [this.#options.redirectUrl],
          token_endpoint_auth_method: "none",
        },
        { status: 201 },
      );
    };
  }

  #withCallbackPath(init: RequestInit): RequestInit | null {
    if (typeof init.body !== "string") return null;
    const body = registrationBodySchema.parse(JSON.parse(init.body));
    const sent = body.redirect_uris?.length === 1 ? body.redirect_uris[0] : undefined;
    const own = sent === this.#options.redirectUrl || sent === this.#localhostRedirectUrl;
    const callback = sent && own ? callbackRedirectUrl(sent) : null;
    return callback ? { ...init, body: JSON.stringify({ ...body, redirect_uris: [callback] }) } : null;
  }

  #documentReplacesRefusal(status: number): boolean {
    if (status !== 401 && status !== 403) return false;
    const metadata = this.#discoveryState?.authorizationServerMetadata;
    return (
      metadata?.client_id_metadata_document_supported === true &&
      (metadata.token_endpoint_auth_methods_supported?.includes("none") ?? false)
    );
  }

  #withOtherRedirectNames(init: RequestInit): RequestInit[] {
    const localhost = this.#localhostRedirectUrl;
    if (!localhost || typeof init.body !== "string") return [];
    const body = registrationBodySchema.parse(JSON.parse(init.body));
    const sent = body.redirect_uris?.length === 1 ? body.redirect_uris[0] : undefined;
    const deepLink = this.#deepLinkRedirectUrl;
    const other = this.#otherRedirectName(sent);
    const names = deepLink && sent === deepLink ? [this.#options.redirectUrl, localhost] : other ? [other] : [];
    return names.map((name) => ({ ...init, body: JSON.stringify({ ...body, redirect_uris: [name] }) }));
  }

  #withOfflineAccessRegistration(init: RequestInit): RequestInit {
    if (typeof init.body !== "string") return init;
    const body = registrationBodySchema.parse(JSON.parse(init.body));
    const scope = scopeWithOfflineAccess(body.scope ?? null, this.#discoveryState?.authorizationServerMetadata);
    return scope ? { ...init, body: JSON.stringify({ ...body, scope }) } : init;
  }

  #registrationUrl(): string | null {
    const discovery = this.#discoveryState;
    if (!discovery) return null;
    const endpoint = discovery.authorizationServerMetadata
      ? discovery.authorizationServerMetadata.registration_endpoint
      : new URL("/register", discovery.authorizationServerUrl).href;
    return endpoint && URL.canParse(endpoint) ? new URL(endpoint).href : null;
  }

  #register(): undefined {
    this.#registrationPending = true;
    return undefined;
  }

  beginCodeExchange(): void {
    this.#exchangingCode = true;
  }

  saveClientInformation(information: OAuthClientInformationFull): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        this.#registrationPending = false;
        this.#registrationStatus = null;
        this.#redirectRefused = false;
        this.recordSecret(information.client_secret);
        const { app, client: stored } = this.#record();
        if (app) {
          if (!app.issuer && typeof information.issuer === "string" && information.client_id === app.clientId)
            yield* this.#save({ app: { ...app, issuer: information.issuer } });
          return;
        }
        const client: OAuthClientInformationFull =
          information.client_id === MCP_CLIENT_METADATA_URL
            ? { ...information, redirect_uris: [this.#options.redirectUrl], token_endpoint_auth_method: "none" }
            : information.client_id === stored?.client_id
              ? information
              : withIssuedSecretMethod(
                  information,
                  this.#discoveryState?.authorizationServerMetadata?.token_endpoint_auth_methods_supported,
                );
        if (this.#options.state && !this.#exchangingCode && this.#record().tokens) {
          this.#registeredClient = client;
          return;
        }
        yield* this.#save({ client });
      }),
    );
  }

  tokens(): OAuthTokens | undefined {
    const tokens = this.#credential(this.#record().tokens);
    this.#recordTokens(tokens);
    if (!tokens?.refresh_token || !this.#options.state || this.#exchangingCode) return tokens;
    const { refresh_token: _refreshToken, ...withoutRefresh } = tokens;
    return withoutRefresh;
  }

  saveTokens(tokens: OAuthTokens): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        this.#recordTokens(tokens);
        const client = this.#registeredClient;
        yield* this.#save({ ...(client ? { client } : {}), tokens, obtainedAt: Date.now(), lostAt: undefined });
        this.#registeredClient = undefined;
      }),
    );
  }

  readonly refresh = Effect.fn("McpOAuthClientProvider.refresh")(function* (
    this: McpOAuthClientProvider,
    fetchFn: FetchLike,
  ): Effect.fn.Return<McpRefreshOutcome, McpOperationError> {
    const stored = this.#record();
    const discovery = this.discoveryState();
    const issuer =
      discovery?.authorizationServerUrl ??
      (typeof stored.tokens?.issuer === "string" ? stored.tokens.issuer : undefined);
    if (!issuer) return "unusable";
    this.#activeIssuer = issuer;
    const tokens = this.tokens();
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken) return "kept";
    if (typeof tokens.issuer === "string" && !issuersMatch(tokens.issuer, issuer)) return "unusable";
    const client = yield* mcpSync(() => this.clientInformation());
    if (!client || (typeof client.issuer === "string" && !issuersMatch(client.issuer, issuer))) return "unusable";
    const metadata = yield* mcpCall(() => discoverAuthorizationServerMetadata(issuer, { fetchFn }));
    const resourceMetadata = yield* mcpCall(() =>
      discoverOAuthProtectedResourceMetadata(
        this.#options.resource,
        discovery?.resourceMetadataUrl ? { resourceMetadataUrl: discovery.resourceMetadataUrl } : {},
        fetchFn,
      ),
    ).pipe(Effect.catch(() => Effect.succeed(undefined)));
    const selected = yield* mcpCall(() => selectResourceURL(this.#options.resource, this, resourceMetadata));
    const resource = selected && resourceMetadata ? resourceMetadata.resource : selected;
    const result = yield* Effect.result(
      mcpCall(() =>
        refreshAuthorization(issuer, {
          ...(metadata ? { metadata } : {}),
          clientInformation: client,
          refreshToken,
          ...(resource ? { resource } : {}),
          fetchFn,
        }),
      ),
    );
    if (Result.isSuccess(result)) {
      if (typeof client.issuer !== "string")
        yield* mcpCall(() => this.saveClientInformation({ ...client, issuer })).pipe(Effect.catch(() => Effect.void));
      yield* mcpCall(() => this.saveTokens({ ...result.success, issuer }));
      return "refreshed";
    }
    const cause = result.failure.cause;
    const clientRefused = cause instanceof InvalidClientError || cause instanceof UnauthorizedClientError;
    if (!clientRefused && !(cause instanceof InvalidGrantError)) return refreshCanPass(cause) ? "kept" : "unusable";
    const current = this.#record();
    if (current.tokens?.refresh_token !== refreshToken) return "kept";
    const { tokens: _tokens, obtainedAt: _obtainedAt, client: registration, ...kept } = current;
    yield* this.#options.storage.write(this.#options.key, {
      ...kept,
      ...(registration && !clientRefused ? { client: registration } : {}),
      lostAt: Date.now(),
    });
    return "lost";
  });

  recordSecret(value: string | undefined): void {
    if (value) this.#secrets.add(value);
  }

  secrets(): string[] {
    return [...this.#secrets];
  }

  #recordTokens(tokens: OAuthTokens | undefined): void {
    this.recordSecret(tokens?.access_token);
    this.recordSecret(tokens?.refresh_token);
  }

  redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        if (this.#options.isAbandoned()) return;
        if (!this.#options.state) return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInNoBrowser")));
        if (!isAuthorizationUrlSafe(authorizationUrl))
          return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInNotWebPage")));
        const { app } = this.#record();
        const url = withGoogleOfflineAccess(
          app?.scope
            ? withAppScope(authorizationUrl, app)
            : withOfflineAccess(authorizationUrl, this.#discoveryState?.authorizationServerMetadata),
        );
        this.#openedUrl = url.toString();
        yield* mcpCall(() => this.#options.openExternal(url.toString()));
        this.#openedRedirectUrl = url.searchParams.get("redirect_uri");
      }),
    );
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        this.#activeIssuer = discovery.authorizationServerUrl;
        this.#discoveryState = discovery;
        const metadata = discovery.authorizationServerMetadata;
        if (metadata && !metadata.registration_endpoint) this.clientMetadataUrl = MCP_CLIENT_METADATA_URL;
        if (
          this.#options.hasUnboundCredentials &&
          (!this.#options.legacyIssuer || !issuersMatch(this.#options.legacyIssuer, discovery.authorizationServerUrl))
        )
          return;
        yield* this.#save({
          discovery: {
            authorizationServerUrl: discovery.authorizationServerUrl,
            resourceMetadataUrl: discovery.resourceMetadataUrl,
          },
        });
      }),
    );
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    const stored = this.#record().discovery;
    const discovery =
      this.#discoveryState ??
      (stored
        ? {
            authorizationServerUrl: stored.authorizationServerUrl,
            ...(stored.resourceMetadataUrl ? { resourceMetadataUrl: stored.resourceMetadataUrl } : {}),
          }
        : undefined);
    this.#discoveryState = discovery;
    this.#activeIssuer = discovery?.authorizationServerUrl;
    return discovery;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.recordSecret(codeVerifier);
    this.#codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.#codeVerifier) throw new Error("This MCP sign-in has no code verifier.");
    return this.#codeVerifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        if (scope === "verifier" || scope === "discovery") {
          if (scope === "verifier") this.#codeVerifier = null;
          else {
            this.#discoveryState = undefined;
            this.#activeIssuer = undefined;
            yield* this.#save({ discovery: undefined });
          }
          return;
        }
        const record = yield* mcpSync(() => this.#record());
        if (scope !== "tokens") this.#registeredClient = undefined;
        if (scope !== "tokens" && this.#exchangingCode && record.app) this.#appRefused = true;
        if (scope === "all") {
          this.#codeVerifier = null;
          if (record.app) yield* this.#options.storage.write(this.#options.key, { app: record.app });
          else yield* this.#options.storage.clear(this.#options.key);
          return;
        }
        const { tokens, obtainedAt, client, ...kept } = record;
        yield* this.#options.storage.write(
          this.#options.key,
          scope === "client" ? { ...kept, tokens, obtainedAt } : { ...kept, client },
        );
      }),
    );
  }

  #record(): McpOAuthRecord {
    return this.#options.storage.read(this.#options.key) ?? {};
  }

  #credential<T extends Pick<OAuthTokens, "issuer">>(credential: T | undefined): T | undefined {
    if (!credential) return undefined;
    if (typeof credential.issuer === "string") return credential;
    return this.#options.legacyIssuer &&
      this.#activeIssuer &&
      issuersMatch(this.#options.legacyIssuer, this.#activeIssuer)
      ? credential
      : undefined;
  }

  readonly #save = Effect.fn("McpOAuthClientProvider.save")(function* (
    this: McpOAuthClientProvider,
    part: Partial<McpOAuthRecord>,
  ): Effect.fn.Return<void, McpOperationError> {
    const record = yield* mcpSync(() => this.#record());
    const next = { ...record, ...part };
    if (!("discovery" in part) && this.#discoveryState && !hasUnboundCredentials(next)) {
      next.discovery = {
        authorizationServerUrl: this.#discoveryState.authorizationServerUrl,
        resourceMetadataUrl: this.#discoveryState.resourceMetadataUrl,
      };
    }
    yield* this.#options.storage.write(this.#options.key, next);
  });
}

export function normalizeResource(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function mcpOAuthAccountKey(url: string): string | null {
  const resource = normalizeResource(url);
  if (!resource) return null;
  const fragment = mcpAccountFragment(url);
  return fragment ? `${resource}${fragment}` : resource;
}

function mcpOAuthServerUrl(key: string): string {
  return normalizeResource(key) ?? key;
}

export const namesAuthorizationServer = Effect.fnUntraced(function* (resource: string, fetchFn: FetchLike) {
  let metadataStatus: number | null = null;
  const metadataFetch: FetchLike = async (input, init) => {
    metadataStatus = null;
    const response = await fetchFn(input, init);
    metadataStatus = response.status;
    return response;
  };
  const metadata = yield* mcpCall(() =>
    discoverOAuthProtectedResourceMetadata(resource, undefined, metadataFetch),
  ).pipe(
    Effect.catch(() => {
      if (metadataStatus !== null && metadataStatus < 500 && metadataStatus !== 408 && metadataStatus !== 429)
        return Effect.succeed(null);
      return Effect.fail(new Error(sourceText("error.backend.mcpSignInMetadataUnreadable")));
    }),
  );
  if (metadata) return metadata.authorization_servers?.[0] ?? null;
  const origin = String(new URL("/", resource));
  return yield* mcpCall(() => discoverAuthorizationServerMetadata(origin, { fetchFn })).pipe(
    Effect.map((found) => (found ? origin : null)),
    Effect.catch(() => Effect.succeed(null)),
  );
});

const acceptsNewClient = Effect.fnUntraced(function* (issuer: string, fetchFn: FetchLike, timeoutMs: number) {
  const metadata = yield* mcpCall(() => discoverAuthorizationServerMetadata(issuer, { fetchFn })).pipe(
    Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.succeed(undefined) }),
    Effect.catch(() => Effect.succeed(undefined)),
  );
  return (
    !metadata || Boolean(metadata.registration_endpoint) || metadata.client_id_metadata_document_supported === true
  );
});

function legacyIssuer(record: McpOAuthRecord | null): string | undefined {
  const issuer = record?.discovery?.authorizationServerUrl;
  if (!issuer) return undefined;
  try {
    const parsed = new URL(issuer);
    return isSecureEndpoint(parsed) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function hasUnboundCredentials(record: McpOAuthRecord | null): boolean {
  return Boolean(
    (record?.client && typeof record.client.issuer !== "string") ||
      (record?.tokens && typeof record.tokens.issuer !== "string"),
  );
}

function credentialIssuer(credential: Pick<OAuthTokens, "issuer">, record: McpOAuthRecord): string | undefined {
  return typeof credential.issuer === "string" ? credential.issuer : legacyIssuer(record);
}

function refreshCanPass(cause: unknown): boolean {
  return (
    !(cause instanceof OAuthError) ||
    cause instanceof ServerError ||
    cause instanceof TemporarilyUnavailableError ||
    cause instanceof TooManyRequestsError
  );
}

function issuersMatch(left: string, right: string): boolean {
  try {
    const a = new URL(left).toString();
    const b = new URL(right).toString();
    return a === b || (a.endsWith("/") && a.slice(0, -1) === b) || (b.endsWith("/") && b.slice(0, -1) === a);
  } catch {
    return left === right;
  }
}

export function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function describeUnusableRedirectUrl(redirectUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    return `"${redirectUrl}" is not a complete address, so no MCP sign-in can come back to it.`;
  }
  if (parsed.protocol === "http:") {
    return isLoopback(parsed.hostname)
      ? null
      : `"${redirectUrl}" is not on this machine, so an MCP sign-in would send the grant in clear text.`;
  }
  if (parsed.protocol === "https:")
    return `"${redirectUrl}" is a web address, which an MCP authorization server will not send a grant to.`;
  return null;
}

function withAppScope(authorizationUrl: URL, app: McpOAuthApp | undefined): URL {
  if (!app?.scope) return authorizationUrl;
  const url = new URL(authorizationUrl);
  url.searchParams.set("scope", app.scope);
  if (app.scope.split(/\s+/).includes("offline_access") && !url.searchParams.has("prompt"))
    url.searchParams.set("prompt", "consent");
  return url;
}

function withOfflineAccess(authorizationUrl: URL, metadata: OAuthDiscoveryState["authorizationServerMetadata"]): URL {
  const scope = scopeWithOfflineAccess(authorizationUrl.searchParams.get("scope"), metadata);
  if (!scope) return authorizationUrl;
  const url = new URL(authorizationUrl);
  url.searchParams.set("scope", scope);
  if (!url.searchParams.has("prompt")) url.searchParams.set("prompt", "consent");
  return url;
}

const registrationBodySchema = z.looseObject({
  scope: z.string().optional(),
  redirect_uris: z.array(z.string()).optional(),
});

const registrationErrorSchema = z.looseObject({ error: z.string() });

async function refusesRedirectAddress(response: Response): Promise<boolean> {
  const error = await registrationErrorCode(response);
  return error === "invalid_redirect_uri" || error === "invalid_client_metadata";
}

async function registrationErrorCode(response: Response): Promise<string | null> {
  if (response.status !== 400) return null;
  const body = registrationErrorSchema.safeParse(
    await response
      .clone()
      .json()
      .catch(() => null),
  );
  return body.success ? body.data.error : null;
}

function localhostRedirectUrl(redirectUrl: string): string | null {
  const url = URL.parse(redirectUrl);
  if (url?.protocol !== "http:" || url.hostname !== "127.0.0.1") return null;
  url.hostname = "localhost";
  return url.href;
}

function isLoopbackHttp(url: URL | null): url is URL {
  return url?.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

function callbackRedirectUrl(redirectUrl: string): string | null {
  const url = URL.parse(redirectUrl);
  if (!isLoopbackHttp(url) || url.pathname === MCP_OAUTH_CALLBACK_PATH) return null;
  url.pathname = MCP_OAUTH_CALLBACK_PATH;
  url.search = "";
  url.hash = "";
  return url.href;
}

function registersAddress(registered: readonly string[], address: string): boolean {
  if (registered.includes(address)) return true;
  const url = URL.parse(address);
  if (!isLoopbackHttp(url) || !url.port) return false;
  url.port = "";
  return registered.includes(url.href);
}

function scopeWithOfflineAccess(
  scope: string | null,
  metadata: OAuthDiscoveryState["authorizationServerMetadata"],
): string | null {
  if (!scope || !metadata?.scopes_supported?.includes("offline_access")) return null;
  if (scope.split(/\s+/).includes("offline_access")) return null;
  return `${scope} offline_access`;
}

function withGoogleOfflineAccess(authorizationUrl: URL): URL {
  if (authorizationUrl.origin !== "https://accounts.google.com" || authorizationUrl.searchParams.has("access_type"))
    return authorizationUrl;
  const url = new URL(authorizationUrl);
  url.searchParams.set("access_type", "offline");
  if (!url.searchParams.has("prompt")) url.searchParams.set("prompt", "consent");
  return url;
}

function isAuthorizationUrlSafe(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopback(url.hostname);
}

const MAX_OAUTH_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function secureOAuthFetch(options: SecureOAuthFetchOptions = {}): FetchLike {
  const resource = options.resource === undefined ? null : new URL(options.resource);
  const resolve = options.lookup ?? systemAddressLookup;
  const guard: OAuthAddressGuard | null = resource
    ? {
        resource,
        resourcePublic: Effect.runSync(
          Effect.cached(
            hostAddresses(resource, resolve).pipe(
              Effect.map((addresses) => addresses.length > 0 && addresses.every(isPublicAddress)),
            ),
          ),
        ),
        resolve,
      }
    : null;
  const mcpTraffic = options.mcpTraffic === true ? resource : null;
  return (input, init) => runCauseEffect(secureOAuthRequest(input, init, options.signal, guard, mcpTraffic));
}

export interface SecureOAuthFetchOptions {
  signal?: AbortSignal;
  resource?: string;
  mcpTraffic?: boolean;
  lookup?: AddressLookup;
}

interface OAuthAddressGuard {
  resource: URL;
  resourcePublic: Effect.Effect<boolean, AddressLookupError>;
  resolve: AddressLookup;
}

const OAUTH_BODY_LIMIT = 1024 * 1024;

const OAUTH_REQUEST_TIMEOUT_MS = 20_000;

const secureOAuthRequest = Effect.fn("McpOAuth.secureFetch")(function* (
  input: Parameters<FetchLike>[0],
  init: Parameters<FetchLike>[1],
  signal: AbortSignal | undefined,
  guard: OAuthAddressGuard | null,
  mcpServer: URL | null,
): Effect.fn.Return<Response, McpOperationError> {
  let url = yield* mcpSync(() => new URL(input instanceof URL ? input.toString() : input));
  const requested = url;
  const mcpTraffic = mcpServer !== null && withoutHash(url) === withoutHash(mcpServer);
  let request: RequestInit = { ...init, ...(signal ? { signal } : {}), redirect: "manual" };
  for (let hop = 0; ; hop++) {
    if (!isSecureEndpoint(url))
      return yield* mcpFailure(new Error(sourceText("error.backend.oauthNotHttps", { origin: url.origin })));
    if (guard) yield* checkEndpointAddress(url, guard);
    const origin = url.origin;
    const unlimited = mcpTraffic && origin === mcpServer?.origin;
    const send = Effect.tryPromise({
      try: (requestSignal) =>
        fetch(url, {
          ...request,
          signal: request.signal ? AbortSignal.any([request.signal, requestSignal]) : requestSignal,
        }),
      catch: mcpFailure,
    });
    const response = yield* unlimited
      ? send
      : send.pipe(
          Effect.flatMap((answer) =>
            REDIRECT_STATUSES.has(answer.status) && answer.headers.has("location")
              ? Effect.succeed(answer)
              : limited(answer, origin),
          ),
          Effect.timeoutOrElse({
            duration: OAUTH_REQUEST_TIMEOUT_MS,
            orElse: () => mcpFailure(new Error(sourceText("error.backend.oauthTimedOut", { origin }))),
          }),
        );
    const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get("location") : null;
    if (location === null) return mcpTraffic ? response : yield* readableAnswer(response, requested, request.method);
    yield* mcpCall(() => response.body?.cancel()).pipe(Effect.catch(() => Effect.void));
    if (hop >= MAX_OAUTH_REDIRECTS)
      return yield* mcpFailure(new Error(sourceText("error.backend.oauthTooManyRedirects")));
    const next = yield* mcpSync(() => new URL(location, url));
    const ownWwwHost = !mcpTraffic && movesToOwnWwwHost(url, next, response.status);
    if (next.origin !== url.origin && carriesCredential(request) && !ownWwwHost)
      return yield* mcpFailure(new Error(sourceText("error.backend.oauthRedirectOrigin", { origin: next.origin })));
    url = next;
    request = redirected(request, response.status);
  }
});

const checkEndpointAddress = Effect.fn("McpOAuth.checkEndpointAddress")(function* (url: URL, guard: OAuthAddressGuard) {
  if (!(yield* toMcpOperationError(guard.resourcePublic))) return;
  const addresses = yield* toMcpOperationError(hostAddresses(url, guard.resolve));
  if (addresses.length > 0 && addresses.every(isPublicAddress)) return;
  return yield* mcpFailure(new Error(sourceText("error.backend.mcpOAuthPrivateEndpoint", { origin: url.origin })));
});

function limited(response: Response, origin: string): Effect.Effect<Response, McpOperationError> {
  return readLimitedBody(response, OAUTH_BODY_LIMIT, (reason) =>
    mcpFailure(
      reason === "too-large"
        ? new Error(sourceText("error.backend.oauthResponseTooLarge", { origin }))
        : new Error(sourceText("error.backend.oauthResponseUnreadable", { origin })),
    ),
  ).pipe(
    Effect.map((body) => {
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(NULL_BODY_STATUSES.has(response.status) ? null : new Uint8Array(body), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }),
  );
}

const readableAnswer = Effect.fnUntraced(function* (response: Response, requested: URL, method: string | undefined) {
  if (!response.ok) return response;
  const metadata = (method ?? "GET").toUpperCase() === "GET" && requested.pathname.includes("/.well-known/");
  const page = (response.headers.get("content-type") ?? "").includes("text/html");
  if (!metadata && !page) return response;
  const body = yield* mcpCall(() => response.clone().text());
  if (isJsonObject(body)) return response;
  if (metadata) return new Response(null, { status: 404, statusText: "Not Found" });
  if (body.trim() === "") return response;
  return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInAnswerUnreadable")));
});

function isJsonObject(body: string): boolean {
  const parsed = Result.try((): unknown => JSON.parse(body));
  return (
    Result.isSuccess(parsed) &&
    typeof parsed.success === "object" &&
    parsed.success !== null &&
    !Array.isArray(parsed.success)
  );
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function withoutHash(url: URL): string {
  return url.href.replace(/#.*$/, "");
}

function carriesCredential(request: RequestInit): boolean {
  if (request.body !== undefined && request.body !== null) return true;
  return new Headers(request.headers).has("authorization");
}

function movesToOwnWwwHost(from: URL, to: URL, status: number): boolean {
  if (status !== 307 && status !== 308) return false;
  if (from.protocol !== "https:" || to.protocol !== "https:" || from.port !== to.port) return false;
  if (from.pathname !== to.pathname || from.search !== to.search) return false;
  const ownWww = (bare: string, www: string) => www === `www.${bare}` && !bare.startsWith("www.");
  return ownWww(from.hostname, to.hostname) || ownWww(to.hostname, from.hostname);
}

function isSecureEndpoint(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopback(url.hostname);
}

function redirected(request: RequestInit, status: number): RequestInit {
  if (status === 307 || status === 308) return request;
  const { body: _body, ...rest } = request;
  return { ...rest, method: "GET" };
}

function revocationClient(record: McpOAuthRecord, issuer: string | undefined): OAuthClientInformationMixed | null {
  if (!issuer) return null;
  if (record.app) {
    if (record.app.issuer && !issuersMatch(record.app.issuer, issuer)) return null;
    return {
      client_id: record.app.clientId,
      ...(record.app.clientSecret ? { client_secret: record.app.clientSecret } : {}),
    };
  }
  const { client } = record;
  if (!client) return null;
  if (typeof client.issuer === "string" && !issuersMatch(client.issuer, issuer)) return null;
  return client;
}

function revocationEndpoint(metadata: AuthorizationServerMetadata | undefined): URL | null {
  const endpoint = metadata && "revocation_endpoint" in metadata ? metadata.revocation_endpoint : undefined;
  if (typeof endpoint !== "string") return null;
  try {
    return new URL(endpoint);
  } catch {
    return null;
  }
}

const revokeToken = Effect.fn("McpOAuth.revokeToken")(function* (
  endpoint: URL,
  token: string,
  hint: "refresh_token" | "access_token",
  client: OAuthClientInformationMixed,
  metadata: AuthorizationServerMetadata | undefined,
  fetchFn: FetchLike,
): Effect.fn.Return<string, McpOperationError> {
  const params = new URLSearchParams({ token, token_type_hint: hint });
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" });
  const supported =
    (metadata && "revocation_endpoint_auth_methods_supported" in metadata
      ? metadata.revocation_endpoint_auth_methods_supported
      : undefined) ??
    metadata?.token_endpoint_auth_methods_supported ??
    [];
  const method = yield* mcpSync(() => selectClientAuthMethod(client, supported));
  if (method === "client_secret_basic" && client.client_secret)
    headers.set("Authorization", `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`);
  else {
    params.set("client_id", client.client_id);
    if (method === "client_secret_post" && client.client_secret) params.set("client_secret", client.client_secret);
  }
  const response = yield* mcpCall(() => fetchFn(endpoint, { method: "POST", headers, body: params }));
  yield* mcpCall(() => response.body?.cancel()).pipe(Effect.catch(() => Effect.void));
  return response.ok ? "ok" : `http ${response.status}`;
});

function tokenEndpointAuthMethod(
  methods: string[] | undefined,
): Pick<OAuthClientMetadata, "token_endpoint_auth_method"> {
  if (methods?.includes("none")) return { token_endpoint_auth_method: "none" };
  if (methods?.includes("client_secret_post") && !methods.includes("client_secret_basic"))
    return { token_endpoint_auth_method: "client_secret_post" };
  return {};
}

function withIssuedSecretMethod(
  information: OAuthClientInformationFull,
  methods: string[] | undefined,
): OAuthClientInformationFull {
  if (!information.client_secret || information.token_endpoint_auth_method !== "none") return information;
  const method = ["client_secret_post", "client_secret_basic"].find((name) => methods?.includes(name));
  return method ? { ...information, token_endpoint_auth_method: method } : information;
}

function errorKind(error: unknown): string {
  const cause = error instanceof McpOperationError ? error.cause : error;
  return cause instanceof Error ? cause.name : "unknown";
}

function expiringSoon(record: McpOAuthRecord, marginMs = TOKEN_REFRESH_MARGIN_MS): boolean {
  const seconds = record.tokens?.expires_in;
  if (seconds === undefined || record.obtainedAt === undefined) return false;
  return record.obtainedAt + seconds * 1000 - marginMs <= Date.now();
}
