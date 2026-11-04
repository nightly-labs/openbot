// Key derivations of X3DH, the Double Ratchet and sender key chains.

import { hkdf, hmacSha256 } from "./crypto";

const MESSAGE_KEY_SEED = Uint8Array.of(0x01);
const CHAIN_KEY_SEED = Uint8Array.of(0x02);

/** Root key from the X3DH master secret input. The second 32 bytes of the output are not used. */
export function initialRootKey(masterSecretInput: Uint8Array): Uint8Array {
  return hkdf(masterSecretInput, "WhisperText", 64).slice(0, 32);
}

/** One root KDF step: the new root key and a new chain key. */
export function rootStep(rootKey: Uint8Array, dhOutput: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array } {
  const out = hkdf(dhOutput, "WhisperRatchet", 64, rootKey);
  return { rootKey: out.slice(0, 32), chainKey: out.slice(32, 64) };
}

/** One chain step: the message key seed of this index and the chain key of the next index. */
export function chainStep(chainKey: Uint8Array): { seed: Uint8Array; next: Uint8Array } {
  return { seed: hmacSha256(chainKey, MESSAGE_KEY_SEED), next: hmacSha256(chainKey, CHAIN_KEY_SEED) };
}

/** Pairwise message keys: AES key, MAC key, IV (32/32/16). */
export function messageKeys(seed: Uint8Array): { cipherKey: Uint8Array; macKey: Uint8Array; iv: Uint8Array } {
  const out = hkdf(seed, "WhisperMessageKeys", 80);
  return { cipherKey: out.slice(0, 32), macKey: out.slice(32, 64), iv: out.slice(64, 80) };
}

/** Sender key message keys: IV, then AES key (16/32). The order is not the pairwise order. */
export function senderMessageKeys(seed: Uint8Array): { iv: Uint8Array; cipherKey: Uint8Array } {
  const out = hkdf(seed, "WhisperGroup", 48);
  return { iv: out.slice(0, 16), cipherKey: out.slice(16, 48) };
}
