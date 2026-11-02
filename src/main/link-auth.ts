// The Link sign-in (link.com, by Stripe): the OAuth device flow, the token refresh and the revoke.
//
// OpenBot uses Link's public client, the one that Stripe's `link-cli` uses, with OpenBot as the
// client hint. A public client needs no secret, so the whole sign-in stays on this computer. Link
// shows `connection_label` in the user's list of connected apps. Link's own page carries the code,
// so the user does not type it: OpenBot opens `verification_uri_complete`.

import { hostname } from "node:os";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { z } from "zod";
import { LinkOperationError, linkCall, linkDecode } from "./link-effects";

const LINK_AUTH_URL = "https://login.link.com";
export const LINK_API_URL = "https://api.link.com";
/** Link's public client. It needs no secret. */
const LINK_CLIENT_ID = "lwlpk_U7Qy7ThG69STZk";
/** The name that Link shows on its approval page. A product name: it is not translated. */
const LINK_CLIENT_HINT = "OpenBot";
/** Read the user's email, and ask for one-time cards that the user approves one at a time. */
const LINK_SCOPE = "userinfo:read payment_methods.agentic";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** RFC 8628: the wait grows by this much after each `slow_down`. */
const SLOW_DOWN_MS = 5_000;
/** A request that Link has not answered in this time fails as unreachable, so a sign-in never hangs. */
export const LINK_REQUEST_TIMEOUT_MS = 30_000;

/** A field that is missing or of the wrong type reads as absent, so each caller names what it needs. */
const text = z.string().min(1).optional().catch(undefined);
const count = z
  .union([z.number().finite(), z.string().regex(/^\d+$/u).transform(Number)])
  .optional()
  .catch(undefined);

/** Every field of a device code, token or OAuth error answer that this module reads. */
const oauthAnswerSchema = z.object({
  error: text,
  error_description: text,
  device_code: text,
  verification_uri_complete: text,
  expires_in: count,
  interval: count,
  access_token: text,
  refresh_token: text,
});

type OAuthAnswer = z.infer<typeof oauthAnswerSchema>;

export type LinkFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface LinkDeviceCode {
  deviceCode: string;
  /** Link's approval page, with the code in it. */
  verificationUrl: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  intervalMs: number;
}

export interface LinkTokenSet {
  accessToken: string;
  /** Epoch milliseconds, or null when Link did not say. */
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
}

/**
 * Why the flow stopped. `denied`, `expired` and `refresh_rejected` are the user's or Link's final
 * answer; the others are a fault that a retry can fix.
 */
export type LinkAuthFailure = "denied" | "expired" | "refresh_rejected" | "unreachable" | "unexpected";

export class LinkAuthError extends Schema.TaggedError<LinkAuthError>()("LinkAuthError", {
  failure: Schema.Literals(["denied", "expired", "refresh_rejected", "unreachable", "unexpected"]),
  message: Schema.String,
}) {
  constructor(failure: LinkAuthFailure, message: string) {
    super({ failure, message });
  }
}

export interface LinkAuthOptions {
  fetch: LinkFetch;
  now?: () => number;
}

/** Asks Link for a device code. The user approves it on `verificationUrl`. */
export const requestLinkDeviceCode = Effect.fn("Link.requestDeviceCode")(function* (
  options: LinkAuthOptions & { signal: AbortSignal },
): Effect.fn.Return<LinkDeviceCode, LinkOperationError> {
  const now = options.now ?? Date.now;
  const body = yield* postFormEffect(
    options.fetch,
    `${LINK_AUTH_URL}/device/code`,
    {
      client_id: LINK_CLIENT_ID,
      scope: LINK_SCOPE,
      connection_label: `${LINK_CLIENT_HINT} on ${hostname()}`,
      client_hint: LINK_CLIENT_HINT,
    },
    options.signal,
  );
  if (body.error) return yield* new LinkOperationError({ cause: flowError(body.error, body) });
  const { device_code: deviceCode, verification_uri_complete: verificationUrl, expires_in: expiresIn } = body;
  if (!deviceCode || !verificationUrl || !isLinkPage(verificationUrl) || expiresIn === undefined) {
    return yield* new LinkOperationError({ cause: unexpected("device code") });
  }
  return {
    deviceCode,
    verificationUrl,
    expiresAt: now() + expiresIn * 1_000,
    intervalMs: Math.max(1, body.interval ?? 5) * 1_000,
  };
});

/** Keeps Link's polling interval and retries only unreachable requests. */
export const pollLinkDeviceToken = Effect.fn("Link.pollDeviceToken")(function* (
  options: LinkAuthOptions & { device: LinkDeviceCode; signal: AbortSignal },
): Effect.fn.Return<LinkTokenSet, LinkOperationError> {
  const now = options.now ?? Date.now;
  let intervalMs = options.device.intervalMs;
  for (;;) {
    yield* waitForEffect(intervalMs, options.signal);
    if (now() >= options.device.expiresAt)
      return yield* new LinkOperationError({ cause: flowError("expired_token", null) });
    const result = yield* postFormEffect(
      options.fetch,
      `${LINK_AUTH_URL}/device/token`,
      { grant_type: DEVICE_GRANT, device_code: options.device.deviceCode, client_id: LINK_CLIENT_ID },
      options.signal,
    ).pipe(Effect.result);
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      if (error instanceof LinkAuthError && error.failure === "unreachable") continue;
      return yield* result.failure;
    }
    const body = result.success;
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      intervalMs += SLOW_DOWN_MS;
      continue;
    }
    if (body.error) return yield* new LinkOperationError({ cause: flowError(body.error, body) });
    return yield* linkDecode(() => tokenSet(body, now()));
  }
});

