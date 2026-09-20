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
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  type OAuthClientInformationFull,
  OAuthClientInformationFullSchema,
  type OAuthClientMetadata,
  type OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";

/** What one server's sign-in leaves behind, and all of it: nothing else is kept between runs. */
export const mcpOAuthRecordSchema = z.object({
  /** This installation's registration with that authorization server, from RFC 7591. */
  client: OAuthClientInformationFullSchema.optional(),
  tokens: OAuthTokensSchema.optional(),
  /** When `tokens` arrived. `expires_in` is a duration, and a duration alone names no moment. */
  obtainedAt: z.number().optional(),
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
  write: (resource: string, record: McpOAuthRecord) => Promise<void>;
  clear: (resource: string) => Promise<void>;
}

export interface McpOAuthOptions {
  storage: McpOAuthStorage;
  /** Opens the authorization page in the user's own browser, never in a window of this app. */
  openExternal: (url: string) => Promise<void>;
  /** Where the authorization server sends the grant back. One address serves every server. */
  redirectUrl: string;
  /** How long a sign-in may stay open before the wait is abandoned. */
  signInTimeoutMs?: number;
  /** How long a token exchange may hold a thread start or a test before the stored token answers. */
  refreshTimeoutMs?: number;
}

/** Long enough to find the right account and read a consent page, short enough to end by itself. */
export const MCP_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How long a token exchange may hold a thread start or a test. The probe and the hand-off both
 * resolve every token before they connect, so an authorization server that accepts a connection
 * but never finishes its response would otherwise stall either past its own deadline.
 */
export const MCP_TOKEN_TIMEOUT_MS = 10_000;

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
  complete: () => Promise<void>;
  /** Ends a wait nothing will answer, so a cancelled sign-in leaves no entry behind. */
  abandon: () => void;
}

/**
 * What a hand-off and a test ask of OAuth. `AgentService` holds one of these and nothing else does.
 */
export interface McpOAuthAuthority {
  accessToken: (url: string) => Promise<string | null>;
  signIn: (url: string) => McpSignIn | null;
  forget: (url: string) => Promise<void>;
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
  readonly #refreshing = new Map<string, Promise<void>>();

  constructor(options: McpOAuthOptions) {
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
  async accessToken(url: string): Promise<string | null> {
    const resource = normalizeResource(url);
    if (!resource) return null;
    const stored = this.#options.storage.read(resource);
    if (!stored?.tokens) return null;
    if (!expiringSoon(stored)) return stored.tokens.access_token;
    await this.#refresh(resource);
    return this.#options.storage.read(resource)?.tokens?.access_token ?? stored.tokens.access_token;
  }

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
   */
  #refresh(resource: string): Promise<void> {
    const running = this.#refreshing.get(resource);
    if (running) return this.#awaitRefresh(running);
    // A refresh the authorization server refused, or one it never got, is not reported here: the
    // stored token is the best answer left, and the server is the right place for the refusal.
    const exchange = auth(this.#provider(resource, null), { serverUrl: resource })
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => this.#refreshing.delete(resource));
    this.#refreshing.set(resource, exchange);
    return this.#awaitRefresh(exchange);
  }

  async #awaitRefresh(exchange: Promise<void>): Promise<void> {
    await stopWaiting(exchange, this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS);
  }

