import { Effect, Schema } from "effect";

class CryptoOperationError extends Schema.TaggedError<CryptoOperationError>()("CryptoOperationError", {}) {}
function cryptoCall<A>(operation: () => Promise<A>): Effect.Effect<A, CryptoOperationError> {
  return Effect.tryPromise({ try: operation, catch: () => new CryptoOperationError({}) });
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

export const sha256 = Effect.fn("Crypto.sha256")(function* (value: string) {
  const digest = yield* cryptoCall(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return base64Url(new Uint8Array(digest));
});

export const hmacSha256 = Effect.fn("Crypto.hmacSha256")(function* (secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = yield* cryptoCall(() =>
    crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  );
  const digest = yield* cryptoCall(() => crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return base64Url(new Uint8Array(digest));
});

/**
 * Derives a key for one use from a secret that has another use. A different label gives an unrelated
 * key, so the derived key tells nothing about the secret or about a key with another label.
 */

export const deriveSecret = Effect.fn("Crypto.deriveSecret")(function* (secret: string, label: string) {
  const encoder = new TextEncoder();
  const key = yield* cryptoCall(() =>
    crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveBits"]),
  );
  const bits = yield* cryptoCall(() =>
    crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode(label) },
      key,
      256,
    ),
  );
  return base64Url(new Uint8Array(bits));
});

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
