import { Deferred, Effect, Exit, Fiber, Result, Scope } from "effect";
import { McpOperationError, mcpCall, mcpFailure, mcpSync, toMcpOperationError } from "./mcp-effects";
/**
 * The OAuth client OpenBot is, for an http MCP server that asks its users to sign in.
 *
 * Every one of the six sign-in listings used to reach its server through `npx -y mcp-remote`, a
 * third-party program that kept the refresh token in a file of its own. A token OpenBot cannot see
 * is a token it cannot redact, and redaction is not optional here - so the grant, the registration
 * and the token set move into OpenBot's own encrypted store, and the bridge goes away.
 *
 * Almost none of the protocol is written here. `@modelcontextprotocol/sdk` already does RFC 9728
 * discovery, RFC 7591 registration, PKCE and the refresh; what it asks for is one object that says
 * where to keep the results and how to reach a browser. That object is `McpOAuthClientProvider`,
 * and `McpOAuth` is the one place that builds it, so the pending sign-ins have a single home the
 * deep link can answer.
 *
 * A server is keyed by its URL and nothing else. Two rows naming the same URL are the same account
 * to the server, so they are the same account here.
 */

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
import { MCP_SIGN_IN_TIMEOUT_MS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { Logger } from "@openbot/logging";
import { z } from "zod";
import { runCauseEffect } from "./effect-boundary";
import { readLimitedBody } from "./limited-body";
import {
  type AddressLookup,
  type AddressLookupError,
  hostAddresses,
  isPublicAddress,
  systemAddressLookup,
} from "./network-address";
import { withTimeout } from "./with-timeout";

/** What one server's sign-in leaves behind, and all of it: nothing else is kept between runs. */
export const mcpOAuthRecordSchema = z.object({
  /**
   * An OAuth app the administrator registered with the authorization server themselves, for a
   * server that does not offer RFC 7591 registration. When it is set, OpenBot never registers.
   * The secret is optional: a public client has none.
   */
  app: z
    .object({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1).optional(),
      scope: z.string().min(1).optional(),
      /**
       * The authorization server that first accepted the app. Its secret is sent to no other one, so
       * a resource that later names another server cannot collect it. Unset until the first sign-in.
       */
      issuer: z.string().optional(),
    })
    .optional(),
  /** This installation's registration with that authorization server, from RFC 7591. */
  client: OAuthClientInformationFullSchema.optional(),
  tokens: OAuthTokensSchema.optional(),
  /** When `tokens` arrived. `expires_in` is a duration, and a duration alone names no moment. */
  obtainedAt: z.number().optional(),
  /**
   * Where the authorization server was found: its URL, and the metadata URL that named it. A
   * later exchange reuses both instead of rediscovering at the default locations, which misses
   * metadata that lives only at the advertised URL. Small on purpose: the SDK re-fetches the
   * metadata documents themselves from these addresses.
   */
  discovery: z
    .object({
      authorizationServerUrl: z.string(),
      resourceMetadataUrl: z.string().optional(),
    })
    .optional(),
  /**
   * When a silent refresh was refused and the tokens were dropped. The row then says that the user
   * must sign in again, and not only that no token is on file. A sign-in that succeeds, a sign-out
   * and a removal clear it. Older builds strip the field when they read the file.
   */
  lostAt: z.number().optional(),
});

export type McpOAuthRecord = z.infer<typeof mcpOAuthRecordSchema>;
type McpOAuthApp = NonNullable<McpOAuthRecord["app"]>;

/** What a reader may see of a sign-in app. The secret itself never leaves the store. */
export interface McpOAuthAppSummary {
  clientId: string;
  secretSaved: boolean;
  scope: string;
}

/**
 * A change to a sign-in app. `clientSecret: null` keeps the secret on file, so a form that never
 * shows the secret can still save a new scope; an empty string removes it.
 */
export interface McpOAuthAppInput {
  clientId: string;
  clientSecret: string | null;
  scope: string;
}

/**
 * Where the records are kept. Implemented in the main process, where `safeStorage` lives, so this
 * module stays testable with a map and imports no Electron.
 *
 * `read` is synchronous because the store loads once at startup and answers from memory after that,
 * exactly as the provider key store does.
 */
export interface McpOAuthStorage {
  read: (resource: string) => McpOAuthRecord | null;
  write: (resource: string, record: McpOAuthRecord) => Effect.Effect<void, McpOperationError>;
  clear: (resource: string) => Effect.Effect<void, McpOperationError>;
}

export interface McpOAuthOptions {
  storage: McpOAuthStorage;
  /** Opens the authorization page in the user's own browser, never in a window of this app. */
  openExternal: (url: string) => Promise<void>;
  /**
   * Where the authorization server sends the grant back. One address serves every server.
   *
   * A loopback http address while this app is listening on one, and the `openbot://mcp-auth` deep
   * link when it could not bind a port. `describeUnusableRedirectUrl` refuses anything else.
   */
  redirectUrl: string;
  /** How long a sign-in may stay open before the wait is abandoned. */
  signInTimeoutMs?: number;
  /** How long a token exchange may hold a thread start or a test before the stored token answers. */
  refreshTimeoutMs?: number;
  /** How long one RFC 7009 revocation request may run after a sign-out. */
  revocationTimeoutMs?: number;
  /** Where a revocation failure is written. It is never shown to the user. */
  logger?: Pick<Logger, "warn">;
  /** Resolves the host names of OAuth endpoints. See `secureOAuthFetch`. */
  lookup?: AddressLookup;
}

/**
 * How long a token exchange may hold a thread start or a test. The probe and the hand-off both
 * resolve every token before they connect, so an authorization server that accepts a connection
 * but never finishes its response would otherwise stall either past its own deadline.
 */
const MCP_TOKEN_TIMEOUT_MS = 10_000;

/**
 * An access token is refreshed this long before it is due to expire, so a thread that starts at the
 * last moment does not hand a provider a token that dies during the handshake.
 */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * How long one revocation request may run. The local tokens are already gone when it starts, so
 * this bounds only how long a dead endpoint keeps a request open.
 */
const MCP_REVOCATION_TIMEOUT_MS = 5_000;

/** One sign-in, from the browser leaving to the token set being stored. */
export interface McpSignIn {
  /** Given to the SDK transport, which drives the whole exchange through it. */
  readonly provider: OAuthClientProvider;
  /**
   * Starts this sign-in for a server that answered without one. Some servers, such as Google's, list
   * their tools to anyone and ask for a token only when a tool runs, so the SDK never gets the 401 that
   * starts a sign-in, and Sign in would end at once with nothing opened. Answers whether the
   * page opened: `false` when this address already holds a token, or when the server publishes no
   * protected-resource metadata that names an authorization server. A metadata read that gets no
   * answer or a server error is an error, not such a `false`: the server did not say that it wants
   * no sign-in.
   */
  begin: () => Effect.Effect<boolean, McpOperationError>;
  /** Waits for the browser to come back, then trades the grant for a token set. */
  complete: () => Effect.Effect<void, McpOperationError>;
  /** Ends a wait nothing will answer, so a cancelled sign-in leaves no entry behind. */
  abandon: () => void;
  /**
   * Every secret this attempt sent or received, for the reader that has to redact a failure.
   *
   * Collected as the exchange runs rather than read from the store afterwards: the SDK clears the
   * record on the refusals it recovers from, so by the time an error is described the value that
   * was actually spent is already gone from disk.
   */
  secrets: () => string[];
  /**
   * Whether this attempt asked to register and got no registration back. An authorization server
   * that registers only the apps it approved, such as Figma's, refuses here, and the user's account
   * is not the cause.
   */
  registrationFailed: () => boolean;
  /**
   * The HTTP status of this attempt's last registration answer, or `null`. The SDK keeps the status
   * only when the body is not an OAuth error, and turns a code it does not know into a
   * `ServerError`: Dropbox answers 403 `registration_not_supported`, which arrives as a bare
   * sentence. Only a fetch passed through `watchRegistration` sees the status.
   */
  registrationStatus: () => number | null;
  /** `fetch` for an exchange that can register, keeping the status of the registration answer. */
  watchRegistration: (fetch: FetchLike) => FetchLike;
  /**
   * Whether the user cancelled this attempt. A cancel can land during discovery, registration or
   * the token exchange, where the step it stops fails with its own words; the reader says
   * "cancelled" instead, because that is what the user did.
   */
  cancelled: () => boolean;
}

