// Double Ratchet encryption and decryption of pairwise messages (`msg` and `pkmsg`)
// (signal.org/docs/specifications/doubleratchet), with the WhatsApp interop rules: PN is the last
// counter of the old chain, the MAC has 8 bytes and covers both 33-byte identity keys.

import { aesCbcDecrypt, aesCbcEncrypt, bytesEqual, concatBytes, constantTimeEqual, hmacSha256 } from "./crypto";
import { sharedKey, withKeyType } from "./curve";
import { MessageCounterError } from "./errors";
import { chainStep, messageKeys, rootStep } from "./kdf";
import {
  decodeSignalMessage,
  encodePreKeySignalMessage,
  encodeSignalMessageBody,
  MAC_LENGTH,
  type ParsedSignalMessage,
  type PreKeySignalMessage,
} from "./messages";
import type { KeyPairSource } from "./session-builder";
import {
  addCurrentState,
  cloneState,
  MAX_FORWARD_JUMP,
  MAX_RECEIVING_CHAINS,
  MAX_SKIPPED_MESSAGE_KEYS,
  promoteState,
  type ReceivingChain,
  type SessionRecord,
  type SessionState,
} from "./session-record";

export interface LocalParty {
  /** 33-byte identity public key. */
  identityKey: Uint8Array;
  registrationId: number;
  newKeyPair: KeyPairSource;
}

export interface EncryptedMessage {
  type: "pkmsg" | "msg";
  ciphertext: Uint8Array;
}

/** Encrypts on the current state of `record` and advances its sending chain. */
export function encryptMessage(record: SessionRecord, local: LocalParty, plaintext: Uint8Array): EncryptedMessage {
  const state = record.states[0];
  if (!state?.sending) throw new Error("No open session to encrypt with");
  const { seed, next } = chainStep(state.sending.chainKey);
  const counter = state.sending.nextIndex;
  state.sending = { chainKey: next, nextIndex: counter + 1 };
  const keys = messageKeys(seed);
  const body = encodeSignalMessageBody({
    ratchetKey: state.localRatchet.publicKey,
    counter,
    previousCounter: state.previousCounter,
    ciphertext: aesCbcEncrypt(keys.cipherKey, keys.iv, plaintext),
  });
  const mac = hmacSha256(keys.macKey, concatBytes(local.identityKey, state.remoteIdentityKey, body));
  const message = concatBytes(body, mac.subarray(0, MAC_LENGTH));
  const pending = state.pendingPreKey;
  if (!pending) return { type: "msg", ciphertext: message };
  return {
    type: "pkmsg",
    ciphertext: encodePreKeySignalMessage({
      preKeyId: pending.preKeyId,
      baseKey: pending.baseKey,
      identityKey: local.identityKey,
      message,
      registrationId: local.registrationId,
      signedPreKeyId: pending.signedPreKeyId,
    }),
  };
}

/**
 * Decrypts a `msg`. Tries the current state, then the archived states from newest; the state that
 * works becomes current. `record` changes only on success.
 */
export function decryptSignalMessage(record: SessionRecord, local: LocalParty, serialized: Uint8Array): Uint8Array {
  const message = decodeSignalMessage(serialized);
  const errors: unknown[] = [];
  for (const [index, state] of record.states.entries()) {
    const candidate = cloneState(state);
    try {
      const plaintext = decryptOnState(candidate, local, message);
      promoteState(record, index, candidate);
      return plaintext;
    } catch (error) {
      errors.push(error);
    }
  }
  const counterError = errors.find((error) => error instanceof MessageCounterError);
  if (counterError) throw counterError;
  const first = errors[0];
  throw new Error(
    `No matching session for message (${record.states.length} states)${first instanceof Error ? `: ${first.message}` : ""}`,
  );
}

/**
 * Decrypts a `pkmsg`. A state with the same base key is used again; else `buildState` makes a
 * responder state, which becomes current after the decryption succeeds. `record` changes only on
 * success. `createdState` tells the caller to delete the one-time prekey.
 */
