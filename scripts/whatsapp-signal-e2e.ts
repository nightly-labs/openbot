// End-to-end check of OpenBot's clean-room Signal implementation for the WhatsApp connector
// (`packages/whatsapp/src/signal`, `packages/whatsapp/src/signal-repository.ts`).
//
// 1. Known-answer vectors in `packages/whatsapp/test-vectors`: X25519, signatures, pairwise sessions
//    (as receiver and as byte-exact sender), out-of-order delivery, forward limit and sender keys.
// 2. Parties that run through `makeOpenBotSignalRepository` with the Baileys transaction layer over
//    an in-memory key store that stores values as the OpenBot auth store does (BufferJSON).
// 3. When `/tmp/wa-oracle/oracle.mjs` exists, a differential conversation against that reference
//    implementation in both directions. CI has no oracle, so the report marks it as skipped.
//
// `bun scripts/whatsapp-signal-e2e.ts`. Writes .openbot-build/whatsapp-signal-e2e.json and exits
// non-zero when a check fails.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import {
  type AuthenticationCreds,
  addTransactionCapability,
  BufferJSON,
  Curve,
  generateSignalPubKey,
  initAuthCreds,
  MISSING_KEYS_ERROR_TEXT,
  proto,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type SignalRepository,
  type SignalRepositoryWithLIDStore,
  type SocketConfig,
  unpadRandomMax16,
  writeRandomPadMax16,
} from "@openbot/whatsapp/baileys";
import { makeOpenBotSignalRepository } from "@openbot/whatsapp/signal-repository";
import { Schema } from "effect";
import { addressToString, jidToAddress } from "../packages/whatsapp/src/signal/address";
import { publicKeyOf, sharedKey, sign, verify, withKeyType } from "../packages/whatsapp/src/signal/curve";
import {
  createDistributionMessage,
  createOwnSenderKey,
  decryptGroupMessage,
  encryptGroupMessage,
  processDistributionMessage,
} from "../packages/whatsapp/src/signal/group-cipher";
import { chainStep, senderMessageKeys } from "../packages/whatsapp/src/signal/kdf";
import { decodePreKeySignalMessage } from "../packages/whatsapp/src/signal/messages";
import { serializeSenderKeyRecord } from "../packages/whatsapp/src/signal/sender-key-record";
import {
  InvalidSignedPreKeyError,
  initiateSession,
  type KeyPairSource,
  type PreKeyBundle,
  respondSession,
} from "../packages/whatsapp/src/signal/session-builder";
import {
  decryptPreKeySignalMessage,
  decryptSignalMessage,
  encryptMessage,
  type LocalParty,
} from "../packages/whatsapp/src/signal/session-cipher";
import {
  deserializeSessionRecord,
  type SessionRecord,
  serializeSessionRecord,
} from "../packages/whatsapp/src/signal/session-record";
import senderKeyVectors from "../packages/whatsapp/test-vectors/sender-keys.json";
import outOfOrderVectors from "../packages/whatsapp/test-vectors/session-out-of-order.json";
import pkmsgVectors from "../packages/whatsapp/test-vectors/session-pkmsg.json";
import signatureVectors from "../packages/whatsapp/test-vectors/signatures.json";
import x25519Vectors from "../packages/whatsapp/test-vectors/x25519.json";

const REPORT = resolve(import.meta.dirname, "../.openbot-build/whatsapp-signal-e2e.json");
const ORACLE = "/tmp/wa-oracle/oracle.mjs";
const log = createOpenBotLogger("whatsapp-signal-e2e");

type BaileysLogger = SocketConfig["logger"];
type E2ESession = Parameters<SignalRepository["injectE2ESession"]>[0]["session"];

const silentLogger: BaileysLogger = {
  level: "silent",
  child: () => silentLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface CheckResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: CheckResult[] = [];

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ name, passed: true });
    log.info(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    log.error(`FAIL ${name}: ${message}`);
  }
}

const fromHex = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const toHex = (value: Uint8Array): string => Buffer.from(value).toString("hex");
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

async function rejects(run: () => unknown, text?: string): Promise<Error> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof Error)) throw new Error("Rejected with a value that is not an Error");
    if (text !== undefined) assert.equal(error.message, text);
    return error;
  }
  throw new Error("Expected a failure, but the call succeeded");
}

/** Gives the listed private keys in order, as the vectors draw them. */
function keyQueue(privateKeys: string[]): { source: KeyPairSource; used: () => number } {
  let next = 0;
  return {
    source: () => {
      const privateKey = privateKeys[next];
      if (privateKey === undefined) throw new Error("Key queue is empty");
      next += 1;
      const key = fromHex(privateKey);
      return { private: key, public: publicKeyOf(key) };
    },
    used: () => next,
  };
}

// ---------------------------------------------------------------------------------------------
// Known-answer vectors

async function checkPrimitiveVectors(): Promise<void> {
  for (const [index, sample] of x25519Vectors.samples.entries()) {
    await check(`x25519/${index}: ${sample.description}`, () => {
      assert.equal(toHex(publicKeyOf(fromHex(sample.privateA))), sample.publicA);
      assert.equal(toHex(publicKeyOf(fromHex(sample.privateB))), sample.publicB);
      assert.equal(toHex(sharedKey(fromHex(sample.privateA), fromHex(sample.publicB))), sample.shared);
      assert.equal(toHex(sharedKey(fromHex(sample.privateB), withKeyType(fromHex(sample.publicA)))), sample.shared);
    });
  }
  for (const [index, sample] of signatureVectors.valid.entries()) {
    await check(`signatures/valid/${index}: ${sample.description.slice(0, 60)}`, () => {
      assert.equal(toHex(withKeyType(publicKeyOf(fromHex(sample.privateKey)))), sample.publicKey);
      assert.equal(verify(fromHex(sample.publicKey), fromHex(sample.message), fromHex(sample.signature)), true);
      const own = sign(fromHex(sample.privateKey), fromHex(sample.message));
      assert.equal(verify(fromHex(sample.publicKey), fromHex(sample.message), own), true);
      assert.equal((own[63] ?? 0) & 0x80, 0, "XEdDSA signer leaves the sign bit clear");
    });
  }
  for (const [index, sample] of signatureVectors.invalid.entries()) {
    await check(`signatures/invalid/${index}: ${sample.description}`, () => {
      assert.equal(verify(fromHex(sample.publicKey), fromHex(sample.message), fromHex(sample.signature)), false);
    });
  }
}