/**
 * What a hand-off and a test ask of OAuth. `AgentService` holds one of these and nothing else does.
 */
/**
 * Opens the authorization page of one sign-in somewhere other than this computer's own browser: a
 * private tab of this host's browser, for an administrator who signs in from another computer.
 */
export type McpSignInOpener = (url: string) => Promise<void>;

export interface McpOAuthAuthority {
  accessToken: (url: string) => Effect.Effect<string | null, McpOperationError>;
  /** A new token after the server refused `rejected`, or `null`. See `McpOAuth.refreshAccessToken`. */
  refreshAccessToken: (url: string, rejected: string) => Effect.Effect<string | null, McpOperationError>;
  signIn: (url: string, open?: McpSignInOpener) => McpSignIn | null;
  /** Ends the sign-in waiting for this URL's browser, if one is. Answers whether one was. */
  cancelSignIn: (url: string) => boolean;
  /** Whether this computer holds a token for this URL. Never the token itself. */
  signedIn: (url: string) => boolean;
  /** Whether the server refused the stored sign-in, so the user must sign in again. */
  needsSignIn: (url: string) => boolean;
  /** Whether this computer keeps a sign-in for this URL: current, expired, or ended by the server. */
  hasSignIn: (url: string) => boolean;
  /** Drops the tokens and keeps the sign-in app, so the next sign-in uses the same app. */
  signOut: (url: string) => Effect.Effect<void, McpOperationError>;
  /** Drops everything kept for this URL, the sign-in app included. Used when the row is removed. */
  forget: (url: string) => Effect.Effect<void, McpOperationError>;
  /** The address the authorization server sends the grant back to. */
  readonly redirectUrl: string;
  signInApp: (url: string) => McpOAuthAppSummary | null;
  /** Answers whether the change dropped the tokens on file. */
  saveSignInApp: (url: string, app: McpOAuthAppInput) => Effect.Effect<boolean, McpOperationError>;
  /** Drops the sign-in app and the tokens it earned. Answers whether there was one. */
  removeSignInApp: (url: string) => Effect.Effect<boolean, McpOperationError>;
}

export class McpOAuth implements McpOAuthAuthority {
  readonly #options: McpOAuthOptions;
  /**
   * The sign-ins waiting for a browser, keyed by the OAuth `state` they sent.
   *
   * `state` is the only thing the return leg carries that names the attempt, and an attempt that is
   * not in here is one this run did not start - which is what makes a forged or replayed
   * `openbot://mcp-auth` link do nothing.
   */
  readonly #waiting = new Map<string, (code: string) => void>();
  /** The waiting sign-ins whose page an opener of their own showed, not the user's browser. */
  readonly #openedElsewhere = new Set<string>();
  /**
   * The cancel of the sign-in still running for each server. A user who presses Cancel names the
   * server, not the `state`, and one attempt per server is kept: a second Sign in replaces the
   * first rather than leaving two browser tabs that race to answer.
   */
  readonly #attempts = new Map<string, () => void>();
  /** The refresh already running for a server, so two hand-offs share one exchange. See `#refresh`. */
  readonly #scope = Scope.makeUnsafe();
  readonly #refreshing = new Map<string, Fiber.Fiber<void>>();
  /**
   * How many times a server's credentials were forgotten. A refresh or a sign-in already running
   * when the count rises must not write back what was removed: its later writes are refused, so
   * removal reads complete before credentials can return to disk.
   */
  readonly #generations = new Map<string, number>();

  constructor(options: McpOAuthOptions) {
    const refusal = describeUnusableRedirectUrl(options.redirectUrl);
    if (refusal) throw new Error(refusal);
    this.#options = options;
  }

