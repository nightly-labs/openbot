import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { type McpOperationError, mcpCall, mcpFailure, mcpSync } from "./mcp-effects";
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
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  type OAuthClientInformationFull,
  OAuthClientInformationFullSchema,
  type OAuthClientMetadata,
  type OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { runCauseEffect } from "./effect-boundary";
import { withTimeout } from "./with-timeout";

/** What one server's sign-in leaves behind, and all of it: nothing else is kept between runs. */
export const mcpOAuthRecordSchema = z.object({
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
});

export type McpOAuthRecord = z.infer<typeof mcpOAuthRecordSchema>;

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
}

/** Long enough to find the right account and read a consent page, short enough to end by itself. */
const MCP_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

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

/** One sign-in, from the browser leaving to the token set being stored. */
export interface McpSignIn {
  /** Given to the SDK transport, which drives the whole exchange through it. */
  readonly provider: OAuthClientProvider;
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
}

/**
 * What a hand-off and a test ask of OAuth. `AgentService` holds one of these and nothing else does.
 */
export interface McpOAuthAuthority {
  accessToken: (url: string) => Effect.Effect<string | null, McpOperationError>;
  signIn: (url: string) => McpSignIn | null;
  forget: (url: string) => Effect.Effect<void, McpOperationError>;
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
   * arrive out of nowhere. A refresh that fails answers with the token that is stored anyway, so
   * the server states the refusal itself rather than the tool quietly losing its credential.
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
    return yield* mcpSync(() => this.#options.storage.read(resource)?.tokens?.access_token ?? fallback);
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
   */
  readonly #refresh = Effect.fn("McpOAuth.refresh")(function* (this: McpOAuth, resource: string) {
    const running = this.#refreshing.get(resource);
    const timeoutMs = this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS;
    if (running) return yield* this.#awaitRefresh(running);
    const controller = new AbortController();
    // The scope owns the exchange; a caller can stop waiting without cancelling another caller's refresh.
    const operation = mcpCall(() =>
      auth(this.#provider(resource, null), {
        serverUrl: resource,
        fetchFn: secureOAuthFetch(controller.signal),
      }),
    ).pipe(
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

  readonly #awaitRefresh = Effect.fn("McpOAuth.awaitRefresh")((exchange: Fiber.Fiber<void>) =>
    Fiber.join(exchange).pipe(
      Effect.timeoutOrElse({
        duration: this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS,
        orElse: () => Effect.void,
      }),
    ),
  );

