import { rmSync } from "node:fs";
import { join } from "node:path";
import { WhatsAppAuthStore } from "@openbot/whatsapp/auth-store";
import type { SocketConfig, WAVersion } from "@openbot/whatsapp/baileys";
import { WhatsAppChatState } from "./whatsapp-chats";
import type { WhatsAppSenderRules } from "./whatsapp-senders";
import { WhatsAppSession, type WhatsAppSocketFactory } from "./whatsapp-session";

/** Who may give work through a linked number, and the pairing codes of a dedicated number. */
export interface WhatsAppPolicy {
  rules(workspaceId: string): WhatsAppSenderRules;
  /** The code for an unknown person, and whether it is new. Null when no request can wait now. */
  pairing(workspaceId: string, senderId: string, name: string): { code: string; created: boolean } | null;
}

/** The open store, session and chat state of one linked number. */
export interface WhatsAppConnectionHandle {
  storeId: string;
  store: WhatsAppAuthStore;
  /** Replaced once, when a link finishes (`promote`). */
  session: WhatsAppSession;
  chats: WhatsAppChatState;
}

export interface WhatsAppRuntimeOptions {
  /** `<userData>/whatsapp`, a folder only this user can read. */
  root: string;
  createSocket: WhatsAppSocketFactory;
  makeSignalRepository: SocketConfig["makeSignalRepository"];
  /** WhatsApp Web's current version, or null. Without it, the session asks WhatsApp's server. */
  fetchVersion?: () => Promise<WAVersion | null>;
  now?: () => number;
}

const NO_RULES: WhatsAppSenderRules = { ownNumber: true, contacts: new Set(), groups: new Set() };

/**
 * The WhatsApp side that the driver and the link flow share: the open store and session of each
 * linked number, by store id, and the sender policy that the messaging service sets. A store stays
 * open from its first use until a disconnect deletes it or the messaging service stops, also while its
 * connection restarts; the store's lock keeps a second process out of the same session.
 */
export class WhatsAppRuntime {
  readonly #options: WhatsAppRuntimeOptions;
  readonly #open = new Map<string, WhatsAppConnectionHandle>();
  #policy: WhatsAppPolicy = { rules: () => NO_RULES, pairing: () => null };

  constructor(options: WhatsAppRuntimeOptions) {
    this.#options = options;
  }

  get policy(): WhatsAppPolicy {
    return this.#policy;
  }

  setPolicy(policy: WhatsAppPolicy): void {
    this.#policy = policy;
  }

  storePath(storeId: string): string {
    return join(this.#options.root, `${storeId}.db`);
  }

  /** The handle of a store, opening it the first time. Throws when the store is locked or unreadable. */
  open(storeId: string, key: Uint8Array, pairing = false): WhatsAppConnectionHandle {
    const current = this.#open.get(storeId);
    if (current) return current;
    const store = WhatsAppAuthStore.open({
      path: this.storePath(storeId),
      key,
      ...(this.#options.now ? { now: this.#options.now } : {}),
    });
    const handle: WhatsAppConnectionHandle = {
      storeId,
      store,
      session: this.#session(store, pairing),
      chats: new WhatsAppChatState(),
    };
    this.#open.set(storeId, handle);
    return handle;
  }

  /** A finished link: the store stays open, and a session for messages replaces the pairing one. */
  promote(storeId: string): void {
    const handle = this.#open.get(storeId);
    if (handle) handle.session = this.#session(handle.store, false);
  }

  /** Closes every store, when the messaging service stops. Their sessions are already stopped. */
  closeAll(): void {
    for (const storeId of [...this.#open.keys()]) this.close(storeId);
  }

  #session(store: WhatsAppAuthStore, pairing: boolean): WhatsAppSession {
    return new WhatsAppSession({
      store,
      createSocket: this.#options.createSocket,
      makeSignalRepository: this.#options.makeSignalRepository,
      pairing,
      ...(this.#options.fetchVersion ? { fetchVersion: this.#options.fetchVersion } : {}),
      ...(this.#options.now ? { now: this.#options.now } : {}),
    });
  }

  get(storeId: string): WhatsAppConnectionHandle | null {
    return this.#open.get(storeId) ?? null;
  }

  /** Closes the store of a stopped session. A later `open` opens it again. */
  close(storeId: string): void {
    const handle = this.#open.get(storeId);
    this.#open.delete(storeId);
    handle?.store.close();
  }

  /** Deletes the files of a closed store: the device's keys are gone for good. */
  delete(storeId: string): void {
    this.close(storeId);
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(`${this.storePath(storeId)}${suffix}`, { force: true });
  }
}