  /**
   * The bearer token for a server, refreshed when it can be, and `null` when this machine has never
   * signed in to it.
   *
   * Never interactive: this runs at a thread start, where a browser window nobody asked for would
   * arrive out of nowhere. A refresh that cannot reach the server answers with the token that is
   * stored anyway, so the server states the refusal itself. A refresh that the server refused drops
   * the tokens, and then the answer is `null`: a token the server already refused is not handed on.
   */
  readonly accessToken = Effect.fn("McpOAuth.accessToken")(function* (
    this: McpOAuth,
    url: string,
  ): Effect.fn.Return<string | null, McpOperationError> {
    const resource = normalizeResource(url);
    if (!resource) return null;
    const stored = yield* mcpSync(() => this.#options.storage.read(resource));
    if (!stored?.tokens) return null;
    const fallback = stored.tokens.access_token;
    if (!expiringSoon(stored)) return fallback;
    // The SDK binds credentials saved by new versions to the authorization server. An older
    // record without that binding must not trigger discovery and then spend its refresh token at
    // whichever server the MCP resource names. Keep the access token for the resource instead.
    if (!credentialIssuer(stored.tokens, stored)) return fallback;
    yield* this.#refresh(resource);
    return yield* mcpSync(() => this.#options.storage.read(resource)?.tokens?.access_token ?? null);
  }).bind(this);

  /**
   * A new bearer token after the server refused `rejected` with a 401, or `null` when there is none.
   *
   * The proxy asks this during a session, when the token can be refused before it expires. A
   * request that arrives after another one already got a new token reads that token and does not
   * spend the refresh token again. A token that has no refresh token cannot be renewed, so the
   * refusal ends the sign-in and the row asks for a new one.
   */
  readonly refreshAccessToken = Effect.fn("McpOAuth.refreshAccessToken")(function* (
    this: McpOAuth,
    url: string,
    rejected: string,
  ): Effect.fn.Return<string | null, McpOperationError> {
    const resource = normalizeResource(url);
    if (!resource) return null;
    const stored = yield* mcpSync(() => this.#options.storage.read(resource));
    if (!stored?.tokens) return null;
    if (stored.tokens.access_token !== rejected) return stored.tokens.access_token;
    if (!stored.tokens.refresh_token) {
      const { tokens: _tokens, obtainedAt: _obtainedAt, ...kept } = stored;
      yield* this.#options.storage.write(resource, { ...kept, lostAt: Date.now() });
      return null;
    }
    if (!credentialIssuer(stored.tokens, stored)) return null;
    yield* this.#refresh(resource);
    const next = yield* mcpSync(() => this.#options.storage.read(resource)?.tokens?.access_token ?? null);
    return next === rejected ? null : next;
  }).bind(this);

  /**
   * One exchange per server at a time, whoever asks.
   *
   * A hand-off resolves every server at once and two threads can start together, so the same
   * expiring token is read twice. Where the authorization server rotates refresh tokens - which
   * the specification recommends - the second exchange spends one that has already been spent: it
   * is refused, and a server that reads reuse as theft revokes the whole grant and costs the user
   * the sign-in. A caller that arrives while an exchange is running waits for that one instead.
   *
   * The wait is bounded: an authorization server that accepts the connection but never finishes
   * its response must not stall a thread start or a test past its own deadline. A caller whose
   * wait ends reads the stored token instead, and the exchange it stopped waiting for keeps
   * running - a token it eventually stores is what the next start reads.
   *
   * The exchange itself is bounded too: a request that stays open without completing is aborted
   * and its entry cleared, so the next caller starts a fresh exchange instead of joining the
   * same stall again. Without this every later thread would wait out the same dead request and
   * receive the expired token, even when the server answers new requests.
   *
   * It is a refresh and nothing more: the `auth()` flow of the SDK registers a new client when the
   * stored one is refused, and a refresh with no browser behind it must not do that. See
   * `McpOAuthClientProvider.refresh`.
   */
  readonly #refresh = Effect.fn("McpOAuth.refresh")(function* (this: McpOAuth, resource: string) {
    const running = this.#refreshing.get(resource);
    const timeoutMs = this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS;
    if (running) return yield* this.#awaitRefresh(running);
    const controller = new AbortController();
    // The scope owns the exchange; a caller can stop waiting without cancelling another caller's refresh.
    const operation = this.#provider(resource, null)
      .refresh(this.#fetch(resource, controller.signal))
      .pipe(
        Effect.asVoid,
        Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.void }),
        Effect.catch(() => Effect.void),
        Effect.ensuring(Effect.sync(() => controller.abort())),
      );
    const exchange = yield* Effect.forkIn(operation, this.#scope, { startImmediately: true });
    this.#refreshing.set(resource, exchange);
    exchange.addObserver(() => {
      if (this.#refreshing.get(resource) === exchange) this.#refreshing.delete(resource);
    });
    yield* this.#awaitRefresh(exchange);
  });

  /** The fetch of one exchange for this server. */
  #fetch(resource: string, signal: AbortSignal): FetchLike {
    const { lookup } = this.#options;
    return secureOAuthFetch({ signal, resource, ...(lookup ? { lookup } : {}) });
  }

  readonly #awaitRefresh = Effect.fn("McpOAuth.awaitRefresh")((exchange: Fiber.Fiber<void>) =>
    Fiber.join(exchange).pipe(
      Effect.timeoutOrElse({
        duration: this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS,
        orElse: () => Effect.void,
      }),
    ),
  );

  readonly close = Effect.fn("McpOAuth.close")(() =>
    Scope.close(this.#scope, Exit.void).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const cancel of [...this.#attempts.values()]) cancel();
          this.#waiting.clear();
          this.#openedElsewhere.clear();
        }),
      ),
    ),
  );

  /** A sign-in the user asked for, or `null` when the URL is not one this can sign in to. */
  signIn(url: string, open?: McpSignInOpener): McpSignIn | null {
    const resource = normalizeResource(url);
    if (!resource) return null;
    this.#attempts.get(resource)?.();
    const state = randomUUID();
    const grant = Deferred.makeUnsafe<string, Error>();
    this.#waiting.set(state, (code) => {
      Deferred.doneUnsafe(grant, Effect.succeed(code));
    });
    if (open) this.#openedElsewhere.add(state);
    // Set when the probe moves on: a discovery slow enough to outlast it must neither open a
    // browser afterwards nor wait out a grant nobody will answer.
    let abandoned = false;
    let cancelled = false;
    const provider = this.#provider(resource, state, () => abandoned, open);
    const abandon = () => {
      abandoned = true;
      this.#waiting.delete(state);
      this.#openedElsewhere.delete(state);
      if (this.#attempts.get(resource) === cancel) this.#attempts.delete(resource);
    };
    // The user said stop: the wait ends now rather than at its deadline, with its own sentence.
    const cancel = () => {
      cancelled = true;
      Deferred.doneUnsafe(grant, Effect.fail(new Error(sourceText("error.backend.mcpSignInCancelled"))));
      abandon();
    };
    this.#attempts.set(resource, cancel);
    return {
      provider,
      begin: () =>
        Effect.gen({ self: this }, function* () {
          if (cancelled || abandoned || this.#options.storage.read(resource)?.tokens) return false;
          // Discovery and the registration read only public documents; the abort ends them with this step.
          const controller = new AbortController();
          const fetchFn = provider.watchRegistration(this.#fetch(resource, controller.signal));
          return yield* withTimeout(
            Effect.gen(function* () {
              // A server that answers without a sign-in and names no authorization server takes none:
              // the SDK would otherwise guess `/authorize` at the server's own origin. Any answer
              // below 500 is such a server: a 404, a refusal, or a page that is not metadata. No
              // answer, a server error, or a busy server (408, 429) says nothing about the server. It
              // must not end the sign-in as if the server asked for none: that left the row showing
              // the result of the earlier test, with no page and no words.
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
                  if (
                    metadataStatus !== null &&
                    metadataStatus < 500 &&
                    metadataStatus !== 408 &&
                    metadataStatus !== 429
                  )
                    return Effect.succeed(null);
                  return Effect.fail(new Error(sourceText("error.backend.mcpSignInMetadataUnreadable")));
                }),
              );
              if (!metadata?.authorization_servers?.length) return false;
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
          // Aborts with the wait: a token endpoint that never completes must not keep a request
          // running after this attempt ends, or its late response would write credentials a later
          // sign-in already replaced.
          const controller = new AbortController();
          yield* Effect.gen({ self: this }, function* () {
            const code = yield* withTimeout(
              Deferred.await(grant),
              this.#options.signInTimeoutMs ?? MCP_SIGN_IN_TIMEOUT_MS,
              sourceText("error.backend.mcpSignInTimedOut"),
            ).pipe(Effect.mapError(mcpFailure));
            // The grant is a credential until it is spent, and a token endpoint that refuses it
            // commonly quotes it back in `error_description`.
            provider.recordSecret(code);
            // From here the registration on file is the one the grant was issued to, whatever
            // address it names: registering again would trade the code against another client.
            provider.beginCodeExchange();
            // The grant waited on the person; the trade waits on the server, and on nothing else.
            // Without this a hung token endpoint holds the test past its own deadline after the user
            // has done everything right.
            yield* withTimeout(
              mcpCall(() =>
                auth(provider, {
                  serverUrl: resource,
                  authorizationCode: code,
                  fetchFn: this.#fetch(resource, controller.signal),
                }),
              ),
              this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS,
              sourceText("error.backend.mcpSignInResponseTimedOut"),
            ).pipe(Effect.mapError(mcpFailure));
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
      registrationStatus: () => provider.registrationStatus,
      watchRegistration: (fetch) => provider.watchRegistration(fetch),
      cancelled: () => cancelled,
    };
  }

  /**
   * The browser came back. Answers whether a sign-in was waiting for this `state`, so the caller can
   * drop a link that belongs to no attempt instead of acting on it.
   */
  receiveAuthorizationCode(state: string, code: string): boolean {
    const deliver = this.#waiting.get(state);
    if (!deliver) return false;
    this.#waiting.delete(state);
    deliver(code);
    return true;
  }

  /**
   * Whether the sign-in waiting for this `state` showed its page in its own opener. Its return
   * raises no window here: the person who signed in is at another computer.
   */
  openedElsewhere(state: string): boolean {
    return this.#openedElsewhere.has(state);
  }

  cancelSignIn(url: string): boolean {
    const resource = normalizeResource(url);
    const cancel = resource ? this.#attempts.get(resource) : undefined;
    cancel?.();
    return cancel !== undefined;
  }

  signedIn(url: string): boolean {
    const resource = normalizeResource(url);
    const record = resource === null ? undefined : this.#options.storage.read(resource);
    // An expired token with no refresh token is a sign-in the server refuses, not one to show as current.
    return Boolean(record?.tokens && (record.tokens.refresh_token || !expiringSoon(record, 0)));
  }

  needsSignIn(url: string): boolean {
    const resource = normalizeResource(url);
    const record = resource === null ? undefined : this.#options.storage.read(resource);
    return record?.lostAt !== undefined && !record.tokens;
  }

  hasSignIn(url: string): boolean {
    const resource = normalizeResource(url);
    const record = resource === null ? undefined : this.#options.storage.read(resource);
    return record?.tokens !== undefined || record?.lostAt !== undefined;
  }

  get redirectUrl(): string {
    return this.#options.redirectUrl;
  }

  /**
   * Forgets one server's registration, tokens and sign-in app. Used when the row is removed. The
   * tokens are revoked after they are gone from this computer: see `#revoke`.
   */
  readonly forget = Effect.fn("McpOAuth.forget")(function* (this: McpOAuth, url: string) {
    const resource = normalizeResource(url);
    if (!resource) return;
    const record = this.#options.storage.read(resource);
    this.#invalidate(resource);
    yield* this.#options.storage.clear(resource);
    yield* this.#revoke(resource, record);
  }).bind(this);

  /**
   * Forgets one server's registration and tokens, and keeps its sign-in app: the administrator
   * registered that app by hand, and signing out of an account is not a reason to type it again.
   */
  readonly signOut = Effect.fn("McpOAuth.signOut")(function* (this: McpOAuth, url: string) {
    const resource = normalizeResource(url);
    if (!resource) return;
    const record = this.#options.storage.read(resource);
    const app = record?.app;
    this.#invalidate(resource);
    if (app) yield* this.#options.storage.write(resource, { app });
    else yield* this.#options.storage.clear(resource);
    yield* this.#revoke(resource, record);
  }).bind(this);

  /**
   * Asks the authorization server to end the grant (RFC 7009), after the local copy is deleted.
   *
   * The order matters. A revocation that hangs or fails must not keep a token on this computer
   * that the user asked to remove, so the delete comes first and the request runs in the
   * background. One request per token, refresh token first: most servers end the access token with
   * its grant. A failure is logged and nothing else. The user signed out here, and a server that
   * cannot revoke still lets the token expire.
   */
  #revoke(resource: string, record: McpOAuthRecord | null): Effect.Effect<void> {
    const tokens = record?.tokens;
    if (!record || !tokens) return Effect.void;
    const issuer = credentialIssuer(tokens, record);
    const client = revocationClient(record, issuer);
    if (!issuer || !client) return Effect.void;
    const timeoutMs = this.#options.revocationTimeoutMs ?? MCP_REVOCATION_TIMEOUT_MS;
    const logger = this.#options.logger;
    const origin = new URL(resource).origin;
    // Aborts what is still open when the revocation ends, so a request that never answers does not outlive it.
    const controller = new AbortController();
    const fetchFn = this.#fetch(resource, controller.signal);
    // A failure is written as its kind and status only: the error text can quote the request.
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
    const resource = normalizeResource(url);
    const app = resource ? this.#options.storage.read(resource)?.app : undefined;
    return app ? { clientId: app.clientId, secretSaved: app.clientSecret !== undefined, scope: app.scope ?? "" } : null;
  }

  /**
   * Saves the app the next sign-in uses. Another client ID is another client to the authorization
   * server: the tokens and the registration on file belong to the old one, so they go, and a
   * sign-in still running is cancelled before it can store tokens the old client earned.
   */
  readonly saveSignInApp = Effect.fn("McpOAuth.saveSignInApp")(function* (
    this: McpOAuth,
    url: string,
    input: McpOAuthAppInput,
  ): Effect.fn.Return<boolean, McpOperationError> {
    const resource = normalizeResource(url);
    if (!resource) return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInAppUrl")));
    const record = this.#options.storage.read(resource) ?? {};
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
    // The binding protects the secret, so a secret kept on file keeps it, also under another client
    // ID. Only a new secret, or no secret, can go to another authorization server.
    const issuer =
      sameClient || (app.clientSecret && app.clientSecret === record.app?.clientSecret)
        ? record.app?.issuer
        : undefined;
    const boundApp = { ...app, ...(issuer ? { issuer } : {}) };
    if (sameClient) {
      yield* this.#options.storage.write(resource, { ...record, app: boundApp });
      return false;
    }
    this.#invalidate(resource);
    yield* this.#options.storage.write(resource, {
      app: boundApp,
      ...(record.discovery ? { discovery: record.discovery } : {}),
    });
    return record.tokens !== undefined;
  }).bind(this);

  readonly removeSignInApp = Effect.fn("McpOAuth.removeSignInApp")(function* (
    this: McpOAuth,
    url: string,
  ): Effect.fn.Return<boolean, McpOperationError> {
    const resource = normalizeResource(url);
    const record = resource ? this.#options.storage.read(resource) : null;
    if (!resource || !record?.app) return false;
    this.#invalidate(resource);
    yield* this.#options.storage.write(resource, record.discovery ? { discovery: record.discovery } : {});
    return true;
  }).bind(this);

  /** Refuses the later writes of every refresh and sign-in already running, and ends the sign-in. */
  #invalidate(resource: string): void {
    this.#generations.set(resource, (this.#generations.get(resource) ?? 0) + 1);
    this.#attempts.get(resource)?.();
  }

  /** A `state` makes the provider interactive; `null` keeps it silent. */
  #provider(
    resource: string,
    state: string | null,
    isAbandoned: () => boolean = () => false,
    open?: McpSignInOpener,
  ): McpOAuthClientProvider {
    const generation = this.#generations.get(resource) ?? 0;
    const storage = this.#options.storage;
    const stored = storage.read(resource);
    // The store as this run saw it: reads answer from disk, but a write or a removal lands only
    // while no `forget` has removed the server - and no abandon has ended the run - since this
    // provider was built.
    const ensureCurrent = (): void => {
      if ((this.#generations.get(resource) ?? 0) !== generation)
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
      // Removal is guarded exactly as a write is. The SDK answers `invalid_client` by calling
      // `invalidateCredentials("all")`, so a refusal that arrives after this attempt ended would
      // otherwise delete the account a later sign-in had already stored.
      clear: (candidate) =>
        Effect.gen({ self: this }, function* () {
          yield* mcpSync(ensureCurrent);
          yield* storage.clear(candidate);
        }),
    };
    return new McpOAuthClientProvider({
      resource,
      state,
      storage: guarded,
      redirectUrl: this.#options.redirectUrl,
      openExternal: open ?? this.#options.openExternal,
      isAbandoned,
      legacyIssuer: legacyIssuer(stored),
      hasUnboundCredentials: hasUnboundCredentials(stored),
    });
  }
}

interface ClientProviderOptions {
  resource: string;
  state: string | null;
  storage: McpOAuthStorage;
  redirectUrl: string;
  openExternal: (url: string) => Promise<void>;
  /** Whether the sign-in that built this provider has been abandoned since. */
  isAbandoned: () => boolean;
  /** The issuer from a pre-1.31 record, captured before the SDK can write new discovery state. */
  legacyIssuer: string | undefined;
  /** Whether this provider started with credentials that have no issuer binding. */
  hasUnboundCredentials: boolean;
}

/**
 * The members the SDK asks for, and no protocol of its own.
 *
 * The PKCE verifier is held in memory and not in the store. It is worth exactly one exchange, it is
 * only useful to the run that made it, and a run that ends before the browser comes back has lost
 * the sign-in either way - so writing it to disk would keep a secret past every moment it can be
 * spent.
 */
class McpOAuthClientProvider implements OAuthClientProvider {
  readonly #options: ClientProviderOptions;
  #codeVerifier: string | null = null;
  /**
   * Every secret this attempt has handled, kept for redaction and nothing else.
   *
   * A token endpoint states a refusal in `error_description`, and the SDK makes that text the
   * message of the error it throws - so a server that quotes the credential it rejected puts that
   * credential in an `McpTestResult.error` on the user's screen. Reading the store at that moment
   * is too late: `invalidateCredentials` has often already dropped the value the attempt spent.
   */
  readonly #secrets = new Set<string>();
  /** Whether the stored registration has already had its one pass with a stale redirect address. */
  #redirectAddressChecked = false;
  /** Set once the grant is in hand: from there the client on file is the one that must spend it. */
  #exchangingCode = false;
  /** Issuer selected by the SDK for this auth attempt, captured before credentials are read. */
  #activeIssuer: string | undefined;
  /** Full discovery for this attempt, including custom protected-resource metadata. */
  #discoveryState: OAuthDiscoveryState | undefined;
  /** Set when the SDK is told to register, and cleared when it saves what it registered. */
  #registrationPending = false;
  /** The status the authorization server answered the pending registration with. */
  #registrationStatus: number | null = null;

  constructor(options: ClientProviderOptions) {
    this.#options = options;
  }

  get redirectUrl(): string {
    return this.#options.redirectUrl;
  }

  /**
   * What OpenBot registers itself as. `redirect_uris` holds the one address this run receives on,
   * so an authorization server will not send a grant anywhere else.
   *
   * No `scope` unless a sign-in app names one: the SDK takes the scope the server's own
   * protected-resource metadata asks for.
   *
   * A public client (`none`) when the server lists that method. RFC 8252 makes a native app a public
   * client, because a secret on the user's computer is not secret, and PKCE protects the grant.
   * Some servers also issue a secret they never accept: Railway registers `client_secret_basic` and
   * then refuses that secret at the token endpoint (#3429). A server that does not list `none` still
   * picks its own method, and the SDK uses the one it registered.
   *
   * Except a server that lists only `client_secret_post`. A request with no method asks for the RFC
   * 7591 default, `client_secret_basic`, and Make refuses that registration with a 400: "No supported
   * Token Endpoint Auth Method provided."
   */
  get clientMetadata(): OAuthClientMetadata {
    const scope = this.#record().app?.scope;
    const methods = this.#discoveryState?.authorizationServerMetadata?.token_endpoint_auth_methods_supported;
    return {
      client_name: "OpenBot",
      client_uri: "https://openbot.run",
      logo_uri: "https://openbot.run/icon-512x512.png",
      redirect_uris: [this.#options.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...tokenEndpointAuthMethod(methods),
      ...(scope ? { scope } : {}),
    };
  }

  state(): string {
    const { state } = this.#options;
    if (!state) throw new Error(sourceText("error.backend.mcpSignInNoBrowser"));
    return state;
  }

  /**
   * The registration this installation already has with that authorization server - unless it
   * names an address the grant can no longer come back to, and the attempt in hand needs one.
   *
   * The redirect address is not fixed for all time. A build that sent `openbot://mcp-auth` and one
   * that listens on a loopback port register different `redirect_uris`, and the port changes on
   * each start - so a stored registration often names another address. An authorization request
   * made against it earns an `Invalid redirect URI.` on the authorization page, where the user can
   * do nothing about it. Answering `undefined` makes the SDK register again, which costs one
   * request and is the whole repair.
   *
   * It is answered that way as late as it can be, because a refresh uses no redirect address at
   * all. Registering in front of one would spend a refresh token against a `client_id` it was
   * never issued to: the authorization server refuses it, and the user is sent to the browser for
   * a sign-in a plain refresh would have avoided. So a record with a refresh token keeps its
   * client for one pass; when that refresh is refused the SDK drops the tokens and asks again,
   * and the pass that goes to the browser is the one that registers.
   *
   * Two attempts never reach here: a silent refresh, which has no browser to register for, and
   * the exchange of a grant already in hand, which must spend it against the `client_id` it was
   * issued to.
   */
  clientInformation(): OAuthClientInformationFull | undefined {
    const record = this.#record();
    // A sign-in app is the client, always: the administrator registered it for this server, and
    // the server offers no registration to fall back on. The first authorization server that accepts
    // it binds it, as the SDK binds a registration; until then it carries no issuer. Another server
    // is refused here, before the SDK can register with it or send it the secret.
    if (record.app) {
      const { issuer } = record.app;
      if (issuer && this.#activeIssuer && !issuersMatch(issuer, this.#activeIssuer))
        throw new Error(sourceText("error.backend.mcpSignInAppIssuerChanged"));
      this.recordSecret(record.app.clientSecret);
      return {
        client_id: record.app.clientId,
        ...(record.app.clientSecret ? { client_secret: record.app.clientSecret } : {}),
        redirect_uris: [this.#options.redirectUrl],
        ...(issuer ? { issuer } : {}),
      };
    }
    const client = this.#credential(record.client);
    this.recordSecret(record.client?.client_secret);
    if (!client) {
      // The token endpoint refused the client, and the SDK dropped it before it tried again. The
      // grant belongs to that client, so a new registration cannot spend it. Without this the SDK
      // says only that it has no client, and the user cannot see that the server refused it.
      if (this.#exchangingCode) throw new Error(sourceText("error.backend.mcpSignInClientRefused"));
      return this.#register();
    }
    if (!this.#options.state || this.#exchangingCode) return client;
    if (client.redirect_uris.includes(this.#options.redirectUrl)) return client;
    const refreshWorthTrying = !this.#redirectAddressChecked && Boolean(record.tokens?.refresh_token);
    this.#redirectAddressChecked = true;
    return refreshWorthTrying ? client : this.#register();
  }

  get registrationPending(): boolean {
    return this.#registrationPending;
  }

  get registrationStatus(): number | null {
    return this.#registrationStatus;
  }

  /**
   * Matched by address, not by `#registrationPending`: the SDK also registers when it drops a
   * client bound to another issuer, which this provider never hears about.
   */
  watchRegistration(fetch: FetchLike): FetchLike {
    return async (input, init) => {
      const response = await fetch(input, init);
      const registrationUrl = this.#registrationUrl();
      if (init?.method === "POST" && registrationUrl !== null && new URL(String(input)).href === registrationUrl)
        this.#registrationStatus = response.status;
      return response;
    };
  }

  /** Where the SDK registers: the advertised endpoint, or `/register` when no metadata was found. */
  #registrationUrl(): string | null {
    const discovery = this.#discoveryState;
    if (!discovery) return null;
    const endpoint = discovery.authorizationServerMetadata
      ? discovery.authorizationServerMetadata.registration_endpoint
      : new URL("/register", discovery.authorizationServerUrl).href;
    return endpoint && URL.canParse(endpoint) ? new URL(endpoint).href : null;
  }

  /** No client, which makes the SDK register next. */
  #register(): undefined {
    this.#registrationPending = true;
    return undefined;
  }

  /**
   * The grant is in hand, so the registration on file is the one that has to spend it.
   * `McpOAuth` calls this before the exchange; nothing else does.
   */
  beginCodeExchange(): void {
    this.#exchangingCode = true;
  }

  saveClientInformation(information: OAuthClientInformationFull): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        this.#registrationPending = false;
        this.#registrationStatus = null;
        this.recordSecret(information.client_secret);
        // The SDK binds an unstamped client to its issuer after an exchange. For a sign-in app that
        // binding is all that is written: the app is not a registration.
        const { app } = this.#record();
        if (app) {
          if (!app.issuer && typeof information.issuer === "string" && information.client_id === app.clientId)
            yield* this.#save({ app: { ...app, issuer: information.issuer } });
          return;
        }
        yield* this.#save({ client: information });
      }),
    );
  }

  tokens(): OAuthTokens | undefined {
    const tokens = this.#credential(this.#record().tokens);
    this.#recordTokens(tokens);
    return tokens;
  }

  saveTokens(tokens: OAuthTokens): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        this.#recordTokens(tokens);
        yield* this.#save({ tokens, obtainedAt: Date.now(), lostAt: undefined });
      }),
    );
  }

  /**
   * A refresh with no browser behind it: the stored refresh token is traded for a new token set,
   * and nothing else is tried.
   *
   * The `auth()` flow of the SDK does more. When the authorization server refuses the client, it
   * drops the whole record, registers a new client (RFC 7591) and starts an authorization that this
   * run cannot show. When the server refuses the grant, it drops the tokens and the caller gets the
   * expired token. Both happen with no user to ask. Here the refusal is classified, and the record
   * says what it cost:
   *
   * - `invalid_grant`: the grant ended. The tokens go. The client and the discovery stay, so the
   *   next sign-in uses the same registration.
   * - `invalid_client` or `unauthorized_client`: the client is not accepted. The tokens and the
   *   registration go. A sign-in app stays, because the administrator typed it.
   * - Any other failure (no network, a server error, a timeout) keeps the record as it is.
   *
   * The first two set `lostAt`, so the row says that the user must sign in again.
   */
  readonly refresh = Effect.fn("McpOAuthClientProvider.refresh")(function* (
    this: McpOAuthClientProvider,
    fetchFn: FetchLike,
  ): Effect.fn.Return<"refreshed" | "lost" | "kept", McpOperationError> {
    const stored = this.#record();
    const discovery = this.discoveryState();
    // The SDK binds a credential to the authorization server URL it found, so that URL is the
    // issuer. A record without discovery state still names it on its tokens.
    const issuer =
      discovery?.authorizationServerUrl ??
      (typeof stored.tokens?.issuer === "string" ? stored.tokens.issuer : undefined);
    if (!issuer) return "kept";
    this.#activeIssuer = issuer;
    const tokens = this.tokens();
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken || (typeof tokens.issuer === "string" && !issuersMatch(tokens.issuer, issuer))) return "kept";
    // A silent provider answers the client on file, or none. With none, a refresh is not possible
    // without registering, and this does not register.
    const client = yield* mcpSync(() => this.clientInformation());
    if (!client || (typeof client.issuer === "string" && !issuersMatch(client.issuer, issuer))) return "kept";
    const metadata = yield* mcpCall(() => discoverAuthorizationServerMetadata(issuer, { fetchFn }));
    const resourceMetadata = yield* mcpCall(() =>
      discoverOAuthProtectedResourceMetadata(
        this.#options.resource,
        discovery?.resourceMetadataUrl ? { resourceMetadataUrl: discovery.resourceMetadataUrl } : {},
        fetchFn,
      ),
    ).pipe(Effect.catch(() => Effect.succeed(undefined)));
    const selected = yield* mcpCall(() => selectResourceURL(this.#options.resource, this, resourceMetadata));
    // Sent as the metadata states it, exactly as `auth()` sends it: `URL.href` adds a "/" to a
    // pathless indicator, and a server that compares exactly refuses that.
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
      // As `auth()` does: a client saved before 1.31 is bound to the server that accepted it.
      if (typeof client.issuer !== "string")
        yield* mcpCall(() => this.saveClientInformation({ ...client, issuer })).pipe(Effect.catch(() => Effect.void));
      yield* mcpCall(() => this.saveTokens({ ...result.success, issuer }));
      return "refreshed";
    }
    const cause = result.failure.cause;
    const clientRefused = cause instanceof InvalidClientError || cause instanceof UnauthorizedClientError;
    if (!clientRefused && !(cause instanceof InvalidGrantError)) return "kept";
    const current = this.#record();
    // A sign-in that ended during the refresh stored a new grant: the refusal is about the old one.
    if (current.tokens?.refresh_token !== refreshToken) return "kept";
    const { tokens: _tokens, obtainedAt: _obtainedAt, client: registration, ...kept } = current;
    yield* this.#options.storage.write(this.#options.resource, {
      ...kept,
      ...(registration && !clientRefused ? { client: registration } : {}),
      lostAt: Date.now(),
    });
    return "lost";
  });

  /** What this attempt must never quote back. Short values are left to `redactMcpValues`. */
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

  /**
   * The user's own browser, not a window of this app.
   *
   * An embedded window would be OpenBot standing between the user and their password manager, their
   * existing session and the address bar that proves which site is asking - which is the whole
   * reason RFC 8252 says a native app must not do it. The one other opener is a sign-in an
   * administrator started from another computer: nobody is at this one, and only a browser here
   * reaches the loopback address the grant comes back to, so the page opens in a private tab of this
   * host's browser that the administrator watches.
   */
  redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        // The probe moved on: a discovery slow enough to outlast it must not open a browser
        // afterwards for a grant nobody waits for.
        if (this.#options.isAbandoned()) return;
        if (!this.#options.state) return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInNoBrowser")));
        // The address arrives in the server's own discovery document, and the SDK accepts more than
        // web pages: an https server naming a file or an installed protocol handler must not reach
        // the browser. Loopback http stays, for a sign-in server on the user's own machine.
        if (!isAuthorizationUrlSafe(authorizationUrl))
          return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInNotWebPage")));
        const { app } = this.#record();
        const url = withGoogleOfflineAccess(
          app?.scope
            ? withAppScope(authorizationUrl, app)
            : withOfflineAccess(authorizationUrl, this.#discoveryState?.authorizationServerMetadata),
        );
        yield* mcpCall(() => this.#options.openExternal(url.toString()));
      }),
    );
  }

  /**
   * The authorization server the last exchange found, kept with the encrypted credentials so a
   * later exchange - in this run or after a restart - reuses it. Without this the SDK
   * rediscovers at the default locations: metadata that lives only at the advertised URL is
   * missed, and the exchange falls back to the MCP origin's token endpoint.
   */
  saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
    return runCauseEffect(
      Effect.gen({ self: this }, function* () {
        this.#activeIssuer = discovery.authorizationServerUrl;
        this.#discoveryState = discovery;
        // A pre-1.31 record has no safe issuer when its discovery state is absent. Do not let a
        // malicious resource install its authorization server as the binding for that record.
        // When old discovery exists, keep it until the old credentials have been stamped.
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

  /**
   * What the server says is no longer worth keeping. The SDK calls this after a refusal it can
   * recover from, and then tries once more, so dropping the right part here is what turns a stale
   * registration into one sign-in rather than a server the user can never connect again.
   */
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
        // A sign-in app stays through every refusal: the administrator typed it, and only they
        // can change it.
        const record = yield* mcpSync(() => this.#record());
        if (scope === "all") {
          this.#codeVerifier = null;
          if (record.app) yield* this.#options.storage.write(this.#options.resource, { app: record.app });
          else yield* this.#options.storage.clear(this.#options.resource);
          return;
        }
        // The discovery stays with the part that is kept: the retry that follows reuses it.
        const { tokens, obtainedAt, client, ...kept } = record;
        yield* this.#options.storage.write(
          this.#options.resource,
          scope === "client" ? { ...kept, tokens, obtainedAt } : { ...kept, client },
        );
      }),
    );
  }

  #record(): McpOAuthRecord {
    return this.#options.storage.read(this.#options.resource) ?? {};
  }

  #credential<T extends Pick<OAuthTokens, "issuer">>(credential: T | undefined): T | undefined {
    if (!credential) return undefined;
    if (typeof credential.issuer === "string") return credential;
    // Let SDK 1.31 stamp a trusted legacy value when the exchange succeeds. Returning a copy
    // with an issuer here would make the SDK treat it as already stamped and leave the record
    // unbound after the migration.
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
    yield* this.#options.storage.write(this.#options.resource, next);
  });
}

