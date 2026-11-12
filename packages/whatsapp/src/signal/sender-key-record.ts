// Sender key states for one (group, sender) pair, with OpenBot's own versioned binary format.
// Our own record holds one state with the signing private key. A received record holds up to five
// states, oldest first.

import { ProtoFields, ProtoWriter } from "./protobuf";

/** OpenBot sender key record format 1. */
const RECORD_FORMAT = 1;
export const MAX_SENDER_KEY_STATES = 5;
export const MAX_SENDER_MESSAGE_KEYS = 2000;
/** Largest accepted step from the current chain iteration to a message iteration. */
export const MAX_SENDER_FORWARD_JUMP = 2000;

export interface SenderKeyState {
  keyId: number;
  /** Iteration of the current chain key. */
  iteration: number;
  chainKey: Uint8Array;
  /** 33 bytes with the type byte 0x05. */
  signingPublicKey: Uint8Array;
  /** Set only for our own sender key. */
  signingPrivateKey: Uint8Array | undefined;
  /** Message key seeds of skipped iterations, oldest first. */
  skipped: Map<number, Uint8Array>;
}

export interface SenderKeyRecord {
  states: SenderKeyState[];
}

export function serializeSenderKeyRecord(record: SenderKeyRecord): Uint8Array {
  const writer = new ProtoWriter().uint32(1, RECORD_FORMAT);
  for (const state of record.states) {
    const stateWriter = new ProtoWriter()
      .uint32(1, state.keyId)
      .uint32(2, state.iteration)
      .bytes(3, state.chainKey)
      .bytes(4, state.signingPublicKey);
    if (state.signingPrivateKey) stateWriter.bytes(5, state.signingPrivateKey);
    for (const [iteration, seed] of state.skipped) {
      stateWriter.bytes(6, new ProtoWriter().uint32(1, iteration).bytes(2, seed).finish());
    }
    writer.bytes(2, stateWriter.finish());
  }
  return writer.finish();
}

export function deserializeSenderKeyRecord(bytes: Uint8Array): SenderKeyRecord {
  const fields = new ProtoFields(bytes);
  const format = fields.uint32(1);
  if (format !== RECORD_FORMAT) throw new Error(`Unknown sender key record format ${format ?? "(none)"}`);
  return {
    states: fields.repeatedBytes(2).map((stateBytes) => {
      const state = new ProtoFields(stateBytes);
      const skipped = new Map<number, Uint8Array>();
      for (const entryBytes of state.repeatedBytes(6)) {
        const entry = new ProtoFields(entryBytes);
        skipped.set(entry.requireUint32(1, "skipped.iteration"), entry.requireBytes(2, "skipped.seed"));
      }
      return {
        keyId: state.requireUint32(1, "keyId"),
        iteration: state.requireUint32(2, "iteration"),
        chainKey: state.requireBytes(3, "chainKey"),
        signingPublicKey: state.requireBytes(4, "signingPublicKey"),
        signingPrivateKey: state.bytes(5),
        skipped,
      };
    }),
  };
}
