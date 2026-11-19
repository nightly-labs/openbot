import { hkdf, hmacSha256 } from "./crypto";

const MESSAGE_KEY_SEED = Uint8Array.of(0x01);
const CHAIN_KEY_SEED = Uint8Array.of(0x02);

export function initialRootKey(masterSecretInput: Uint8Array): Uint8Array {
  return hkdf(masterSecretInput, "WhisperText", 64).slice(0, 32);
}

export function rootStep(rootKey: Uint8Array, dhOutput: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array } {
  const out = hkdf(dhOutput, "WhisperRatchet", 64, rootKey);
  return { rootKey: out.slice(0, 32), chainKey: out.slice(32, 64) };
}

export function chainStep(chainKey: Uint8Array): { seed: Uint8Array; next: Uint8Array } {
  return { seed: hmacSha256(chainKey, MESSAGE_KEY_SEED), next: hmacSha256(chainKey, CHAIN_KEY_SEED) };
}

export function messageKeys(seed: Uint8Array): { cipherKey: Uint8Array; macKey: Uint8Array; iv: Uint8Array } {
  const out = hkdf(seed, "WhisperMessageKeys", 80);
  return { cipherKey: out.slice(0, 32), macKey: out.slice(32, 64), iv: out.slice(64, 80) };
}

export function senderMessageKeys(seed: Uint8Array): { iv: Uint8Array; cipherKey: Uint8Array } {
  const out = hkdf(seed, "WhisperGroup", 48);
  return { iv: out.slice(0, 16), cipherKey: out.slice(16, 48) };
}