/**
 * The URL a token is filed under: the address as the server itself would resolve it, so a row
 * written with a trailing slash and one without share the account the user signed in to once.
 *
 * `https`, or `http` on the loopback address. A grant sent to a plain-text address anywhere else is
 * a grant on the wire, and every shipped listing is `https` already. Loopback is the exception RFC
 * 8252 makes and the one a user testing a server on their own machine needs.
 */
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

/** A legacy binding is useful only when it names an endpoint this client would send credentials to. */
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

function issuersMatch(left: string, right: string): boolean {
  try {
    const a = new URL(left).toString();
    const b = new URL(right).toString();
    return a === b || (a.endsWith("/") && a.slice(0, -1) === b) || (b.endsWith("/") && b.slice(0, -1) === a);
  } catch {
    return left === right;
  }
}

/** The names that never leave this machine. `::1` arrives from `URL` inside brackets. */
export function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Why an address cannot receive a grant, or `null` when it can.
 *
 * Checked where the address is configured rather than where it is spent, because the failure it
 * prevents is otherwise invisible from here: the authorization server refuses the address on its
 * own page, in its own words, after the browser has already left. Canva answers `Invalid redirect
 * URI.` there and OpenBot never learns of it.
 *
 * Two kinds are allowed, and they are the two RFC 8252 gives a native application: loopback http,
 * which is what this app listens on, and a private-use scheme such as `openbot://mcp-auth`, which
 * the operating system routes. An `https` address belongs to a web site, and a plain-text address
 * anywhere but loopback would put the grant on the wire.
 */
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

