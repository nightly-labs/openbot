// Checks the libsignal replacement that Baileys loads (`vendor/whatsapp-signal`): sessions in both
// directions on the real whatsapp-rust-bridge, a changed message that must be refused, messages that
// libsignal-node encrypted (recorded bytes, no libsignal-node code), and the curve, HKDF, AES and HMAC
// functions. A wrong answer here means that WhatsApp messages cannot be decrypted.
//
// `bun scripts/whatsapp-signal-e2e.ts`. Writes .openbot-build/whatsapp-signal-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  type KeyPair,
  ProtocolAddress,
  SessionBuilder,
  SessionCipher,
  SessionRecord,
  type SignalStorage,
} from "../vendor/whatsapp-signal/index.js";
import { calculateMAC, decrypt, deriveSecrets, encrypt } from "../vendor/whatsapp-signal/src/crypto.js";
import {
  calculateAgreement,
  calculateSignature,
  generateKeyPair,
  verifySignature,
} from "../vendor/whatsapp-signal/src/curve.js";

const OUT = resolve(import.meta.dirname, "../.openbot-build/whatsapp-signal-e2e");

/**
 * Bytes that libsignal-node 6.0.0 produced in a separate project: Alice started a session with Bob's
 * prekey bundle and encrypted two messages; Bob signed one message. Only these bytes are kept here.
 */
const LIBSIGNAL_NODE_VECTORS = {
  bob: {
    identity: {
      pubKey: "BfBhl883wcIgpd8c8k37JBoCGFduhQHP+Jdb/vGLMWIl",
      privKey: "kMabUlmlAKLU/U1L35U30caw49HtsoPgQfOlyxlghEo=",
    },
    signedPreKey: {
      keyId: 2,
      pubKey: "BeNPXyTlKVolRw9sT0YoneG+ezJQPnjYsf3kZ/9YuMch",
      privKey: "mEETcqbGBl8398M5f2X1oQT4i8ISODTW2jz5DVHVJH0=",
    },
    preKey: {
      keyId: 9,
      pubKey: "BUcOQNmavaOkXAEofdtNFMdsyJQc6yXGvGZRqdZAERhZ",
      privKey: "8NPyFpZ0GbrK4tvCrMycX1xY6v/BiRgVAm+DZHUyRWY=",
    },
    registrationId: 4321,
  },
  alice: {
    identityPubKey: "BRy6VrmiamR2tWD+eN1sCuYwG3SOgqRk0jUsOoXWYeoJ",
    registrationId: 1234,
  },
  messages: [
    {
      type: 3,
      body: "MwgJEiEF5z2xkqP9MzqZ244BEdXFox9iOJDjyLjIvTYHCLRbhyIaIQUcula5ompkdrVg/njdbArmMBt0joKkZNI1LDqF1mHqCSJiMwohBVagXsQoaWl6x3CZhkIwDyRjaa+KiUUb4FUhNcwSryowEAAYACIwPeuWqBcQSZNbhhN9FJ1rq8JpxEMalE4TSYIM2n/t1LVr40QbUadyhZhWb1jaiatVXuosKFBK9Bco0gkwAg==",
      text: "first message from libsignal-node",
    },
    {
      type: 3,
      body: "MwgJEiEF5z2xkqP9MzqZ244BEdXFox9iOJDjyLjIvTYHCLRbhyIaIQUcula5ompkdrVg/njdbArmMBt0joKkZNI1LDqF1mHqCSJiMwohBVagXsQoaWl6x3CZhkIwDyRjaa+KiUUb4FUhNcwSryowEAEYACIwfQvnKqdWpb9+5sDSckhrBtBXyFpCo4kEDU2tFex81LP/YeVozoqsYKgFjz9EWtbHyCAZ6euYKAAo0gkwAg==",
      text: "second message from libsignal-node",
    },
  ],
  signature: {
    pubKey: "BfBhl883wcIgpd8c8k37JBoCGFduhQHP+Jdb/vGLMWIl",
    message: "c2lnbmVkIGJ5IGxpYnNpZ25hbC1ub2Rl",
    signature: "OiHzAjMmMY8fni8phGtji+dP+K736Ptgd/xCJI0ESxbHpXEC7tF2HgEevHCrARYlEOHU5NKqO9H9b8YfmgzQiQ==",
  },
  agreement: {
    pubKey: "BRy6VrmiamR2tWD+eN1sCuYwG3SOgqRk0jUsOoXWYeoJ",
    privKey: "kMabUlmlAKLU/U1L35U30caw49HtsoPgQfOlyxlghEo=",
    shared: "nlvaqMCoQTcy29imimhrq9HqqPL/54CWLr+tj+hbQz8=",
  },
} as const;

