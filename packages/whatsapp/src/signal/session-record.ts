import { ProtoFields, ProtoWriter } from "./protobuf";

const RECORD_FORMAT = 1;
const MAX_SESSION_STATES = 40;
export const MAX_RECEIVING_CHAINS = 5;
export const MAX_SKIPPED_MESSAGE_KEYS = 2000;
export const MAX_FORWARD_JUMP = 2000;

interface RatchetKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

interface SendingChain {
  chainKey: Uint8Array;
  nextIndex: number;
}

export interface ReceivingChain {
  ratchetKey: Uint8Array;
  chainKey: Uint8Array | undefined;
  nextIndex: number;
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
  baseKey: Uint8Array;
  rootKey: Uint8Array;
  localRatchet: RatchetKeyPair;
  remoteRatchetKey: Uint8Array | undefined;
  previousCounter: number;
  sending: SendingChain | undefined;
  receiving: ReceivingChain[];
  pendingPreKey: PendingPreKey | undefined;
}

export interface SessionRecord {
  states: SessionState[];
}

export function addCurrentState(record: SessionRecord, state: SessionState): void {
  record.states.unshift(state);
  if (record.states.length > MAX_SESSION_STATES) record.states.length = MAX_SESSION_STATES;
}

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
