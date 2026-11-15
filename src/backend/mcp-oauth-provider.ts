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
 * A server is keyed by its URL. Two rows naming the same URL are the same account to the server, so
 * they are the same account here. The exception is a row whose URL ends in an `#account-…`
 * fragment: the user added it as another account, and it has its own sign-in. See
 * `mcpOAuthAccountKey`.
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
import { mcpAccountFragment } from "@openbot/contracts/mcp-accounts";
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

/**
 * OpenBot's OAuth client metadata document. `apps/auth-api` serves it, and its `redirect_uris`
 * must hold every address that `redirectUrl` can be for this document. The `localhost` form comes
 * only from an RFC 7591 registration, never from this document.
 */
const MCP_CLIENT_METADATA_URL = "https://openbot.run/oauth/mcp-client.json";

/** The `client_name` that OpenBot registers with. */
export const MCP_CLIENT_NAME = "OpenBot";

/**
 * The second path of the loopback grant listener. Dropbox registers only the loopback paths of the
 * MCP clients that it knows, `/callback` among them, and refuses `/mcp-auth` with a 403 (#8025).
 */
export const MCP_OAUTH_CALLBACK_PATH = "/callback";

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
  /**
   * This installation's registration with that authorization server, from RFC 7591. For a client
   * metadata document it is the document URL, and `redirect_uris` holds the address of the run that
   * used it, so a run on another address uses the document again.
   */
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
  /**
   * The `openbot://mcp-auth` deep link, which a sign-in in this computer's browser registers after
   * the browser did not come back on `127.0.0.1` or on `localhost`. TradingView's firewall blocks a
   * sign-in page that names either one (#7230). Read at each sign-in: `undefined` while the
   * operating system does not open the link in this app, and then the retry uses only the two
   * loopback names.
   */
  deepLinkRedirectUrl?: () => string | undefined;
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

/**
 * What Sign in would do for a server that answered without one: nothing, open a page, or end at
 * once because the authorization server cannot take OpenBot as a client.
 */