/**
 * The scope a sign-in app names replaces the one the SDK chose from the server's metadata: the
 * administrator registered the app for exactly that scope. `offline_access` asks for consent, as the
 * SDK does, so the server issues a refresh token.
 */
function withAppScope(authorizationUrl: URL, app: McpOAuthApp | undefined): URL {
  if (!app?.scope) return authorizationUrl;
  const url = new URL(authorizationUrl);
  url.searchParams.set("scope", app.scope);
  if (app.scope.split(/\s+/).includes("offline_access") && !url.searchParams.has("prompt"))
    url.searchParams.set("prompt", "consent");
  return url;
}

/**
 * The SDK asks for the scope of the protected-resource metadata, and an OpenID server that lists
 * `offline_access` issues a refresh token only when the request names it. Vercel's tokens last one
 * hour, so without it every sign-in stopped working an hour later. Added only to a scope the SDK
 * already sends: a request with no scope gets the server's default grant, which a lone
 * `offline_access` would replace.
 */
function withOfflineAccess(authorizationUrl: URL, metadata: OAuthDiscoveryState["authorizationServerMetadata"]): URL {
  const scope = authorizationUrl.searchParams.get("scope");
  if (!scope || !metadata?.scopes_supported?.includes("offline_access")) return authorizationUrl;
  if (scope.split(/\s+/).includes("offline_access")) return authorizationUrl;
  const url = new URL(authorizationUrl);
  url.searchParams.set("scope", `${scope} offline_access`);
  if (!url.searchParams.has("prompt")) url.searchParams.set("prompt", "consent");
  return url;
}

