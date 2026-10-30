// Pairwise session states and the record that holds them for one remote address, with OpenBot's own
// versioned binary format. A record has one current state and archived states (newest first).

import { ProtoFields, ProtoWriter } from "./protobuf";

/** OpenBot session record format 1. */
const RECORD_FORMAT = 1;
/** Current state plus archived states. */
const MAX_SESSION_STATES = 40;
export const MAX_RECEIVING_CHAINS = 5;
export const MAX_SKIPPED_MESSAGE_KEYS = 2000;
/** Largest accepted step from the last derived index of a chain to a message counter. */
export const MAX_FORWARD_JUMP = 2000;

interface RatchetKeyPair {
  /** 33 bytes with the type byte 0x05. */
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

interface SendingChain {
  chainKey: Uint8Array;
  /** Counter of the next message. */
  nextIndex: number;
}

export interface ReceivingChain {
  ratchetKey: Uint8Array;
  /** Undefined when the chain is closed: no more keys can be derived. */
  chainKey: Uint8Array | undefined;
  /** Index of the next message key to derive. */
  nextIndex: number;
  /** Message key seeds of skipped messages by counter, oldest first. */
  skipped: Map<number, Uint8Array>;
}

interface PendingPreKey {
  signedPreKeyId: number;
  preKeyId: number | undefined;
  baseKey: Uint8Array;
}

export interface SessionState {
  remoteIdentityKey: Uint8Array;
  remoteRegistrationId: number;
  /** The initiator's base key. It identifies the state between two devices. */
  baseKey: Uint8Array;
  rootKey: Uint8Array;
  localRatchet: RatchetKeyPair;
  /** Undefined only for a responder state before its first message. */
  remoteRatchetKey: Uint8Array | undefined;
  previousCounter: number;
  sending: SendingChain | undefined;
  /** Oldest first. */
  receiving: ReceivingChain[];
  /** Set while the initiator has not decrypted a message on this state. */
  pendingPreKey: PendingPreKey | undefined;
}

export interface SessionRecord {
  /** `states[0]` is the current state; the others are archived, newest first. */
  states: SessionState[];
}

/** Makes `state` current and archives the old current state. */
export function addCurrentState(record: SessionRecord, state: SessionState): void {
  record.states.unshift(state);
  if (record.states.length > MAX_SESSION_STATES) record.states.length = MAX_SESSION_STATES;
}

/** Replaces the state at `index` with `state` and makes it current. */
export function promoteState(record: SessionRecord, index: number, state: SessionState): void {
  record.states.splice(index, 1);
  record.states.unshift(state);
}

export function cloneState(state: SessionState): SessionState {
  return structuredClone(state);
}

export function serializeSessionRecord(record: SessionRecord): Uint8Array {
  const writer = new ProtoWriter().uint32(1, RECORD_FORMAT);
  for (const state of record.states) writer.bytes(2, encodeState(state));
  return writer.finish();
}

export function deserializeSessionRecord(bytes: Uint8Array): SessionRecord {
  const fields = new ProtoFields(bytes);
  const format = fields.uint32(1);
  if (format !== RECORD_FORMAT) throw new Error(`Unknown session record format ${format ?? "(none)"}`);
  return { states: fields.repeatedBytes(2).map(decodeState) };
}

function encodeState(state: SessionState): Uint8Array {
  const writer = new ProtoWriter()
    .bytes(1, state.remoteIdentityKey)
    .uint32(2, state.remoteRegistrationId)
    .bytes(3, state.baseKey)
    .bytes(4, state.rootKey)
    .bytes(5, state.localRatchet.publicKey)
    .bytes(6, state.localRatchet.privateKey)
    .uint32(8, state.previousCounter);
  if (state.remoteRatchetKey) writer.bytes(7, state.remoteRatchetKey);
  if (state.sending) {
    writer.bytes(9, new ProtoWriter().bytes(1, state.sending.chainKey).uint32(2, state.sending.nextIndex).finish());
  }
  for (const chain of state.receiving) {
    const chainWriter = new ProtoWriter().bytes(1, chain.ratchetKey).uint32(3, chain.nextIndex);
    if (chain.chainKey) chainWriter.bytes(2, chain.chainKey);
    for (const [index, seed] of chain.skipped) {
      chainWriter.bytes(4, new ProtoWriter().uint32(1, index).bytes(2, seed).finish());
    }
    writer.bytes(10, chainWriter.finish());
  }
  if (state.pendingPreKey) {
    const pending = new ProtoWriter()
      .uint32(1, state.pendingPreKey.signedPreKeyId)
      .bytes(3, state.pendingPreKey.baseKey);
    if (state.pendingPreKey.preKeyId !== undefined) pending.uint32(2, state.pendingPreKey.preKeyId);
    writer.bytes(11, pending.finish());
  }
  return writer.finish();
}

function decodeState(bytes: Uint8Array): SessionState {
  const fields = new ProtoFields(bytes);
  const sendingBytes = fields.bytes(9);
  const sendingFields = sendingBytes ? new ProtoFields(sendingBytes) : undefined;
  const pendingBytes = fields.bytes(11);
  const pendingFields = pendingBytes ? new ProtoFields(pendingBytes) : undefined;
  return {
    remoteIdentityKey: fields.requireBytes(1, "remoteIdentityKey"),
    remoteRegistrationId: fields.requireUint32(2, "remoteRegistrationId"),
    baseKey: fields.requireBytes(3, "baseKey"),
    rootKey: fields.requireBytes(4, "rootKey"),
    localRatchet: {
      publicKey: fields.requireBytes(5, "localRatchet.publicKey"),
      privateKey: fields.requireBytes(6, "localRatchet.privateKey"),
    },
    remoteRatchetKey: fields.bytes(7),
    previousCounter: fields.requireUint32(8, "previousCounter"),
    sending: sendingFields
      ? {
          chainKey: sendingFields.requireBytes(1, "sending.chainKey"),
          nextIndex: sendingFields.requireUint32(2, "sending.nextIndex"),
        }
      : undefined,
    receiving: fields.repeatedBytes(10).map((chainBytes) => {
      const chain = new ProtoFields(chainBytes);
      const skipped = new Map<number, Uint8Array>();
      for (const entryBytes of chain.repeatedBytes(4)) {
        const entry = new ProtoFields(entryBytes);
        skipped.set(entry.requireUint32(1, "skipped.index"), entry.requireBytes(2, "skipped.seed"));
      }
      return {
        ratchetKey: chain.requireBytes(1, "receiving.ratchetKey"),
        chainKey: chain.bytes(2),
        nextIndex: chain.requireUint32(3, "receiving.nextIndex"),
        skipped,
      };
    }),
    pendingPreKey: pendingFields
      ? {
          signedPreKeyId: pendingFields.requireUint32(1, "pendingPreKey.signedPreKeyId"),
          preKeyId: pendingFields.uint32(2),
          baseKey: pendingFields.requireBytes(3, "pendingPreKey.baseKey"),
        }
      : undefined,
  };
}