  /** A sign-in the user asked for, or `null` when the URL is not one this can sign in to. */
  signIn(url: string): McpSignIn | null {
    const resource = normalizeResource(url);
    if (!resource) return null;
    const state = randomUUID();
    let deliver: (code: string) => void = () => undefined;
    const grant = new Promise<string>((resolve) => {
      deliver = resolve;
    });
    this.#waiting.set(state, (code) => deliver(code));
    const provider = this.#provider(resource, state);
    const abandon = () => {
      this.#waiting.delete(state);
    };
    return {
      provider,
      complete: async () => {
        try {
          const code = await withSignInDeadline(grant, this.#options.signInTimeoutMs ?? MCP_SIGN_IN_TIMEOUT_MS);
          // The grant waited on the person; the trade waits on the server, and on nothing else.
          // Without this a hung token endpoint holds the test past its own deadline after the user
          // has done everything right.
          await withTimeout(
            auth(provider, { serverUrl: resource, authorizationCode: code }),
            this.#options.refreshTimeoutMs ?? MCP_TOKEN_TIMEOUT_MS,
            "The sign-in response did not arrive in time.",
          );
        } finally {
          abandon();
        }
      },
      abandon,
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
  forget(url: string): Promise<void> {
    const resource = normalizeResource(url);
    return resource ? this.#options.storage.clear(resource) : Promise.resolve();
  }

  /** A `state` makes the provider interactive; `null` keeps it silent. */
  #provider(resource: string, state: string | null): OAuthClientProvider {
    return new McpOAuthClientProvider({
      resource,
      state,
      storage: this.#options.storage,
      redirectUrl: this.#options.redirectUrl,
      openExternal: this.#options.openExternal,
    });
  }
}

interface ClientProviderOptions {
  resource: string;
  state: string | null;
  storage: McpOAuthStorage;
  redirectUrl: string;
  openExternal: (url: string) => Promise<void>;
}

/**
 * The nine members the SDK asks for, and no protocol of its own.
 *
 * The PKCE verifier is held in memory and not in the store. It is worth exactly one exchange, it is
 * only useful to the run that made it, and a run that ends before the browser comes back has lost
 * the sign-in either way - so writing it to disk would keep a secret past every moment it can be
 * spent.
 */
class McpOAuthClientProvider implements OAuthClientProvider {
  readonly #options: ClientProviderOptions;
  #codeVerifier: string | null = null;

  constructor(options: ClientProviderOptions) {
    this.#options = options;
  }

  get redirectUrl(): string {
    return this.#options.redirectUrl;
  }

  /**
   * What OpenBot registers itself as. `redirect_uris` holds the one address the deep-link router
   * classifies, so an authorization server will not send a grant anywhere else.
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
    if (!state) throw new Error("This MCP sign-in cannot open a browser.");
    return state;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return this.#record().client;
  }

  async saveClientInformation(information: OAuthClientInformationFull): Promise<void> {
    await this.#save({ client: information });
  }

  tokens(): OAuthTokens | undefined {
    return this.#record().tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.#save({ tokens, obtainedAt: Date.now() });
  }

  /**
   * The user's own browser, not a window of this app.
   *
   * An embedded window would be OpenBot standing between the user and their password manager, their
   * existing session and the address bar that proves which site is asking - which is the whole
   * reason RFC 8252 says a native app must not do it.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.#options.state) throw new Error("This MCP sign-in cannot open a browser.");
    await this.#options.openExternal(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): void {
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
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "verifier" || scope === "discovery") {
      if (scope === "verifier") this.#codeVerifier = null;
      return;
    }
    if (scope === "all") {
      this.#codeVerifier = null;
      await this.#options.storage.clear(this.#options.resource);
      return;
    }
    const record = this.#record();
    await this.#options.storage.write(
      this.#options.resource,
      scope === "client" ? { tokens: record.tokens, obtainedAt: record.obtainedAt } : { client: record.client },
    );
  }

  #record(): McpOAuthRecord {
    return this.#options.storage.read(this.#options.resource) ?? {};
  }

  async #save(part: Partial<McpOAuthRecord>): Promise<void> {
    await this.#options.storage.write(this.#options.resource, { ...this.#record(), ...part });
  }
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

/** The names that never leave this machine. `::1` arrives from `URL` inside brackets. */
function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Whether the stored access token is inside the margin, or already past its life. */
function expiringSoon(record: McpOAuthRecord): boolean {
  const seconds = record.tokens?.expires_in;
  // A server that states no lifetime is taken at its word. Refreshing on a guess would spend a
  // refresh token on every thread start for a token that was never going to expire.
  if (seconds === undefined || record.obtainedAt === undefined) return false;
  return record.obtainedAt + seconds * 1000 - TOKEN_REFRESH_MARGIN_MS <= Date.now();
}

function withSignInDeadline(grant: Promise<string>, timeoutMs: number): Promise<string> {
  return withTimeout(grant, timeoutMs, "The sign-in was not finished in the browser.");
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Stops waiting, never fails. The caller falls back to what is stored; the exchange itself keeps
 * running, so a token it eventually stores is what the next caller reads.
 */
function stopWaiting(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}
