import { getPublicKeyAsync, hashes, signAsync, verifyAsync } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { Effect, Schema } from "effect";

class Ed25519Error extends Schema.TaggedError<Ed25519Error>()("Ed25519Error", { message: Schema.String }) {}

function cryptoError(error: unknown): Ed25519Error {
  return new Ed25519Error({ message: error instanceof Error ? error.message : String(error) });
}

hashes.sha512 = sha512;
hashes.sha512Async = async (message) => sha512(message);

const ED25519_SECRET_KEY_BYTES = 32;
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
const PUBLIC_KEY_HEADER = "-----BEGIN PUBLIC KEY-----";
const PUBLIC_KEY_FOOTER = "-----END PUBLIC KEY-----";

export interface Ed25519Identity {
  secretKey: Uint8Array;
  publicKeyPem: string;
}

export const createEd25519Identity = Effect.fn("Ed25519.createIdentity")(function* (
  randomBytes: (size: number) => Uint8Array,
) {
  const generated = yield* Effect.try({ try: () => randomBytes(ED25519_SECRET_KEY_BYTES), catch: cryptoError });
  if (generated.length !== ED25519_SECRET_KEY_BYTES) {
    return yield* new Ed25519Error({ message: "The random source returned an invalid Ed25519 secret key." });
  }
  const secretKey = Uint8Array.from(generated);
  const publicKey = yield* Effect.tryPromise({ try: () => getPublicKeyAsync(secretKey), catch: cryptoError });
  const publicKeyPem = yield* Effect.try({ try: () => encodePublicKeyPem(publicKey), catch: cryptoError });
  return { secretKey, publicKeyPem };
});

export const signEd25519 = Effect.fn("Ed25519.sign")(function* (message: Uint8Array, secretKey: Uint8Array) {
  return yield* Effect.tryPromise({ try: () => signAsync(message, secretKey), catch: cryptoError });
});

export const verifyEd25519Pem = Effect.fn("Ed25519.verify")(function* (
  signature: Uint8Array,
  message: Uint8Array,
  publicKeyPem: string,
) {
  const key = yield* Effect.try({ try: () => decodePublicKeyPem(publicKeyPem), catch: cryptoError });
  return yield* Effect.tryPromise({
    try: () => verifyAsync(signature, message, key, { zip215: false }),
    catch: cryptoError,
  });
});

function encodePublicKeyPem(publicKey: Uint8Array): string {
  if (publicKey.length !== ED25519_PUBLIC_KEY_BYTES) throw new Error("The Ed25519 public key is invalid.");
  const spki = new Uint8Array(ED25519_SPKI_PREFIX.length + publicKey.length);
  spki.set(ED25519_SPKI_PREFIX);
  spki.set(publicKey, ED25519_SPKI_PREFIX.length);
  const base64 = bytesToBase64(spki);
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `${PUBLIC_KEY_HEADER}\n${lines.join("\n")}\n${PUBLIC_KEY_FOOTER}`;
}

function decodePublicKeyPem(pem: string): Uint8Array {
  const trimmed = pem.trim();
  if (!trimmed.startsWith(PUBLIC_KEY_HEADER) || !trimmed.endsWith(PUBLIC_KEY_FOOTER)) {
    throw new Error("The server returned an invalid Ed25519 public key.");
  }
  const encoded = trimmed
    .slice(PUBLIC_KEY_HEADER.length, -PUBLIC_KEY_FOOTER.length)
    .replaceAll("\n", "")
    .replaceAll("\r", "")
    .replaceAll(" ", "")
    .trim();
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
    throw new Error("The server returned an invalid Ed25519 public key.");
  }
  let spki: Uint8Array;
  try {
    spki = base64ToBytes(encoded);
  } catch {
    throw new Error("The server returned an invalid Ed25519 public key.");
  }
  if (spki.length !== ED25519_SPKI_PREFIX.length + ED25519_PUBLIC_KEY_BYTES) {
    throw new Error("The server returned an invalid Ed25519 public key.");
  }
  for (let index = 0; index < ED25519_SPKI_PREFIX.length; index += 1) {
    if (spki[index] !== ED25519_SPKI_PREFIX[index]) {
      throw new Error("The server returned an invalid Ed25519 public key.");
    }
  }
  return spki.slice(ED25519_SPKI_PREFIX.length);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