const bytes = (base64: string) => Buffer.from(base64, "base64");

interface Party {
  name: string;
  identity: KeyPair;
  registrationId: number;
  signedPreKey: { keyId: number; keyPair: KeyPair; signature: Buffer };
  preKey: { keyId: number; keyPair: KeyPair };
  storage: SignalStorage;
  sessions: Map<string, Buffer>;
}

/** A party with Baileys-shaped storage: a session is stored as its bytes and loaded as a record. */
function party(
  name: string,
  keys?: { identity: KeyPair; signed: KeyPair; pre: KeyPair; registrationId: number },
): Party {
  const identity = keys?.identity ?? generateKeyPair();
  const signed = keys?.signed ?? generateKeyPair();
  const pre = keys?.pre ?? generateKeyPair();
  const registrationId = keys?.registrationId ?? 1000 + name.length;
  const sessions = new Map<string, Buffer>();
  const preKeys = new Map([[9, pre]]);
  const storage: SignalStorage = {
    loadSession: (address) => {
      const stored = sessions.get(address);
      return stored ? SessionRecord.deserialize(stored) : null;
    },
    storeSession: (address, record) => {
      sessions.set(address, record.serialize());
    },
    getOurIdentity: () => identity,
    getOurRegistrationId: () => registrationId,
    isTrustedIdentity: () => true,
    // Baileys keeps public keys without the type byte; the adapter accepts both forms.
    loadPreKey: (id) => {
      const pair = preKeys.get(id);
      return pair ? { privKey: pair.privKey, pubKey: pair.pubKey.subarray(1) } : undefined;
    },
    removePreKey: (id) => {
      preKeys.delete(id);
    },
    loadSignedPreKey: () => ({ privKey: signed.privKey, pubKey: signed.pubKey.subarray(1) }),
  };
  return {
    name,
    identity,
    registrationId,
    signedPreKey: { keyId: 2, keyPair: signed, signature: calculateSignature(identity.privKey, signed.pubKey) },
    preKey: { keyId: 9, keyPair: pre },
    storage,
    sessions,
  };
}

function bundle(of: Party) {
  return {
    registrationId: of.registrationId,
    identityKey: of.identity.pubKey,
    signedPreKey: {
      keyId: of.signedPreKey.keyId,
      publicKey: of.signedPreKey.keyPair.pubKey,
      signature: of.signedPreKey.signature,
    },
    preKey: { keyId: of.preKey.keyId, publicKey: of.preKey.keyPair.pubKey },
  };
}

const text = (value: Uint8Array) => Buffer.from(value).toString("utf8");

async function sessionsBothWays() {
  const alice = party("alice");
  const bob = party("bob");
  const toBob = () => new SessionCipher(alice.storage, new ProtocolAddress("bob", 0));
  const toAlice = () => new SessionCipher(bob.storage, new ProtocolAddress("alice", 0));
  await new SessionBuilder(alice.storage, new ProtocolAddress("bob", 0)).initOutgoing(bundle(bob));

  const first = await toBob().encrypt(Buffer.from("hello"));
  assert.equal(first.type, 3);
  assert.equal(text(await toAlice().decryptPreKeyWhisperMessage(first.body)), "hello");

  const reply = await toAlice().encrypt(Buffer.from("hi"));
  assert.equal(reply.type, 1);
  assert.equal(text(await toBob().decryptWhisperMessage(reply.body)), "hi");

  // Two messages that arrive out of order on one chain.
  const one = await toBob().encrypt(Buffer.from("one"));
  const two = await toBob().encrypt(Buffer.from("two"));
  assert.equal(text(await toAlice().decryptWhisperMessage(two.body)), "two");
  assert.equal(text(await toAlice().decryptWhisperMessage(one.body)), "one");

  const record = SessionRecord.deserialize(alice.sessions.get("bob.0") ?? Buffer.alloc(0));
  assert.equal(record.haveOpenSession(), true);
  assert.equal(record.getOpenSession()?.registrationId, bob.registrationId);
  assert.equal(record.getOpenSession()?.indexInfo.baseKey?.byteLength, 33);
  return { ok: true, messages: 6 };
}

