// The OAuth device flow of a GitHub App, and the token refresh that follows it.
//
// Only the public Client ID is used. GitHub refreshes a token that the device flow issued without
// the client secret, so the whole sign-in stays on this computer and no account server takes part.
// https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token

import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { z } from "zod";
import { GitHubOperationError, githubCall, githubDecode } from "./github-effects";

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** GitHub asks for this much more wait after each `slow_down`. */
const SLOW_DOWN_MS = 5_000;
/** A request that GitHub has not answered in this time fails as unreachable, so a sign-in never hangs. */
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

/** A field that is missing or of the wrong type reads as absent, so each caller names what it needs. */
const text = z.string().min(1).optional().catch(undefined);
/** A form-encoded answer carries numbers as text. */
const count = z
  .union([z.number().finite(), z.string().regex(/^\d+$/u).transform(Number)])
  .optional()
  .catch(undefined);

/** Every field of a device code, token or OAuth error answer that this module reads. */
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
  /** Epoch milliseconds. */
  expiresAt: number;
  intervalMs: number;
}

export interface GitHubTokenSet {
  accessToken: string;
  /** Epoch milliseconds, or null when the GitHub App issues tokens that do not expire. */
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
}

/**
 * Why the flow stopped. `denied`, `expired` and `refresh_rejected` are the user's or GitHub's final
 * answer; the others are a fault that a retry can fix.
 */
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

/** Asks GitHub for a user code. The user types it at `verificationUri`. An abort rejects with the signal's reason. */

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

/** Keep GitHub's polling interval and retry only unreachable requests. */

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
          cause: signal?.aborted
            ? signal.reason
            : new GitHubDeviceFlowError(
                "unreachable",
                sourceText("error.connector.githubUnreachable", {
                  detail: cause instanceof Error ? cause.message : String(cause),
                }),
              ),
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
      // The error code and GitHub's own description only. Never the body: it can hold a token.
      return unexpected([code, body?.error_description].filter(Boolean).join(": "));
  }
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
