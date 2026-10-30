// OpenBot's Signal repository for Baileys: pairwise sessions, sender keys and LID mapping, stored in
// the Baileys key store. Session and sender key records use OpenBot's own binary format under the key
// types `session` and `sender-key`; remote identity keys (33 bytes) go under `identity-key`.

import {
  isHostedLidUser,
  isHostedPnUser,
  isLidUser,
  isPnUser,
  jidDecode,
  jidEncode,
  type LIDMapping,
  LIDMappingStore,
  type SignalAuthState,
  type SignalDataSet,
  type SignalKeyStore,
  type SignalKeyStoreWithTransaction,
  type SignalRepositoryWithLIDStore,
  type SocketConfig,
} from "@openbot/whatsapp/baileys";
import { addressToString, jidToAddress, senderKeyName } from "./signal/address";
import { bytesEqual } from "./signal/crypto";
import { generateKeyPair, withKeyType } from "./signal/curve";
import { NoSessionError } from "./signal/errors";
import {
  createDistributionMessage,
  createOwnSenderKey,
  decryptGroupMessage,
  encryptGroupMessage,
  isOwnSenderKey,
  processDistributionMessage,
} from "./signal/group-cipher";
import { decodePreKeySignalMessage } from "./signal/messages";
import { deserializeSenderKeyRecord, type SenderKeyRecord, serializeSenderKeyRecord } from "./signal/sender-key-record";
import { InvalidSignedPreKeyError, initiateSession, respondSession } from "./signal/session-builder";
import {
  decryptPreKeySignalMessage,
  decryptSignalMessage,
  encryptMessage,
  type LocalParty,
} from "./signal/session-cipher";
import {
  addCurrentState,
  deserializeSessionRecord,
  type SessionRecord,
  serializeSessionRecord,
} from "./signal/session-record";

/** The Baileys logger interface, which its package index does not export by name. */
type ILogger = SocketConfig["logger"];

