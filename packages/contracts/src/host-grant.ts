// The sealed hand-off from the account Worker to one desktop host, for an install that ends in the
// browser, such as the OpenBot Slack or Discord app's.
//
// The host makes a P-256 key pair for one sign-in and sends only the public key. The Worker seals
// the result to it with ECDH, HKDF and AES-GCM, and only the host that holds the private key can open
// it. The host's nonce is the additional data, so a grant opens only for the sign-in that asked for
// it. Each kind of grant has its own HKDF info and version, so one kind never opens as another.
//
// WebCrypto only, so the Worker and the Electron main process run the same code.

import { isDynamicRecord, isString } from "./runtime-values";

const RAW_P256_PUBLIC_KEY_BYTES = 65;

/** What separates one kind of grant from another. */
export interface HostGrantKind {
  version: number;
  info: string;
}

export function isRawP256PublicKey(value: string): boolean {
  try {
    const bytes = fromBase64Url(value);
    return bytes.byteLength === RAW_P256_PUBLIC_KEY_BYTES && bytes[0] === 4;
  } catch {
    return false;
  }
}

export async function createHostGrantKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: toBase64Url(raw) };
}

/**
 * A key pair that the host keeps across restarts. `privateKey` is PKCS #8 in base64url: the host stores
 * it encrypted and opens it with `importHostGrantPrivateKey`.
 */
export async function createStoredHostGrantKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { privateKey: toBase64Url(pkcs8), publicKey: toBase64Url(raw) };
}

export function importHostGrantPrivateKey(privateKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", fromBase64Url(privateKey), { name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
}

export async function sealHostGrant(
  kind: HostGrantKind,
  hostPublicKey: string,
  nonce: string,
  grant: unknown,
): Promise<string> {
  const recipient = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(hostPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const key = await contentKey(kind, ephemeral.privateKey, recipient, ephemeralPublic);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(grant));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(nonce) },
      key,
      plaintext,
    ),
  );
  return toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        v: kind.version,
        epk: toBase64Url(ephemeralPublic),
        iv: toBase64Url(iv),
        ct: toBase64Url(ciphertext),
      }),
    ),
  );
}

/**
 * The grant, checked by `decode`. Throws for a payload that another key sealed, that another sign-in
 * asked for, that is another kind, that was changed, or that `decode` refuses.
 */
export async function openHostGrant<T>(
  kind: HostGrantKind,
  privateKey: CryptoKey,
  nonce: string,
  payload: string,
  decode: (value: unknown) => T,
): Promise<T> {
  const envelope = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  if (
    !isDynamicRecord(envelope) ||
    envelope.v !== kind.version ||
    !isString(envelope.epk) ||
    !isString(envelope.iv) ||
    !isString(envelope.ct)
  ) {
    throw new Error("The grant is invalid.");
  }
  const ephemeralPublic = fromBase64Url(envelope.epk);
  const sender = await crypto.subtle.importKey(
    "raw",
    ephemeralPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const key = await contentKey(kind, privateKey, sender, ephemeralPublic);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(envelope.iv), additionalData: new TextEncoder().encode(nonce) },
    key,
    fromBase64Url(envelope.ct),
  );
  return decode(JSON.parse(new TextDecoder().decode(plaintext)));
}

async function contentKey(
  kind: HostGrantKind,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(kind.info) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new Error("The value is not base64url.");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