interface VectorKey {
  priv: string;
}

interface SessionVectorStep {
  step: number;
  label: string;
  from?: string;
  to?: string;
  type?: string;
  plaintext?: string;
  ciphertext?: string;
  decryptStep?: number;
  expectedPlaintext?: string;
  expectError?: boolean;
  receiverConsumedKeys?: VectorKey[];
}

interface SessionVector {
  alice: {
    identityPrivateKey: string;
    identityPublicKey: string;
    registrationId: number;
    baseKey: VectorKey;
    ratchetKeysInOrder: VectorKey[];
  };
  bob: {
    identityPrivateKey: string;
    identityPublicKey: string;
    registrationId: number;
    signedPreKey: { id: number; privateKey: string };
    oneTimePreKey: { id: number; privateKey: string } | null;
    ratchetKeysInOrder: VectorKey[];
  };
  bundleSeenByAlice: {
    identityKey: string;
    registrationId: number;
    signedPreKey: { id: number; publicKey: string; signature: string };
    preKey?: { id: number; publicKey: string };
  };
  steps: SessionVectorStep[];
}

function vectorBundle(bundle: SessionVector["bundleSeenByAlice"]): PreKeyBundle {
  return {
    registrationId: bundle.registrationId,
    identityKey: fromHex(bundle.identityKey),
    signedPreKey: {
      keyId: bundle.signedPreKey.id,
      publicKey: fromHex(bundle.signedPreKey.publicKey),
      signature: fromHex(bundle.signedPreKey.signature),
    },
    preKey: bundle.preKey ? { keyId: bundle.preKey.id, publicKey: fromHex(bundle.preKey.publicKey) } : undefined,
  };
}

function vectorKeyPair(privateKey: string): { public: Uint8Array; private: Uint8Array } {
  const key = fromHex(privateKey);
  return { public: publicKeyOf(key), private: key };
}

/** Bob's responder state builder for a pkmsg, from the vector keys. */
function vectorResponder(
  bob: SessionVector["bob"],
): (message: ReturnType<typeof decodePreKeySignalMessage>) => () => Promise<ReturnType<typeof respondSession>> {
  return (message) => async () => {
    const oneTime = bob.oneTimePreKey;
    if (message.signedPreKeyId !== bob.signedPreKey.id) throw new Error("Unknown signed prekey ID");
    if (message.preKeyId !== undefined && message.preKeyId !== oneTime?.id) throw new Error("Unknown prekey ID");
    return respondSession(
      fromHex(bob.identityPrivateKey),
      vectorKeyPair(bob.signedPreKey.privateKey),
      message.preKeyId !== undefined && oneTime ? vectorKeyPair(oneTime.privateKey) : undefined,
      message,
    );
  };
}

async function runSessionVector(name: string, vector: SessionVector): Promise<void> {
  const aliceKeys = keyQueue([vector.alice.baseKey.priv, ...vector.alice.ratchetKeysInOrder.map((key) => key.priv)]);
  const bobKeys = keyQueue(vector.bob.ratchetKeysInOrder.map((key) => key.priv));
  const parties: Record<string, { local: LocalParty; record: SessionRecord; used: () => number }> = {
    alice: {
      local: {
        identityKey: fromHex(vector.alice.identityPublicKey),
        registrationId: vector.alice.registrationId,
        newKeyPair: aliceKeys.source,
      },
      record: { states: [] },
      used: aliceKeys.used,
    },
    bob: {
      local: {
        identityKey: fromHex(vector.bob.identityPublicKey),
        registrationId: vector.bob.registrationId,
        newKeyPair: bobKeys.source,
      },
      record: { states: [] },
      used: bobKeys.used,
    },
  };
  const responder = vectorResponder(vector.bob);

  await check(`${name}/initiator setup`, () => {
    const alice = parties.alice;
    assert.ok(alice);
    alice.record.states.push(
      initiateSession(
        fromHex(vector.alice.identityPrivateKey),
        vectorBundle(vector.bundleSeenByAlice),
        aliceKeys.source,
      ),
    );
    assert.equal(aliceKeys.used(), 2, "the initiator draws the base key and one ratchet key");
  });

  for (const step of vector.steps) {
    await check(`${name}/step ${step.step}: ${step.label}`, async () => {
      if (step.from) {
        const sender = parties[step.from];
        assert.ok(sender && step.plaintext !== undefined && step.ciphertext !== undefined);
        const out = encryptMessage(sender.record, sender.local, fromHex(step.plaintext));
        assert.equal(out.type, step.type);
        assert.equal(toHex(out.ciphertext), step.ciphertext, "byte-exact sender output");
        return;
      }
      const receiver = step.to ? parties[step.to] : undefined;
      const source = vector.steps.find((candidate) => candidate.step === step.decryptStep);
      assert.ok(receiver && source?.ciphertext);
      const ciphertext = fromHex(source.ciphertext);
      const before = toHex(serializeSessionRecord(receiver.record));
      const usedBefore = receiver.used();
      const decrypt = async (): Promise<Uint8Array> => {
        if (source.type === "pkmsg") {
          const message = decodePreKeySignalMessage(ciphertext);
          return (await decryptPreKeySignalMessage(receiver.record, receiver.local, message, responder(message)))
            .plaintext;
        }
        return decryptSignalMessage(receiver.record, receiver.local, ciphertext);
      };
      if (step.expectError) {
        await rejects(decrypt);
        assert.equal(toHex(serializeSessionRecord(receiver.record)), before, "a failed decrypt changes no state");
        return;
      }
      assert.equal(toHex(await decrypt()), step.expectedPlaintext);
      assert.equal(receiver.used() - usedBefore, step.receiverConsumedKeys?.length ?? 0, "ratchet keys drawn");
    });
  }
}

