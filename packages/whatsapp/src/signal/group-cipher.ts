// Group messages with sender keys (`skmsg`) and SenderKeyDistributionMessages. A sender encrypts with
// a symmetric chain and signs each message; receivers get the chain key and the signing public key
// from the distribution message.

import { randomBytes, randomInt } from "node:crypto";
import { aesCbcDecrypt, aesCbcEncrypt, bytesEqual, concatBytes } from "./crypto";
import { type CurveKeyPair, generateKeyPair, sign, verify, withKeyType } from "./curve";
import { MessageCounterError } from "./errors";
import { chainStep, senderMessageKeys } from "./kdf";
import {
  decodeSenderKeyDistributionMessage,
  decodeSenderKeyMessage,
  encodeSenderKeyDistributionMessage,
  encodeSenderKeyMessageBody,
} from "./messages";
import {
  MAX_SENDER_FORWARD_JUMP,
  MAX_SENDER_KEY_STATES,
  MAX_SENDER_MESSAGE_KEYS,
  type SenderKeyRecord,
  type SenderKeyState,
} from "./sender-key-record";

export interface OwnSenderKeyInput {
  keyId: number;
  iteration: number;
  chainKey: Uint8Array;
  signingKeyPair: CurveKeyPair;
}

/** Our own sender key record with one state. Without input, the key ID and keys are random. */
export function createOwnSenderKey(input?: OwnSenderKeyInput): SenderKeyRecord {
  const signingKeyPair = input?.signingKeyPair ?? generateKeyPair();
  return {
    states: [
      {
        keyId: input?.keyId ?? randomInt(0, 2 ** 31 - 1),
        iteration: input?.iteration ?? 0,
        chainKey: input?.chainKey ?? new Uint8Array(randomBytes(32)),
        signingPublicKey: withKeyType(signingKeyPair.public),
        signingPrivateKey: signingKeyPair.private,
        skipped: new Map(),
      },
    ],
  };
}

/** True when the record holds our own sender key. */
export function isOwnSenderKey(record: SenderKeyRecord): boolean {
  return record.states.at(-1)?.signingPrivateKey !== undefined;
}

/** Distribution message for the current iteration and chain key of our own sender key. */
export function createDistributionMessage(record: SenderKeyRecord): Uint8Array {
  const state = ownState(record);
  return encodeSenderKeyDistributionMessage({
    keyId: state.keyId,
    iteration: state.iteration,
    chainKey: state.chainKey,
    signingKey: state.signingPublicKey,
  });
}

/**
 * Adds the state of a received distribution message. A message for a state that the record has
 * (same key ID and signing key) changes nothing, so kept message keys stay.
 */
export function processDistributionMessage(
  record: SenderKeyRecord | undefined,
  serialized: Uint8Array,
): SenderKeyRecord {
  const message = decodeSenderKeyDistributionMessage(serialized);
  const states = record?.states ?? [];
  const known = states.some(
    (state) => state.keyId === message.keyId && bytesEqual(state.signingPublicKey, message.signingKey),
  );
  if (known) return { states };
  const next = [
    ...states,
    {
      keyId: message.keyId,
      iteration: message.iteration,
      chainKey: message.chainKey,
      signingPublicKey: message.signingKey,
      signingPrivateKey: undefined,
      skipped: new Map<number, Uint8Array>(),
    },
  ];
  return { states: next.slice(-MAX_SENDER_KEY_STATES) };
}

/** Encrypts with the current chain iteration, then advances the chain by one. */
export function encryptGroupMessage(record: SenderKeyRecord, plaintext: Uint8Array): Uint8Array {
  const state = ownState(record);
  const signingPrivateKey = state.signingPrivateKey;
  if (!signingPrivateKey) throw new Error("Sender key has no signing private key");
  const { seed, next } = chainStep(state.chainKey);
  const keys = senderMessageKeys(seed);
  const signed = encodeSenderKeyMessageBody({
    keyId: state.keyId,
    iteration: state.iteration,
    ciphertext: aesCbcEncrypt(keys.cipherKey, keys.iv, plaintext),
  });
  state.chainKey = next;
  state.iteration += 1;
  return concatBytes(signed, sign(signingPrivateKey, signed));
}

/** Decrypts an `skmsg`. The record changes only on success. */
export function decryptGroupMessage(record: SenderKeyRecord, serialized: Uint8Array): Uint8Array {
  const message = decodeSenderKeyMessage(serialized);
  const index = record.states.findLastIndex((state) => state.keyId === message.keyId);
  const found = record.states[index];
  if (!found) throw new Error(`No sender key state for key ID ${message.keyId}`);
  if (!verify(found.signingPublicKey, message.signed, message.signature)) {
    throw new Error("Invalid sender key message signature");
  }
  const state = structuredClone(found);
  const keys = senderMessageKeys(takeSenderMessageKey(state, message.iteration));
  const plaintext = aesCbcDecrypt(keys.cipherKey, keys.iv, message.ciphertext);
  record.states[index] = state;
  return plaintext;
}

function ownState(record: SenderKeyRecord): SenderKeyState {
  const state = record.states.at(-1);
  if (!state) throw new Error("Sender key record is empty");
  return state;
}

function takeSenderMessageKey(state: SenderKeyState, iteration: number): Uint8Array {
  if (iteration < state.iteration) {
    const seed = state.skipped.get(iteration);
    if (!seed) throw new MessageCounterError();
    state.skipped.delete(iteration);
    return seed;
  }
  if (iteration - state.iteration > MAX_SENDER_FORWARD_JUMP) {
    throw new Error(`Sender key iteration ${iteration} is too far ahead of the chain (at ${state.iteration})`);
  }
  let chainKey = state.chainKey;
  while (state.iteration < iteration) {
    const { seed, next } = chainStep(chainKey);
    state.skipped.set(state.iteration, seed);
    chainKey = next;
    state.iteration += 1;
  }
  for (const oldest of state.skipped.keys()) {
    if (state.skipped.size <= MAX_SENDER_MESSAGE_KEYS) break;
    state.skipped.delete(oldest);
  }
  const { seed, next } = chainStep(chainKey);
  state.chainKey = next;
  state.iteration = iteration + 1;
  return seed;
}
