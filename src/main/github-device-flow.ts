import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { z } from "zod";
import { GitHubOperationError, githubCall, githubDecode } from "./github-effects";

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SLOW_DOWN_MS = 5_000;
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

const text = z.string().min(1).optional().catch(undefined);
const count = z
  .union([z.number().finite(), z.string().regex(/^\d+$/u).transform(Number)])
  .optional()
  .catch(undefined);

const oauthAnswerSchema = z.object({
  error: text,
  error_description: text,
  device_code: text,
  user_code: text,
  verification_uri: text,
  expires_in: count,
  interval: count,
  access_token: text,
  refresh_token: text,
  refresh_token_expires_in: count,
});

type OAuthAnswer = z.infer<typeof oauthAnswerSchema>;

export type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GitHubDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

export interface GitHubTokenSet {
  accessToken: string;
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
}

export type GitHubDeviceFlowFailure =
  | "denied"
  | "expired"
  | "device_flow_disabled"
  | "client_unknown"
  | "refresh_rejected"
  | "unreachable"
  | "unexpected";

export class GitHubDeviceFlowError extends Schema.TaggedError<GitHubDeviceFlowError>()("GitHubDeviceFlowError", {
  failure: Schema.Literals([
    "denied",
    "expired",
    "device_flow_disabled",
    "client_unknown",
    "refresh_rejected",
    "unreachable",
    "unexpected",
  ]),
  message: Schema.String,
}) {
  constructor(failure: GitHubDeviceFlowFailure, message: string) {
    super({ failure, message });
  }
}

export interface GitHubDeviceFlowOptions {
  clientId: string;
  fetch: GitHubFetch;
  now?: () => number;
}

export interface PollGitHubDeviceTokenOptions extends GitHubDeviceFlowOptions {
  device: GitHubDeviceCode;
  signal: AbortSignal;
}

export const requestGitHubDeviceCode = Effect.fn("GitHub.requestDeviceCode")(function* (
  options: GitHubDeviceFlowOptions & { signal: AbortSignal },
): Effect.fn.Return<GitHubDeviceCode, GitHubOperationError> {
  const now = options.now ?? Date.now;
  const body = yield* postFormEffect(
    options.fetch,
    GITHUB_DEVICE_CODE_URL,
    { client_id: options.clientId },
    options.signal,
  );
  if (body.error) return yield* new GitHubOperationError({ cause: flowError(body.error, body) });
  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    expires_in: expiresIn,
  } = body;
  if (!deviceCode || !userCode || !verificationUri?.startsWith("https://") || expiresIn === undefined) {
    return yield* new GitHubOperationError({ cause: unexpected("device code") });
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresAt: now() + expiresIn * 1_000,
    intervalMs: Math.max(1, body.interval ?? 5) * 1_000,
  };
});

export const pollGitHubDeviceToken = Effect.fn("GitHub.pollDeviceToken")(function* (
  options: PollGitHubDeviceTokenOptions,
): Effect.fn.Return<GitHubTokenSet, GitHubOperationError> {
  const now = options.now ?? Date.now;
  let intervalMs = options.device.intervalMs;
  for (;;) {
    yield* waitForEffect(intervalMs, options.signal);
    if (now() >= options.device.expiresAt)
      return yield* new GitHubOperationError({ cause: flowError("expired_token", null) });
    const result = yield* postFormEffect(
      options.fetch,
      GITHUB_ACCESS_TOKEN_URL,
      { client_id: options.clientId, device_code: options.device.deviceCode, grant_type: DEVICE_GRANT },
      options.signal,
    ).pipe(Effect.result);
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      if (error instanceof GitHubDeviceFlowError && error.failure === "unreachable") continue;
      return yield* result.failure;
    }
    const body = result.success;
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      intervalMs =
        body.interval === undefined ? intervalMs + SLOW_DOWN_MS : Math.max(body.interval * 1_000, intervalMs);
      continue;
    }
    if (body.error) return yield* new GitHubOperationError({ cause: flowError(body.error, body) });
    return yield* githubDecode(() => tokenSet(body, now()));
  }
});

