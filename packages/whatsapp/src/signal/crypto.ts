// Symmetric primitives of the Signal protocol: HKDF-SHA256 (RFC 5869), HMAC-SHA256 and AES-256-CBC
// with PKCS#7 padding.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

const ZERO_SALT = new Uint8Array(32);

/** HKDF-SHA256. `salt` defaults to 32 zero bytes, as every Signal use gives a 32-byte salt. */
export function hkdf(input: Uint8Array, info: string, length: number, salt: Uint8Array = ZERO_SALT): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", input, salt, info, length));
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(data).digest());
}

export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return concatBytes(cipher.update(plaintext), cipher.final());
}

/** Throws when the key is wrong or the padding is not valid. */
export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return concatBytes(decipher.update(ciphertext), decipher.final());
}

/** Compares two byte strings in constant time for equal lengths. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
