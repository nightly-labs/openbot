import { concatBytes } from "./crypto";
import { type CurveKeyPair, sharedKey, verify, withKeyType } from "./curve";
import { initialRootKey, rootStep } from "./kdf";
import type { PreKeySignalMessage } from "./messages";
import type { SessionState } from "./session-record";

export type KeyPairSource = () => CurveKeyPair;

export interface PreKeyBundle {
  registrationId: number;
  identityKey: Uint8Array;
  signedPreKey: { keyId: number; publicKey: Uint8Array; signature: Uint8Array };
  preKey: { keyId: number; publicKey: Uint8Array } | undefined;
}

export class InvalidSignedPreKeyError extends Error {
  constructor() {
    super("Invalid signature on the signed prekey of the bundle");
    this.name = "InvalidSignedPreKeyError";
  }
}

const DISCONTINUITY = new Uint8Array(32).fill(0xff);

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