export function makeOpenBotSignalRepository(
  auth: SignalAuthState,
  logger: ILogger,
  pnToLIDFunc?: (jids: string[]) => Promise<LIDMapping[] | undefined>,
): SignalRepositoryWithLIDStore {
  const keys = withTransactions(auth.keys);
  const lidMapping = new LIDMappingStore(keys, logger, pnToLIDFunc);

  const local = (): LocalParty => ({
    identityKey: withKeyType(auth.creds.signedIdentityKey.public),
    registrationId: auth.creds.registrationId,
    newKeyPair: generateKeyPair,
  });

  const loadSession = async (address: string): Promise<SessionRecord | undefined> => {
    const bytes = (await keys.get("session", [address]))[address];
    return bytes ? deserializeSessionRecord(bytes) : undefined;
  };

  const loadIdentity = async (address: string): Promise<Uint8Array | undefined> => {
    const identity = (await keys.get("identity-key", [address]))[address];
    return identity ?? undefined;
  };

  const loadSenderKey = async (name: string): Promise<SenderKeyRecord | undefined> => {
    const bytes = (await keys.get("sender-key", [name]))[name];
    return bytes ? deserializeSenderKeyRecord(bytes) : undefined;
  };

  const saveSenderKey = async (name: string, record: SenderKeyRecord): Promise<void> => {
    await keys.set({ "sender-key": { [name]: serializeSenderKeyRecord(record) } });
  };

  /** Session address of `jid`. A phone-number JID uses its LID address when the mapping is stored. */
  const sessionAddress = async (jid: string): Promise<string> => {
    if (isPnUser(jid) || isHostedPnUser(jid)) {
      const decoded = jidDecode(jid);
      const lidUser = decoded ? (await keys.get("lid-mapping", [decoded.user]))[decoded.user] : undefined;
      if (decoded && lidUser) {
        return addressToString(
          jidToAddress(jidEncode(lidUser, decoded.server === "hosted" ? "hosted.lid" : "lid", decoded.device)),
        );
      }
    }
    return addressToString(jidToAddress(jid));
  };

  const ownSenderKey = async (name: string): Promise<SenderKeyRecord> => {
    const record = await loadSenderKey(name);
    return record && isOwnSenderKey(record) ? record : createOwnSenderKey();
  };

  return {
    lidMapping,

    jidToSignalProtocolAddress(jid) {
      return addressToString(jidToAddress(jid));
    },

    async decryptMessage({ jid, type, ciphertext }) {
      const address = await sessionAddress(jid);
      return keys.transaction(async () => {
        if (type === "msg") {
          const record = await loadSession(address);
          if (!record?.states.length) throw new NoSessionError(address);
          const plaintext = decryptSignalMessage(record, local(), ciphertext);
          await keys.set({ session: { [address]: serializeSessionRecord(record) } });
          return plaintext;
        }

        const message = decodePreKeySignalMessage(ciphertext);
        const storedIdentity = await loadIdentity(address);
        const identityChanged = storedIdentity !== undefined && !bytesEqual(storedIdentity, message.identityKey);
        if (identityChanged) logger.info({ address }, "identity key changed, starting a new session record");
        // Trust on first use, as WhatsApp Web does: a new identity replaces the old record.
        const record = (identityChanged ? undefined : await loadSession(address)) ?? { states: [] };
        const { plaintext, createdState } = await decryptPreKeySignalMessage(record, local(), message, async () => {
          const signedPreKey = auth.creds.signedPreKey;
          if (signedPreKey.keyId !== message.signedPreKeyId) {
            // Baileys keeps only the current signed prekey; an older ID fails the MAC check.
            logger.warn(
              { address, wanted: message.signedPreKeyId, current: signedPreKey.keyId },
              "pkmsg names a signed prekey that is not current",
            );
          }
          let oneTimePreKey: { public: Uint8Array; private: Uint8Array } | undefined;
          if (message.preKeyId !== undefined) {
            const id = String(message.preKeyId);
            oneTimePreKey = (await keys.get("pre-key", [id]))[id];
            if (!oneTimePreKey) throw new Error(`One-time prekey ${id} not found`);
          }
          return respondSession(auth.creds.signedIdentityKey.private, signedPreKey.keyPair, oneTimePreKey, message);
        });

        const updates: SignalDataSet = { session: { [address]: serializeSessionRecord(record) } };
        if (storedIdentity === undefined || identityChanged) {
          updates["identity-key"] = { [address]: message.identityKey };
        }
        if (createdState && message.preKeyId !== undefined) {
          updates["pre-key"] = { [String(message.preKeyId)]: null };
        }
        await keys.set(updates);
        return plaintext;
      }, address);
    },

    async encryptMessage({ jid, data }) {
      const address = await sessionAddress(jid);
      return keys.transaction(async () => {
        const record = await loadSession(address);
        if (!record?.states.length) throw new NoSessionError(address);
        const result = encryptMessage(record, local(), data);
        await keys.set({ session: { [address]: serializeSessionRecord(record) } });
        return result;
      }, address);
    },

    async injectE2ESession({ jid, session }) {
      const address = await sessionAddress(jid);
      await keys.transaction(async () => {
        const preKey = session.preKey?.keyId ? session.preKey : undefined;
        let state: ReturnType<typeof initiateSession>;
        try {
          state = initiateSession(
            auth.creds.signedIdentityKey.private,
            {
              registrationId: session.registrationId,
              identityKey: session.identityKey,
              signedPreKey: session.signedPreKey,
              preKey: preKey ? { keyId: preKey.keyId, publicKey: preKey.publicKey } : undefined,
            },
            generateKeyPair,
          );
        } catch (error) {
          if (error instanceof InvalidSignedPreKeyError) logger.warn({ jid }, "rejected a bundle with a bad signature");
          throw error;
        }
        const identity = withKeyType(session.identityKey);
        const storedIdentity = await loadIdentity(address);
        const identityChanged = storedIdentity !== undefined && !bytesEqual(storedIdentity, identity);
        const record = (identityChanged ? undefined : await loadSession(address)) ?? { states: [] };
        addCurrentState(record, state);
        await keys.set({
          session: { [address]: serializeSessionRecord(record) },
          "identity-key": { [address]: identity },
        });
      }, address);
    },

    async getSessionInfo(jid) {
      const current = (await loadSession(await sessionAddress(jid)))?.states[0];
      return current ? { baseKey: current.baseKey, registrationId: current.remoteRegistrationId } : null;
    },

    async validateSession(jid) {
      const current = (await loadSession(await sessionAddress(jid)))?.states[0];
      if (!current) return { exists: false, reason: "no session" };
      if (!current.sending) return { exists: false, reason: "no open session" };
      return { exists: true };
    },

    async deleteSession(jids) {
      const sessions: Record<string, null> = {};
      for (const jid of jids) {
        sessions[addressToString(jidToAddress(jid))] = null;
        sessions[await sessionAddress(jid)] = null;
      }
      await keys.transaction(() => Promise.resolve(keys.set({ session: sessions })), "delete-session");
    },

    async migrateSession(fromJid, toJid) {
      const from = jidDecode(fromJid);
      const to = jidDecode(toJid);
      const fromIsPn = isPnUser(fromJid) || isHostedPnUser(fromJid);
      const toIsLid = isLidUser(toJid) || isHostedLidUser(toJid);
      if (!from || !to || !fromIsPn || !toIsLid) return { migrated: 0, skipped: 0, total: 0 };

      const devices = new Set([from.device ?? 0]);
      for (const device of (await keys.get("device-list", [from.user]))[from.user] ?? []) {
        const value = Number(device);
        if (Number.isInteger(value) && value >= 0) devices.add(value);
      }
      const pairs = [...devices].map((device) => ({
        pn: addressToString(jidToAddress(jidEncode(from.user, from.server, device))),
        lid: addressToString(jidToAddress(jidEncode(to.user, to.server, device))),
      }));

      return keys.transaction(async () => {
        const sessions = await keys.get(
          "session",
          pairs.flatMap(({ pn, lid }) => [pn, lid]),
        );
        const identities = await keys.get(
          "identity-key",
          pairs.map(({ pn }) => pn),
        );
        const sessionUpdates: Record<string, Uint8Array | null> = {};
        const identityUpdates: Record<string, Uint8Array> = {};
        let migrated = 0;
        let skipped = 0;
        let total = 0;
        for (const { pn, lid } of pairs) {
          const record = sessions[pn];
          if (!record) continue;
          total += 1;
          if (sessions[lid]) {
            skipped += 1;
          } else {
            sessionUpdates[lid] = record;
            const identity = identities[pn];
            if (identity) identityUpdates[lid] = identity;
            migrated += 1;
          }
          sessionUpdates[pn] = null;
        }
        if (total > 0) await keys.set({ session: sessionUpdates, "identity-key": identityUpdates });
        if (migrated > 0) logger.debug({ fromJid, toJid, migrated, skipped }, "moved sessions to LID addresses");
        return { migrated, skipped, total };
      }, `migrate:${from.user}`);
    },

    async decryptGroupMessage({ group, authorJid, msg }) {
      const name = senderKeyName(group, jidToAddress(authorJid));
      return keys.transaction(async () => {
        const record = await loadSenderKey(name);
        if (!record) throw new Error(`No sender key record for ${name}`);
        const plaintext = decryptGroupMessage(record, msg);
        await saveSenderKey(name, record);
        return plaintext;
      }, name);
    },

    async processSenderKeyDistributionMessage({ item, authorJid }) {
      const group = item.groupId;
      const serialized = item.axolotlSenderKeyDistributionMessage;
      if (!group) throw new Error("Sender key distribution message has no group ID");
      if (!serialized) throw new Error("Sender key distribution message has no content");
      const name = senderKeyName(group, jidToAddress(authorJid));
      await keys.transaction(async () => {
        await saveSenderKey(name, processDistributionMessage(await loadSenderKey(name), serialized));
      }, name);
    },

    async encryptGroupMessage({ group, data, meId }) {
      const name = senderKeyName(group, jidToAddress(meId));
      return keys.transaction(async () => {
        const record = await ownSenderKey(name);
        // The distribution message states the iteration of this message, so receivers can decrypt it.
        const senderKeyDistributionMessage = createDistributionMessage(record);
        const ciphertext = encryptGroupMessage(record, data);
        await saveSenderKey(name, record);
        return { ciphertext, senderKeyDistributionMessage };
      }, name);
    },

    async getSenderKeyDistributionMessage({ group, meId }) {
      const name = senderKeyName(group, jidToAddress(meId));
      return keys.transaction(async () => {
        const record = await ownSenderKey(name);
        await saveSenderKey(name, record);
        return createDistributionMessage(record);
      }, name);
    },

    async hasSenderKey({ group, meId }) {
      const record = await loadSenderKey(senderKeyName(group, jidToAddress(meId)));
      return record !== undefined && isOwnSenderKey(record);
    },
  };
}

/** Baileys gives a store with transactions at runtime; a plain store runs each transaction directly. */
function withTransactions(store: SignalKeyStore | SignalKeyStoreWithTransaction): SignalKeyStoreWithTransaction {
  if ("transaction" in store) return store;
  return {
    get: (type, ids) => store.get(type, ids),
    set: (data) => store.set(data),
    isInTransaction: () => false,
    transaction: (exec) => exec(),
  };
}
