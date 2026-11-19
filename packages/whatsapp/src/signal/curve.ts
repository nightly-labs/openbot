import { invert, mod } from "@noble/curves/abstract/modular.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { bytesToNumberLE, numberToBytesLE } from "@noble/curves/utils.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";

export const DJB_KEY_TYPE = 0x05;

const FIELD_PRIME = 2n ** 255n - 19n;
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
const Point = ed25519.Point;

export interface CurveKeyPair {
  public: Uint8Array;
  private: Uint8Array;
}

export function generateKeyPair(): CurveKeyPair {
  const privateKey = clamp(randomBytes(32));
  return { public: x25519.getPublicKey(privateKey), private: privateKey };
}

export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(clamp(checkPrivateKey(privateKey)));
}

export function sharedKey(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(clamp(checkPrivateKey(privateKey)), stripKeyType(publicKey));
}

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
    if (((fixed[63] ?? 0) & 0xe0) !== 0) return false;
    return ed25519.verify(fixed, message, edwards, { zip215: false });
  } catch {
    return false;
  }
}

function stripKeyType(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === 32) return publicKey;
  if (publicKey.length === 33 && publicKey[0] === DJB_KEY_TYPE) return publicKey.subarray(1);
  throw new Error(`Invalid Curve25519 public key (${publicKey.length} bytes)`);
}

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
