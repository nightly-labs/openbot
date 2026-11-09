// Two-step (TOTP, RFC 6238) codes for a Vault login. The key is a base32 setup key or an
// `otpauth://totp/` link, as a site shows it under its QR code. Main makes the codes from a saved key;
// the window makes them only from a key that the user typed in the setup dialog and has not saved.
// `crypto.subtle` is in Node, Electron and every browser, so one helper serves all of them.

export type TwoStepAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export interface TwoStepKey {
  secret: Uint8Array<ArrayBuffer>;
  algorithm: TwoStepAlgorithm;
  /** 6–8. */
  digits: number;
  /** Seconds that one code is valid. */
  period: number;
}

/** The longest key text that the Vault keeps, an `otpauth:` link included. */
export const TWO_STEP_KEY_LIMIT = 1024;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** 80 bits, the shortest key that sites give. A shorter text is more likely a typing error. */
const MINIMUM_KEY_CHARACTERS = 16;
const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;
const ALGORITHMS: Readonly<Record<string, TwoStepAlgorithm>> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

function cleanBase32(text: string): string | null {
  const clean = text.replace(/[\s-]/gu, "").replace(/=+$/u, "").toUpperCase();
  return clean.length >= MINIMUM_KEY_CHARACTERS && /^[A-Z2-7]+$/u.test(clean) ? clean : null;
}

function base32Bytes(clean: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    value = ((value << 5) | BASE32.indexOf(char)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bytes[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return bytes;
}

interface KeyParts {
  base32: string;
  algorithm: TwoStepAlgorithm;
  digits: number;
  period: number;
}

function integerParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d+$/u.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

function keyParts(text: string): KeyParts | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > TWO_STEP_KEY_LIMIT) return null;
  if (!/^otpauth:\/\//iu.test(trimmed)) {
    const base32 = cleanBase32(trimmed);
    return base32 ? { base32, algorithm: "SHA-1", digits: DEFAULT_DIGITS, period: DEFAULT_PERIOD } : null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // A counter (`hotp`) key needs a saved counter, and sites use time keys.
  if (url.host.toLowerCase() !== "totp") return null;
  const base32 = cleanBase32(url.searchParams.get("secret") ?? "");
  const algorithm = ALGORITHMS[(url.searchParams.get("algorithm") ?? "SHA1").toUpperCase()];
  const digits = integerParam(url.searchParams, "digits", DEFAULT_DIGITS, 6, 8);
  const period = integerParam(url.searchParams, "period", DEFAULT_PERIOD, 10, 300);
  if (!base32 || !algorithm || digits === null || period === null) return null;
  return { base32, algorithm, digits, period };
}

/** A setup key or an `otpauth://totp/` link, or null when the text is neither. */
export function parseTwoStepKey(text: string): TwoStepKey | null {
  const parts = keyParts(text);
  return parts
    ? { secret: base32Bytes(parts.base32), algorithm: parts.algorithm, digits: parts.digits, period: parts.period }
    : null;
}

/**
 * The text that the Vault saves for a key: the base32 key alone for the usual settings, else a
 * short `otpauth:` link with the settings. The account and issuer are not kept. Null for no key.
 */
export function normalizeTwoStepKey(text: string): string | null {
  const parts = keyParts(text);
  if (!parts) return null;
  if (parts.algorithm === "SHA-1" && parts.digits === DEFAULT_DIGITS && parts.period === DEFAULT_PERIOD)
    return parts.base32;
  const algorithm = parts.algorithm.replace("-", "");
  return `otpauth://totp/OpenBot?secret=${parts.base32}&algorithm=${algorithm}&digits=${parts.digits}&period=${parts.period}`;
}

/** The base32 key in a saved key text, for secret redaction. Null for no key. */
export function twoStepKeySecret(text: string): string | null {
  return keyParts(text)?.base32 ?? null;
}

/** The code at `at` (milliseconds since 1970). */
export async function twoStepCode(key: TwoStepKey, at: number): Promise<string> {
  const counter = Math.floor(at / 1000 / key.period);
  const message = new DataView(new ArrayBuffer(8));
  message.setUint32(0, Math.floor(counter / 2 ** 32));
  message.setUint32(4, counter >>> 0);
  const cryptoKey = await crypto.subtle.importKey("raw", key.secret, { name: "HMAC", hash: key.algorithm }, false, [
    "sign",
  ]);
  const mac = new DataView(await crypto.subtle.sign("HMAC", cryptoKey, message.buffer));
  const offset = mac.getUint8(mac.byteLength - 1) & 0x0f;
  return String((mac.getUint32(offset) & 0x7fffffff) % 10 ** key.digits).padStart(key.digits, "0");
}

/** Milliseconds until the next code. */
export function twoStepRemainingMs(period: number, at: number): number {
  const periodMs = period * 1000;
  return periodMs - (at % periodMs);
}

/** A code in two groups, as authenticator apps show it: `123 456`. */
export function groupedTwoStepCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}
