import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const LIVE_ACTIVITY_SECRET_BYTES = 32;
export const LIVE_ACTIVITY_NONCE_BYTES = 16;
const TAG_BYTES = 16;
const BLOCK_BYTES = 32;

export interface LiveActivityKeys {
  seal: Uint8Array;
  tag: Uint8Array;
  action: Uint8Array;
}

export function liveActivityKeys(secret: Uint8Array): LiveActivityKeys {
  if (secret.length !== LIVE_ACTIVITY_SECRET_BYTES) throw new Error("The Live Activity secret has a wrong size.");
  const derive = (label: string) => hmac(sha256, secret, utf8ToBytes(`openbot live activity ${label}`));
  return { seal: derive("seal"), tag: derive("tag"), action: derive("action") };
}

export function liveActivityHostSecret(phoneSecret: Uint8Array, serverId: string): Uint8Array {
  return hmac(sha256, phoneSecret, utf8ToBytes(`openbot live activity host ${serverId}`));
}

export function sealLiveActivity(
  text: string,
  keys: Pick<LiveActivityKeys, "seal" | "tag">,
  nonce: Uint8Array,
): string {
  if (nonce.length !== LIVE_ACTIVITY_NONCE_BYTES) throw new Error("The Live Activity nonce has a wrong size.");
  const plain = utf8ToBytes(text);
  const cipher = new Uint8Array(plain.length);
  for (let offset = 0; offset < plain.length; offset += BLOCK_BYTES) {
    const stream = hmac(sha256, keys.seal, concatBytes(nonce, counter(offset / BLOCK_BYTES)));
    for (let index = 0; index < BLOCK_BYTES && offset + index < plain.length; index += 1) {
      cipher[offset + index] = (plain[offset + index] ?? 0) ^ (stream[index] ?? 0);
    }
  }
  const body = concatBytes(nonce, cipher);
  return base64Url(concatBytes(body, hmac(sha256, keys.tag, body).subarray(0, TAG_BYTES)));
}

export function signLiveActivityLink(payload: string, key: Uint8Array): string {
  return base64Url(hmac(sha256, key, utf8ToBytes(payload)).subarray(0, TAG_BYTES));
}

export function verifyLiveActivityLink(payload: string, signature: string, key: Uint8Array): boolean {
  const expected = signLiveActivityLink(payload, key);
  let difference = expected.length ^ signature.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ (signature.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function encodeLiveActivityBytes(bytes: Uint8Array): string {
  return base64Url(bytes);
}

export function decodeLiveActivityBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((value.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of value) {
    buffer = (buffer << 6) | ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return bytes;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    text += ALPHABET[a >> 2];
    text += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) text += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) text += ALPHABET[c & 63];
  }
  return text;
}

function counter(block: number): Uint8Array {
  return new Uint8Array([(block >>> 24) & 0xff, (block >>> 16) & 0xff, (block >>> 8) & 0xff, block & 0xff]);
}
