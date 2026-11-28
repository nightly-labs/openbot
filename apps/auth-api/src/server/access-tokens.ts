import { Effect, Schema } from "effect";
import { decodeBase64Url, deriveSecret, encodeBase64Url, importHmacSha256Key } from "./crypto";

const ACCESS_TOKEN_PREFIX = "oba1.";
const ACCESS_TOKEN_LIFETIME_MS = 10 * 60_000;
export const ACCESS_TOKEN_ROUTE = "/v1/auth/access-token";
const ACCESS_TOKEN_KEY_LABEL = "openbot/auth-access-token/v1";
const ACCESS_TOKEN_MAX_LENGTH = 512;

const AccessTokenPayload = Schema.Struct({
  sid: Schema.String,
  uid: Schema.String,
  exp: Schema.Number,
  iat: Schema.Number,
});
type AccessTokenPayload = typeof AccessTokenPayload.Type;
const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(AccessTokenPayload));

export type AccessTokenCheck =
  | { readonly status: "valid"; readonly sessionId: string; readonly userId: string; readonly expiresAt: number }
  | { readonly status: "expired" }
  | { readonly status: "invalid" };

export interface IssuedAccessToken {
  accessToken: string;
  expiresAt: number;
}

const keys = new Map<string, CryptoKey>();

const accessTokenKey = Effect.fn("AccessTokens.key")(function* (secret: string, usage: "sign" | "verify") {
  const cacheKey = `${usage}:${secret}`;
  const known = keys.get(cacheKey);
  if (known) return known;
  const derived = yield* deriveSecret(secret, ACCESS_TOKEN_KEY_LABEL);
  const key = yield* Effect.tryPromise(() => importHmacSha256Key(derived, usage));
  keys.set(cacheKey, key);
  return key;
});

export function isAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX);
}

export const issueAccessToken = Effect.fn("AccessTokens.issue")(function* (
  secret: string,
  session: { sessionId: string; userId: string; expiresAt: number },
  now: number,
) {
  const payload: AccessTokenPayload = {
    sid: session.sessionId,
    uid: session.userId,
    exp: Math.min(now + ACCESS_TOKEN_LIFETIME_MS, session.expiresAt),
    iat: now,
  };
  const body = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signed = `${ACCESS_TOKEN_PREFIX}${body}`;
  const key = yield* accessTokenKey(secret, "sign");
  const signature = yield* Effect.tryPromise(() => crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed)));
  return {
    accessToken: `${signed}.${encodeBase64Url(new Uint8Array(signature))}`,
    expiresAt: payload.exp,
  } satisfies IssuedAccessToken;
});

function tokenParts(token: string): { signed: string; body: string; signature: Uint8Array<ArrayBuffer> } | null {
  if (!isAccessToken(token) || token.length > ACCESS_TOKEN_MAX_LENGTH) return null;
  const parts = token.slice(ACCESS_TOKEN_PREFIX.length).split(".");
  const [body, signature] = parts;
  if (parts.length !== 2 || !body || !signature) return null;
  try {
    return { signed: `${ACCESS_TOKEN_PREFIX}${body}`, body, signature: decodeBase64Url(signature) };
  } catch {
    return null;
  }
}

function decodeBody(body: string): AccessTokenPayload | null {
  try {
    const decoded = decodePayload(new TextDecoder().decode(decodeBase64Url(body)));
    return decoded._tag === "Some" ? decoded.value : null;
  } catch {
    return null;
  }
}

export const checkAccessToken = Effect.fn("AccessTokens.check")(
  function* (secret: string, token: string, now: number) {
    const parts = tokenParts(token);
    if (!parts) return { status: "invalid" } satisfies AccessTokenCheck;
    const key = yield* accessTokenKey(secret, "verify");
    const valid = yield* Effect.tryPromise(() =>
      crypto.subtle.verify("HMAC", key, parts.signature, new TextEncoder().encode(parts.signed)),
    );
    if (!valid) return { status: "invalid" } satisfies AccessTokenCheck;
    const payload = decodeBody(parts.body);
    if (!payload) return { status: "invalid" } satisfies AccessTokenCheck;
    if (now >= payload.exp) return { status: "expired" } satisfies AccessTokenCheck;
    return {
      status: "valid",
      sessionId: payload.sid,
      userId: payload.uid,
      expiresAt: payload.exp,
    } satisfies AccessTokenCheck;
  },
  Effect.orElseSucceed(() => ({ status: "invalid" }) satisfies AccessTokenCheck),
);
