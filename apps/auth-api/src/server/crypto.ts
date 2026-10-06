import { Effect, Schema } from "effect";

class CryptoOperationError extends Schema.TaggedError<CryptoOperationError>()("CryptoOperationError", {}) {}
function cryptoCall<A>(operation: () => Promise<A>): Effect.Effect<A, CryptoOperationError> {
  return Effect.tryPromise({ try: operation, catch: () => new CryptoOperationError({}) });
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return encodeBase64Url(value);
}

export const sha256 = Effect.fn("Crypto.sha256")(function* (value: string) {
  const digest = yield* cryptoCall(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return encodeBase64Url(new Uint8Array(digest));
});

export const hmacSha256 = Effect.fn("Crypto.hmacSha256")(function* (secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = yield* cryptoCall(() => importHmacSha256Key(secret, "sign"));
  const digest = yield* cryptoCall(() => crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return encodeBase64Url(new Uint8Array(digest));
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
  return encodeBase64Url(new Uint8Array(bits));
});

export function importHmacSha256Key(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);
}

export function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Throws when `atob` rejects `value`. It does not reject the `+` and `/` characters of standard base64. */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

/** The caller must first check that `value` has an even number of hex digits. */
export function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** The time does not show where the values differ. A different length returns at once. */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