export type McpSignInOffer = "none" | "offered" | "refused";

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
   * Whether this attempt had to register, and the authorization server has no registration endpoint.
   * Google's has none and takes no client metadata document either, so the SDK stops before any
   * request with a bare sentence about dynamic client registration.
   */
  registrationUnsupported: () => boolean;
  /**
   * The HTTP status of this attempt's last registration answer, or `null`. The SDK keeps the status
   * only when the body is not an OAuth error, and turns a code it does not know into a
   * `ServerError`: Dropbox answers 403 `registration_not_supported`, which arrives as a bare
   * sentence. Only a fetch passed through `watchRegistration` sees the status.
   */
  registrationStatus: () => number | null;
  /**
   * Whether the authorization server refused each redirect address of this attempt's registration
   * with `invalid_redirect_uri`. YNAB registers only the MCP clients it approved (#8417).
   */
  registrationRedirectRefused: () => boolean;
  /** `fetch` for an exchange that can register, keeping the status of the registration answer. */
  watchRegistration: (fetch: FetchLike) => FetchLike;
  /**
   * Whether the user cancelled this attempt. A cancel can land during discovery, registration or
   * the token exchange, where the step it stops fails with its own words; the reader says
   * "cancelled" instead, because that is what the user did.
   */
  cancelled: () => boolean;
  /**
   * Whether the token endpoint answered the grant with a failure. Its timeout is not one: that has
   * its own words. Supabase refuses a grant with a 404, which must not read as a wrong address.
   */
  exchangeFailed: () => boolean;
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
  signIn: (url: string, open?: McpSignInOpener, deepLinkRedirectUrl?: string) => McpSignIn | null;
  /** Ends the sign-in waiting for this URL's browser, if one is. Answers whether one was. */
  cancelSignIn: (url: string) => boolean;
  /** Whether this computer holds a token for this URL. Never the token itself. */
  signedIn: (url: string) => boolean;
  /** Whether the server refused the stored sign-in, so the user must sign in again. */
  needsSignIn: (url: string) => boolean;
  /** Whether this computer keeps a sign-in for this URL: current, expired, or ended by the server. */
  hasSignIn: (url: string) => boolean;
  /** What Sign in would do for a server that answered without one. See `McpOAuth.signInOffer`. */
  signInOffer: (url: string) => Effect.Effect<McpSignInOffer>;
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
  /**
   * For each server, the redirect address its last sign-in opened the browser with and got no grant
   * back on. The next sign-in registers the other name of the same listener: a firewall can refuse
   * a request that names `127.0.0.1` on the authorization page, where OpenBot cannot see it (#6149).
   * After `localhost`, a sign-in in this computer's browser registers the deep link (#7230).
   */
  readonly #unanswered = new Map<string, string>();
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
    const key = mcpOAuthAccountKey(url);
    if (!key) return null;
    const stored = yield* mcpSync(() => this.#options.storage.read(key));
    if (!stored?.tokens) return null;
    const fallback = stored.tokens.access_token;
    if (!expiringSoon(stored)) return fallback;
    // The SDK binds credentials saved by new versions to the authorization server. An older
    // record without that binding must not trigger discovery and then spend its refresh token at
    // whichever server the MCP resource names. Keep the access token for the resource instead.
    if (!credentialIssuer(stored.tokens, stored)) return fallback;
    yield* this.#refresh(key);
    return yield* mcpSync(() => this.#options.storage.read(key)?.tokens?.access_token ?? null);
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
    const key = mcpOAuthAccountKey(url);
    if (!key) return null;
    const stored = yield* mcpSync(() => this.#options.storage.read(key));
    if (!stored?.tokens) return null;
    if (stored.tokens.access_token !== rejected) return stored.tokens.access_token;
    if (!stored.tokens.refresh_token) {
      const { tokens: _tokens, obtainedAt: _obtainedAt, ...kept } = stored;
      yield* this.#options.storage.write(key, { ...kept, lostAt: Date.now() });
      return null;
    }
    if (!credentialIssuer(stored.tokens, stored)) return null;
    yield* this.#refresh(key);
    const next = yield* mcpSync(() => this.#options.storage.read(key)?.tokens?.access_token ?? null);
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
  readonly #refresh = Effect.fn("McpOAuth.refresh")(function* (this: McpOAuth, key: string) {
    const running = this.#refreshing.get(key);
    const timeoutMs = this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS;
    if (running) return yield* this.#awaitRefresh(running);
    const controller = new AbortController();
    // The scope owns the exchange; a caller can stop waiting without cancelling another caller's refresh.
    const operation = this.#provider(key, null)
      .refresh(this.#fetch(key, controller.signal))
      .pipe(
        Effect.asVoid,
        Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.void }),
        Effect.catch(() => Effect.void),
        Effect.ensuring(Effect.sync(() => controller.abort())),
      );
    const exchange = yield* Effect.forkIn(operation, this.#scope, { startImmediately: true });
    this.#refreshing.set(key, exchange);
    exchange.addObserver(() => {
      if (this.#refreshing.get(key) === exchange) this.#refreshing.delete(key);
    });
    yield* this.#awaitRefresh(exchange);
  });

  /** The fetch of one exchange for this server. */
  #fetch(key: string, signal: AbortSignal): FetchLike {
    const { lookup } = this.#options;
    return secureOAuthFetch({ signal, resource: mcpOAuthServerUrl(key), ...(lookup ? { lookup } : {}) });
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

  /**
   * A sign-in the user asked for, or `null` when the URL is not one this can sign in to. With `open`,
   * `deepLinkRedirectUrl` is the link that the computer where the page opens returns to OpenBot on
   * (`sign-in-relay-deep-link-v1`).
   */
  signIn(url: string, open?: McpSignInOpener, deepLinkRedirectUrl?: string): McpSignIn | null {
    const key = mcpOAuthAccountKey(url);
    if (!key) return null;
    this.#attempts.get(key)?.();
    const unanswered = this.#unanswered.get(key);
    this.#unanswered.delete(key);
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
    let exchangeFailed = false;
    const resource = mcpOAuthServerUrl(key);
    const provider = this.#provider(key, state, () => abandoned, open, unanswered, deepLinkRedirectUrl);
    const abandon = () => {
      // `receiveAuthorizationCode` removes the state when the grant arrives. An attempt that ended
      // before it opened a page keeps the record it was given, for the next attempt.
      const unansweredNow = provider.openedRedirectUrl ?? unanswered;
      if (!abandoned && this.#waiting.has(state) && unansweredNow) this.#unanswered.set(key, unansweredNow);
      abandoned = true;
      this.#waiting.delete(state);
      this.#openedElsewhere.delete(state);
      if (this.#attempts.get(key) === cancel) this.#attempts.delete(key);
    };
    // The user said stop: the wait ends now rather than at its deadline, with its own sentence.
    const cancel = () => {
      cancelled = true;
      Deferred.doneUnsafe(grant, Effect.fail(new Error(sourceText("error.backend.mcpSignInCancelled"))));
      abandon();
    };
    this.#attempts.set(key, cancel);
    return {
      provider,
      begin: () =>
        Effect.gen({ self: this }, function* () {
          if (cancelled || abandoned || this.#options.storage.read(key)?.tokens) return false;
          // Discovery and the registration read only public documents; the abort ends them with this step.
          const controller = new AbortController();
          const fetchFn = provider.watchRegistration(this.#fetch(key, controller.signal));
          return yield* withTimeout(
            Effect.gen(function* () {
              // A server that answers without a sign-in and names no authorization server takes none:
              // the SDK would otherwise guess `/authorize` at the server's own origin.
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
      registrationStatus: () => provider.registrationStatus,
      registrationRedirectRefused: () => provider.redirectRefused,
      watchRegistration: (fetch) => provider.watchRegistration(fetch),
      cancelled: () => cancelled,
      exchangeFailed: () => exchangeFailed,
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
    const key = mcpOAuthAccountKey(url);
    const cancel = key ? this.#attempts.get(key) : undefined;
    cancel?.();
    return cancel !== undefined;
  }

  signedIn(url: string): boolean {
    const key = mcpOAuthAccountKey(url);
    const record = key === null ? undefined : this.#options.storage.read(key);
    // An expired token with no refresh token is a sign-in the server refuses, not one to show as current.
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

  /**
   * What Sign in would do for a server that answered without one. `offered`: no token is on file,
   * and its metadata names an authorization server. Some servers list their tools to anyone and want
   * a token only to run one. `refused`: that authorization server cannot take OpenBot as a new client,
   * so Sign in would end at once with the refused-registration sentence (#8827). Public documents
   * only; a read that fails is `none`, because nobody pressed Sign in to see its error.
   */
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
      // A sign-in app, or a registration with this issuer, is the client: nothing has to register.
      // The SDK drops a registration bound to another issuer and registers again.
      const client = record?.client;
      if (record?.app || (client && (typeof client.issuer !== "string" || issuersMatch(client.issuer, issuer))))
        return "offered";
      return (yield* acceptsNewClient(issuer, fetchFn, timeoutMs)) ? "offered" : "refused";
    }).pipe(Effect.ensuring(Effect.sync(() => controller.abort())));
  });

  get redirectUrl(): string {
    return this.#options.redirectUrl;
  }

  /**
   * Forgets one server's registration, tokens and sign-in app. Used when the row is removed. The
   * tokens are revoked after they are gone from this computer: see `#revoke`.
   */
  readonly forget = Effect.fn("McpOAuth.forget")(function* (this: McpOAuth, url: string) {
    const key = mcpOAuthAccountKey(url);
    if (!key) return;
    const record = this.#options.storage.read(key);
    this.#invalidate(key);
    yield* this.#options.storage.clear(key);
    yield* this.#revoke(key, record);
  }).bind(this);

  /**
   * Forgets one server's registration and tokens, and keeps its sign-in app: the administrator
   * registered that app by hand, and signing out of an account is not a reason to type it again.
   */
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

  /**
   * Asks the authorization server to end the grant (RFC 7009), after the local copy is deleted.
   *
   * The order matters. A revocation that hangs or fails must not keep a token on this computer
   * that the user asked to remove, so the delete comes first and the request runs in the
   * background. One request per token, refresh token first: most servers end the access token with
   * its grant. A failure is logged and nothing else. The user signed out here, and a server that
   * cannot revoke still lets the token expire.
   */
  #revoke(key: string, record: McpOAuthRecord | null): Effect.Effect<void> {
    const tokens = record?.tokens;
    if (!record || !tokens) return Effect.void;
    const issuer = credentialIssuer(tokens, record);
    const client = revocationClient(record, issuer);
    if (!issuer || !client) return Effect.void;
    const timeoutMs = this.#options.revocationTimeoutMs ?? MCP_REVOCATION_TIMEOUT_MS;
    const logger = this.#options.logger;
    const origin = new URL(key).origin;
    // Aborts what is still open when the revocation ends, so a request that never answers does not outlive it.
    const controller = new AbortController();
    const fetchFn = this.#fetch(key, controller.signal);
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
    const key = mcpOAuthAccountKey(url);
    const app = key ? this.#options.storage.read(key)?.app : undefined;
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
    // The binding protects the secret, so a secret kept on file keeps it, also under another client
    // ID. Only a new secret, or no secret, can go to another authorization server.
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

  /** Refuses the later writes of every refresh and sign-in already running, and ends the sign-in. */
  #invalidate(key: string): void {
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    this.#attempts.get(key)?.();
    this.#unanswered.delete(key);
  }

  /** A `state` makes the provider interactive; `null` keeps it silent. */
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
    // The store as this run saw it: reads answer from disk, but a write or a removal lands only
    // while no `forget` has removed the server - and no abandon has ended the run - since this
    // provider was built.
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
      key,
      resource: mcpOAuthServerUrl(key),
      state,
      storage: guarded,
      redirectUrl: this.#options.redirectUrl,
      // A page that an opener shows is not in this computer's browser, which is what opens the deep link.
      // A relayed page opens on a computer that can name its own.
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
  /** The store entry of the account. See `mcpOAuthAccountKey`. */
  key: string;
  /** The server address that discovery and the token requests name. */
  resource: string;
  state: string | null;
  storage: McpOAuthStorage;
  redirectUrl: string;
  /** The deep link to register after `localhost` got no grant back, or unset. See `McpOAuthOptions`. */
  deepLinkRedirectUrl?: (() => string | undefined) | undefined;
  openExternal: (url: string) => Promise<void>;
  /** Whether the sign-in that built this provider has been abandoned since. */
  isAbandoned: () => boolean;
  /** The issuer from a pre-1.31 record, captured before the SDK can write new discovery state. */
  legacyIssuer: string | undefined;
  /** Whether this provider started with credentials that have no issuer binding. */
  hasUnboundCredentials: boolean;
  /** The address the last sign-in of this server opened the browser with and got no grant back on. */
  unansweredRedirectUrl?: string | undefined;
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
  /** Set once the grant is in hand: from there the client on file is the one that must spend it. */
  #exchangingCode = false;
  /** A client that this sign-in registered while tokens were on file. See `saveClientInformation`. */
  #registeredClient: OAuthClientInformationFull | undefined;
  /** Issuer selected by the SDK for this auth attempt, captured before credentials are read. */
  #activeIssuer: string | undefined;
  /** Full discovery for this attempt, including custom protected-resource metadata. */
  #discoveryState: OAuthDiscoveryState | undefined;
  /**
   * The client metadata document (CIMD, SEP-991) that names OpenBot. Set in `saveDiscoveryState`
   * only for an authorization server with no RFC 7591 registration endpoint; ElevenLabs accepts only
   * this. The SDK uses it only when the server sets `client_id_metadata_document_supported`. A server
   * with a registration endpoint keeps the registration, so a sign-in that works now does not change
   * to a different client. When that server refuses the registration, `watchRegistration` gives the
   * SDK the document client instead.
   */
  clientMetadataUrl?: string;
  /** Set when the SDK is told to register, and cleared when it saves what it registered. */
  #registrationPending = false;
  /** The status the authorization server answered the pending registration with. */
  #registrationStatus: number | null = null;
  /** Whether that answer was `invalid_redirect_uri`, with no client metadata document to use instead. */
  #redirectRefused = false;

  constructor(options: ClientProviderOptions) {
    this.#options = options;
    this.#localhostRedirectUrl = localhostRedirectUrl(options.redirectUrl);
    // `127.0.0.1`, then `localhost`, then the deep link, and then `127.0.0.1` again. TradingView's
    // firewall blocks a sign-in page that names either loopback name, and lets the deep link through
    // (#7230). The deep link is read only here, when the attempt needs it: on Linux the check runs
    // `xdg-settings`. Without it, the two loopback names alternate.
    const { unansweredRedirectUrl: unanswered } = options;
    this.#deepLinkRedirectUrl =
      unanswered === this.#localhostRedirectUrl ? (options.deepLinkRedirectUrl?.() ?? null) : null;
    this.#retryRedirectUrl = this.#deepLinkRedirectUrl ?? this.#otherRedirectName(unanswered);
  }

  /** The `localhost` form of this run's loopback address, for a server that refuses `127.0.0.1`. */
  readonly #localhostRedirectUrl: string | null;
  /** The deep link, when this attempt registers it instead of a loopback name. */
  readonly #deepLinkRedirectUrl: string | null;
  /**
   * The address to register instead, when the last sign-in of this server opened the browser on
   * another one and no grant came back (#6149).
   */
  readonly #retryRedirectUrl: string | null;
  /** The `redirect_uri` of the authorization page this attempt opened, or `null` before it opens one. */
  #openedRedirectUrl: string | null = null;

  /** The `localhost` form of this run's address for its `127.0.0.1` form, and the reverse. */
  #otherRedirectName(redirectUrl: string | null | undefined): string | null {
    const localhost = this.#localhostRedirectUrl;
    if (!localhost) return null;
    if (redirectUrl === this.#options.redirectUrl) return localhost;
    return redirectUrl === localhost ? this.#options.redirectUrl : null;
  }

  /**
   * This run's address, or its `localhost` form when the registration on file names that form. A
   * server that refused `127.0.0.1` registered that form (#5584), and the authorization request and
   * the token request must send the address that was registered.
   *
   * The deep link only in the attempt that registered it: a build from before the loopback listener
   * registered it too, and Canva refuses it at `/authorize`.
   *
   * A registration that this sign-in keeps in memory while tokens are on file (#6975) is the client
   * that the authorization request names, so its address is the one to send.
   *
   * The `/callback` form only when the registration names it and not this run's address: a server
   * that refused `/mcp-auth` registered it (see `watchRegistration`).
   */
  get redirectUrl(): string {
    const record = this.#record();
    const own = this.#options.redirectUrl;
    const client = this.#registeredClient ?? record.client;
    if (record.app || !client) return own;
    const deepLink = this.#deepLinkRedirectUrl;
    if (deepLink && client.redirect_uris.includes(deepLink)) return deepLink;
    const localhost = this.#localhostRedirectUrl;
    if (localhost && client.redirect_uris.includes(localhost)) return localhost;
    if (client.redirect_uris.includes(own)) return own;
    for (const address of [own, localhost]) {
      const callback = address ? callbackRedirectUrl(address) : null;
      if (callback && registersAddress(client.redirect_uris, callback)) return callback;
    }
    return own;
  }

  /**
   * What OpenBot registers itself as. `redirect_uris` holds the one address this run receives on,
   * so an authorization server will not send a grant anywhere else.
   *
   * No `scope` unless a sign-in app names one: the SDK takes the scope the server's own
   * protected-resource metadata asks for. A resource with no such metadata gets the scope its
   * authorization server lists (see `#authorizationServerScope`).
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
   *
   * `application_type` is `native`: OpenID Dynamic Client Registration takes a missing value as
   * `web`, and a server that follows it refuses the loopback `http` address with "web redirect_uris
   * must only use the https scheme". The SDK schema does not name the field, but sends it.
   */
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

  /**
   * The `scopes_supported` of the authorization server, for a resource that has no
   * protected-resource metadata. The SDK asks for the scope of the 401 challenge, then of the
   * resource's metadata, then of `clientMetadata`, and sends no scope when all three are empty.
   * Microsoft Entra refuses a request with no scope (AADSTS900144), and the Microsoft 365 MCP server
   * lists its scopes only in its authorization server metadata (#7812). The MCP Python SDK uses the
   * same fallback. A resource that has metadata keeps the scope it names, or none.
   */
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
   * A sign-in that the user asked for does not refresh (see `tokens`), so it goes to the browser,
   * and that pass registers.
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
    const client = this.#registeredClient ?? this.#credential(record.client);
    this.recordSecret(record.client?.client_secret);
    if (!client) {
      // The token endpoint refused the client, and the SDK dropped it before it tried again. The
      // grant belongs to that client, so a new registration cannot spend it. Without this the SDK
      // says only that it has no client, and the user cannot see that the server refused it.
      if (this.#exchangingCode) throw new Error(sourceText("error.backend.mcpSignInClientRefused"));
      return this.#register();
    }
    if (!this.#options.state || this.#exchangingCode) return client;
    // The last browser trip on the address of this registration got no grant back: register the
    // next address (see the constructor). A client metadata document lists only one address.
    const retry = this.#retryRedirectUrl;
    if (retry && client.client_id !== MCP_CLIENT_METADATA_URL && !client.redirect_uris.includes(retry))
      return this.#register();
    // A registration made before its scope named `offline_access` refuses the request that adds it.
    // Only a scope from the resource's metadata is checked: with no scope to send, nothing is added.
    const discovery = this.#discoveryState;
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

  get registrationPending(): boolean {
    return this.#registrationPending;
  }

  /** No client, and the authorization server's metadata names no registration endpoint. */
  get registrationUnsupported(): boolean {
    const metadata = this.#discoveryState?.authorizationServerMetadata;
    return this.#registrationPending && metadata !== undefined && !metadata.registration_endpoint;
  }

  get registrationStatus(): number | null {
    return this.#registrationStatus;
  }

  /** Whether the last registration answer refused each redirect address that this attempt sent. */
  get redirectRefused(): boolean {
    return this.#redirectRefused;
  }

  /**
   * Matched by address, not by `#registrationPending`: the SDK also registers when it drops a
   * client bound to another issuer, which this provider never hears about.
   *
   * The registration asks for the scope the authorization request will ask for, `offline_access`
   * included (SEP-2207). A server that limits a client to its registered scope refused the request
   * otherwise: ActiveCampaign answered `invalid_scope` at the authorization page (#5419).
   *
   * A server that refuses the `127.0.0.1` address gets one more registration with the `localhost`
   * form of the same address, which the listener also answers. The MCP authorization specification
   * names `localhost` redirects, and some servers accept only that name (#5584). A `localhost`
   * registration after an unanswered sign-in (#6149) gets the `127.0.0.1` form in the same way.
   *
   * A server that refuses a loopback registration with 401 or 403 gets one more with the `/callback`
   * form of the address it refused, which the listener also answers. Dropbox accepts only the paths
   * of the MCP clients it knows (#8025). A server that refuses OpenBot itself refuses that one too,
   * and the first refusal is kept.
   *
   * A server that refuses each address with `invalid_redirect_uri` registers only the MCP clients it
   * approved: YNAB answers "Redirect URI is not an allowed MCP client" (#8417). The client metadata
   * document then takes the place of the registration, as for a 401 or a 403.
   */
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
      // Only an accepted retry replaces the refusal: its status is what the probe explains.
      const callback = response.status === 401 || response.status === 403 ? this.#withCallbackPath(request) : null;
      const retried = callback ? await fetch(input, callback) : null;
      if (retried?.ok) response = retried;
      this.#registrationStatus = response.status;
      const redirectRefused = (await registrationErrorCode(response)) === "invalid_redirect_uri";
      this.#redirectRefused = redirectRefused;
      if (!this.#documentReplacesRefusal(response.status, redirectRefused)) return response;
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

  /** The registration body with the `/callback` form of the loopback address of this run that it sent, or `null`. */
  #withCallbackPath(init: RequestInit): RequestInit | null {
    if (typeof init.body !== "string") return null;
    const body = registrationBodySchema.parse(JSON.parse(init.body));
    const sent = body.redirect_uris?.length === 1 ? body.redirect_uris[0] : undefined;
    const own = sent === this.#options.redirectUrl || sent === this.#localhostRedirectUrl;
    const callback = sent && own ? callbackRedirectUrl(sent) : null;
    return callback ? { ...init, body: JSON.stringify({ ...body, redirect_uris: [callback] }) } : null;
  }

  /**
   * Whether the client metadata document takes the place of a registration that the authorization
   * server refused. Railway lists a registration endpoint, answers each registration with 403
   * ("Dynamic client registration is disabled"), and accepts the document (#7855). A server that
   * registers OpenBot keeps that registration: only a refusal changes the client. The document has
   * no secret, so the server must list `none`.
   */
  #documentReplacesRefusal(status: number, redirectRefused: boolean): boolean {
    if (status !== 401 && status !== 403 && !redirectRefused) return false;
    const metadata = this.#discoveryState?.authorizationServerMetadata;
    return (
      metadata?.client_id_metadata_document_supported === true &&
      (metadata.token_endpoint_auth_methods_supported?.includes("none") ?? false)
    );
  }

  /**
   * The registration body with each other name of this run's address, in order, or none when it sends
   * neither name. A refused deep link gets `127.0.0.1` and then `localhost`, so the next attempt after
   * that page moves on to `localhost`, as before #7230, and a server that accepts only `localhost`
   * (#5584) still signs in.
   */
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

  /** The SDK's registration body, with the `offline_access` that `withOfflineAccess` will request. */
  #withOfflineAccessRegistration(init: RequestInit): RequestInit {
    if (typeof init.body !== "string") return init;
    const body = registrationBodySchema.parse(JSON.parse(init.body));
    const scope = scopeWithOfflineAccess(body.scope ?? null, this.#discoveryState?.authorizationServerMetadata);
    return scope ? { ...init, body: JSON.stringify({ ...body, scope }) } : init;
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
        this.#redirectRefused = false;
        this.recordSecret(information.client_secret);
        // The SDK binds an unstamped client to its issuer after an exchange. For a sign-in app that
        // binding is all that is written: the app is not a registration.
        const { app } = this.#record();
        if (app) {
          if (!app.issuer && typeof information.issuer === "string" && information.client_id === app.clientId)
            yield* this.#save({ app: { ...app, issuer: information.issuer } });
          return;
        }
        // For a client metadata document the SDK passes only its URL and the issuer. The store
        // refuses a client with no `redirect_uris`, so the address of this run is added, as a
        // registration has it. A later run on another port then uses the document again.
        const client: OAuthClientInformationFull =
          information.client_id === MCP_CLIENT_METADATA_URL
            ? { ...information, redirect_uris: [this.#options.redirectUrl], token_endpoint_auth_method: "none" }
            : information;
        // The tokens on file belong to the client on file: the silent refresh and the revocation at
        // sign-out send them with it. A sign-in that registers again keeps its client here until its
        // grant is exchanged, so a cancel or a timeout keeps the stored sign-in usable (#6975).
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
    // A sign-in that the user asked for (it has a `state`) gets a new grant from the browser. The
    // SDK refreshes when it sees a refresh token, and a server that refuses the sign-in on file
    // also refuses the refreshed token: the press then opened no page (#6975). The stored access
    // token is still sent, so a sign-in that the server accepts connects at once. The record on
    // disk is not changed: a cancel or a timeout keeps it. Once the grant is in hand, the tokens
    // it earns are given as they are.
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
    yield* this.#options.storage.write(this.#options.key, {
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
        this.#openedRedirectUrl = url.searchParams.get("redirect_uri");
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
        const metadata = discovery.authorizationServerMetadata;
        if (metadata && !metadata.registration_endpoint) this.clientMetadataUrl = MCP_CLIENT_METADATA_URL;
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
        if (scope !== "tokens") this.#registeredClient = undefined;
        if (scope === "all") {
          this.#codeVerifier = null;
          if (record.app) yield* this.#options.storage.write(this.#options.key, { app: record.app });
          else yield* this.#options.storage.clear(this.#options.key);
          return;
        }
        // The discovery stays with the part that is kept: the retry that follows reuses it.
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
    yield* this.#options.storage.write(this.#options.key, next);
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

/**
 * The store entry of one account: the normalized URL, plus the `#account-…` fragment when the row
 * has one. Two rows on one server with different fragments are two accounts with their own sign-in.
 * A fragment never leaves this computer: `fetch` does not send it, and discovery and the token
 * requests use `mcpOAuthServerUrl`. A row without such a fragment keeps the entry it always had.
 */
export function mcpOAuthAccountKey(url: string): string | null {
  const resource = normalizeResource(url);
  if (!resource) return null;
  const fragment = mcpAccountFragment(url);
  return fragment ? `${resource}${fragment}` : resource;
}

/** The server address of a store entry, without the account fragment. */
function mcpOAuthServerUrl(key: string): string {
  return normalizeResource(key) ?? key;
}

/**
 * The first authorization server that the server's protected-resource metadata names, or `null`. A
 * sign-in needs one to open a page. Any answer below 500 that is not such metadata says no: a
 * 404, a refusal, or a page that is not metadata. No answer, a server error, or a busy server (408,
 * 429) says nothing about the server, so it fails: a sign-in must not end as if the server asked for
 * none, which left the row showing the result of the earlier test, with no page and no words.
 */
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
  return metadata?.authorization_servers?.[0] ?? null;
});

/**
 * Whether an authorization server can take a client that OpenBot does not have yet, as the SDK
 * decides it: a registration endpoint, or the client metadata document. Google's has neither, so
 * Sign in to Gmail or Drive always ends in the refused-registration sentence (#8827). Metadata that
 * cannot be read is a yes: the SDK then registers at `/register`, and Sign in says what went wrong.
 */
const acceptsNewClient = Effect.fnUntraced(function* (issuer: string, fetchFn: FetchLike, timeoutMs: number) {
  const metadata = yield* mcpCall(() => discoverAuthorizationServerMetadata(issuer, { fetchFn })).pipe(
    Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.succeed(undefined) }),
    Effect.catch(() => Effect.succeed(undefined)),
  );
  return (
    !metadata || Boolean(metadata.registration_endpoint) || metadata.client_id_metadata_document_supported === true
  );
});

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
  const scope = scopeWithOfflineAccess(authorizationUrl.searchParams.get("scope"), metadata);
  if (!scope) return authorizationUrl;
  const url = new URL(authorizationUrl);
  url.searchParams.set("scope", scope);
  if (!url.searchParams.has("prompt")) url.searchParams.set("prompt", "consent");
  return url;
}

/** The fields of the SDK's registration body that `watchRegistration` changes; the rest stays. */
const registrationBodySchema = z.looseObject({
  scope: z.string().optional(),
  redirect_uris: z.array(z.string()).optional(),
});

const registrationErrorSchema = z.looseObject({ error: z.string() });

/**
 * Whether a registration answer refuses the redirect address. RFC 7591 names `invalid_redirect_uri`
 * for that; a server can also answer `invalid_client_metadata`, as #5584's does. A copy is read, so
 * the SDK still reads the answer that is kept. The secure fetch has already limited the body.
 */
async function refusesRedirectAddress(response: Response): Promise<boolean> {
  const error = await registrationErrorCode(response);
  return error === "invalid_redirect_uri" || error === "invalid_client_metadata";
}

/** The OAuth `error` of a 400 registration answer, or `null`. A copy is read, as above. */
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

/** The `localhost` form of a `127.0.0.1` loopback address, or `null` for any other address. */
function localhostRedirectUrl(redirectUrl: string): string | null {
  const url = URL.parse(redirectUrl);
  if (url?.protocol !== "http:" || url.hostname !== "127.0.0.1") return null;
  url.hostname = "localhost";
  return url.href;
}

/** Whether an address is on the loopback grant listener: `http` to `127.0.0.1` or `localhost`. */
function isLoopbackHttp(url: URL | null): url is URL {
  return url?.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

/** The `/callback` form of a loopback address, or `null` for any other address and for that form. */
function callbackRedirectUrl(redirectUrl: string): string | null {
  const url = URL.parse(redirectUrl);
  if (!isLoopbackHttp(url) || url.pathname === MCP_OAUTH_CALLBACK_PATH) return null;
  url.pathname = MCP_OAUTH_CALLBACK_PATH;
  url.search = "";
  url.hash = "";
  return url.href;
}

/**
 * Whether a registration names `address`. A loopback address also matches its form with no port:
 * RFC 8252 (7.3) lets the port of a loopback redirect change, and Dropbox registers its loopback
 * addresses with no port (#8025). Only the port is left out, as OpenClaw does (#170876).
 */
function registersAddress(registered: readonly string[], address: string): boolean {
  if (registered.includes(address)) return true;
  const url = URL.parse(address);
  if (!isLoopbackHttp(url) || !url.port) return false;
  url.port = "";
  return registered.includes(url.href);
}

/** `scope` with `offline_access` added, or `null` when `withOfflineAccess` leaves it as it is. */
function scopeWithOfflineAccess(
  scope: string | null,
  metadata: OAuthDiscoveryState["authorizationServerMetadata"],
): string | null {
  if (!scope || !metadata?.scopes_supported?.includes("offline_access")) return null;
  if (scope.split(/\s+/).includes("offline_access")) return null;
  return `${scope} offline_access`;
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
  const requested = url;
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
    if (location === null) return mcpTraffic ? response : yield* readableAnswer(response, requested, request.method);
    // Redirect response bodies are not consumed by the SDK.
    yield* mcpCall(() => response.body?.cancel()).pipe(Effect.catch(() => Effect.void));
    if (hop >= MAX_OAUTH_REDIRECTS)
      return yield* mcpFailure(new Error(sourceText("error.backend.oauthTooManyRedirects")));
    const next = yield* mcpSync(() => new URL(location, url));
    // Only a sign-in request may move to its own `www.` host: MCP traffic keeps its origin rule.
    const ownWwwHost = !mcpTraffic && movesToOwnWwwHost(url, next, response.status);
    if (next.origin !== url.origin && carriesCredential(request) && !ownWwwHost)
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

/**
 * An OAuth answer that a web page took the place of.
 *
 * A web host often answers every path with its own page, `/.well-known/…` too, also after a redirect
 * to its home or login page. RFC 8414 and RFC 9728 allow only a JSON object as a successful metadata
 * answer, but the SDK reads any 2xx as JSON, so the page stopped the discovery with a parser error
 * before the next address was tried (#6204). Such an answer to a metadata request becomes the 404
 * that the SDK skips. A page from another endpoint, such as the registration or the token endpoint,
 * fails with words the user can act on. An empty answer, such as a revocation's, is not changed.
 * `limited` has already read the body, so the copy is cheap.
 */
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

/**
 * Whether a redirect only moves the same https request between a host and its own `www.` host.
 * Lunch Flow's metadata names `lunchflow.app`, which answers each request with a 308 to the same
 * path on `www.lunchflow.app` (#8436). The server that redirects already has the request, and a
 * 307 or 308 keeps the method and the body. Any other origin change still refuses a credential.
 */
function movesToOwnWwwHost(from: URL, to: URL, status: number): boolean {
  if (status !== 307 && status !== 308) return false;
  if (from.protocol !== "https:" || to.protocol !== "https:" || from.port !== to.port) return false;
  if (from.pathname !== to.pathname || from.search !== to.search) return false;
  const ownWww = (bare: string, www: string) => www === `www.${bare}` && !bare.startsWith("www.");
  return ownWww(from.hostname, to.hostname) || ownWww(to.hostname, from.hostname);
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
