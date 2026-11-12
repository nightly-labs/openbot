// Company sign-in. A server owner connects the company's OpenID Connect provider, such as Microsoft
// Entra ID, Okta or Google Workspace, and proves the company's email domains with a DNS record. A
// person at one of these domains then signs in at the provider, not with an email code:
//
// 1. The app sends the email and its loopback address to `startSignIn`. The answer is the provider URL.
// 2. The provider sends the browser to `/v1/auth/company/callback`. `finish` checks the ID token,
//    finds or makes the account, and sends the browser to the app's loopback with a one-time code.
// 3. The app gives the code and its verifier to `exchange` and gets a session like an email code gives.
//    The phone app returns to `openbot://company-sign-in` in its browser session, and its exchange
//    names the device, so the session is a mobile session.
//
// A test sign-in uses the same flow. It saves the connection only when it passes, so a connection
// with a wrong value never takes the email codes away. SCIM from the provider turns a person off.

import { MOBILE_COMPANY_SIGN_IN_RETURN } from "@openbot/contracts/company-sign-in";
import { isAvatarColor } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isValidHostname, normalizeEmailAddress } from "@openbot/contracts/validation";
import { Effect, Schema } from "effect";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { decodeBase64Url, deriveSecret, encodeBase64Url, hmacSha256, randomToken, sha256 } from "./crypto";
import { mobileSessionStatements } from "./d1-auth-repository";
import type { RemoteFailure } from "./remote-control-plane";
import { PERSISTENT_SESSION_EXPIRES_AT } from "./session-policy";
import type { AuthUser, MobileAuthDeviceIdentity, WorkerBindings } from "./types";

const FLOW_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 2 * 60_000;
const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_DOMAINS = 20;
// The same window and limits as the email start: each start asks the provider for its metadata.
const RATE_WINDOW_MS = 15 * 60_000;
const START_EMAIL_LIMIT = 5;
const START_IP_LIMIT = 20;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
/** The app's loopback listener. The port is the one the app took. */
const RETURN_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]{2,5}\/company-sign-in$/u;
/** The web app's return on this account service. The browser that started the flow holds its verifier. */
export const WEB_RETURN_PATH = "/api/browser/company/return";
const DOMAIN_RECORD_PREFIX = "_openbot";
const DOMAIN_RECORD_VALUE_PREFIX = "openbot-domain-verification=";
const CALLBACK_PATH = "/v1/auth/company/callback";
const GOOGLE_ISSUER = "https://accounts.google.com";
/** Mail services that no company owns. Their addresses keep email codes. */
const SHARED_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "aol.com",
  "yandex.com",
  "mail.ru",
  "qq.com",
  "wp.pl",
  "onet.pl",
  "o2.pl",
  "interia.pl",
]);

export class CompanySignInError extends Schema.TaggedError<CompanySignInError>()("CompanySignInError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

class CompanySignInOperationError extends Schema.TaggedError<CompanySignInOperationError>()(
  "CompanySignInOperationError",
  {},
) {}

export type CompanySignInFailure = CompanySignInError | CompanySignInOperationError | RemoteFailure;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function storeCall<A>(operation: () => Promise<A>): Effect.Effect<A, CompanySignInOperationError> {
  return Effect.tryPromise({ try: operation, catch: () => new CompanySignInOperationError({}) });
}

/** A failure at the provider. The cause can hold provider data, so it is not kept. */
function providerCall<A>(operation: () => Promise<A>): Effect.Effect<A, CompanySignInError> {
  return Effect.tryPromise({
    try: operation,
    catch: () =>
      new CompanySignInError(502, "company_provider_unreachable", "The company sign-in provider did not answer."),
  });
}

function invalid(message: string): CompanySignInError {
  return new CompanySignInError(400, "invalid_company_sign_in", message);
}

interface CompanySignInConnection {
  issuer: string;
  clientId: string;
  domains: string[];
  enabled: boolean;
  testedAt: number;
  scimTokenCreatedAt: number | null;
}

export interface CompanySignInSettings {
  redirectUri: string;
  scimUrl: string;
  /** The TXT record that proves a domain: `<name>.<domain>` holds `value`. */
  domainRecord: { name: string; value: string };
  /** False on a development API, which does not check the DNS record. */
  domainCheck: boolean;
  connection: CompanySignInConnection | null;
}

export interface CompanySignInTestInput {
  issuer: string;
  clientId: string;
  clientSecret: string;
  domains: string[];
  returnTo: string;
  clientState: string;
}

export interface CompanySignInStartInput {
  email: string;
  returnTo: string;
  clientState: string;
  clientChallenge: string;
  /** The client address from `requestSourceIp`, for the rate limit. */
  sourceIp: string;
}

export interface ScimUser {
  id: string;
  email: string;
  name: string | null;
  externalId: string | null;
  active: boolean;
}

interface ProviderMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  basicAuth: boolean;
}

interface ConnectionRow {
  host_id: string;
  issuer: string;
  client_id: string;
  client_secret_ciphertext: string;
  enabled: number;
  updated_by_user_id: string;
  tested_at: number;
  scim_token_created_at: number | null;
}

interface FlowRow {
  purpose: "sign_in" | "test";
  host_id: string;
  user_id: string | null;
  issuer: string;
  client_id: string;
  client_secret_ciphertext: string;
  domains_json: string;
  verifier: string;
  nonce: string;
  return_to: string;
  client_state: string;
  client_challenge: string;
  expires_at: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  analytics_enabled: number | null;
  chat_color: string | null;
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    analyticsEnabled: row.analytics_enabled === null ? null : row.analytics_enabled === 1,
    chatColor: isAvatarColor(row.chat_color) ? row.chat_color : null,
  };
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/** The domains that a flow saved when it started. */
function storedDomains(value: string): string[] {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter(isString) : [];
}

function loopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

/** Adds a person to the server of the connection as a member. See `RemoteControlPlane.joinByCompanySignIn`. */
type JoinServer = (
  hostId: string,
  userId: string,
  options: { restore: boolean },
) => Effect.Effect<"joined" | "member" | "removed" | "no_seat", RemoteFailure>;

