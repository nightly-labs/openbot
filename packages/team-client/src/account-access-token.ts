import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { accountBookmarkHeaders, rememberAccountBookmark } from "./account-bookmark";

export const ACCOUNT_ACCESS_TOKEN_PATH = "/v1/auth/access-token";
export const ACCOUNT_ACCESS_TOKEN_EXPIRED = "access_token_expired";

const REFRESH_SHARE = 0.8;
const UNSUPPORTED_RETRY_MS = 3_600_000;
const ISSUE_TIMEOUT_MS = 10_000;
const MAX_LIFETIME_MS = 3_600_000;
const MIN_LIFETIME_MS = 10_000;
const CLOCK_SKEW_LIMIT_MS = 60_000;
const ACCESS_TOKEN_FORMAT = /^[\x21-\x7e]{1,4096}$/u;
const PATH_BASE = "https://account.invalid";

const SESSION_TOKEN_PATHS = [
  "/v1/auth",
  "/v1/mobile-auth/session",
  "/v1/mobile-auth/devices",
  "/v1/me/billing",
  "/v1/me/license",
  "/v1/me/credits/checkout",
  "/v1/me/email",
  "/v1/me/account",
  "/v1/near",
];

export interface AccountAccessResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type AccountAccessFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<AccountAccessResponse>;

interface AccountAccessReply {
  readonly status: number;
  clone(): { json(): Promise<unknown> };
}

export interface AccountAccessRequest {
  apiUrl: string;
  sessionToken: string;
  path: string;
  method?: string | undefined;
  fetch: AccountAccessFetch;
}

interface AccessGrant {
  token: string;
  refreshAt: number;
  expiresAt: number;
}

interface AccessEntry {
  grant: AccessGrant | null;
  pending: Promise<AccessGrant | null> | null;
}

type IssueResult = AccessGrant | "unsupported" | null;

function accountPathname(path: string): string {
  try {
    return new URL(path, PATH_BASE).pathname.replace(/\/+$/u, "") || "/";
  } catch {
    return path;
  }
}

export function requiresAccountSessionToken(path: string, method = "GET"): boolean {
  const pathname = accountPathname(path);
  if (pathname === "/v1/me" && method.toUpperCase() === "DELETE") return true;
  return SESSION_TOKEN_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function accountOrigin(apiUrl: string): string | null {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return null;
  }
}

function grantFrom(value: unknown, sentAt: number, receivedAt: number, serverDate: string | null): AccessGrant | null {
  if (!isDynamicRecord(value) || !isString(value.accessToken) || !isNumber(value.expiresAt)) return null;
  if (!ACCESS_TOKEN_FORMAT.test(value.accessToken)) return null;
  const serverNow = serverDate === null ? Number.NaN : Date.parse(serverDate);
  const clockOffset =
    Number.isFinite(serverNow) && Math.abs(serverNow - receivedAt) > CLOCK_SKEW_LIMIT_MS ? serverNow - receivedAt : 0;
  const lifetime = Math.min(value.expiresAt - clockOffset - receivedAt, MAX_LIFETIME_MS);
  if (!Number.isFinite(lifetime) || lifetime < MIN_LIFETIME_MS) return null;
  return {
    token: value.accessToken,
    refreshAt: sentAt + Math.floor(lifetime * REFRESH_SHARE),
    expiresAt: sentAt + lifetime,
  };
}

async function isAccessTokenExpiredResponse(response: AccountAccessReply): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const value = await response.clone().json();
    return isDynamicRecord(value) && isDynamicRecord(value.error) && value.error.code === ACCOUNT_ACCESS_TOKEN_EXPIRED;
  } catch {
    return false;
  }
}

export function isAccountAccessTokenExpired(status: number, code: string | null | undefined): boolean {
  return status === 401 && code === ACCOUNT_ACCESS_TOKEN_EXPIRED;
}

