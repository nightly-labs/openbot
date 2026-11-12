// Wire formats of the Signal messages that WhatsApp uses: SignalMessage (`msg`),
// PreKeySignalMessage (`pkmsg`), SenderKeyMessage (`skmsg`) and SenderKeyDistributionMessage.
// Every serialized message starts with the version byte 0x33. Public keys on the wire have 33 bytes
// with the type byte 0x05. A missing integer field has the protobuf default 0.

import { DJB_KEY_TYPE } from "./curve";
import { ProtoFields, ProtoWriter } from "./protobuf";

const VERSION_BYTE = 0x33;
export const MAC_LENGTH = 8;
const SIGNATURE_LENGTH = 64;

export interface SignalMessage {
  ratchetKey: Uint8Array;
  counter: number;
  previousCounter: number;
  ciphertext: Uint8Array;
}

export interface ParsedSignalMessage extends SignalMessage {
  /** Version byte and protobuf bytes as received: the MAC covers these bytes. */
  body: Uint8Array;
  mac: Uint8Array;
}

export interface PreKeySignalMessage {
  /** One-time prekey ID, or undefined when the sender used no one-time prekey. */
  preKeyId: number | undefined;
  baseKey: Uint8Array;
  identityKey: Uint8Array;
  /** The complete serialized SignalMessage, with its version byte and MAC. */
  message: Uint8Array;
  registrationId: number;
  signedPreKeyId: number;
}

export interface SenderKeyMessage {
  keyId: number;
  iteration: number;
  ciphertext: Uint8Array;
}

export interface ParsedSenderKeyMessage extends SenderKeyMessage {
  /** Version byte and protobuf bytes as received: the signature covers these bytes. */
  signed: Uint8Array;
  signature: Uint8Array;
}

export interface SenderKeyDistributionMessage {
  keyId: number;
  iteration: number;
  chainKey: Uint8Array;
  /** 33-byte signing public key. */
  signingKey: Uint8Array;
}

/** Returns the version byte and the protobuf of a SignalMessage, without the MAC. */
export function encodeSignalMessageBody(message: SignalMessage): Uint8Array {
  return withVersion(
    new ProtoWriter()
      .bytes(1, message.ratchetKey)
      .uint32(2, message.counter)
      .uint32(3, message.previousCounter)
      .bytes(4, message.ciphertext)
      .finish(),
  );
}

export function decodeSignalMessage(serialized: Uint8Array): ParsedSignalMessage {
  if (serialized.length < 1 + MAC_LENGTH) throw new Error("SignalMessage is too short");
  checkVersion(serialized);
  const body = serialized.subarray(0, serialized.length - MAC_LENGTH);
  const fields = new ProtoFields(body.subarray(1));
  return {
    ratchetKey: requireWireKey(fields.requireBytes(1, "ratchetKey"), "ratchetKey"),
    counter: fields.uint32(2) ?? 0,
    previousCounter: fields.uint32(3) ?? 0,
    ciphertext: fields.requireBytes(4, "ciphertext"),
    body,
    mac: serialized.subarray(serialized.length - MAC_LENGTH),
  };
}

export function encodePreKeySignalMessage(message: PreKeySignalMessage): Uint8Array {
  const writer = new ProtoWriter();
  if (message.preKeyId !== undefined) writer.uint32(1, message.preKeyId);
  writer
    .bytes(2, message.baseKey)
    .bytes(3, message.identityKey)
    .bytes(4, message.message)
    .uint32(5, message.registrationId)
    .uint32(6, message.signedPreKeyId);
  return withVersion(writer.finish());
}

export function decodePreKeySignalMessage(serialized: Uint8Array): PreKeySignalMessage {
  checkVersion(serialized);
  const fields = new ProtoFields(serialized.subarray(1));
  const preKeyId = fields.uint32(1);
  return {
    // Prekey ID 0 means "no one-time prekey".
    preKeyId: preKeyId ? preKeyId : undefined,
    baseKey: requireWireKey(fields.requireBytes(2, "baseKey"), "baseKey"),
    identityKey: requireWireKey(fields.requireBytes(3, "identityKey"), "identityKey"),
    message: fields.requireBytes(4, "message"),
    registrationId: fields.uint32(5) ?? 0,
    signedPreKeyId: fields.uint32(6) ?? 0,
  };
}

/** Returns the version byte and the protobuf of a SenderKeyMessage, without the signature. */
export function encodeSenderKeyMessageBody(message: SenderKeyMessage): Uint8Array {
  return withVersion(
    new ProtoWriter().uint32(1, message.keyId).uint32(2, message.iteration).bytes(3, message.ciphertext).finish(),
  );
}

export function decodeSenderKeyMessage(serialized: Uint8Array): ParsedSenderKeyMessage {
  if (serialized.length < 1 + SIGNATURE_LENGTH) throw new Error("SenderKeyMessage is too short");
  checkVersion(serialized);
  const signed = serialized.subarray(0, serialized.length - SIGNATURE_LENGTH);
  const fields = new ProtoFields(signed.subarray(1));
  return {
    keyId: fields.uint32(1) ?? 0,
    iteration: fields.uint32(2) ?? 0,
    ciphertext: fields.requireBytes(3, "ciphertext"),
    signed,
    signature: serialized.subarray(serialized.length - SIGNATURE_LENGTH),
  };
}

export function encodeSenderKeyDistributionMessage(message: SenderKeyDistributionMessage): Uint8Array {
  return withVersion(
    new ProtoWriter()
      .uint32(1, message.keyId)
      .uint32(2, message.iteration)
      .bytes(3, message.chainKey)
      .bytes(4, message.signingKey)
      .finish(),
  );
}

export function decodeSenderKeyDistributionMessage(serialized: Uint8Array): SenderKeyDistributionMessage {
  checkVersion(serialized);
  const fields = new ProtoFields(serialized.subarray(1));
  const chainKey = fields.requireBytes(3, "chainKey");
  if (chainKey.length !== 32) throw new Error("SenderKeyDistributionMessage: chain key is not 32 bytes");
  return {
    keyId: fields.uint32(1) ?? 0,
    iteration: fields.uint32(2) ?? 0,
    chainKey,
    signingKey: requireWireKey(fields.requireBytes(4, "signingKey"), "signingKey"),
  };
}

/** Accepts a message only when both nibbles of the version byte are 3. */
function checkVersion(serialized: Uint8Array): void {
  const version = serialized[0];
  if (version !== VERSION_BYTE) {
    throw new Error(`Unsupported Signal message version byte ${version === undefined ? "(none)" : version}`);
  }
}

function withVersion(protobuf: Uint8Array): Uint8Array {
  const out = new Uint8Array(protobuf.length + 1);
  out[0] = VERSION_BYTE;
  out.set(protobuf, 1);
  return out;
}

function requireWireKey(key: Uint8Array, name: string): Uint8Array {
  if (key.length !== 33 || key[0] !== DJB_KEY_TYPE) throw new Error(`Invalid ${name}: expected 33 bytes with 0x05`);
  return key;
}