export async function decryptPreKeySignalMessage(
  record: SessionRecord,
  local: LocalParty,
  message: PreKeySignalMessage,
  buildState: () => Promise<SessionState>,
): Promise<{ plaintext: Uint8Array; createdState: boolean }> {
  const inner = decodeSignalMessage(message.message);
  const index = record.states.findIndex((state) => bytesEqual(state.baseKey, message.baseKey));
  const known = record.states[index];
  if (known) {
    const candidate = cloneState(known);
    const plaintext = decryptOnState(candidate, local, inner);
    promoteState(record, index, candidate);
    return { plaintext, createdState: false };
  }
  const state = await buildState();
  const plaintext = decryptOnState(state, local, inner);
  addCurrentState(record, state);
  return { plaintext, createdState: true };
}

/** Decrypts on one state and changes it. Callers give a copy. */
function decryptOnState(state: SessionState, local: LocalParty, message: ParsedSignalMessage): Uint8Array {
  let chain = state.receiving.find((candidate) => bytesEqual(candidate.ratchetKey, message.ratchetKey));
  if (!chain) chain = ratchetStep(state, local, message);
  const keys = messageKeys(takeMessageKey(chain, message.counter));
  const mac = hmacSha256(keys.macKey, concatBytes(state.remoteIdentityKey, local.identityKey, message.body));
  if (!constantTimeEqual(mac.subarray(0, MAC_LENGTH), message.mac)) throw new Error("Bad MAC");
  const plaintext = aesCbcDecrypt(keys.cipherKey, keys.iv, message.ciphertext);
  state.pendingPreKey = undefined;
  return plaintext;
}

/** DH ratchet step for a message with a new ratchet key. Returns the new receiving chain. */
function ratchetStep(state: SessionState, local: LocalParty, message: ParsedSignalMessage): ReceivingChain {
  const remoteRatchetKey = state.remoteRatchetKey;
  const previous = remoteRatchetKey
    ? state.receiving.find((candidate) => bytesEqual(candidate.ratchetKey, remoteRatchetKey))
    : undefined;
  if (previous?.chainKey) {
    // Keep the keys of the old chain up to PN, then close it.
    if (message.previousCounter >= previous.nextIndex) deriveUpTo(previous, message.previousCounter);
    previous.chainKey = undefined;
  }

  const receiving = rootStep(state.rootKey, sharedKey(state.localRatchet.privateKey, message.ratchetKey));
  const chain: ReceivingChain = {
    ratchetKey: message.ratchetKey,
    chainKey: receiving.chainKey,
    nextIndex: 0,
    skipped: new Map(),
  };
  state.receiving.push(chain);
  if (state.receiving.length > MAX_RECEIVING_CHAINS) state.receiving.shift();

  if (state.sending) state.previousCounter = Math.max(state.sending.nextIndex - 1, 0);
  const ratchetKey = local.newKeyPair();
  const sending = rootStep(receiving.rootKey, sharedKey(ratchetKey.private, message.ratchetKey));
  state.rootKey = sending.rootKey;
  state.localRatchet = { publicKey: withKeyType(ratchetKey.public), privateKey: ratchetKey.private };
  state.sending = { chainKey: sending.chainKey, nextIndex: 0 };
  state.remoteRatchetKey = message.ratchetKey;
  return chain;
}

/** Returns the message key seed for `counter` and removes it from the chain. */
function takeMessageKey(chain: ReceivingChain, counter: number): Uint8Array {
  if (counter >= chain.nextIndex) deriveUpTo(chain, counter);
  const seed = chain.skipped.get(counter);
  if (!seed) throw new MessageCounterError();
  chain.skipped.delete(counter);
  return seed;
}

/** Derives and keeps the message keys of `chain` up to and including `index`. */
function deriveUpTo(chain: ReceivingChain, index: number): void {
  if (!chain.chainKey) throw new MessageCounterError();
  if (index - (chain.nextIndex - 1) > MAX_FORWARD_JUMP) {
    throw new Error(`Message counter ${index} is too far ahead of the chain (at ${chain.nextIndex})`);
  }
  let chainKey = chain.chainKey;
  while (chain.nextIndex <= index) {
    const { seed, next } = chainStep(chainKey);
    chain.skipped.set(chain.nextIndex, seed);
    chainKey = next;
    chain.nextIndex += 1;
  }
  chain.chainKey = chainKey;
  // Keep only the newest keys. The key for `index` is the newest, so it stays.
  for (const oldest of chain.skipped.keys()) {
    if (chain.skipped.size <= MAX_SKIPPED_MESSAGE_KEYS) break;
    chain.skipped.delete(oldest);
  }
}
