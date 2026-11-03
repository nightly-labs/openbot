import type { ConversationPage, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { decodeConversationPage } from "./conversation";
import { type DrawerSnapshot, decodeDrawerSnapshot } from "./drawer-snapshot";
import { decodeAgentSummaries, decodeSidebarLayout, type RemoteAgent } from "./workspace-records";

/** What the phone shows for one server before its connection is back. The host stays the source of truth. */
interface CachedServer {
  agents: RemoteAgent[];
  /** The host's hidden agents, or null for a host without `agent-hidden-v1`. */
  hidden: string[] | null;
  sidebar: SidebarLayoutSnapshot | null;
  conversations: ConversationPage[];
  /** The last values of the drawer. A file of an older build has none. */
  drawer: DrawerSnapshot | null;
}

export interface WorkspaceCache {
  read(serverId: string): Promise<CachedServer | null>;
  write(serverId: string, value: CachedServer): Promise<void>;
  remove(serverId: string): Promise<void>;
  /** Deletes the files of the servers that the account no longer lists, also those removed while the app was closed. */
  retain(serverIds: readonly string[]): Promise<void>;
}

const FORMAT = 1;
const ROOT = "workspace-cache-v1/";
const KEY_NAME = "openbot.mobile.workspace-cache-key.v1";
/**
 * The escaped JSON of a server file. Base64 adds a third, so the file stays under 4 MB. A server with
 * more keeps its agents and the chats that fit, newest first.
 */
const MAX_JSON_LENGTH = 3 * 1024 * 1024;

const segment = (value: string) => value.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "_");
const rootDirectory = () => (FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}${ROOT}` : null);

let keyLoad: Promise<Crypto.AESEncryptionKey | null> | null = null;

/**
 * The device key of the cache, in the keychain that a locked phone can read after the first unlock.
 * It stays on this device. A keychain that does not open gives no cache in this run; a new key is
 * made only when the keychain has none.
 */
function cacheKey(): Promise<Crypto.AESEncryptionKey | null> {
  keyLoad ??= (async () => {
    let stored: string | null;
    try {
      stored = await LockedKeychain.getItemAsync(KEY_NAME);
    } catch {
      return null;
    }
    if (stored) return Crypto.AESEncryptionKey.import(stored, "base64");
    const key = await Crypto.AESEncryptionKey.generate(Crypto.AESKeySize.AES256);
    await LockedKeychain.setItemAsync(KEY_NAME, await key.encoded("base64"));
    return key;
  })().catch(() => null);
  const load = keyLoad;
  // A failed load tries again on the next use.
  void load.then((key) => {
    if (!key && keyLoad === load) keyLoad = null;
  });
  return load;
}

/**
 * JSON in ASCII only: each other UTF-16 unit is a `\u` escape, so the bytes are the characters. No
 * `u` flag: with it, a character outside the Basic Multilingual Plane would not match.
 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

function asciiText(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192)
    text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return text;
}

function decodeCachedServer(value: unknown): CachedServer {
  if (
    !isDynamicRecord(value) ||
    value.format !== FORMAT ||
    !Array.isArray(value.conversations) ||
    (value.hidden !== null && !(Array.isArray(value.hidden) && value.hidden.every(isString)))
  )
    throw new Error("The workspace cache is invalid.");
  return {
    agents: decodeAgentSummaries(value.agents),
    hidden: value.hidden,
    sidebar: value.sidebar === null ? null : decodeSidebarLayout(value.sidebar),
    conversations: value.conversations.map(decodeConversationPage),
    drawer: decodeDrawerSnapshot(value.drawer),
  };
}

/**
 * The agents, sections and recent chats of each server of one account, so the app shows them at
 * once after a start, before the connection is back. Each server has one file in `Library/Caches`,
 * which is not in a backup and which the system can delete when the device is low on storage. The
 * files are sealed with AES-256-GCM and bound to the account and the server.
 */
export function createWorkspaceCache(scope: string): WorkspaceCache | null {
  const root = rootDirectory();
  if (!root) return null;
  const account = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope);
  const paths = async (serverId: string) => {
    const folder = `${root}${await account}/`;
    return { folder, file: `${folder}${segment(serverId)}.bin`, next: `${folder}${segment(serverId)}.next.bin` };
  };
  const binding = async (serverId: string) => asciiBytes(asciiJson([FORMAT, await account, serverId]));
  // A remove that follows a write of the same server runs after it, so the file does not come back.
  const queues = new Map<string, Promise<unknown>>();
  const inOrder = <T>(serverId: string, operation: () => Promise<T>): Promise<T> => {
    const result = (queues.get(serverId) ?? Promise.resolve()).then(operation, operation);
    const tail = result.catch(() => undefined);
    queues.set(serverId, tail);
    void tail.then(() => {
      if (queues.get(serverId) === tail) queues.delete(serverId);
    });
    return result;
  };

  return {
    read: (serverId) =>
      inOrder(serverId, async () => {
        const key = await cacheKey();
        if (!key) return null;
        const { file } = await paths(serverId);
        if (!(await FileSystem.getInfoAsync(file)).exists) return null;
        try {
          const sealed = Crypto.AESSealedData.fromCombined(await FileSystem.readAsStringAsync(file));
          const plain = await Crypto.aesDecryptAsync(sealed, key, {
            output: "bytes",
            additionalData: await binding(serverId),
          });
          return decodeCachedServer(JSON.parse(asciiText(plain)));
        } catch {
          // A file of an older format, of another key or a damaged one: the server loads as before.
          await FileSystem.deleteAsync(file, { idempotent: true });
          return null;
        }
      }),
    write: (serverId, value) =>
      inOrder(serverId, async () => {
        const key = await cacheKey();
        if (!key) return;
        // A provider that this build does not know goes back to `provider`, where the decoder reads it.
        const agents = value.agents.map(({ foreignProvider, ...agent }) => ({
          ...agent,
          provider: agent.provider ?? foreignProvider,
        }));
        // Each page counts with its escapes and the comma before it.
        const conversations: ConversationPage[] = [];
        let length = asciiJson({ format: FORMAT, ...value, agents, conversations }).length;
        for (const page of [...value.conversations].sort((a, b) =>
          (b.messages.at(-1)?.createdAt ?? "").localeCompare(a.messages.at(-1)?.createdAt ?? ""),
        )) {
          length += asciiJson(page).length + 1;
          if (length > MAX_JSON_LENGTH) break;
          conversations.push(page);
        }
        const sealed = await Crypto.aesEncryptAsync(
          asciiBytes(asciiJson({ format: FORMAT, ...value, agents, conversations })),
          key,
          { additionalData: await binding(serverId) },
        );
        const { folder, file, next } = await paths(serverId);
        await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
        await FileSystem.writeAsStringAsync(next, await sealed.combined("base64"));
        await FileSystem.deleteAsync(file, { idempotent: true });
        await FileSystem.moveAsync({ from: next, to: file });
      }),
    remove: (serverId) =>
      inOrder(serverId, async () => {
        const { file, next } = await paths(serverId);
        await FileSystem.deleteAsync(file, { idempotent: true });
        await FileSystem.deleteAsync(next, { idempotent: true });
      }),
    retain: async (serverIds) => {
      const folder = `${root}${await account}/`;
      if (!(await FileSystem.getInfoAsync(folder)).exists) return;
      const kept = new Set(serverIds.flatMap((id) => [`${segment(id)}.bin`, `${segment(id)}.next.bin`]));
      for (const name of await FileSystem.readDirectoryAsync(folder))
        if (!kept.has(name)) await FileSystem.deleteAsync(`${folder}${name}`, { idempotent: true });
    },
  };
}

/** Deletes the cache of every account and its key, such as on sign-out. A file left behind cannot be read. */
export async function deleteWorkspaceCaches(): Promise<void> {
  keyLoad = null;
  await LockedKeychain.deleteItemAsync(KEY_NAME).catch(() => undefined);
  const root = rootDirectory();
  if (root) await FileSystem.deleteAsync(root, { idempotent: true }).catch(() => undefined);
}
