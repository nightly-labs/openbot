import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { WhatsAppAuthStore } from "@openbot/whatsapp/auth-store";
import type { SocketConfig, WAVersion } from "@openbot/whatsapp/baileys";
import type { WhatsAppHistory } from "./whatsapp-archive";
import { WhatsAppChatState } from "./whatsapp-chats";
import type { WhatsAppSenderRules } from "./whatsapp-senders";
import { WhatsAppSession, type WhatsAppSocketFactory } from "./whatsapp-session";

/** Who may give work through a linked number, and the pairing codes of a dedicated number. */
export interface WhatsAppPolicy {
  rules(workspaceId: string): WhatsAppSenderRules;
  /** The code for an unknown person, and whether it is new. Null when no request can wait now. */
  pairing(workspaceId: string, senderId: string, name: string): { code: string; created: boolean } | null;
  /** Where the number's messages are saved, or null before it has a connection. */
  history(workspaceId: string): WhatsAppHistory | null;
}

/** The open store, session and chat state of one linked number. */
export interface WhatsAppConnectionHandle {
  storeId: string;
  store: WhatsAppAuthStore;
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

/** A download writes a `.part` file first. One this old belongs to a download that stopped with the app. */
const PART_FILE_MAX_AGE_MS = 60 * 60_000;

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
  #policy: WhatsAppPolicy = { rules: () => NO_RULES, pairing: () => null, history: () => null };

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

  /** The copies of the files that a connection saved, in a folder only this user can read. */
  filesPath(connectionId: string): string {
    return join(this.#options.root, "files", connectionId);
  }

  /** Deletes the copies of the files of a connection. */
  deleteFiles(connectionId: string): void {
    rmSync(this.filesPath(connectionId), { recursive: true, force: true });
  }

  /** Deletes the saved copies that a prune of the history returned. A path outside the files folder stays. */
  deleteSavedFiles(paths: readonly string[]): void {
    const files = `${resolve(this.#options.root, "files")}${sep}`;
    for (const path of paths) if (resolve(path).startsWith(files)) rmSync(path, { force: true });
  }

  /**
   * Deletes the copies that no saved message can name any more: those older than `savedBefore`, and the
   * parts of downloads that stopped with the app. The prune of the history deletes the others.
   */
  pruneFiles(savedBefore: number): void {
    const root = join(this.#options.root, "files");
    if (!existsSync(root)) return;
    const partsBefore = (this.#options.now ?? Date.now)() - PART_FILE_MAX_AGE_MS;
    for (const folder of readdirSync(root, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      for (const file of readdirSync(join(root, folder.name), { withFileTypes: true })) {
        if (!file.isFile()) continue;
        const path = join(root, folder.name, file.name);
        const before = file.name.endsWith(".part") ? partsBefore : savedBefore;
        const modified = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
        if (modified !== undefined && modified < before) rmSync(path, { force: true });
      }
    }
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

  /** A finished link: the store and its open socket go on as the connection's. */
  promote(storeId: string): void {
    this.#open.get(storeId)?.session.finishPairing();
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
    handle?.chats.detach();
    handle?.store.close();
  }

  /** Deletes the files of a closed store: the device's keys are gone for good. */
  delete(storeId: string): void {
    this.close(storeId);
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(`${this.storePath(storeId)}${suffix}`, { force: true });
  }
}