/**
 * Google issues a refresh token only when the request says `access_type=offline`, and only at a
 * consent, so `prompt=consent` comes with it. Its metadata lists no `offline_access` scope, so
 * `withOfflineAccess` never adds one, and its access tokens last one hour: without this a sign-in
 * to Google's MCP servers, such as Gmail or Drive, stopped working an hour later.
 */
function withGoogleOfflineAccess(authorizationUrl: URL): URL {
  if (authorizationUrl.origin !== "https://accounts.google.com" || authorizationUrl.searchParams.has("access_type"))
    return authorizationUrl;
  const url = new URL(authorizationUrl);
  url.searchParams.set("access_type", "offline");
  if (!url.searchParams.has("prompt")) url.searchParams.set("prompt", "consent");
  return url;
}

/** Where a browser may be sent: a web page, or a sign-in server on the user's own machine. */
function isAuthorizationUrlSafe(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopback(url.hostname);
}

/**
 * How many hops an OAuth endpoint may redirect through before this gives up. Enough for the
 * ordinary canonicalising hop - a bare host to its `www`, a metadata path to its real home - and
 * far short of a loop.
 */
const MAX_OAUTH_REDIRECTS = 5;

/** The redirects that carry the request on, and keep their method and body when they do. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The fetch every OAuth exchange goes through.
 *
 * `normalizeResource` checks the MCP server's own address, and `isAuthorizationUrlSafe` checks
 * where the browser is sent - but neither covers where the credentials themselves go. Discovery
 * answers with addresses of its own, and the SDK posts the authorization code, the PKCE verifier
 * and the refresh token to whatever `token_endpoint` the metadata names. An https server whose
 * document names `http://auth.example.com/token` would put all three on the wire in clear text.
 *
 * So the check is here, where every request passes, and it is applied to each hop rather than to
 * the first one alone: a redirect to a plain-text address leaks exactly as much as naming it
 * directly. Redirects are followed by hand for that reason - `fetch` would follow them itself and
 * never say where it went.
 */
