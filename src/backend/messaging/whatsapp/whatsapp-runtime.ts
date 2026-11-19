import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { WhatsAppAuthStore } from "@openbot/whatsapp/auth-store";
import type { SocketConfig, WAVersion } from "@openbot/whatsapp/baileys";
import type { WhatsAppHistory } from "./whatsapp-archive";
import { WhatsAppChatState } from "./whatsapp-chats";
import type { WhatsAppSenderRules } from "./whatsapp-senders";
import { WhatsAppSession, type WhatsAppSocketFactory } from "./whatsapp-session";

export interface WhatsAppPolicy {
  rules(workspaceId: string): WhatsAppSenderRules;
  pairing(workspaceId: string, senderId: string, name: string): { code: string; created: boolean } | null;
  history(workspaceId: string): WhatsAppHistory | null;
}

export interface WhatsAppConnectionHandle {
  storeId: string;
  store: WhatsAppAuthStore;
  session: WhatsAppSession;
  chats: WhatsAppChatState;
}

export interface WhatsAppRuntimeOptions {
  root: string;
  createSocket: WhatsAppSocketFactory;
  makeSignalRepository: SocketConfig["makeSignalRepository"];
  fetchVersion?: () => Promise<WAVersion | null>;
  now?: () => number;
}

const PART_FILE_MAX_AGE_MS = 60 * 60_000;

const NO_RULES: WhatsAppSenderRules = { ownNumber: true, contacts: new Map(), groups: new Set() };

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

  filesPath(connectionId: string): string {
    return join(this.#options.root, "files", connectionId);
  }

  deleteFiles(connectionId: string): void {
    rmSync(this.filesPath(connectionId), { recursive: true, force: true });
  }

  deleteSavedFiles(paths: readonly string[]): void {
    const files = `${resolve(this.#options.root, "files")}${sep}`;
    for (const path of paths) if (resolve(path).startsWith(files)) rmSync(path, { force: true });
  }

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

  promote(storeId: string): void {
    this.#open.get(storeId)?.session.finishPairing();
  }

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

  close(storeId: string): void {
    const handle = this.#open.get(storeId);
    this.#open.delete(storeId);
    handle?.chats.detach();
    handle?.store.close();
  }

  delete(storeId: string): void {
    this.close(storeId);
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(`${this.storePath(storeId)}${suffix}`, { force: true });
  }
}
