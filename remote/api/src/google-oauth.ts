// The Google token broker. A host sends the two token requests of a Google sign-in here: the code
// exchange and the refresh. Signal adds the client secret of the OpenBot Google sign-in app, passes
// the request to Google, and returns Google's status and body. It stores nothing, and it never logs
// the request, the answer, the code or a token. See `@openbot/contracts/signal-protocol/google-oauth`.

import {
  GOOGLE_OAUTH_REDIRECT_PATTERN,
  type GoogleOAuthBrokerErrorBody,
  type GoogleOAuthBrokerErrorCode,
  type GoogleOAuthTokenRequest,
} from "@openbot/contracts/signal-protocol/google-oauth";
import { z } from "zod";
import type { GoogleOAuthConfig } from "./config";

// A request holds one code, one verifier or one refresh token: a few hundred bytes.
export const GOOGLE_OAUTH_REQUEST_BYTES_LIMIT = 8 * 1024;
// A token set is a few kilobytes. A larger answer is not one.
const GOOGLE_OAUTH_ANSWER_BYTES_LIMIT = 64 * 1024;
// The host waits 10 seconds for a token exchange. Signal stops a little before it.
const GOOGLE_OAUTH_TIMEOUT_MS = 8_000;

const valueSchema = z.string().min(1).max(2_048);
const resourceSchema = z
  .url({ protocol: /^https$/u })
  .max(2_048)
  .optional();
const requestSchema = z.discriminatedUnion("grant", [
  z.strictObject({
    grant: z.literal("authorization_code"),
    clientId: valueSchema,
    code: valueSchema,
    codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u),
    redirectUri: z.string().regex(GOOGLE_OAUTH_REDIRECT_PATTERN),
    resource: resourceSchema,
  }),
  z.strictObject({
    grant: z.literal("refresh_token"),
    clientId: valueSchema,
    refreshToken: valueSchema,
    resource: resourceSchema,
  }),
]) satisfies z.ZodType<GoogleOAuthTokenRequest>;

/** The request, or null when it does not match the contract. */
export function decodeGoogleOAuthTokenRequest(body: Uint8Array): GoogleOAuthTokenRequest | null {
  try {
    const parsed = requestSchema.safeParse(JSON.parse(new TextDecoder().decode(body)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function googleOAuthError(status: number, code: GoogleOAuthBrokerErrorCode): Response {
  const body: GoogleOAuthBrokerErrorBody = { error: "openbot_broker", code };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Passes one token request to Google with the client secret, and returns Google's answer as it is. */
export async function exchangeGoogleToken(
  config: GoogleOAuthConfig,
  request: GoogleOAuthTokenRequest,
  signal: AbortSignal,
): Promise<Response> {
  const client = config.clients.find((candidate) => candidate.clientId === request.clientId);
  if (!client) return googleOAuthError(400, "unknown_client");
  const form = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret });
  if (request.grant === "authorization_code") {
    form.set("grant_type", "authorization_code");
    form.set("code", request.code);
    form.set("code_verifier", request.codeVerifier);
    form.set("redirect_uri", request.redirectUri);
  } else {
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", request.refreshToken);
  }
  if (request.resource) form.set("resource", request.resource);
  try {
    const answer = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(GOOGLE_OAUTH_TIMEOUT_MS)]),
    });
    const body = await readAnswer(answer);
    if (body === null) return googleOAuthError(502, "upstream_failed");
    return new Response(body, {
      status: answer.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    // Only the error name: a fetch error can quote the request.
    console.error("The Google token request failed.", error instanceof Error ? error.name : "Unknown error");
    return googleOAuthError(502, "upstream_failed");
  }
}

/** Google's answer, or null when it is larger than the limit. */
async function readAnswer(answer: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of answer.body ?? []) {
    size += chunk.byteLength;
    // Leaving the loop cancels the rest of the body.
    if (size > GOOGLE_OAUTH_ANSWER_BYTES_LIMIT) return null;
    chunks.push(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
