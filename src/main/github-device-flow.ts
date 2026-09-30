// The OAuth device flow of a GitHub App, and the token refresh that follows it.
//
// Only the public Client ID is used. GitHub refreshes a token that the device flow issued without
// the client secret, so the whole sign-in stays on this computer and no account server takes part.
// https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token

import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";

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

export class GitHubDeviceFlowError extends Error {
  readonly failure: GitHubDeviceFlowFailure;

  constructor(failure: GitHubDeviceFlowFailure, message: string) {
    super(message);
    this.name = "GitHubDeviceFlowError";
    this.failure = failure;
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
export async function requestGitHubDeviceCode(
  options: GitHubDeviceFlowOptions & { signal: AbortSignal },
): Promise<GitHubDeviceCode> {
  const now = options.now ?? Date.now;
  const body = await postForm(options.fetch, GITHUB_DEVICE_CODE_URL, { client_id: options.clientId }, options.signal);
  const error = body.error;
  if (error) throw flowError(error, body);
  const deviceCode = body.device_code;
  const userCode = body.user_code;
  const verificationUri = body.verification_uri;
  const expiresIn = body.expires_in;
  if (!deviceCode || !userCode || !verificationUri?.startsWith("https://") || expiresIn === undefined) {
    throw unexpected("device code");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresAt: now() + expiresIn * 1_000,
    intervalMs: Math.max(1, body.interval ?? 5) * 1_000,
  };
}

/**
 * Asks GitHub for the token at the interval it named, until the user answers, the code expires, or
 * `signal` aborts. An abort rejects with the signal's reason. A network failure is not an answer:
 * the next interval asks again.
 */
export async function pollGitHubDeviceToken(options: PollGitHubDeviceTokenOptions): Promise<GitHubTokenSet> {
  const now = options.now ?? Date.now;
  let intervalMs = options.device.intervalMs;
  for (;;) {
    await waitFor(intervalMs, options.signal);
    if (now() >= options.device.expiresAt) throw flowError("expired_token", null);
    let body: OAuthAnswer;
    try {
      body = await postForm(
        options.fetch,
        GITHUB_ACCESS_TOKEN_URL,
        { client_id: options.clientId, device_code: options.device.deviceCode, grant_type: DEVICE_GRANT },
        options.signal,
      );
    } catch (error) {
      if (error instanceof GitHubDeviceFlowError && error.failure === "unreachable") continue;
      throw error;
    }
    const error = body.error;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      // GitHub names the new interval; without one, the documented five seconds are added.
      const named = body.interval;
      intervalMs = named === undefined ? intervalMs + SLOW_DOWN_MS : Math.max(named * 1_000, intervalMs);
      continue;
    }
    if (error) throw flowError(error, body);
    return tokenSet(body, now());
  }
}

/** Trades a refresh token for a new token set. No client secret: the device flow issued it. */
export async function refreshGitHubToken(
  options: GitHubDeviceFlowOptions & { refreshToken: string },
): Promise<GitHubTokenSet> {
  const now = options.now ?? Date.now;
  const body = await postForm(options.fetch, GITHUB_ACCESS_TOKEN_URL, {
    client_id: options.clientId,
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
  });
  const error = body.error;
  if (error) throw flowError(error, body);
  return tokenSet(body, now());
}

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

async function postForm(
  fetch: GitHubFetch,
  url: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<OAuthAnswer> {
  const timeout = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    // Only the caller's abort is rethrown. The timeout is a network fault like any other.
    if (signal?.aborted) throw signal.reason;
    throw new GitHubDeviceFlowError(
      "unreachable",
      sourceText("error.connector.githubUnreachable", {
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
  // GitHub answers an OAuth error with 200 and an `error` field, and some errors with 4xx and the
  // same field. Both are read the same way; a body that is not an object is the unexpected case.
  const answer = oauthAnswerSchema.safeParse(await response.json().catch(() => null));
  if (!answer.success) throw unexpected(`HTTP ${response.status}`);
  return answer.data;
}

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

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
