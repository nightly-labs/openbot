/** The part of the `libsignal` API that Baileys uses. Byte values are Buffers or Uint8Arrays. */
export interface KeyPair {
  pubKey: Uint8Array;
  privKey: Uint8Array;
}

/** The storage that Baileys passes: it loads and stores a session as a `SessionRecord`. */
export interface SignalStorage {
  loadSession(address: string): Promise<SessionRecord | null | undefined> | SessionRecord | null | undefined;
  storeSession(address: string, record: SessionRecord): Promise<void> | void;
  getOurIdentity(): Promise<KeyPair> | KeyPair;
  getOurRegistrationId(): Promise<number> | number;
  isTrustedIdentity(name: string, identityKey: Uint8Array, direction: number): Promise<boolean> | boolean;
  loadPreKey(id: number): Promise<KeyPair | null | undefined> | KeyPair | null | undefined;
  removePreKey(id: number): Promise<void> | void;
  loadSignedPreKey(id: number): Promise<KeyPair | null | undefined> | KeyPair | null | undefined;
}

export interface PreKeyBundle {
  registrationId: number;
  identityKey: Uint8Array;
  signedPreKey: { keyId: number; publicKey: Uint8Array; signature: Uint8Array };
  preKey?: { keyId: number; publicKey: Uint8Array };
}

export class ProtocolAddress {
  static from(encoded: string): ProtocolAddress;
  constructor(id: string, deviceId: number);
  readonly id: string;
  readonly deviceId: number;
  toString(): string;
  is(other: unknown): boolean;
}

export class SessionRecord {
  static deserialize(data: SessionRecord | Uint8Array): SessionRecord;
  constructor(bytes?: Buffer | null);
  serialize(): Buffer;
  haveOpenSession(): boolean;
  getOpenSession(): { registrationId: number; indexInfo: { baseKey: Buffer | undefined } } | undefined;
}

export class SessionCipher {
  constructor(storage: SignalStorage, address: ProtocolAddress);
  /** `type` is 3 for a prekey message and 1 for a Whisper message, as in libsignal-node. */
  encrypt(data: Uint8Array): Promise<{ type: number; body: Buffer }>;
  decryptWhisperMessage(data: Uint8Array): Promise<Buffer>;
  decryptPreKeyWhisperMessage(data: Uint8Array): Promise<Buffer>;
  hasOpenSession(): Promise<boolean>;
}

export class SessionBuilder {
  constructor(storage: SignalStorage, address: ProtocolAddress);
  initOutgoing(device: PreKeyBundle): Promise<void>;
}