async function checkSessionVectors(): Promise<void> {
  for (const testCase of pkmsgVectors.cases) {
    await runSessionVector(`session-pkmsg/${testCase.name}`, testCase);
  }
  await runSessionVector("session-out-of-order", outOfOrderVectors);

  const limit = outOfOrderVectors.futureLimit;
  await check("session-out-of-order/futureLimit: +2000 accepted, +2001 rejected", async () => {
    const bobKeys = keyQueue(limit.bob.ratchetKeysInOrder.map((key) => key.priv));
    const bob: LocalParty = {
      identityKey: fromHex(limit.bob.identityPublicKey),
      registrationId: limit.bob.registrationId,
      newKeyPair: bobKeys.source,
    };
    const responder = vectorResponder({
      ...limit.bob,
      signedPreKey: limit.bob.signedPreKey,
      oneTimePreKey: null,
    });
    const record: SessionRecord = { states: [] };
    const first = decodePreKeySignalMessage(fromHex(limit.m0.ciphertext));
    const m0 = await decryptPreKeySignalMessage(record, bob, first, responder(first));
    assert.equal(toHex(m0.plaintext), limit.m0.plaintext);
    const snapshot = serializeSessionRecord(record);

    const accepted = deserializeSessionRecord(snapshot);
    const acceptMessage = decodePreKeySignalMessage(fromHex(limit.accept.ciphertext));
    const result = await decryptPreKeySignalMessage(accepted, bob, acceptMessage, responder(acceptMessage));
    assert.equal(toHex(result.plaintext), limit.accept.plaintext);

    const rejected = deserializeSessionRecord(snapshot);
    const rejectMessage = decodePreKeySignalMessage(fromHex(limit.reject.ciphertext));
    await rejects(() => decryptPreKeySignalMessage(rejected, bob, rejectMessage, responder(rejectMessage)));
    assert.equal(toHex(serializeSessionRecord(rejected)), toHex(snapshot));
  });
}