async function changedMessageRefused() {
  const alice = party("alice");
  const bob = party("bob");
  const toBob = () => new SessionCipher(alice.storage, new ProtocolAddress("bob", 0));
  const toAlice = () => new SessionCipher(bob.storage, new ProtocolAddress("alice", 0));
  await new SessionBuilder(alice.storage, new ProtocolAddress("bob", 0)).initOutgoing(bundle(bob));
  await toAlice().decryptPreKeyWhisperMessage((await toBob().encrypt(Buffer.from("hello"))).body);
  const reply = await toAlice().encrypt(Buffer.from("hi"));
  // The last eight bytes of a Whisper message are its MAC.
  const changed = Buffer.from(reply.body);
  changed[changed.length - 1] = (changed.at(-1) ?? 0) ^ 1;
  await assert.rejects(toBob().decryptWhisperMessage(changed));
  assert.equal(text(await toBob().decryptWhisperMessage(reply.body)), "hi");
  return { ok: true };
}

async function libsignalNodeMessages() {
  const vectors = LIBSIGNAL_NODE_VECTORS;
  const keyPair = (pair: { pubKey: string; privKey: string }) => ({
    pubKey: bytes(pair.pubKey),
    privKey: bytes(pair.privKey),
  });
  const bob = party("bob", {
    identity: keyPair(vectors.bob.identity),
    signed: keyPair(vectors.bob.signedPreKey),
    pre: keyPair(vectors.bob.preKey),
    registrationId: vectors.bob.registrationId,
  });
  for (const message of vectors.messages) {
    assert.equal(message.type, 3);
    const plain = await new SessionCipher(bob.storage, new ProtocolAddress("alice", 0)).decryptPreKeyWhisperMessage(
      bytes(message.body),
    );
    assert.equal(text(plain), message.text);
  }
  return { ok: true, messages: vectors.messages.length };
}

function curveMatches() {
  const { signature, agreement } = LIBSIGNAL_NODE_VECTORS;
  assert.equal(verifySignature(bytes(signature.pubKey), bytes(signature.message), bytes(signature.signature)), true);
  assert.equal(verifySignature(bytes(signature.pubKey), Buffer.from("other"), bytes(signature.signature)), false);
  assert.deepEqual(calculateAgreement(bytes(agreement.pubKey), bytes(agreement.privKey)), bytes(agreement.shared));
  // A key without the type byte is the same key.
  assert.deepEqual(
    calculateAgreement(bytes(agreement.pubKey).subarray(1), bytes(agreement.privKey)),
    bytes(agreement.shared),
  );
  const own = generateKeyPair();
  const message = Buffer.from("message");
  assert.equal(verifySignature(own.pubKey, message, calculateSignature(own.privKey, message)), true);
  assert.throws(() => verifySignature(own.pubKey, message, Buffer.alloc(10)), /Invalid signature/u);
  return { ok: true };
}

function symmetricMatches() {
  // RFC 5869 test case 1 input with a 32-byte salt: each chunk is 32 bytes and the first does not
  // depend on how many follow.
  const salt = Buffer.alloc(32, 0x0c);
  const [first, second] = deriveSecrets(Buffer.alloc(22, 0x0b), salt, Buffer.from("info"), 2);
  assert.equal(first?.byteLength, 32);
  assert.equal(second?.byteLength, 32);
  assert.deepEqual(deriveSecrets(Buffer.alloc(22, 0x0b), salt, Buffer.from("info"), 1)[0], first);
  assert.throws(() => deriveSecrets(Buffer.alloc(1), Buffer.alloc(16), Buffer.alloc(0)), /salt/u);
  const key = Buffer.alloc(32, 1);
  const iv = Buffer.alloc(16, 2);
  assert.equal(decrypt(key, encrypt(key, Buffer.from("plain"), iv), iv).toString(), "plain");
  // HMAC-SHA256 of a known text.
  assert.equal(
    calculateMAC(Buffer.from("key"), Buffer.from("The quick brown fox jumps over the lazy dog")).toString("hex"),
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  );
  return { ok: true };
}

/** Baileys must load this package as `libsignal`, never the GPL package from npm. */
async function baileysLoadsReplacement() {
  const fromBaileys = createRequire(
    resolve(import.meta.dirname, "../node_modules/@whiskeysockets/baileys/package.json"),
  );
  const loaded = await realpath(fromBaileys.resolve("libsignal"));
  const expected = await realpath(resolve(import.meta.dirname, "../vendor/whatsapp-signal/index.js"));
  assert.equal(loaded, expected);
  return { ok: true };
}

await mkdir(OUT, { recursive: true });
const cases = {
  baileysLoadsReplacement: await baileysLoadsReplacement(),
  sessionsBothWays: await sessionsBothWays(),
  changedMessageRefused: await changedMessageRefused(),
  libsignalNodeMessages: await libsignalNodeMessages(),
  curveMatches: curveMatches(),
  symmetricMatches: symmetricMatches(),
};
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ok: true, cases }, null, 2)}\n`);
process.stdout.write(`whatsapp-signal-e2e: ${Object.keys(cases).length} cases passed\n`);