/** Link rotates the refresh token: the caller must keep the new one before it uses the access token. */
export const refreshLinkToken = Effect.fn("Link.refreshToken")(function* (
  options: LinkAuthOptions & { refreshToken: string },
): Effect.fn.Return<LinkTokenSet, LinkOperationError> {
  const now = options.now ?? Date.now;
  const body = yield* postFormEffect(options.fetch, `${LINK_AUTH_URL}/device/token`, {
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
    client_id: LINK_CLIENT_ID,
  });
  if (body.error) {
    const failure = body.error === "invalid_grant" ? "refresh_rejected" : body.error;
    return yield* new LinkOperationError({ cause: flowError(failure, body) });
  }
  return yield* linkDecode(() => tokenSet(body, now()));
});

/** Tells Link to forget a token. Link then removes OpenBot from the user's connected apps. */
export const revokeLinkToken = Effect.fn("Link.revokeToken")(function* (
  options: LinkAuthOptions & { token: string },
): Effect.fn.Return<void, LinkOperationError> {
  const body = yield* postFormEffect(options.fetch, `${LINK_AUTH_URL}/device/revoke`, {
    client_id: LINK_CLIENT_ID,
    token: options.token,
  });
  if (body.error) return yield* new LinkOperationError({ cause: flowError(body.error, body) });
});

/** An https page on link.com, the only kind that OpenBot opens for Link. */
export function isLinkPage(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && (url.hostname === "link.com" || url.hostname.endsWith(".link.com"));
  } catch {
    return false;
  }
}

function tokenSet(body: OAuthAnswer, now: number): LinkTokenSet {
  const accessToken = body.access_token;
  if (!accessToken) throw unexpected("token");
  return {
    accessToken,
    accessTokenExpiresAt: body.expires_in === undefined ? null : now + body.expires_in * 1_000,
    refreshToken: body.refresh_token ?? null,
  };
}

const postFormEffect = Effect.fn("Link.postForm")(function* (
  fetch: LinkFetch,
  url: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Effect.fn.Return<OAuthAnswer, LinkOperationError> {
  const timeout = AbortSignal.timeout(LINK_REQUEST_TIMEOUT_MS);
  const response = yield* linkCall((fiberSignal) =>
    fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.any(signal ? [signal, timeout, fiberSignal] : [timeout, fiberSignal]),
    }),
  ).pipe(
    Effect.mapError(
      ({ cause }) =>
        new LinkOperationError({
          cause: signal?.aborted ? signal.reason : unreachable(cause),
        }),
    ),
  );
  const json = yield* linkCall(() => response.json()).pipe(Effect.catch(() => Effect.succeed(null)));
  const answer = oauthAnswerSchema.safeParse(json);
  if (!answer.success) return yield* new LinkOperationError({ cause: unexpected(`HTTP ${response.status}`) });
  if (!response.ok && !answer.data.error) return { ...answer.data, error: `HTTP ${response.status}` };
  return answer.data;
});

export function unreachable(cause: unknown): LinkAuthError {
  return new LinkAuthError(
    "unreachable",
    sourceText("error.connector.linkUnreachable", { detail: cause instanceof Error ? cause.message : String(cause) }),
  );
}

function flowError(code: string, body: OAuthAnswer | null): LinkAuthError {
  switch (code) {
    case "access_denied":
    case "authorization_failed":
      return new LinkAuthError("denied", sourceText("error.connector.linkDenied"));
    case "expired_token":
      return new LinkAuthError("expired", sourceText("error.connector.linkCodeExpired"));
    case "refresh_rejected":
      return new LinkAuthError("refresh_rejected", sourceText("error.connector.linkExpired"));
    default:
      // The error code and Link's own description only. Never the body: it can hold a token.
      return unexpected([code, body?.error_description].filter(Boolean).join(": "));
  }
}

export function unexpected(detail: string): LinkAuthError {
  return new LinkAuthError("unexpected", sourceText("error.connector.linkUnexpected", { detail }));
}

const waitForEffect = (ms: number, signal?: AbortSignal): Effect.Effect<void, LinkOperationError> =>
  Effect.callback<void, LinkOperationError>((resume) => {
    if (signal?.aborted) {
      resume(Effect.fail(new LinkOperationError({ cause: signal.reason })));
      return;
    }
    const timer = setTimeout(() => resume(Effect.void), ms);
    const abort = () => resume(Effect.fail(new LinkOperationError({ cause: signal?.reason })));
    signal?.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    });
  });