export function secureOAuthFetch(options: SecureOAuthFetchOptions = {}): FetchLike {
  const resource = options.resource === undefined ? null : new URL(options.resource);
  const resolve = options.lookup ?? systemAddressLookup;
  const guard: OAuthAddressGuard | null = resource
    ? {
        resource,
        // Resolved once for each exchange: every hop compares its addresses with this one answer.
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
  /**
   * The MCP server the exchange is for. When it is on the public internet, every OAuth endpoint
   * must be too.
   */
  resource?: string;
  /**
   * Whether this fetch also sends MCP traffic, as the probe transport does. A request to the exact
   * `resource` address then has no size or time limit. A sign-in, refresh or revocation sends no
   * MCP traffic, so an endpoint at that address still has the limits.
   */
  mcpTraffic?: boolean;
  /** Resolves host names for that rule. `dns.lookup` when not given. */
  lookup?: AddressLookup;
}

interface OAuthAddressGuard {
  resource: URL;
  resourcePublic: Effect.Effect<boolean, AddressLookupError>;
  resolve: AddressLookup;
}

/**
 * The largest OAuth response that is read. Metadata, a registration and a token set are a few
 * kilobytes; a larger body is not one of them, and reading it without a limit lets a server use
 * this computer's memory.
 */
const OAUTH_BODY_LIMIT = 1024 * 1024;

/**
 * How long one OAuth request may take, from the request to the last byte of its body. The callers
 * have deadlines of their own; this one stops a single endpoint that never finishes.
 */
const OAUTH_REQUEST_TIMEOUT_MS = 20_000;

const secureOAuthRequest = Effect.fn("McpOAuth.secureFetch")(function* (
  input: Parameters<FetchLike>[0],
  init: Parameters<FetchLike>[1],
  signal: AbortSignal | undefined,
  guard: OAuthAddressGuard | null,
  mcpServer: URL | null,
): Effect.fn.Return<Response, McpOperationError> {
  let url = yield* mcpSync(() => new URL(input instanceof URL ? input.toString() : input));
  const mcpTraffic = mcpServer !== null && withoutHash(url) === withoutHash(mcpServer);
  let request: RequestInit = { ...init, ...(signal ? { signal } : {}), redirect: "manual" };
  for (let hop = 0; ; hop++) {
    if (!isSecureEndpoint(url))
      return yield* mcpFailure(new Error(sourceText("error.backend.oauthNotHttps", { origin: url.origin })));
    if (guard) yield* checkEndpointAddress(url, guard);
    const origin = url.origin;
    // A redirect to another origin leaves the MCP server, so that hop has the OAuth limits.
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
          // Only a redirect this loop follows skips the limit: one with no `Location` goes to the SDK.
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
    if (location === null) return response;
    // Redirect response bodies are not consumed by the SDK.
    yield* mcpCall(() => response.body?.cancel()).pipe(Effect.catch(() => Effect.void));
    if (hop >= MAX_OAUTH_REDIRECTS)
      return yield* mcpFailure(new Error(sourceText("error.backend.oauthTooManyRedirects")));
    const next = yield* mcpSync(() => new URL(location, url));
    if (next.origin !== url.origin && carriesCredential(request))
      return yield* mcpFailure(new Error(sourceText("error.backend.oauthRedirectOrigin", { origin: next.origin })));
    url = next;
    request = redirected(request, response.status);
  }
});

/**
 * Refuses an OAuth endpoint on a private network when the MCP server is on the public internet.
 *
 * Discovery names the endpoints, and the SDK sends the code, the verifier and the refresh token to
 * them. A public server that names `10.0.0.5` or `localhost` would make this computer send requests
 * into its own network. A server that the user typed as a private or loopback address is not
 * affected: its authorization server is commonly on the same network.
 *
 * DNS can answer differently between this check and the connection. There is no pinning: this
 * stops a document that names a private address, not a resolver that changes its answer.
 */
const checkEndpointAddress = Effect.fn("McpOAuth.checkEndpointAddress")(function* (url: URL, guard: OAuthAddressGuard) {
  if (!(yield* toMcpOperationError(guard.resourcePublic))) return;
  const addresses = yield* toMcpOperationError(hostAddresses(url, guard.resolve));
  if (addresses.length > 0 && addresses.every(isPublicAddress)) return;
  return yield* mcpFailure(new Error(sourceText("error.backend.mcpOAuthPrivateEndpoint", { origin: url.origin })));
});

/** The response with its body read, up to `OAUTH_BODY_LIMIT`. */
function limited(response: Response, origin: string): Effect.Effect<Response, McpOperationError> {
  return readLimitedBody(response, OAUTH_BODY_LIMIT, (reason) =>
    mcpFailure(
      reason === "too-large"
        ? new Error(sourceText("error.backend.oauthResponseTooLarge", { origin }))
        : new Error(sourceText("error.backend.oauthResponseUnreadable", { origin })),
    ),
  ).pipe(
    Effect.map((body) => {
      // The body is decoded already, and its length is the one read here.
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

/** The statuses whose response cannot have a body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function withoutHash(url: URL): string {
  return url.href.replace(/#.*$/, "");
}

/** Whether this request would hand the next origin something only the first one should have. */
function carriesCredential(request: RequestInit): boolean {
  if (request.body !== undefined && request.body !== null) return true;
  return new Headers(request.headers).has("authorization");
}

/** Where a credential may be sent: an https endpoint, or one on the user's own machine. */
function isSecureEndpoint(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopback(url.hostname);
}

/**
 * The next hop's request. RFC 9110 turns 301, 302 and 303 into a bodyless `GET`; 307 and 308 keep
 * the method and the body, which is what a token endpoint that moved needs.
 */
function redirected(request: RequestInit, status: number): RequestInit {
  if (status === 307 || status === 308) return request;
  const { body: _body, ...rest } = request;
  return { ...rest, method: "GET" };
}

/**
 * The client a revocation authenticates as: the sign-in app, or the registration on file. `null`
 * when the one on file belongs to another authorization server, which must not receive it.
 */
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

/** One RFC 7009 request. Answers `ok`, or the HTTP status the server gave instead. */
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

/** The method a registration asks for, from the ones the authorization server lists. */
function tokenEndpointAuthMethod(
  methods: string[] | undefined,
): Pick<OAuthClientMetadata, "token_endpoint_auth_method"> {
  if (methods?.includes("none")) return { token_endpoint_auth_method: "none" };
  if (methods?.includes("client_secret_post") && !methods.includes("client_secret_basic"))
    return { token_endpoint_auth_method: "client_secret_post" };
  return {};
}

/** The class of a failure, for a log line that must not carry the failure's own text. */
function errorKind(error: unknown): string {
  const cause = error instanceof McpOperationError ? error.cause : error;
  return cause instanceof Error ? cause.name : "unknown";
}

/** Whether the stored access token is inside the margin, or already past its life. */
function expiringSoon(record: McpOAuthRecord, marginMs = TOKEN_REFRESH_MARGIN_MS): boolean {
  const seconds = record.tokens?.expires_in;
  // A server that states no lifetime is taken at its word. Refreshing on a guess would spend a
  // refresh token on every thread start for a token that was never going to expire.
  if (seconds === undefined || record.obtainedAt === undefined) return false;
  return record.obtainedAt + seconds * 1000 - marginMs <= Date.now();
}