export class CompanySignInService {
  readonly #database: D1Database;
  readonly #secret: string | null;
  readonly #development: boolean;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  readonly #flushSessionRevocations: () => Effect.Effect<void, RemoteFailure>;
  readonly #revokeMembership: (
    actorUserId: string,
    hostId: string,
    membershipId: string,
  ) => Effect.Effect<void, RemoteFailure>;
  readonly #joinServer: JoinServer;

  constructor(
    bindings: Pick<WorkerBindings, "DB" | "COMPANY_SIGN_IN_SECRET" | "AUTH_EXPOSE_DEVELOPMENT_CODE">,
    options: {
      fetch?: Fetch;
      now?: () => number;
      flushSessionRevocations?: () => Effect.Effect<void, RemoteFailure>;
      revokeMembership?: (
        actorUserId: string,
        hostId: string,
        membershipId: string,
      ) => Effect.Effect<void, RemoteFailure>;
      joinServer?: JoinServer;
    } = {},
  ) {
    const secret = bindings.COMPANY_SIGN_IN_SECRET?.trim();
    this.#database = bindings.DB;
    this.#secret = secret && new TextEncoder().encode(secret).byteLength >= 32 ? secret : null;
    // A development API signs in with a local test provider: plain HTTP on loopback, and no DNS.
    this.#development = bindings.AUTH_EXPOSE_DEVELOPMENT_CODE === "true";
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#flushSessionRevocations = options.flushSessionRevocations ?? (() => Effect.void);
    this.#revokeMembership = options.revokeMembership ?? (() => Effect.void);
    this.#joinServer = options.joinServer ?? (() => Effect.succeed("member"));
  }

  /**
   * True when the email is at a domain whose connection is on. Then email codes are refused. With no
   * secret, company sign-in cannot start, so everyone signs in with an email code.
   */
  readonly usesCompanySignIn = Effect.fn("CompanySignIn.usesCompanySignIn")(function* (
    this: CompanySignInService,
    email: string,
  ) {
    if (!this.#secret) return false;
    const row = yield* storeCall(() =>
      this.#database
        .prepare(
          `SELECT 1 AS found FROM company_sign_in_domains
           JOIN company_sign_in_connections USING (host_id)
           WHERE company_sign_in_domains.domain = ? AND company_sign_in_connections.enabled = 1 LIMIT 1`,
        )
        .bind(emailDomain(email))
        .first<{ found: number }>(),
    );
    return row !== null;
  });

  readonly settings = Effect.fn("CompanySignIn.settings")(function* (
    this: CompanySignInService,
    user: AuthUser,
    hostId: string,
    requestUrl: string,
  ): Effect.fn.Return<CompanySignInSettings, CompanySignInFailure> {
    const secret = yield* this.#requireSecret();
    yield* this.#requireOwner(user, hostId);
    const connection = yield* this.#connection(hostId);
    const domains = connection ? yield* this.#domains(hostId) : [];
    return {
      redirectUri: new URL(CALLBACK_PATH, requestUrl).toString(),
      scimUrl: new URL("/scim/v2", requestUrl).toString(),
      domainRecord: { name: DOMAIN_RECORD_PREFIX, value: yield* this.#domainRecordValue(secret, hostId) },
      domainCheck: !this.#development,
      connection: connection
        ? {
            issuer: connection.issuer,
            clientId: connection.client_id,
            domains,
            enabled: connection.enabled === 1,
            testedAt: connection.tested_at,
            scimTokenCreatedAt: connection.scim_token_created_at,
          }
        : null,
    };
  });

  /** Starts a test sign-in with the values of the dialog. A test that passes saves them. */
  readonly startTest = Effect.fn("CompanySignIn.startTest")(function* (
    this: CompanySignInService,
    user: AuthUser,
    hostId: string,
    input: CompanySignInTestInput,
    requestUrl: string,
  ): Effect.fn.Return<{ authorizationUrl: string }, CompanySignInFailure> {
    const secret = yield* this.#requireSecret();
    yield* this.#requireOwner(user, hostId);
    yield* this.#validateReturn(input.returnTo, input.clientState);
    const clientId = input.clientId.trim();
    if (!clientId || clientId.length > 256) return yield* invalid("Enter the client ID.");
    if (input.clientSecret.length > 1024) return yield* invalid("The client secret is too long.");
    const domains = yield* this.#normalizeDomains(input.domains);
    yield* this.#requireFreeDomains(hostId, domains);
    if (!this.#development) {
      for (const domain of domains) yield* this.#requireDomainRecord(secret, hostId, domain);
    }
    // The saved secret is never used again for a test: a changed issuer must not receive it.
    if (!input.clientSecret) return yield* invalid("Enter the client secret.");
    const ciphertext = yield* this.#encrypt(secret, input.clientSecret);
    const metadata = yield* this.#discover(input.issuer);
    return yield* this.#startFlow({
      purpose: "test",
      hostId,
      userId: user.id,
      metadata,
      clientId,
      ciphertext,
      domains,
      returnTo: input.returnTo,
      clientState: input.clientState,
      clientChallenge: "",
      requestUrl,
      loginHint: null,
    });
  });

  readonly setEnabled = Effect.fn("CompanySignIn.setEnabled")(function* (
    this: CompanySignInService,
    user: AuthUser,
    hostId: string,
    enabled: boolean,
  ): Effect.fn.Return<void, CompanySignInFailure> {
    yield* this.#requireSecret();
    yield* this.#requireOwner(user, hostId);
    const result = yield* storeCall(() =>
      this.#database
        .prepare(
          "UPDATE company_sign_in_connections SET enabled = ?, updated_by_user_id = ?, updated_at = ? WHERE host_id = ?",
        )
        .bind(enabled ? 1 : 0, user.id, this.#now(), hostId)
        .run(),
    );
    if (result.meta.changes !== 1) {
      return yield* new CompanySignInError(409, "company_sign_in_not_tested", "Test the sign-in first.");
    }
  });

  /** Removes the connection. Its domains go back to email codes, and SCIM stops. */
  readonly remove = Effect.fn("CompanySignIn.remove")(function* (
    this: CompanySignInService,
    user: AuthUser,
    hostId: string,
  ): Effect.fn.Return<void, CompanySignInFailure> {
    yield* this.#requireOwner(user, hostId);
    yield* storeCall(() =>
      this.#database.prepare("DELETE FROM company_sign_in_connections WHERE host_id = ?").bind(hostId).run(),
    );
  });

  /** A new SCIM token replaces the earlier one. Only its hash is stored, so it shows once. */
  readonly createScimToken = Effect.fn("CompanySignIn.createScimToken")(function* (
    this: CompanySignInService,
    user: AuthUser,
    hostId: string,
  ): Effect.fn.Return<{ token: string; createdAt: number }, CompanySignInFailure> {
    yield* this.#requireOwner(user, hostId);
    const token = `obscim_${randomToken(32)}`;
    const createdAt = this.#now();
    const tokenHash = yield* sha256(token).pipe(Effect.mapError(() => new CompanySignInOperationError({})));
    const result = yield* storeCall(() =>
      this.#database
        .prepare(
          `UPDATE company_sign_in_connections SET scim_token_hash = ?, scim_token_created_at = ?, updated_at = ?
           WHERE host_id = ?`,
        )
        .bind(tokenHash, createdAt, createdAt, hostId)
        .run(),
    );
    if (result.meta.changes !== 1) {
      return yield* new CompanySignInError(409, "company_sign_in_not_tested", "Test the sign-in first.");
    }
    return { token, createdAt };
  });

  readonly revokeScimToken = Effect.fn("CompanySignIn.revokeScimToken")(function* (
    this: CompanySignInService,
    user: AuthUser,
    hostId: string,
  ): Effect.fn.Return<void, CompanySignInFailure> {
    yield* this.#requireOwner(user, hostId);
    yield* storeCall(() =>
      this.#database
        .prepare(
          `UPDATE company_sign_in_connections SET scim_token_hash = NULL, scim_token_created_at = NULL, updated_at = ?
           WHERE host_id = ?`,
        )
        .bind(this.#now(), hostId)
        .run(),
    );
  });

  /** Counts one attempt for `key` in the current window, in the table of the email sign-in limits. */
  readonly #enforceRateLimit = Effect.fn("CompanySignIn.enforceRateLimit")(function* (
    this: CompanySignInService,
    key: string,
    limit: number,
  ): Effect.fn.Return<void, CompanySignInFailure> {
    const windowStart = Math.floor(this.#now() / RATE_WINDOW_MS) * RATE_WINDOW_MS;
    const keyHash = yield* sha256(key).pipe(Effect.mapError(() => new CompanySignInOperationError({})));
    const row = yield* storeCall(() =>
      this.#database
        .prepare(
          `INSERT INTO auth_rate_limits(key_hash, window_start, attempts) VALUES (?, ?, 1)
           ON CONFLICT(key_hash, window_start) DO UPDATE SET attempts = attempts + 1
           RETURNING attempts`,
        )
        .bind(keyHash, windowStart)
        .first<{ attempts: number }>(),
    );
    if ((row?.attempts ?? limit + 1) > limit) {
      return yield* new CompanySignInError(429, "rate_limited", "Too many sign-in attempts. Try again later.");
    }
  });

  readonly startSignIn = Effect.fn("CompanySignIn.startSignIn")(function* (
    this: CompanySignInService,
    input: CompanySignInStartInput,
    requestUrl: string,
    /** The web app's origin, when the web app started the sign-in. `requestUrl` is then the API's. */
    webOrigin?: string,
  ): Effect.fn.Return<{ authorizationUrl: string }, CompanySignInFailure> {
    yield* this.#requireSecret();
    yield* this.#validateReturn(input.returnTo, input.clientState, webOrigin, webOrigin === undefined);
    if (!TOKEN_PATTERN.test(input.clientChallenge)) return yield* invalid("The sign-in request is invalid.");
    const email = normalizeEmailAddress(input.email);
    if (!email) return yield* new CompanySignInError(400, "invalid_email", "Enter a valid email address.");
    yield* this.#enforceRateLimit(`company:start:ip:${input.sourceIp}`, START_IP_LIMIT);
    yield* this.#enforceRateLimit(`company:start:email:${email}`, START_EMAIL_LIMIT);
    const connection = yield* storeCall(() =>
      this.#database
        .prepare(
          `SELECT company_sign_in_connections.* FROM company_sign_in_domains
           JOIN company_sign_in_connections USING (host_id)
           WHERE company_sign_in_domains.domain = ? AND company_sign_in_connections.enabled = 1 LIMIT 1`,
        )
        .bind(emailDomain(email))
        .first<ConnectionRow>(),
    );
    if (!connection) {
      return yield* new CompanySignInError(
        404,
        "company_sign_in_not_found",
        "This email does not use company sign-in.",
      );
    }
    const metadata = yield* this.#discover(connection.issuer);
    return yield* this.#startFlow({
      purpose: "sign_in",
      hostId: connection.host_id,
      userId: null,
      metadata,
      clientId: connection.client_id,
      ciphertext: connection.client_secret_ciphertext,
      domains: yield* this.#domains(connection.host_id),
      returnTo: input.returnTo,
      clientState: input.clientState,
      clientChallenge: input.clientChallenge,
      requestUrl,
      loginHint: email,
    });
  });

  /**
   * Finishes the flow that the provider sent the browser back for. The answer is the app's loopback
   * address with the result, or null when the request has no flow, such as an old browser tab.
   */
  readonly finish = Effect.fn("CompanySignIn.finish")(function* (
    this: CompanySignInService,
    params: URLSearchParams,
    requestUrl: string,
  ): Effect.fn.Return<string | null, CompanySignInFailure> {
    const state = params.get("state");
    if (!state || !TOKEN_PATTERN.test(state)) return null;
    const stateHash = yield* sha256(state).pipe(Effect.mapError(() => new CompanySignInOperationError({})));
    // One use: a second visit of the same address finds no flow.
    const flow = yield* storeCall(() =>
      this.#database
        .prepare("DELETE FROM company_sign_in_flows WHERE state_hash = ? RETURNING *")
        .bind(stateHash)
        .first<FlowRow>(),
    );
    if (!flow || flow.expires_at <= this.#now()) return null;
    const back = (values: Record<string, string>) => {
      const url = new URL(flow.return_to);
      url.searchParams.set("state", flow.client_state);
      for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
      return url.toString();
    };
    const result = yield* this.#completeFlow(flow, params, requestUrl).pipe(
      Effect.map((values) => back(values)),
      Effect.catchTag("CompanySignInError", (error) => Effect.succeed(back({ error: error.code }))),
      // The flow is spent, so each other failure also goes back to the app, which then stops its wait.
      Effect.catch(() => Effect.succeed(back({ error: "company_sign_in_failed" }))),
    );
    return result;
  });

  /**
   * Gives the session for a one-time code. The verifier proves the app that started the flow. With a
   * device, the session is a mobile session that replaces the earlier session of that device.
   */
  readonly exchange = Effect.fn("CompanySignIn.exchange")(function* (
    this: CompanySignInService,
    input: { code: string; codeVerifier: string; device?: MobileAuthDeviceIdentity },
  ): Effect.fn.Return<{ sessionToken: string; user: AuthUser }, CompanySignInFailure> {
    const failed = new CompanySignInError(
      400,
      "invalid_company_sign_in_code",
      "The sign-in did not finish. Try again.",
    );
    if (!TOKEN_PATTERN.test(input.code) || !TOKEN_PATTERN.test(input.codeVerifier)) return yield* failed;
    const hash = (value: string) => sha256(value).pipe(Effect.mapError(() => new CompanySignInOperationError({})));
    const codeHash = yield* hash(input.code);
    const challenge = yield* hash(input.codeVerifier);
    const now = this.#now();
    const session = { id: crypto.randomUUID(), token: randomToken() };
    const tokenHash = yield* hash(session.token);
    // The session row is made only by the exchange that spent the code with the right verifier. One
    // batch: a session without its mobile row would count as a desktop session.
    const [spent, , registered] = yield* storeCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `UPDATE company_sign_in_codes SET redeemed_at = ?, session_id = ?
             WHERE code_hash = ? AND client_challenge = ? AND redeemed_at IS NULL AND expires_at > ?`,
          )
          .bind(now, session.id, codeHash, challenge, now),
        this.#database
          .prepare(
            `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
             SELECT ?, user_id, ?, ?, ?, ? FROM company_sign_in_codes WHERE code_hash = ? AND session_id = ?`,
          )
          .bind(session.id, tokenHash, PERSISTENT_SESSION_EXPIRES_AT, now, now, codeHash, session.id),
        ...(input.device ? mobileSessionStatements(this.#database, { now, session, device: input.device }, null) : []),
      ]),
    );
    if (spent?.meta.changes !== 1) return yield* failed;
    if (input.device) {
      if (registered?.meta.changes !== 1) return yield* new CompanySignInOperationError({});
      // The revocation of the earlier session is written, and the cron delivers it again.
      yield* this.#flushSessionRevocations().pipe(Effect.catch(() => Effect.void));
    }
    const row = yield* storeCall(() =>
      this.#database
        .prepare(
          `SELECT users.id, users.email, users.name, users.avatar_url, users.analytics_enabled, users.chat_color
           FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id WHERE auth_sessions.id = ?`,
        )
        .bind(session.id)
        .first<UserRow>(),
    );
    if (!row) return yield* failed;
    return { sessionToken: session.token, user: mapUser(row) };
  });

  /** The connection that a SCIM token belongs to. */
  readonly scimConnection = Effect.fn("CompanySignIn.scimConnection")(function* (
    this: CompanySignInService,
    token: string | null,
  ): Effect.fn.Return<{ hostId: string; actorUserId: string }, CompanySignInFailure> {
    const refused = new CompanySignInError(401, "invalid_scim_token", "The SCIM token is invalid.");
    if (!token?.startsWith("obscim_")) return yield* refused;
    const tokenHash = yield* sha256(token).pipe(Effect.mapError(() => new CompanySignInOperationError({})));
    const row = yield* storeCall(() =>
      this.#database
        .prepare("SELECT host_id, updated_by_user_id FROM company_sign_in_connections WHERE scim_token_hash = ?")
        .bind(tokenHash)
        .first<{ host_id: string; updated_by_user_id: string }>(),
    );
    if (!row) return yield* refused;
    return { hostId: row.host_id, actorUserId: row.updated_by_user_id };
  });

  /** A person at one of the connection's domains, or null. */
  readonly scimUser = Effect.fn("CompanySignIn.scimUser")(function* (
    this: CompanySignInService,
    hostId: string,
    lookup: { userId: string } | { email: string },
  ): Effect.fn.Return<ScimUser | null, CompanySignInFailure> {
    const row = yield* storeCall(() =>
      this.#database
        .prepare(
          `SELECT users.id, users.email, users.name, managed.external_id, managed.active
           FROM users
           JOIN company_sign_in_domains AS domains
             ON domains.host_id = ? AND domains.domain = substr(users.email, instr(users.email, '@') + 1)
           LEFT JOIN company_sign_in_users AS managed ON managed.host_id = ? AND managed.user_id = users.id
           WHERE ${"userId" in lookup ? "users.id = ?" : "users.email = ?"} LIMIT 1`,
        )
        .bind(hostId, hostId, "userId" in lookup ? lookup.userId : lookup.email.trim().toLowerCase())
        .first<{ id: string; email: string; name: string | null; external_id: string | null; active: number | null }>(),
    );
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name, externalId: row.external_id, active: row.active !== 0 };
  });

  /** Makes the account for a person the provider adds. The person signs in later at the provider. */
  readonly scimCreate = Effect.fn("CompanySignIn.scimCreate")(function* (
    this: CompanySignInService,
    connection: { hostId: string; actorUserId: string },
    input: { email: string; externalId: string | null; active: boolean },
  ): Effect.fn.Return<ScimUser, CompanySignInFailure> {
    const email = normalizeEmailAddress(input.email);
    if (!email) return yield* invalid("The userName is not a valid email address.");
    const domains = yield* this.#domains(connection.hostId);
    if (!domains.includes(emailDomain(email))) return yield* invalid("The email domain is not in this connection.");
    const now = this.#now();
    yield* storeCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
             VALUES (?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .bind(crypto.randomUUID(), `email:${email}`, email, now, now),
        this.#database
          .prepare(
            `INSERT INTO company_sign_in_users(host_id, user_id, external_id, active, updated_at)
             SELECT ?, id, ?, 1, ? FROM users WHERE email = ?
             ON CONFLICT(host_id, user_id) DO UPDATE SET external_id = excluded.external_id, updated_at = excluded.updated_at`,
          )
          .bind(connection.hostId, input.externalId, now, email),
      ]),
    );
    const user = yield* this.scimUser(connection.hostId, { email });
    if (!user) return yield* new CompanySignInOperationError({});
    // A new row starts on. Off, or a change of a row that exists, goes through the same path as a PATCH,
    // which ends sessions and removes the person, or adds the person again.
    if (user.active !== input.active) yield* this.scimSetActive(connection, user.id, input.active);
    return { ...user, active: input.active };
  });

  /**
   * Turns a person on or off. Off ends every session of the account and removes it from the server.
   * On lets the person sign in again and adds them to the server again.
   */
  readonly scimSetActive = Effect.fn("CompanySignIn.scimSetActive")(function* (
    this: CompanySignInService,
    connection: { hostId: string; actorUserId: string },
    userId: string,
    active: boolean,
  ): Effect.fn.Return<void, CompanySignInFailure> {
    const now = this.#now();
    yield* storeCall(() =>
      this.#database
        .prepare(
          `INSERT INTO company_sign_in_users(host_id, user_id, external_id, active, updated_at)
           VALUES (?, ?, NULL, ?, ?)
           ON CONFLICT(host_id, user_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`,
        )
        .bind(connection.hostId, userId, active ? 1 : 0, now)
        .run(),
    );
    // A person that the provider turns on again comes back, also after the removal that turning off made.
    if (active) return yield* this.#join(connection.hostId, userId, { restore: true });
    // The trigger on `revoked_at` ends the remote sessions of these sessions and queues their events.
    // An email code or a company sign-in code that the person got before is spent too, so it cannot
    // make a new session.
    yield* storeCall(() =>
      this.#database.batch([
        this.#database
          .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
          .bind(now, userId),
        this.#database
          .prepare("UPDATE company_sign_in_codes SET redeemed_at = ? WHERE user_id = ? AND redeemed_at IS NULL")
          .bind(now, userId),
        this.#database
          .prepare(
            `UPDATE email_login_challenges SET consumed_at = ?
             WHERE email = (SELECT email FROM users WHERE id = ?) AND consumed_at IS NULL`,
          )
          .bind(now, userId),
      ]),
    );
    const membership = yield* storeCall(() =>
      this.#database
        .prepare(
          `SELECT membership_id FROM remote_memberships
           WHERE host_id = ? AND user_id = ? AND status = 'active' AND role != 'owner' LIMIT 1`,
        )
        .bind(connection.hostId, userId)
        .first<{ membership_id: string }>(),
    );
    if (membership) yield* this.#revokeMembership(connection.actorUserId, connection.hostId, membership.membership_id);
    yield* this.#flushSessionRevocations();
  });

  readonly #completeFlow = Effect.fn("CompanySignIn.completeFlow")(function* (
    this: CompanySignInService,
    flow: FlowRow,
    params: URLSearchParams,
    requestUrl: string,
  ): Effect.fn.Return<Record<string, string>, CompanySignInFailure> {
    if (params.get("error")) {
      return yield* new CompanySignInError(400, "company_provider_refused", "The company sign-in was cancelled.");
    }
    const code = params.get("code");
    if (!code || code.length > 4096) return yield* invalid("The provider answer is invalid.");
    const secret = yield* this.#requireSecret();
    const metadata = yield* this.#discover(flow.issuer);
    const clientSecret = yield* this.#decrypt(secret, flow.client_secret_ciphertext);
    const identity = yield* this.#redeemProviderCode({
      metadata,
      clientId: flow.client_id,
      clientSecret,
      code,
      verifier: flow.verifier,
      nonce: flow.nonce,
      redirectUri: new URL(CALLBACK_PATH, requestUrl).toString(),
    });
    const domains = storedDomains(flow.domains_json);
    const companyManaged =
      metadata.issuer !== GOOGLE_ISSUER || (identity.hostedDomain !== null && domains.includes(identity.hostedDomain));
    if (!domains.includes(emailDomain(identity.email)) || !companyManaged) {
      return yield* new CompanySignInError(
        403,
        "company_email_domain_mismatch",
        "The account at the provider has an email at another domain.",
      );
    }
    if (flow.purpose === "test") {
      yield* this.#saveTestedConnection(flow, metadata.issuer, domains);
      return { status: "passed", email: identity.email };
    }
    const connection = yield* storeCall(() =>
      this.#database
        .prepare(
          `SELECT 1 AS found FROM company_sign_in_connections JOIN company_sign_in_domains USING (host_id)
           WHERE host_id = ? AND enabled = 1 AND domain = ? LIMIT 1`,
        )
        .bind(flow.host_id, emailDomain(identity.email))
        .first<{ found: number }>(),
    );
    if (!connection) {
      return yield* new CompanySignInError(409, "company_sign_in_not_found", "Company sign-in is off for this email.");
    }
    const userId = yield* this.#accountFor(metadata.issuer, identity);
    const inactive = yield* storeCall(() =>
      this.#database
        .prepare("SELECT 1 AS found FROM company_sign_in_users WHERE host_id = ? AND user_id = ? AND active = 0")
        .bind(flow.host_id, userId)
        .first<{ found: number }>(),
    );
    if (inactive) {
      return yield* new CompanySignInError(403, "company_account_disabled", "Your company turned this account off.");
    }
    // The company's provider decides who gets in, so a person who signs in joins with no invitation.
    yield* this.#join(flow.host_id, userId, { restore: false });
    const exchangeCode = randomToken(32);
    const codeHash = yield* sha256(exchangeCode).pipe(Effect.mapError(() => new CompanySignInOperationError({})));
    const now = this.#now();
    yield* storeCall(() =>
      this.#database
        .prepare(
          `INSERT INTO company_sign_in_codes(code_hash, user_id, client_challenge, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(codeHash, userId, flow.client_challenge, now, now + CODE_TTL_MS)
        .run(),
    );
    return { code: exchangeCode };
  });

  readonly #join = Effect.fn("CompanySignIn.join")(function* (
    this: CompanySignInService,
    hostId: string,
    userId: string,
    options: { restore: boolean },
  ): Effect.fn.Return<void, CompanySignInFailure> {
    const result = yield* this.#joinServer(hostId, userId, options).pipe(
      Effect.mapError(() => new CompanySignInOperationError({})),
    );
    if (result === "no_seat") console.warn("Company sign-in found no free seat on the server.", { hostId });
  });

  /** The account of the provider's person: the linked one, else the one with the email, else a new one. */
  readonly #accountFor = Effect.fn("CompanySignIn.accountFor")(function* (
    this: CompanySignInService,
    issuer: string,
    identity: { subject: string; email: string },
  ): Effect.fn.Return<string, CompanySignInFailure> {
    const linked = yield* storeCall(() =>
      this.#database
        .prepare("SELECT user_id FROM company_sign_in_identities WHERE issuer = ? AND subject = ?")
        .bind(issuer, identity.subject)
        .first<{ user_id: string }>(),
    );
    if (linked) return linked.user_id;
    const now = this.#now();
    yield* storeCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
             VALUES (?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .bind(crypto.randomUUID(), `email:${identity.email}`, identity.email, now, now),
        this.#database
          .prepare(
            `INSERT INTO company_sign_in_identities(issuer, subject, user_id, created_at)
             SELECT ?, ?, id, ? FROM users WHERE email = ? ON CONFLICT DO NOTHING`,
          )
          .bind(issuer, identity.subject, now, identity.email),
      ]),
    );
    const row = yield* storeCall(() =>
      this.#database
        .prepare("SELECT user_id FROM company_sign_in_identities WHERE issuer = ? AND subject = ?")
        .bind(issuer, identity.subject)
        .first<{ user_id: string }>(),
    );
    if (!row) return yield* new CompanySignInOperationError({});
    return row.user_id;
  });

  readonly #saveTestedConnection = Effect.fn("CompanySignIn.saveTestedConnection")(function* (
    this: CompanySignInService,
    flow: FlowRow,
    issuer: string,
    domains: string[],
  ): Effect.fn.Return<void, CompanySignInFailure> {
    if (!flow.user_id) return yield* new CompanySignInOperationError({});
    yield* this.#requireOwner({ id: flow.user_id }, flow.host_id);
    yield* this.#requireFreeDomains(flow.host_id, domains);
    const now = this.#now();
    yield* storeCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT INTO company_sign_in_connections(
               host_id, issuer, client_id, client_secret_ciphertext, enabled, updated_by_user_id, tested_at,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
             ON CONFLICT(host_id) DO UPDATE SET issuer = excluded.issuer, client_id = excluded.client_id,
               client_secret_ciphertext = excluded.client_secret_ciphertext,
               updated_by_user_id = excluded.updated_by_user_id, tested_at = excluded.tested_at,
               updated_at = excluded.updated_at`,
          )
          .bind(flow.host_id, issuer, flow.client_id, flow.client_secret_ciphertext, flow.user_id, now, now, now),
        this.#database.prepare("DELETE FROM company_sign_in_domains WHERE host_id = ?").bind(flow.host_id),
        ...domains.map((domain) =>
          this.#database
            .prepare("INSERT INTO company_sign_in_domains(domain, host_id) VALUES (?, ?)")
            .bind(domain, flow.host_id),
        ),
      ]),
    );
  });

  readonly #redeemProviderCode = Effect.fn("CompanySignIn.redeemProviderCode")(function* (
    this: CompanySignInService,
    input: {
      metadata: ProviderMetadata;
      clientId: string;
      clientSecret: string;
      code: string;
      verifier: string;
      nonce: string;
      redirectUri: string;
    },
  ): Effect.fn.Return<{ subject: string; email: string; hostedDomain: string | null }, CompanySignInFailure> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    });
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" });
    if (input.metadata.basicAuth) {
      const pair = `${encodeURIComponent(input.clientId)}:${encodeURIComponent(input.clientSecret)}`;
      headers.set("Authorization", `Basic ${btoa(pair)}`);
    } else {
      body.set("client_id", input.clientId);
      body.set("client_secret", input.clientSecret);
    }
    const tokens = yield* providerCall(async () => {
      const response = await this.#fetch(input.metadata.tokenEndpoint, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      return { ok: response.ok, value: await response.json().catch(() => null) };
    });
    if (!tokens.ok || !isDynamicRecord(tokens.value) || !isString(tokens.value.id_token)) {
      return yield* new CompanySignInError(
        401,
        "company_provider_rejected",
        "The provider did not accept the client ID or secret.",
      );
    }
    const idToken = tokens.value.id_token;
    const fetchImplementation = this.#fetch;
    const keys = createRemoteJWKSet(new URL(input.metadata.jwksUri), {
      timeoutDuration: PROVIDER_TIMEOUT_MS,
      [customFetch]: (url, options) => fetchImplementation(url, options),
    });
    const verified = yield* Effect.tryPromise({
      try: () =>
        jwtVerify(idToken, keys, {
          issuer: input.metadata.issuer,
          audience: input.clientId,
          algorithms: ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"],
          clockTolerance: 60,
        }),
      catch: () =>
        new CompanySignInError(401, "company_token_invalid", "The provider gave a sign-in that cannot be checked."),
    });
    const claims = verified.payload;
    if (claims.nonce !== input.nonce || !isString(claims.sub) || !claims.sub) {
      return yield* new CompanySignInError(
        401,
        "company_token_invalid",
        "The provider gave a sign-in that cannot be checked.",
      );
    }
    // Entra ID often gives no `email`; its `preferred_username` is then the sign-in address.
    const address = isString(claims.email)
      ? claims.email
      : isString(claims.preferred_username)
        ? claims.preferred_username
        : "";
    const email = normalizeEmailAddress(address);
    if (!email || claims.email_verified === false) {
      return yield* new CompanySignInError(
        403,
        "company_email_missing",
        "The provider did not give a verified email address.",
      );
    }
    // Each Google account has the same issuer. Only `hd` shows that a Workspace of the company manages the account.
    const hostedDomain = isString(claims.hd) ? claims.hd.toLowerCase() : null;
    return { subject: claims.sub, email, hostedDomain };
  });

  readonly #startFlow = Effect.fn("CompanySignIn.startFlow")(function* (
    this: CompanySignInService,
    input: {
      purpose: "sign_in" | "test";
      hostId: string;
      userId: string | null;
      metadata: ProviderMetadata;
      clientId: string;
      ciphertext: string;
      domains: string[];
      returnTo: string;
      clientState: string;
      clientChallenge: string;
      requestUrl: string;
      loginHint: string | null;
    },
  ): Effect.fn.Return<{ authorizationUrl: string }, CompanySignInFailure> {
    const state = randomToken(32);
    const verifier = randomToken(48);
    const nonce = randomToken(24);
    const hash = (value: string) => sha256(value).pipe(Effect.mapError(() => new CompanySignInOperationError({})));
    const stateHash = yield* hash(state);
    const challenge = yield* hash(verifier);
    const now = this.#now();
    yield* storeCall(() =>
      this.#database
        .prepare(
          `INSERT INTO company_sign_in_flows(
             state_hash, purpose, host_id, user_id, issuer, client_id, client_secret_ciphertext, domains_json,
             verifier, nonce, return_to, client_state, client_challenge, created_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          stateHash,
          input.purpose,
          input.hostId,
          input.userId,
          input.metadata.issuer,
          input.clientId,
          input.ciphertext,
          JSON.stringify(input.domains),
          verifier,
          nonce,
          input.returnTo,
          input.clientState,
          input.clientChallenge,
          now,
          now + FLOW_TTL_MS,
        )
        .run(),
    );
    const url = new URL(input.metadata.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", new URL(CALLBACK_PATH, input.requestUrl).toString());
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
    // A test signs in as a person the owner picks, not as the account the browser already has.
    if (input.purpose === "test") url.searchParams.set("prompt", "select_account");
    return { authorizationUrl: url.toString() };
  });

  readonly #discover = Effect.fn("CompanySignIn.discover")(function* (
    this: CompanySignInService,
    issuerInput: string,
  ): Effect.fn.Return<ProviderMetadata, CompanySignInError> {
    // The Entra ID portal shows the address of the metadata document. It is the issuer with a suffix.
    const issuer = issuerInput.trim().replace(/\/\.well-known\/openid-configuration\/?$/u, "");
    const issuerUrl = URL.canParse(issuer) ? new URL(issuer) : null;
    if (!issuerUrl || issuer.length > 512 || issuerUrl.search || issuerUrl.hash || !this.#allowedEndpoint(issuerUrl)) {
      return yield* invalid("Enter the issuer URL of the provider, such as https://login.microsoftonline.com/…/v2.0.");
    }
    const discoveryUrl = `${issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`;
    // Workers refuse `redirect: "error"`. With `manual`, a redirect answer is not `ok`, so it is refused.
    const document = yield* providerCall(async () => {
      const response = await this.#fetch(discoveryUrl, {
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("discovery");
      return response.json();
    });
    const notFound = new CompanySignInError(
      400,
      "company_provider_not_found",
      "No OpenID Connect provider answers at this issuer URL.",
    );
    if (!isDynamicRecord(document)) return yield* notFound;
    const { issuer: documentIssuer, authorization_endpoint, token_endpoint, jwks_uri } = document;
    // Entra ID `common` and `organizations` give a placeholder issuer, which no token has.
    if (isString(documentIssuer) && documentIssuer.includes("{")) {
      return yield* invalid("Enter the issuer URL with your tenant ID, not common or organizations.");
    }
    // Entra ID gives the issuer with the tenant ID for a tenant domain. Only the host that sent the
    // document can give another issuer, and that issuer is the one that is saved and checked in tokens.
    if (
      !isString(documentIssuer) ||
      !URL.canParse(documentIssuer) ||
      new URL(documentIssuer).origin !== issuerUrl.origin ||
      !isString(authorization_endpoint) ||
      !isString(token_endpoint) ||
      !isString(jwks_uri)
    ) {
      return yield* notFound;
    }
    for (const endpoint of [authorization_endpoint, token_endpoint, jwks_uri]) {
      if (!URL.canParse(endpoint) || !this.#allowedEndpoint(new URL(endpoint))) return yield* notFound;
    }
    const methods = document.token_endpoint_auth_methods_supported;
    const basicAuth = !Array.isArray(methods) || methods.includes("client_secret_basic");
    return {
      issuer: documentIssuer,
      authorizationEndpoint: authorization_endpoint,
      tokenEndpoint: token_endpoint,
      jwksUri: jwks_uri,
      basicAuth,
    };
  });

  #allowedEndpoint(url: URL): boolean {
    if (url.protocol === "https:") return !url.username && !url.password;
    return this.#development && loopbackHttp(url);
  }

  readonly #validateReturn = Effect.fn("CompanySignIn.validateReturn")(function* (
    returnTo: string,
    clientState: string,
    /** Given for a web sign-in. A test returns only to the desktop app. */
    webOrigin?: string,
    /** True for a sign-in that an app starts. A test is not made on the phone. */
    mobile = false,
  ) {
    const webReturn = webOrigin !== undefined && returnTo === new URL(WEB_RETURN_PATH, webOrigin).toString();
    const mobileReturn = mobile && returnTo === MOBILE_COMPANY_SIGN_IN_RETURN;
    if ((!webReturn && !mobileReturn && !RETURN_PATTERN.test(returnTo)) || !TOKEN_PATTERN.test(clientState)) {
      return yield* invalid("The sign-in request is invalid.");
    }
  });

  readonly #normalizeDomains = Effect.fn("CompanySignIn.normalizeDomains")(function* (values: string[]) {
    const domains = [...new Set(values.map((value) => value.trim().toLowerCase().replace(/^@/u, "")).filter(Boolean))];
    if (domains.length === 0) return yield* invalid("Enter at least one email domain.");
    if (domains.length > MAX_DOMAINS) return yield* invalid("Enter 20 email domains at most.");
    for (const domain of domains) {
      if (!isValidHostname(domain)) return yield* invalid(`${domain} is not a domain.`);
      if (SHARED_MAIL_DOMAINS.has(domain)) {
        return yield* new CompanySignInError(400, "company_domain_shared", `${domain} is a shared mail service.`);
      }
    }
    return domains;
  });

  readonly #requireFreeDomains = Effect.fn("CompanySignIn.requireFreeDomains")(function* (
    this: CompanySignInService,
    hostId: string,
    domains: string[],
  ) {
    const taken = yield* storeCall(() =>
      this.#database
        .prepare(
          `SELECT domain FROM company_sign_in_domains
           WHERE host_id != ? AND domain IN (SELECT value FROM json_each(?)) LIMIT 1`,
        )
        .bind(hostId, JSON.stringify(domains))
        .first<{ domain: string }>(),
    );
    if (taken) {
      return yield* new CompanySignInError(
        409,
        "company_domain_taken",
        `${taken.domain} already signs in through another server.`,
      );
    }
  });

  /** The TXT record `_openbot.<domain>` must hold the value of this server. */
  readonly #requireDomainRecord = Effect.fn("CompanySignIn.requireDomainRecord")(function* (
    this: CompanySignInService,
    secret: string,
    hostId: string,
    domain: string,
  ) {
    const expected = yield* this.#domainRecordValue(secret, hostId);
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", `${DOMAIN_RECORD_PREFIX}.${domain}`);
    url.searchParams.set("type", "TXT");
    const answer = yield* providerCall(async () => {
      const response = await this.#fetch(url, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("dns");
      return response.json();
    });
    const records =
      isDynamicRecord(answer) && Array.isArray(answer.Answer)
        ? answer.Answer.flatMap((record) =>
            isDynamicRecord(record) && isString(record.data)
              ? [record.data.replaceAll(/"\s*"/gu, "").replaceAll('"', "")]
              : [],
          )
        : [];
    if (!records.includes(expected)) {
      return yield* new CompanySignInError(
        409,
        "company_domain_not_verified",
        `The DNS record of ${domain} is missing. DNS changes can take some minutes.`,
      );
    }
  });

  readonly #domainRecordValue = Effect.fn("CompanySignIn.domainRecordValue")(function* (
    secret: string,
    hostId: string,
  ) {
    const digest = yield* hmacSha256(secret, `domain-record:${hostId}`).pipe(
      Effect.mapError(() => new CompanySignInOperationError({})),
    );
    return `${DOMAIN_RECORD_VALUE_PREFIX}${digest.slice(0, 32)}`;
  });

  readonly #requireSecret = Effect.fn("CompanySignIn.requireSecret")(function* (this: CompanySignInService) {
    if (!this.#secret) {
      return yield* new CompanySignInError(
        503,
        "company_sign_in_not_configured",
        "Company sign-in is not available on this account service.",
      );
    }
    return this.#secret;
  });

  readonly #requireOwner = Effect.fn("CompanySignIn.requireOwner")(function* (
    this: CompanySignInService,
    user: Pick<AuthUser, "id">,
    hostId: string,
  ) {
    const host = yield* storeCall(() =>
      this.#database
        .prepare("SELECT owner_user_id FROM remote_hosts WHERE host_id = ? LIMIT 1")
        .bind(hostId)
        .first<{ owner_user_id: string }>(),
    );
    if (host?.owner_user_id !== user.id) {
      return yield* new CompanySignInError(
        403,
        "forbidden",
        "Only the owner of this server can set up company sign-in.",
      );
    }
  });

  readonly #connection = Effect.fn("CompanySignIn.connection")(function* (this: CompanySignInService, hostId: string) {
    return yield* storeCall(() =>
      this.#database
        .prepare("SELECT * FROM company_sign_in_connections WHERE host_id = ?")
        .bind(hostId)
        .first<ConnectionRow>(),
    );
  });

  readonly #domains = Effect.fn("CompanySignIn.domains")(function* (this: CompanySignInService, hostId: string) {
    const rows = yield* storeCall(() =>
      this.#database
        .prepare("SELECT domain FROM company_sign_in_domains WHERE host_id = ? ORDER BY domain")
        .bind(hostId)
        .all<{ domain: string }>(),
    );
    return rows.results.map((row) => row.domain);
  });

  readonly #encrypt = Effect.fn("CompanySignIn.encrypt")(function* (
    this: CompanySignInService,
    secret: string,
    value: string,
  ) {
    const key = yield* this.#cipherKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = yield* storeCall(() =>
      crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)),
    );
    return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
  });

  readonly #decrypt = Effect.fn("CompanySignIn.decrypt")(function* (
    this: CompanySignInService,
    secret: string,
    value: string,
  ) {
    const [version, iv, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !ciphertext) return yield* new CompanySignInOperationError({});
    const key = yield* this.#cipherKey(secret);
    const plaintext = yield* storeCall(() =>
      crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(iv) }, key, decodeBase64Url(ciphertext)),
    );
    return new TextDecoder().decode(plaintext);
  });

  readonly #cipherKey = Effect.fn("CompanySignIn.cipherKey")(function* (secret: string) {
    const raw = yield* deriveSecret(secret, "openbot/company-sign-in/client-secret/v1").pipe(
      Effect.mapError(() => new CompanySignInOperationError({})),
    );
    return yield* storeCall(() =>
      crypto.subtle.importKey("raw", decodeBase64Url(raw), "AES-GCM", false, ["encrypt", "decrypt"]),
    );
  });
}