async function checkSenderKeyVectors(): Promise<void> {
  const v = senderKeyVectors;
  const own = () =>
    createOwnSenderKey({
      keyId: v.inputs.keyId,
      iteration: v.inputs.iteration,
      chainKey: fromHex(v.inputs.chainKey),
      signingKeyPair: vectorKeyPair(v.inputs.signingKeyPrivate),
    });

  await check("sender-keys/derived keys of iteration 0", () => {
    const { seed, next } = chainStep(fromHex(v.inputs.chainKey));
    const keys = senderMessageKeys(seed);
    assert.equal(toHex(seed), v.derived.messageKeySeed);
    assert.equal(toHex(next), v.derived.nextChainKey);
    assert.equal(toHex(keys.iv), v.derived.iv);
    assert.equal(toHex(keys.cipherKey), v.derived.cipherKey);
  });

  await check("sender-keys/distribution message is byte-exact", () => {
    assert.equal(toHex(createDistributionMessage(own())), v.skdm.bytes);
  });

  await check("sender-keys/sender message 0 is byte-exact except the signature", () => {
    const record = own();
    const message = v.messages[0];
    assert.ok(message?.protobuf);
    const ciphertext = encryptGroupMessage(record, fromHex(message.plaintext));
    const signed = ciphertext.subarray(0, ciphertext.length - 64);
    assert.equal(toHex(signed), `33${message.protobuf}`);
    assert.equal(verify(fromHex(v.inputs.signingKeyPublic), signed, ciphertext.subarray(-64)), true);
    const receiver = processDistributionMessage(undefined, fromHex(v.skdm.bytes));
    assert.equal(toHex(decryptGroupMessage(receiver, ciphertext)), message.plaintext);
  });

  await check("sender-keys/late distribution message after 23 sequential iterations", () => {
    const record = own();
    for (let i = 0; i < v.lateSkdm.iteration; i++) encryptGroupMessage(record, utf8(`m${i}`));
    assert.equal(toHex(createDistributionMessage(record)), v.lateSkdm.bytes);
  });

  const receivers = {
    early: processDistributionMessage(undefined, fromHex(v.skdm.bytes)),
    late: processDistributionMessage(undefined, fromHex(v.lateSkdm.bytes)),
  };
  for (const [index, delivery] of v.deliveries.entries()) {
    await check(`sender-keys/delivery ${index}: ${delivery.receiver}, ${delivery.label}`, async () => {
      const record = delivery.receiver === "late" ? receivers.late : receivers.early;
      const message = v.messages[delivery.message];
      assert.ok(message);
      if (delivery.expectError) {
        const before = toHex(serializeSenderKeyRecord(record));
        await rejects(() => decryptGroupMessage(record, fromHex(message.ciphertext)));
        assert.equal(toHex(serializeSenderKeyRecord(record)), before, "a failed decrypt changes no state");
        return;
      }
      assert.equal(toHex(decryptGroupMessage(record, fromHex(message.ciphertext))), delivery.expectedPlaintext);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Repository parties

/** Stores each value as JSON text with BufferJSON, as the OpenBot auth store does. */
class MemoryKeyStore implements SignalKeyStore {
  readonly #values = new Map<string, string>();

  get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): { [id: string]: SignalDataTypeMap[T] } {
    const out: { [id: string]: SignalDataTypeMap[T] } = {};
    for (const id of ids) {
      const text = this.#values.get(`${type}/${id}`);
      if (text !== undefined) out[id] = JSON.parse(text, BufferJSON.reviver);
    }
    return out;
  }

  set(data: SignalDataSet): void {
    for (const [type, values] of Object.entries(data)) {
      for (const [id, value] of Object.entries(values ?? {})) {
        if (value === null || value === undefined) this.#values.delete(`${type}/${id}`);
        else this.#values.set(`${type}/${id}`, JSON.stringify(value, BufferJSON.replacer));
      }
    }
  }

  has(type: keyof SignalDataTypeMap, id: string): boolean {
    return this.#values.has(`${type}/${id}`);
  }
}

interface Party {
  jid: string;
  creds: AuthenticationCreds;
  store: MemoryKeyStore;
  repo: SignalRepositoryWithLIDStore;
}

function openRepository(store: MemoryKeyStore, creds: AuthenticationCreds): SignalRepositoryWithLIDStore {
  const keys = addTransactionCapability(store, silentLogger, { maxCommitRetries: 1, delayBetweenTriesMs: 0 });
  return makeOpenBotSignalRepository({ creds, keys }, silentLogger);
}

function makeParty(jid: string): Party {
  const creds = initAuthCreds();
  const store = new MemoryKeyStore();
  const preKeys: { [id: string]: { public: Uint8Array; private: Uint8Array } } = {};
  for (let id = 1; id <= 5; id++) preKeys[id] = Curve.generateKeyPair();
  store.set({ "pre-key": preKeys });
  return { jid, creds, store, repo: openRepository(store, creds) };
}

/** The bundle a prekey fetch returns for `party`, with keys as Baileys parses them. */
function bundleOf(party: Party, preKeyId?: number): E2ESession {
  const bundle: E2ESession = {
    registrationId: party.creds.registrationId,
    identityKey: generateSignalPubKey(party.creds.signedIdentityKey.public),
    signedPreKey: {
      keyId: party.creds.signedPreKey.keyId,
      publicKey: generateSignalPubKey(party.creds.signedPreKey.keyPair.public),
      signature: party.creds.signedPreKey.signature,
    },
  };
  if (preKeyId === undefined) return bundle;
  const preKey = party.store.get("pre-key", [String(preKeyId)])[String(preKeyId)];
  assert.ok(preKey, `prekey ${preKeyId} exists`);
  return { ...bundle, preKey: { keyId: preKeyId, publicKey: generateSignalPubKey(preKey.public) } };
}

async function send(from: Party, to: Party, text: string): Promise<{ type: "pkmsg" | "msg"; ciphertext: Uint8Array }> {
  return from.repo.encryptMessage({ jid: to.jid, data: utf8(text) });
}

async function receive(
  to: Party,
  from: Party,
  message: { type: "pkmsg" | "msg"; ciphertext: Uint8Array },
  text: string,
): Promise<void> {
  const plaintext = await to.repo.decryptMessage({ jid: from.jid, type: message.type, ciphertext: message.ciphertext });
  assert.equal(new TextDecoder().decode(plaintext), text);
}

async function exchange(a: Party, b: Party, text: string): Promise<void> {
  await receive(b, a, await send(a, b, text), text);
}

async function checkRepositoryParties(): Promise<void> {
  const alice = makeParty("100000000000001:1@lid");
  const bob = makeParty("100000000000002:3@lid");
  const carol = makeParty("100000000000003@lid");

  await check("repository/addresses follow the WhatsApp mapping", () => {
    const table: Array<[string, string]> = [
      ["15551234567@s.whatsapp.net", "15551234567.0"],
      ["15551234567:3@s.whatsapp.net", "15551234567.3"],
      ["123456789012345@lid", "123456789012345_1.0"],
      ["123456789012345:2@lid", "123456789012345_1.2"],
      ["15551234567:99@hosted", "15551234567_128.99"],
      ["123456789012345:99@hosted.lid", "123456789012345_129.99"],
    ];
    for (const [jid, address] of table) assert.equal(alice.repo.jidToSignalProtocolAddress(jid), address);
    assert.throws(() => alice.repo.jidToSignalProtocolAddress("15551234567:99@s.whatsapp.net"));
  });

  await check("repository/bundle with a bad signed prekey signature is rejected", async () => {
    const bundle = bundleOf(bob, 1);
    const signature = Uint8Array.from(bundle.signedPreKey.signature);
    signature[0] = (signature[0] ?? 0) ^ 0x01;
    const error = await rejects(() =>
      alice.repo.injectE2ESession({
        jid: bob.jid,
        session: { ...bundle, signedPreKey: { ...bundle.signedPreKey, signature } },
      }),
    );
    assert.ok(error instanceof InvalidSignedPreKeyError);
    assert.deepEqual(await alice.repo.validateSession(bob.jid), { exists: false, reason: "no session" });
  });

  await check("repository/session with a one-time prekey", async () => {
    await alice.repo.injectE2ESession({ jid: bob.jid, session: bundleOf(bob, 1) });
    assert.deepEqual(await alice.repo.validateSession(bob.jid), { exists: true });
    const first = await send(alice, bob, "hello bob");
    const second = await send(alice, bob, "second pkmsg");
    assert.equal(first.type, "pkmsg");
    assert.equal(second.type, "pkmsg");
    assert.equal(decodePreKeySignalMessage(first.ciphertext).preKeyId, 1);
    await receive(bob, alice, first, "hello bob");
    assert.equal(bob.store.has("pre-key", "1"), false, "the used one-time prekey is deleted");
    assert.equal(bob.store.has("pre-key", "2"), true);
    await receive(bob, alice, second, "second pkmsg");
    const reply = await send(bob, alice, "hi alice");
    assert.equal(reply.type, "msg");
    await receive(alice, bob, reply, "hi alice");
    const third = await send(alice, bob, "now a msg");
    assert.equal(third.type, "msg", "pending prekey is cleared after the first reply");
    await receive(bob, alice, third, "now a msg");
    const aliceInfo = await alice.repo.getSessionInfo(bob.jid);
    const bobInfo = await bob.repo.getSessionInfo(alice.jid);
    assert.ok(aliceInfo && bobInfo);
    assert.equal(toHex(aliceInfo.baseKey), toHex(bobInfo.baseKey));
    assert.equal(aliceInfo.registrationId, bob.creds.registrationId);
    assert.equal(bobInfo.registrationId, alice.creds.registrationId);
  });

  await check("repository/session without a one-time prekey", async () => {
    await alice.repo.injectE2ESession({ jid: carol.jid, session: bundleOf(carol) });
    const first = await send(alice, carol, "hello carol");
    assert.equal(decodePreKeySignalMessage(first.ciphertext).preKeyId, undefined);
    await receive(carol, alice, first, "hello carol");
    await exchange(carol, alice, "hi alice from carol");
    await exchange(alice, carol, "back to carol");
  });

  await check("repository/out-of-order and skipped messages across ratchet steps", async () => {
    const a1 = await send(alice, bob, "a1");
    const a2 = await send(alice, bob, "a2");
    const a3 = await send(alice, bob, "a3");
    await receive(bob, alice, a3, "a3");
    await receive(bob, alice, a1, "a1");
    const b1 = await send(bob, alice, "b1");
    const b2 = await send(bob, alice, "b2");
    await receive(alice, bob, b2, "b2");
    const a4 = await send(alice, bob, "a4");
    await receive(bob, alice, a4, "a4");
    await receive(bob, alice, a2, "a2"); // from the old chain
    await receive(alice, bob, b1, "b1");
    await rejects(() => receive(alice, bob, b1, "b1"), MISSING_KEYS_ERROR_TEXT);
    await exchange(alice, bob, "still works after a duplicate");
    await exchange(bob, alice, "and back");
  });

  await check("repository/store reload in the middle of a conversation", async () => {
    const late = await send(alice, bob, "sent before the reload");
    const next = await send(alice, bob, "next");
    await receive(bob, alice, next, "next");
    bob.repo = openRepository(bob.store, bob.creds);
    alice.repo = openRepository(alice.store, alice.creds);
    await receive(bob, alice, late, "sent before the reload");
    await exchange(bob, alice, "after the reload");
    await exchange(alice, bob, "after the reload, back");
  });

  await check("repository/simultaneous initiation converges on one session", async () => {
    const dave = makeParty("100000000000004:1@lid");
    const erin = makeParty("100000000000005:2@lid");
    await dave.repo.injectE2ESession({ jid: erin.jid, session: bundleOf(erin, 1) });
    await erin.repo.injectE2ESession({ jid: dave.jid, session: bundleOf(dave, 1) });
    const fromDave = await send(dave, erin, "dave first");
    const fromErin = await send(erin, dave, "erin first");
    assert.equal(fromDave.type, "pkmsg");
    assert.equal(fromErin.type, "pkmsg");
    await receive(erin, dave, fromDave, "dave first");
    await receive(dave, erin, fromErin, "erin first");
    for (let round = 0; round < 3; round++) {
      await exchange(dave, erin, `dave ${round}`);
      await exchange(erin, dave, `erin ${round}`);
    }
    const daveInfo = await dave.repo.getSessionInfo(erin.jid);
    const erinInfo = await erin.repo.getSessionInfo(dave.jid);
    assert.ok(daveInfo && erinInfo);
    assert.equal(toHex(daveInfo.baseKey), toHex(erinInfo.baseKey), "both current states have the same base key");
  });

  await check("repository/session reset after an identity change", async () => {
    // Bob reinstalls: new identity, new keys, same JID.
    const newBob = makeParty(bob.jid);
    await newBob.repo.injectE2ESession({ jid: alice.jid, session: bundleOf(alice, 2) });
    await receive(alice, newBob, await send(newBob, alice, "new bob"), "new bob");
    const bobAddress = alice.repo.jidToSignalProtocolAddress(bob.jid);
    const stored = alice.store.get("identity-key", [bobAddress])[bobAddress];
    assert.ok(stored);
    assert.equal(toHex(stored), toHex(generateSignalPubKey(newBob.creds.signedIdentityKey.public)));
    await exchange(alice, newBob, "welcome back");
    // Alice rebuilds the session from a new bundle, as the identity change handler does.
    await alice.repo.injectE2ESession({ jid: bob.jid, session: bundleOf(newBob, 3) });
    const rebuilt = await send(alice, newBob, "rebuilt session");
    assert.equal(rebuilt.type, "pkmsg");
    await receive(newBob, alice, rebuilt, "rebuilt session");
    await exchange(newBob, alice, "reply on the rebuilt session");
    await exchange(alice, newBob, "msg on the rebuilt session");
    bob.repo = newBob.repo;
    bob.store = newBob.store;
    bob.creds = newBob.creds;
  });

  await check("repository/phone-number session moves to the LID address", async () => {
    const frank = makeParty("100000000000006:2@lid");
    const pnJid = "15550000006:2@s.whatsapp.net";
    await alice.repo.injectE2ESession({ jid: pnJid, session: bundleOf(frank, 1) });
    assert.equal(alice.store.has("session", "15550000006.2"), true);
    await alice.repo.lidMapping.storeLIDPNMappings([{ lid: "100000000000006@lid", pn: "15550000006@s.whatsapp.net" }]);
    alice.store.set({ "device-list": { "15550000006": ["0", "2"] } });
    const result = await alice.repo.migrateSession("15550000006@s.whatsapp.net", "100000000000006@lid");
    assert.deepEqual(result, { migrated: 1, skipped: 0, total: 1 });
    assert.equal(alice.store.has("session", "15550000006.2"), false);
    assert.equal(alice.store.has("session", "100000000000006_1.2"), true);
    assert.deepEqual(await alice.repo.validateSession(frank.jid), { exists: true });
    assert.deepEqual(
      await alice.repo.validateSession(pnJid),
      { exists: true },
      "a mapped PN JID finds the LID session",
    );
    const message = await alice.repo.encryptMessage({ jid: pnJid, data: utf8("to frank") });
    await receive(frank, alice, message, "to frank");
  });

  await check("repository/deleteSession removes the session", async () => {
    await alice.repo.deleteSession([carol.jid]);
    assert.deepEqual(await alice.repo.validateSession(carol.jid), { exists: false, reason: "no session" });
    await rejects(() => send(alice, carol, "no session"));
    await alice.repo.injectE2ESession({ jid: carol.jid, session: bundleOf(carol, 2) });
    await exchange(alice, carol, "new session to carol");
  });

  await check("repository/sender keys with three members", async () => {
    const group = "120363000000000001@g.us";
    await bob.repo.injectE2ESession({ jid: carol.jid, session: bundleOf(carol, 3) });
    await exchange(bob, carol, "bob to carol");
    await exchange(carol, bob, "carol to bob");
    const members = [alice, bob, carol];
    for (const sender of members) {
      const text = `group hello from ${sender.jid}`;
      const first = await sender.repo.encryptGroupMessage({ group, data: utf8(text), meId: sender.jid });
      assert.equal(await sender.repo.hasSenderKey({ group, meId: sender.jid }), true);
      const later: Array<{ ciphertext: Uint8Array }> = [];
      for (let i = 0; i < 3; i++) {
        later.push(await sender.repo.encryptGroupMessage({ group, data: utf8(`${text} #${i}`), meId: sender.jid }));
      }
      for (const receiver of members) {
        if (receiver === sender) continue;
        // The distribution message travels in a pairwise WhatsApp message, as Baileys sends it.
        const carrier = proto.Message.encode({
          senderKeyDistributionMessage: {
            groupId: group,
            axolotlSenderKeyDistributionMessage: first.senderKeyDistributionMessage,
          },
        }).finish();
        const pairwise = await sender.repo.encryptMessage({ jid: receiver.jid, data: writeRandomPadMax16(carrier) });
        const opened = proto.Message.decode(
          unpadRandomMax16(
            await receiver.repo.decryptMessage({
              jid: sender.jid,
              type: pairwise.type,
              ciphertext: pairwise.ciphertext,
            }),
          ),
        );
        const item = opened.senderKeyDistributionMessage;
        assert.ok(item);
        await receiver.repo.processSenderKeyDistributionMessage({ item, authorJid: sender.jid });
        assert.equal(
          await receiver.repo.hasSenderKey({ group, meId: sender.jid }),
          false,
          "a received key is not ours",
        );
        const read = async (ciphertext: Uint8Array): Promise<string> =>
          new TextDecoder().decode(
            await receiver.repo.decryptGroupMessage({ group, authorJid: sender.jid, msg: ciphertext }),
          );
        const [m0, m1, m2] = later;
        assert.ok(m0 && m1 && m2);
        assert.equal(await read(m2.ciphertext), `${text} #2`);
        assert.equal(await read(first.ciphertext), text);
        assert.equal(await read(m0.ciphertext), `${text} #0`);
        await rejects(() => read(m0.ciphertext), MISSING_KEYS_ERROR_TEXT);
        assert.equal(await read(m1.ciphertext), `${text} #1`);
      }
    }
    // Reload a receiver: the stored sender keys still decrypt.
    carol.repo = openRepository(carol.store, carol.creds);
    const after = await alice.repo.encryptGroupMessage({ group, data: utf8("after reload"), meId: alice.jid });
    const plaintext = await carol.repo.decryptGroupMessage({ group, authorJid: alice.jid, msg: after.ciphertext });
    assert.equal(new TextDecoder().decode(plaintext), "after reload");
  });
}

// ---------------------------------------------------------------------------------------------
// Differential conversation against the reference oracle

/** Oracle input: JSON values, with hex strings for bytes. */
type OracleValue = string | number | boolean | undefined | OracleValue[] | { [key: string]: OracleValue };

const OracleOutput = Schema.Struct({
  ok: Schema.Boolean,
  valid: Schema.optional(Schema.Boolean),
  type: Schema.optional(Schema.Literals(["pkmsg", "msg"])),
  ciphertext: Schema.optional(Schema.String),
  plaintext: Schema.optional(Schema.String),
  skdm: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
  publicKey: Schema.optional(Schema.String),
  identityKey: Schema.optional(Schema.String),
  signedPreKeys: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.Number, publicKey: Schema.String, signature: Schema.String })),
  ),
  preKeys: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.Number, publicKey: Schema.String }))),
});
type OracleOutput = typeof OracleOutput.Type;
const decodeOracleOutput = Schema.decodeUnknownSync(Schema.fromJsonString(OracleOutput));

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Oracle output has no ${name}`);
  return value;
}

function oracle(command: string, input: { [key: string]: OracleValue }, state?: string): OracleOutput {
  const args = [ORACLE, command, "-"];
  if (state) args.push(state);
  const result = spawnSync("node", args, { input: JSON.stringify(input), encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`oracle ${command} failed: ${result.stdout || result.stderr}`);
  }
  const output = decodeOracleOutput(result.stdout);
  if (!output.ok) throw new Error(`oracle ${command} failed: ${result.stdout}`);
  return output;
}

async function checkOracleDifferential(): Promise<"ran" | "skipped"> {
  if (!existsSync(ORACLE)) {
    log.info(`SKIP differential: ${ORACLE} does not exist`);
    return "skipped";
  }
  const dir = await mkdtemp(join(tmpdir(), "openbot-wa-oracle-"));
  try {
    await check("oracle/signatures both ways", () => {
      const ours = Curve.generateKeyPair();
      const message = randomBytes(40);
      const signature = sign(ours.private, message);
      const verified = oracle("verify", {
        publicKey: toHex(withKeyType(ours.public)),
        message: toHex(message),
        signature: toHex(signature),
      });
      assert.equal(verified.valid, true);
      const signed = oracle("sign", { priv: toHex(randomBytes(32)), message: toHex(message) });
      assert.equal(
        verify(fromHex(need(signed.publicKey, "publicKey")), message, fromHex(need(signed.signature, "signature"))),
        true,
      );
    });

    const oracleJid = "100000000000010:4@lid";
    const oracleAddress = addressToString(jidToAddress(oracleJid));

    await check("oracle/pairwise: OpenBot initiates", async () => {
      const state = join(dir, "peer-a.json");
      const bundle = oracle(
        "init",
        {
          identityPriv: toHex(randomBytes(32)),
          registrationId: 4321,
          signedPreKey: { id: 1, priv: toHex(randomBytes(32)) },
          preKeys: [{ id: 42, priv: toHex(randomBytes(32)) }],
        },
        state,
      );
      const us = makeParty("100000000000009:2@lid");
      const ourAddress = addressToString(jidToAddress(us.jid));
      const signedPreKey = need(bundle.signedPreKeys?.[0], "signed prekey");
      const preKey = need(bundle.preKeys?.[0], "prekey");
      await us.repo.injectE2ESession({
        jid: oracleJid,
        session: {
          registrationId: 4321,
          identityKey: fromHex(need(bundle.identityKey, "identityKey")),
          signedPreKey: {
            keyId: 1,
            publicKey: fromHex(need(signedPreKey.publicKey, "publicKey")),
            signature: fromHex(need(signedPreKey.signature, "signature")),
          },
          preKey: { keyId: 42, publicKey: fromHex(need(preKey.publicKey, "publicKey")) },
        },
      });
      const toOracle = async (texts: string[]) => {
        const sent = [];
        for (const text of texts) sent.push(await us.repo.encryptMessage({ jid: oracleJid, data: utf8(text) }));
        return sent;
      };
      const oracleDecrypt = (message: { type: string; ciphertext: Uint8Array }, text: string) => {
        const out = oracle(
          message.type === "pkmsg" ? "decrypt-pkmsg" : "decrypt-msg",
          { address: ourAddress, ciphertext: toHex(message.ciphertext) },
          state,
        );
        assert.equal(need(out.plaintext, "plaintext"), toHex(utf8(text)));
      };
      const oracleEncrypt = (text: string) => {
        const out = oracle("encrypt-msg", { address: ourAddress, plaintext: toHex(utf8(text)) }, state);
        return { type: need(out.type, "type"), ciphertext: fromHex(need(out.ciphertext, "ciphertext")) };
      };
      const ourDecrypt = async (message: { type: "pkmsg" | "msg"; ciphertext: Uint8Array }, text: string) => {
        const plaintext = await us.repo.decryptMessage({
          jid: oracleJid,
          type: message.type,
          ciphertext: message.ciphertext,
        });
        assert.equal(new TextDecoder().decode(plaintext), text);
      };

      const [p0, p1, p2] = await toOracle(["p0", "p1", "p2"]);
      assert.ok(p0 && p1 && p2);
      assert.equal(p0.type, "pkmsg");
      oracleDecrypt(p2, "p2");
      oracleDecrypt(p0, "p0");
      const r0 = oracleEncrypt("r0");
      const r1 = oracleEncrypt("r1");
      await ourDecrypt(r1, "r1");
      oracleDecrypt(p1, "p1");
      const [q0, q1] = await toOracle(["q0", "q1"]);
      assert.ok(q0 && q1);
      assert.equal(q0.type, "msg");
      oracleDecrypt(q1, "q1");
      await ourDecrypt(r0, "r0");
      oracleDecrypt(q0, "q0");
      for (let round = 0; round < 3; round++) {
        const [mine] = await toOracle([`ours ${round}`]);
        assert.ok(mine);
        oracleDecrypt(mine, `ours ${round}`);
        await ourDecrypt(oracleEncrypt(`theirs ${round}`), `theirs ${round}`);
      }
    });

    await check("oracle/pairwise: oracle initiates", async () => {
      const state = join(dir, "peer-b.json");
      oracle("init", { identityPriv: toHex(randomBytes(32)), registrationId: 5432 }, state);
      const us = makeParty("100000000000011:5@lid");
      const ourAddress = addressToString(jidToAddress(us.jid));
      const bundle = bundleOf(us, 1);
      oracle(
        "init-outgoing",
        {
          address: ourAddress,
          bundle: {
            identityKey: toHex(bundle.identityKey),
            registrationId: bundle.registrationId,
            signedPreKey: {
              id: bundle.signedPreKey.keyId,
              publicKey: toHex(bundle.signedPreKey.publicKey),
              signature: toHex(bundle.signedPreKey.signature),
            },
            preKey: bundle.preKey ? { id: bundle.preKey.keyId, publicKey: toHex(bundle.preKey.publicKey) } : undefined,
          },
        },
        state,
      );
      const oracleEncrypt = (text: string) => {
        const out = oracle("encrypt-msg", { address: ourAddress, plaintext: toHex(utf8(text)) }, state);
        return { type: need(out.type, "type"), ciphertext: fromHex(need(out.ciphertext, "ciphertext")) };
      };
      const ourDecrypt = async (message: { type: "pkmsg" | "msg"; ciphertext: Uint8Array }, text: string) => {
        const plaintext = await us.repo.decryptMessage({
          jid: oracleJid,
          type: message.type,
          ciphertext: message.ciphertext,
        });
        assert.equal(new TextDecoder().decode(plaintext), text);
      };
      const oracleDecrypt = (message: { type: string; ciphertext: Uint8Array }, text: string) => {
        const out = oracle("decrypt-msg", { address: ourAddress, ciphertext: toHex(message.ciphertext) }, state);
        assert.equal(need(out.plaintext, "plaintext"), toHex(utf8(text)));
      };
      const o0 = oracleEncrypt("o0");
      const o1 = oracleEncrypt("o1");
      assert.equal(o0.type, "pkmsg");
      await ourDecrypt(o1, "o1");
      assert.equal(us.store.has("pre-key", "1"), false);
      await ourDecrypt(o0, "o0");
      const reply = await us.repo.encryptMessage({ jid: oracleJid, data: utf8("reply") });
      assert.equal(reply.type, "msg");
      oracleDecrypt(reply, "reply");
      for (let round = 0; round < 3; round++) {
        const theirs = oracleEncrypt(`theirs ${round}`);
        assert.equal(theirs.type, "msg");
        await ourDecrypt(theirs, `theirs ${round}`);
        oracleDecrypt(await us.repo.encryptMessage({ jid: oracleJid, data: utf8(`ours ${round}`) }), `ours ${round}`);
      }
    });

    await check("oracle/sender keys both ways", async () => {
      const state = join(dir, "peer-group.json");
      oracle("init", { identityPriv: toHex(randomBytes(32)), registrationId: 6543 }, state);
      const us = makeParty("100000000000012:1@lid");
      const ourAddress = addressToString(jidToAddress(us.jid));
      const group = "120363000000000099@g.us";

      // Oracle -> OpenBot.
      const created = oracle(
        "skdm-create",
        {
          groupId: group,
          sender: oracleAddress,
          keyId: 987654,
          iteration: 0,
          chainKey: toHex(randomBytes(32)),
          signingKeyPriv: toHex(randomBytes(32)),
        },
        state,
      );
      await us.repo.processSenderKeyDistributionMessage({
        item: { groupId: group, axolotlSenderKeyDistributionMessage: fromHex(need(created.skdm, "skdm")) },
        authorJid: oracleJid,
      });
      const fromOracle = ["g0", "g1", "g2", "g3"].map((text) => ({
        text,
        ciphertext: fromHex(
          need(
            oracle("encrypt-skmsg", { groupId: group, sender: oracleAddress, plaintext: toHex(utf8(text)) }, state)
              .ciphertext,
            "ciphertext",
          ),
        ),
      }));
      for (const index of [3, 0, 2, 1]) {
        const message = fromOracle[index];
        assert.ok(message);
        const plaintext = await us.repo.decryptGroupMessage({ group, authorJid: oracleJid, msg: message.ciphertext });
        assert.equal(new TextDecoder().decode(plaintext), message.text);
      }

      // OpenBot -> oracle.
      const ours: Array<{ text: string; ciphertext: Uint8Array; senderKeyDistributionMessage: Uint8Array }> = [];
      for (const text of ["h0", "h1", "h2", "h3"]) {
        ours.push({ text, ...(await us.repo.encryptGroupMessage({ group, data: utf8(text), meId: us.jid })) });
      }
      const firstOurs = ours[0];
      assert.ok(firstOurs);
      oracle(
        "skdm-process",
        { groupId: group, sender: ourAddress, skdm: toHex(firstOurs.senderKeyDistributionMessage) },
        state,
      );
      for (const index of [2, 0, 3, 1]) {
        const message = ours[index];
        assert.ok(message);
        const out = oracle(
          "decrypt-skmsg",
          { groupId: group, sender: ourAddress, ciphertext: toHex(message.ciphertext) },
          state,
        );
        assert.equal(need(out.plaintext, "plaintext"), toHex(utf8(message.text)));
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return "ran";
}

// ---------------------------------------------------------------------------------------------

await checkPrimitiveVectors();
await checkSessionVectors();
await checkSenderKeyVectors();
await checkRepositoryParties();
const differential = await checkOracleDifferential();

const failed = results.filter((result) => !result.passed);
const report = {
  passed: failed.length === 0,
  total: results.length,
  failed: failed.length,
  differential,
  checks: results,
};
await mkdir(resolve(REPORT, ".."), { recursive: true });
await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
log.info(
  `${report.passed ? "PASSED" : "FAILED"}: ${results.length - failed.length}/${results.length} checks, differential ${differential}. Report: ${REPORT}`,
);
if (!report.passed) process.exitCode = 1;
