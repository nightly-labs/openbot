// Curve25519 operations for the Signal protocol: X25519 key agreement (RFC 7748) and signatures that
// are compatible with XEdDSA (signal.org/docs/specifications/xeddsa).
//
// Public keys can have 32 bytes, or 33 bytes with the type byte 0x05. Private keys have 32 bytes and
// can be unclamped: each operation clamps the key before use.

import { invert, mod } from "@noble/curves/abstract/modular.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { bytesToNumberLE, numberToBytesLE } from "@noble/curves/utils.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";

/** The type byte of a Curve25519 public key in Signal messages. */
export const DJB_KEY_TYPE = 0x05;

const FIELD_PRIME = 2n ** 255n - 19n;
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
const Point = ed25519.Point;

export interface CurveKeyPair {
  /** 32-byte X25519 public key, without the type byte. */
  public: Uint8Array;
  /** 32-byte private key. */
  private: Uint8Array;
}

/** Makes a new random X25519 key pair. The private key is stored clamped. */
export function generateKeyPair(): CurveKeyPair {
  const privateKey = clamp(randomBytes(32));
  return { public: x25519.getPublicKey(privateKey), private: privateKey };
}

/** Returns the 32-byte X25519 public key of a private key. */
export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(clamp(checkPrivateKey(privateKey)));
}

/** Returns the raw 32-byte X25519 shared value. It is not hashed. */
export function sharedKey(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(clamp(checkPrivateKey(privateKey)), stripKeyType(publicKey));
}

/**
 * Signs `message` with an X25519 private key as XEdDSA specifies: the scalar is negated when the
 * Edwards sign bit of its public key is 1, so byte 63 bit 7 of the signature is always 0. The nonce
 * uses 64 random bytes.
 */
export function sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  const k = bytesToNumberLE(clamp(checkPrivateKey(privateKey))) % GROUP_ORDER;
  const edwards = Point.BASE.multiply(k).toBytes();
  const negate = ((edwards[31] ?? 0) & 0x80) !== 0;
  const a = negate ? GROUP_ORDER - k : k;
  const publicKey = Uint8Array.from(edwards);
  publicKey[31] = (publicKey[31] ?? 0) & 0x7f;
  const aBytes = numberToBytesLE(a, 32);

  const prefix = new Uint8Array(32).fill(0xff);
  prefix[0] = 0xfe;
  const r = bytesToNumberLE(sha512(concatBytes(prefix, aBytes, message, randomBytes(64)))) % GROUP_ORDER;
  const encodedR = Point.BASE.multiply(r).toBytes();
  const h = bytesToNumberLE(sha512(concatBytes(encodedR, publicKey, message))) % GROUP_ORDER;
  const s = (r + h * a) % GROUP_ORDER;
  return concatBytes(encodedR, numberToBytesLE(s, 32));
}

/**
 * Verifies a 64-byte signature. The Edwards sign bit of the signer key comes from byte 63 bit 7 of the
 * signature. Returns false for every invalid input; it never throws.
 */
export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    if (signature.length !== 64) return false;
    const u = bytesToNumberLE(stripKeyType(publicKey)) & ((1n << 255n) - 1n);
    const denominator = mod(u + 1n, FIELD_PRIME);
    if (denominator === 0n) return false;
    const y = mod((u - 1n) * invert(denominator, FIELD_PRIME), FIELD_PRIME);
    const edwards = numberToBytesLE(y, 32);
    const signBit = (signature[63] ?? 0) & 0x80;
    edwards[31] = (edwards[31] ?? 0) | signBit;
    const fixed = Uint8Array.from(signature);
    fixed[63] = (fixed[63] ?? 0) & 0x7f;
    // XEdDSA rejects s >= 2^253.
    if (((fixed[63] ?? 0) & 0xe0) !== 0) return false;
    return ed25519.verify(fixed, message, edwards, { zip215: false });
  } catch {
    return false;
  }
}

/** Removes the 0x05 type byte from a 33-byte public key. A 32-byte key is returned as it is. */
function stripKeyType(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === 32) return publicKey;
  if (publicKey.length === 33 && publicKey[0] === DJB_KEY_TYPE) return publicKey.subarray(1);
  throw new Error(`Invalid Curve25519 public key (${publicKey.length} bytes)`);
}

/** Adds the 0x05 type byte to a 32-byte public key. A 33-byte key must already have it. */
export function withKeyType(publicKey: Uint8Array): Uint8Array {
  const raw = stripKeyType(publicKey);
  const out = new Uint8Array(33);
  out[0] = DJB_KEY_TYPE;
  out.set(raw, 1);
  return out;
}

function checkPrivateKey(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) throw new Error(`Invalid Curve25519 private key (${privateKey.length} bytes)`);
  return privateKey;
}

function clamp(privateKey: Uint8Array): Uint8Array {
  const out = Uint8Array.from(privateKey);
  out[0] = (out[0] ?? 0) & 0xf8;
  out[31] = ((out[31] ?? 0) & 0x7f) | 0x40;
  return out;
}