export class AccountAccessTokens {
  readonly #entries = new Map<string, AccessEntry>();
  readonly #unsupportedUntil = new Map<string, number>();
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  bearer(request: AccountAccessRequest): Effect.Effect<string> {
    if (requiresAccountSessionToken(request.path, request.method)) return Effect.succeed(request.sessionToken);
    return Effect.promise(() => this.#bearer(request));
  }

  send<T extends AccountAccessReply, E, R>(
    request: AccountAccessRequest,
    perform: (bearer: string) => Effect.Effect<T, E, R>,
  ): Effect.Effect<T, E, R> {
    return Effect.gen({ self: this }, function* () {
      const bearer = yield* this.bearer(request);
      const response = yield* perform(bearer);
      if (bearer === request.sessionToken || response.status !== 401) return response;
      this.expire(request, bearer);
      const expired = yield* Effect.promise(() => isAccessTokenExpiredResponse(response));
      const retryBearer = expired ? yield* this.bearer(request) : request.sessionToken;
      const retried = yield* perform(retryBearer);
      if (retryBearer === request.sessionToken || retried.status !== 401) return retried;
      this.expire(request, retryBearer);
      return yield* perform(request.sessionToken);
    });
  }

  expire(request: Pick<AccountAccessRequest, "apiUrl" | "sessionToken">, bearer: string): void {
    const key = this.#key(request);
    const entry = key === null ? undefined : this.#entries.get(key);
    if (entry?.grant?.token === bearer) entry.grant = null;
  }

  forget(sessionToken: string): void {
    for (const key of [...this.#entries.keys()]) {
      if (key.endsWith(` ${sessionToken}`)) this.#entries.delete(key);
    }
  }

  #key(request: Pick<AccountAccessRequest, "apiUrl" | "sessionToken">): string | null {
    const origin = accountOrigin(request.apiUrl);
    return origin === null ? null : `${origin} ${request.sessionToken}`;
  }

  async #bearer(request: AccountAccessRequest): Promise<string> {
    const origin = accountOrigin(request.apiUrl);
    const key = this.#key(request);
    if (origin === null || key === null || request.sessionToken.length === 0) return request.sessionToken;
    if ((this.#unsupportedUntil.get(origin) ?? 0) > this.#now()) return request.sessionToken;
    const current = this.#entries.get(key)?.grant;
    if (current && this.#now() < current.refreshAt) return current.token;
    const grant = await this.#refresh(key, origin, request);
    if (grant) return grant.token;
    const kept = this.#entries.get(key)?.grant;
    return kept && this.#now() < kept.expiresAt ? kept.token : request.sessionToken;
  }

  #refresh(key: string, origin: string, request: AccountAccessRequest): Promise<AccessGrant | null> {
    const entry = this.#entries.get(key) ?? { grant: null, pending: null };
    this.#entries.set(key, entry);
    if (entry.pending) return entry.pending;
    const pending = this.#issue(request).then((result) => {
      entry.pending = null;
      if (result === "unsupported") {
        this.#unsupportedUntil.set(origin, this.#now() + UNSUPPORTED_RETRY_MS);
        return null;
      }
      if (this.#entries.get(key) !== entry) return null;
      if (result) entry.grant = result;
      return result;
    });
    entry.pending = pending;
    return pending;
  }

  async #issue(request: AccountAccessRequest): Promise<IssueResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ISSUE_TIMEOUT_MS);
    try {
      const url = new URL(ACCOUNT_ACCESS_TOKEN_PATH, request.apiUrl);
      const sentAt = this.#now();
      const response = await request.fetch(url.toString(), {
        method: "POST",
        headers: { ...accountBookmarkHeaders(url), Authorization: `Bearer ${request.sessionToken}` },
        signal: controller.signal,
      });
      rememberAccountBookmark(url, response);
      if (response.status === 404) return "unsupported";
      if (!response.ok) return null;
      const value = await response.json();
      return grantFrom(value, sentAt, this.#now(), response.headers.get("Date"));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const accountAccessTokens = new AccountAccessTokens();