export const refreshGitHubToken = Effect.fn("GitHub.refreshToken")(function* (
  options: GitHubDeviceFlowOptions & { refreshToken: string },
): Effect.fn.Return<GitHubTokenSet, GitHubOperationError> {
  const now = options.now ?? Date.now;
  const body = yield* postFormEffect(options.fetch, GITHUB_ACCESS_TOKEN_URL, {
    client_id: options.clientId,
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
  });
  if (body.error) return yield* new GitHubOperationError({ cause: flowError(body.error, body) });
  return yield* githubDecode(() => tokenSet(body, now()));
});

function tokenSet(body: OAuthAnswer, now: number): GitHubTokenSet {
  const accessToken = body.access_token;
  if (!accessToken) throw unexpected("token");
  const expiresIn = body.expires_in;
  const refreshExpiresIn = body.refresh_token_expires_in;
  return {
    accessToken,
    accessTokenExpiresAt: expiresIn === undefined ? null : now + expiresIn * 1_000,
    refreshToken: body.refresh_token ?? null,
    refreshTokenExpiresAt: refreshExpiresIn === undefined ? null : now + refreshExpiresIn * 1_000,
  };
}

const postFormEffect = Effect.fn("GitHub.postForm")(function* (
  fetch: GitHubFetch,
  url: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Effect.fn.Return<OAuthAnswer, GitHubOperationError> {
  const timeout = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
  const response = yield* githubCall((fiberSignal) =>
    fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.any(signal ? [signal, timeout, fiberSignal] : [timeout, fiberSignal]),
    }),
  ).pipe(
    Effect.mapError(
      ({ cause }) =>
        new GitHubOperationError({
          cause: signal?.aborted ? signal.reason : githubUnreachable(cause),
        }),
    ),
  );
  const json = yield* githubCall(() => response.json()).pipe(Effect.catch(() => Effect.succeed(null)));
  const answer = oauthAnswerSchema.safeParse(json);
  if (!answer.success) return yield* new GitHubOperationError({ cause: unexpected(`HTTP ${response.status}`) });
  return answer.data;
});

function flowError(code: string, body: OAuthAnswer | null): GitHubDeviceFlowError {
  switch (code) {
    case "access_denied":
      return new GitHubDeviceFlowError("denied", sourceText("error.connector.githubDenied"));
    case "expired_token":
    case "token_expired":
      return new GitHubDeviceFlowError("expired", sourceText("error.connector.githubCodeExpired"));
    case "device_flow_disabled":
      return new GitHubDeviceFlowError("device_flow_disabled", sourceText("error.connector.githubDeviceFlowDisabled"));
    case "incorrect_client_credentials":
    case "unauthorized_client":
      return new GitHubDeviceFlowError("client_unknown", sourceText("error.connector.githubClientUnknown"));
    case "bad_refresh_token":
      return new GitHubDeviceFlowError("refresh_rejected", sourceText("error.connector.githubExpired"));
    default:
      return unexpected([code, body?.error_description].filter(Boolean).join(": "));
  }
}

/** Codes that say the request never got to GitHub: no name lookup, no route, or no connection. */
const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * A request that got no answer. Node rejects it with a bare "fetch failed", and the reason (DNS, a
 * refused connection) is only on its `cause`, sometimes in an `AggregateError`. A network reason
 * gets a sentence that says what to check; any other failure names its innermost reason.
 */
export function githubUnreachable(error: unknown): GitHubDeviceFlowError {
  let detail = error instanceof Error ? error.message : String(error);
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = "code" in current ? current.code : undefined;
    if (typeof code === "string" && NETWORK_CODES.has(code)) {
      return new GitHubDeviceFlowError("unreachable", sourceText("error.connector.githubOffline"));
    }
    if (current.message) detail = current.message;
    current = current.cause ?? (current instanceof AggregateError ? current.errors[0] : undefined);
  }
  return new GitHubDeviceFlowError("unreachable", sourceText("error.connector.githubUnreachable", { detail }));
}

function unexpected(detail: string): GitHubDeviceFlowError {
  return new GitHubDeviceFlowError("unexpected", sourceText("error.connector.githubUnexpected", { detail }));
}

const waitForEffect = (ms: number, signal: AbortSignal): Effect.Effect<void, GitHubOperationError> =>
  Effect.callback<void, GitHubOperationError>((resume) => {
    if (signal.aborted) {
      resume(Effect.fail(new GitHubOperationError({ cause: signal.reason })));
      return;
    }
    const timer = setTimeout(() => resume(Effect.void), ms);
    const abort = () => resume(Effect.fail(new GitHubOperationError({ cause: signal.reason })));
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    });
  });
