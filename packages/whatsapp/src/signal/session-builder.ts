// X3DH session setup (signal.org/docs/specifications/x3dh) as WhatsApp uses it: the initiator builds a
// state from a prekey bundle, and the responder builds the same state from a PreKeySignalMessage.

import { concatBytes } from "./crypto";
import { type CurveKeyPair, sharedKey, verify, withKeyType } from "./curve";
import { initialRootKey, rootStep } from "./kdf";
import type { PreKeySignalMessage } from "./messages";
import type { SessionState } from "./session-record";

/** Makes a new key pair. Tests give a fixed sequence; production uses random keys. */
export type KeyPairSource = () => CurveKeyPair;

export interface PreKeyBundle {
  registrationId: number;
  /** 32 or 33 bytes. */
  identityKey: Uint8Array;
  signedPreKey: { keyId: number; publicKey: Uint8Array; signature: Uint8Array };
  /** Undefined, or ID 0, means no one-time prekey. */
  preKey: { keyId: number; publicKey: Uint8Array } | undefined;
}

export class InvalidSignedPreKeyError extends Error {
  constructor() {
    super("Invalid signature on the signed prekey of the bundle");
    this.name = "InvalidSignedPreKeyError";
  }
}

/** The X3DH "F" prefix for X25519: 32 bytes of 0xFF. */
const DISCONTINUITY = new Uint8Array(32).fill(0xff);

/**
 * Initiator side. Checks the signed prekey signature (X3DH requires it), draws the base key and
 * then the first sending ratchet key, and returns a state with pending prekey data.
 */
export function initiateSession(
  identityPrivateKey: Uint8Array,
  bundle: PreKeyBundle,
  newKeyPair: KeyPairSource,
): SessionState {
  const signedPreKey = withKeyType(bundle.signedPreKey.publicKey);
  if (!verify(bundle.identityKey, signedPreKey, bundle.signedPreKey.signature)) {
    throw new InvalidSignedPreKeyError();
  }
  const preKey = bundle.preKey && bundle.preKey.keyId !== 0 ? bundle.preKey : undefined;
  const baseKey = newKeyPair();
  const ratchetKey = newKeyPair();

  const parts = [
    DISCONTINUITY,
    sharedKey(identityPrivateKey, signedPreKey),
    sharedKey(baseKey.private, bundle.identityKey),
    sharedKey(baseKey.private, signedPreKey),
  ];
  if (preKey) parts.push(sharedKey(baseKey.private, preKey.publicKey));
  const sending = rootStep(initialRootKey(concatBytes(...parts)), sharedKey(ratchetKey.private, signedPreKey));
  const baseKeyPublic = withKeyType(baseKey.public);

  return {
    remoteIdentityKey: withKeyType(bundle.identityKey),
    remoteRegistrationId: bundle.registrationId,
    baseKey: baseKeyPublic,
    rootKey: sending.rootKey,
    localRatchet: { publicKey: withKeyType(ratchetKey.public), privateKey: ratchetKey.private },
    remoteRatchetKey: signedPreKey,
    previousCounter: 0,
    sending: { chainKey: sending.chainKey, nextIndex: 0 },
    receiving: [],
    pendingPreKey: {
      signedPreKeyId: bundle.signedPreKey.keyId,
      preKeyId: preKey?.keyId,
      baseKey: baseKeyPublic,
    },
  };
}

/**
 * Responder side. The state has no sending chain: the first decrypted message makes a ratchet step.
 * `oneTimePreKey` must be the key that the message names.
 */
export function respondSession(
  identityPrivateKey: Uint8Array,
  signedPreKey: CurveKeyPair,
  oneTimePreKey: CurveKeyPair | undefined,
  message: PreKeySignalMessage,
): SessionState {
  if ((message.preKeyId === undefined) !== (oneTimePreKey === undefined)) {
    throw new Error("One-time prekey does not match the message");
  }
  const parts = [
    DISCONTINUITY,
    sharedKey(signedPreKey.private, message.identityKey),
    sharedKey(identityPrivateKey, message.baseKey),
    sharedKey(signedPreKey.private, message.baseKey),
  ];
  if (oneTimePreKey) parts.push(sharedKey(oneTimePreKey.private, message.baseKey));

  return {
    remoteIdentityKey: message.identityKey,
    remoteRegistrationId: message.registrationId,
    baseKey: message.baseKey,
    rootKey: initialRootKey(concatBytes(...parts)),
    localRatchet: { publicKey: withKeyType(signedPreKey.public), privateKey: signedPreKey.private },
    remoteRatchetKey: undefined,
    previousCounter: 0,
    sending: undefined,
    receiving: [],
    pendingPreKey: undefined,
  };
}