  readonly close = Effect.fn("McpOAuth.close")(() =>
    Scope.close(this.#scope, Exit.void).pipe(Effect.ensuring(Effect.sync(() => this.#waiting.clear()))),
  );

  /** A sign-in the user asked for, or `null` when the URL is not one this can sign in to. */
  signIn(url: string): McpSignIn | null {
    const resource = normalizeResource(url);
    if (!resource) return null;
    const state = randomUUID();
    const grant = Deferred.makeUnsafe<string>();
    this.#waiting.set(state, (code) => {
      Deferred.doneUnsafe(grant, Effect.succeed(code));
    });
    // Set when the probe moves on: a discovery slow enough to outlast it must neither open a
    // browser afterwards nor wait out a grant nobody will answer.
    let abandoned = false;
    const provider = this.#provider(resource, state, () => abandoned);
    const abandon = () => {
      abandoned = true;
      this.#waiting.delete(state);
    };
    return {
      provider,
      complete: () =>
        Effect.gen({ self: this }, function* () {
          if (abandoned) return yield* mcpFailure(new Error(sourceText("error.backend.mcpSignInAbandonedGeneric")));
          // Aborts with the wait: a token endpoint that never completes must not keep a request
          // running after this attempt ends, or its late response would write credentials a later
          // sign-in already replaced.
          const controller = new AbortController();
          yield* Effect.gen({ self: this }, function* () {
            const code = yield* withTimeout(
              Deferred.await(grant),
              this.#options.signInTimeoutMs ?? MCP_SIGN_IN_TIMEOUT_MS,
              "The sign-in was not finished in the browser.",
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
                  fetchFn: secureOAuthFetch(controller.signal),
                }),
              ),
              this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS,
              "The sign-in response did not arrive in time.",
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

  /** Forgets one server's registration and tokens. Used when the row that named it is removed. */
  readonly forget = Effect.fn("McpOAuth.forget")(function* (this: McpOAuth, url: string) {
    const resource = normalizeResource(url);
    if (!resource) return;
    this.#generations.set(resource, (this.#generations.get(resource) ?? 0) + 1);
    yield* this.#options.storage.clear(resource);
  }).bind(this);

  /** A `state` makes the provider interactive; `null` keeps it silent. */
  #provider(resource: string, state: string | null, isAbandoned: () => boolean = () => false): McpOAuthClientProvider {
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
      openExternal: this.#options.openExternal,
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
   * No `scope` and no `token_endpoint_auth_method`: the SDK takes the scope the server's own
   * protected-resource metadata asks for, and picks an authentication method the server said it
   * supports. Naming either here would be OpenBot guessing in front of an answer it already has.
   */
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "OpenBot",
      client_uri: "https://openbot.run",
      redirect_uris: [this.#options.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
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
    const client = this.#credential(record.client);
    this.recordSecret(record.client?.client_secret);
    if (!client) return this.#register();
    if (!this.#options.state || this.#exchangingCode) return client;
    if (client.redirect_uris.includes(this.#options.redirectUrl)) return client;
    const refreshWorthTrying = !this.#redirectAddressChecked && Boolean(record.tokens?.refresh_token);
    this.#redirectAddressChecked = true;
    return refreshWorthTrying ? client : this.#register();
  }

  get registrationPending(): boolean {
    return this.#registrationPending;
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
        this.recordSecret(information.client_secret);
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
        yield* this.#save({ tokens, obtainedAt: Date.now() });
      }),
    );
  }

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
   * reason RFC 8252 says a native app must not do it.
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
        yield* mcpCall(() => this.#options.openExternal(authorizationUrl.toString()));
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
        if (scope === "all") {
          this.#codeVerifier = null;
          yield* this.#options.storage.clear(this.#options.resource);
          return;
        }
        const record = yield* mcpSync(() => this.#record());
        yield* this.#options.storage.write(
          this.#options.resource,
          scope === "client" ? { tokens: record.tokens, obtainedAt: record.obtainedAt } : { client: record.client },
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
function isLoopback(hostname: string): boolean {
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
export function describeUnusableRedirectUrl(redirectUrl: string): string | null {
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
export function secureOAuthFetch(signal?: AbortSignal): FetchLike {
  return (input, init) => runCauseEffect(secureOAuthRequest(input, init, signal));
}

const secureOAuthRequest = Effect.fn("McpOAuth.secureFetch")(function* (
  input: Parameters<FetchLike>[0],
  init: Parameters<FetchLike>[1],
  signal?: AbortSignal,
): Effect.fn.Return<Response, McpOperationError> {
  let url = yield* mcpSync(() => new URL(input instanceof URL ? input.toString() : input));
  let request: RequestInit = { ...init, ...(signal ? { signal } : {}), redirect: "manual" };
  for (let hop = 0; ; hop++) {
    if (!isSecureEndpoint(url))
      return yield* mcpFailure(new Error(sourceText("error.backend.oauthNotHttps", { origin: url.origin })));
    const response = yield* Effect.tryPromise({
      try: (requestSignal) =>
        fetch(url, {
          ...request,
          signal: request.signal ? AbortSignal.any([request.signal, requestSignal]) : requestSignal,
        }),
      catch: mcpFailure,
    });
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

/** Whether the stored access token is inside the margin, or already past its life. */
function expiringSoon(record: McpOAuthRecord): boolean {
  const seconds = record.tokens?.expires_in;
  // A server that states no lifetime is taken at its word. Refreshing on a guess would spend a
  // refresh token on every thread start for a token that was never going to expire.
  if (seconds === undefined || record.obtainedAt === undefined) return false;
  return record.obtainedAt + seconds * 1000 - TOKEN_REFRESH_MARGIN_MS <= Date.now();
}
