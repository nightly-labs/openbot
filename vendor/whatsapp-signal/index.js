// The `libsignal` API that Baileys uses, on the Signal protocol implementation of
// whatsapp-rust-bridge (MIT). OpenBot installs this package in place of `libsignal`.
//
// Baileys keeps its own storage: it loads a session as a `SessionRecord` (from the bytes it stored)
// and stores one by its `serialize()` bytes. The bridge reads and writes the bytes of a session, so
// each cipher gets an adapter between the two. Every bridge object is freed after its operation.
import * as bridge from "whatsapp-rust-bridge";
import { keyPair, prefixedPublicKey, toBuffer } from "./src/keys.js";
import { RecordStructure } from "./src/protobufs.js";

export class ProtocolAddress {
  static from(encoded) {
    if (typeof encoded !== "string" || !/^.+\.\d+$/u.test(encoded)) throw new Error("Invalid address encoding");
    const index = encoded.lastIndexOf(".");
    return new ProtocolAddress(encoded.slice(0, index), Number(encoded.slice(index + 1)));
  }

  constructor(id, deviceId) {
    if (typeof id !== "string" || id.includes(".")) throw new TypeError("id required for addr");
    if (!Number.isInteger(deviceId) || deviceId < 0) throw new TypeError("number required for deviceId");
    this.id = id;
    this.deviceId = deviceId;
  }

  toString() {
    return `${this.id}.${this.deviceId}`;
  }

  is(other) {
    return other instanceof ProtocolAddress && other.id === this.id && other.deviceId === this.deviceId;
  }
}

/** The stored bytes of one session, as Baileys keeps them. */
export class SessionRecord {
  static deserialize(data) {
    if (data instanceof SessionRecord) return data;
    if (data instanceof Uint8Array) return new SessionRecord(Buffer.from(data));
    throw new Error("Session data in an unknown format");
  }

  constructor(bytes) {
    this.bytes = bytes ?? null;
  }

  serialize() {
    if (this.bytes === null) throw new Error("Empty session");
    return this.bytes;
  }

  haveOpenSession() {
    if (this.bytes === null) return false;
    const record = bridge.SessionRecord.deserialize(this.bytes);
    try {
      return record.haveOpenSession();
    } finally {
      record.free();
    }
  }

  /** The fields of the current session that Baileys reads, or undefined without an open session. */
  getOpenSession() {
    if (!this.haveOpenSession()) return undefined;
    const current = RecordStructure.decode(this.bytes).currentSession;
    if (!current) return undefined;
    return {
      registrationId: current.remoteRegistrationId ?? 0,
      indexInfo: { baseKey: current.aliceBaseKey ? Buffer.from(current.aliceBaseKey) : undefined },
    };
  }
}

function bridgeStorage(storage) {
  return {
    async loadSession(address) {
      const record = await storage.loadSession(address);
      return record ? SessionRecord.deserialize(record).bytes : null;
    },
    async storeSession(address, record) {
      await storage.storeSession(address, new SessionRecord(Buffer.from(record.serialize())));
    },
    async getOurIdentity() {
      return keyPair(await storage.getOurIdentity());
    },
    getOurRegistrationId: () => storage.getOurRegistrationId(),
    isTrustedIdentity: (name, identityKey, direction) =>
      storage.isTrustedIdentity(name, Buffer.from(identityKey), direction),
    async loadPreKey(id) {
      const pair = await storage.loadPreKey(id);
      return pair ? keyPair(pair) : undefined;
    },
    removePreKey: (id) => storage.removePreKey(id),
    async loadSignedPreKey(id) {
      const pair = await storage.loadSignedPreKey(id);
      if (!pair) return undefined;
      // The receiving side of a session needs the private key only; Baileys does not return the signature.
      const signature = pair.signature ? toBuffer(pair.signature) : new Uint8Array(64);
      return { keyId: id, keyPair: keyPair(pair.keyPair ?? pair), signature };
    },
    loadSenderKey() {
      throw new Error("Group sessions are kept by Baileys.");
    },
    storeSenderKey() {
      throw new Error("Group sessions are kept by Baileys.");
    },
  };
}

function bridgeAddress(address) {
  return new bridge.ProtocolAddress(address.id, address.deviceId);
}

async function withBridge(make, use) {
  const value = make();
  try {
    return await use(value);
  } finally {
    value.free();
  }
}

export class SessionCipher {
  constructor(storage, address) {
    this.storage = storage;
    this.address = address;
  }

  #run(use) {
    return withBridge(
      () => bridgeAddress(this.address),
      (address) => withBridge(() => new bridge.SessionCipher(bridgeStorage(this.storage), address), use),
    );
  }

  async encrypt(data) {
    const result = await this.#run((cipher) => cipher.encrypt(toBuffer(data)));
    // libsignal-node names a Whisper message 1; the bridge uses the libsignal (Rust) number 2.
    return { type: result.type === 2 ? 1 : result.type, body: Buffer.from(result.body) };
  }

  async decryptWhisperMessage(data) {
    return Buffer.from(await this.#run((cipher) => cipher.decryptWhisperMessage(toBuffer(data))));
  }

  async decryptPreKeyWhisperMessage(data) {
    return Buffer.from(await this.#run((cipher) => cipher.decryptPreKeyWhisperMessage(toBuffer(data))));
  }

  async hasOpenSession() {
    return this.#run((cipher) => cipher.hasOpenSession());
  }
}

export class SessionBuilder {
  constructor(storage, address) {
    this.storage = storage;
    this.address = address;
  }

  /** Starts a session from a prekey bundle of the other device. */
  async initOutgoing(device) {
    const bundle = {
      registrationId: device.registrationId,
      identityKey: prefixedPublicKey(device.identityKey),
      signedPreKey: {
        keyId: device.signedPreKey.keyId,
        publicKey: prefixedPublicKey(device.signedPreKey.publicKey),
        signature: toBuffer(device.signedPreKey.signature),
      },
      ...(device.preKey
        ? { preKey: { keyId: device.preKey.keyId, publicKey: prefixedPublicKey(device.preKey.publicKey) } }
        : {}),
    };
    await withBridge(
      () => bridgeAddress(this.address),
      (address) =>
        withBridge(
          () => new bridge.SessionBuilder(bridgeStorage(this.storage), address),
          (builder) => builder.initOutgoing(bundle),
        ),
    );
  }
}
