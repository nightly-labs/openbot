import { isStorageGb } from "@openbot/contracts/billing";
import {
  type AvatarColor,
  type ChannelPage,
  type ChannelSummary,
  type ConversationPage,
  decodeChannelPage,
  decodeChannelSummaries,
  isAvatarColor,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { optionalServerAppearanceField } from "@openbot/contracts/team-protocol/host-appearance-v1";
import type { RemoteTeamHost } from "@openbot/team-client";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { decodeConversationPage } from "./conversation";
import { type DrawerSnapshot, decodeDrawerSnapshot } from "./drawer-snapshot";
import { decodeAgentSummaries, decodeSidebarLayout, type RemoteAgent } from "./workspace-records";

interface CachedServer {
  agents: RemoteAgent[];
  hidden: string[] | null;
  colors: { agentId: string; color: AvatarColor }[] | null;
  sidebar: SidebarLayoutSnapshot | null;
  conversations: ConversationPage[];
  capabilities: readonly string[] | null;
  drawer: DrawerSnapshot | null;
  channels: { channels: ChannelSummary[]; pages: ChannelPage[] } | null;
}

export interface CachedPages {
  conversations: ConversationPage[];
  channelPages: ChannelPage[];
}

export interface CachedWorkspace {
  agents: RemoteAgent[];
  hidden: string[] | null;
  colors: { agentId: string; color: AvatarColor }[] | null;
  sidebar: SidebarLayoutSnapshot | null;
  capabilities: readonly string[] | null;
  drawer: DrawerSnapshot | null;
  channels: ChannelSummary[] | null;
  readPages(): Promise<CachedPages | null>;
}

export interface WorkspaceCache {
  read(serverId: string): Promise<CachedWorkspace | null>;
  write(serverId: string, value: CachedServer): Promise<boolean>;
  remove(serverId: string): Promise<void>;
  retain(serverIds: readonly string[]): Promise<void>;
  readHosts(): Promise<RemoteTeamHost[] | null>;
  writeHosts(hosts: readonly RemoteTeamHost[]): Promise<void>;
}

const FORMAT = 1;
const SPLIT_FORMAT = 2;
const ROOT = "workspace-cache-v1/";
const KEY_NAME = "openbot.mobile.workspace-cache-key.v1";
const HOSTS_NAME = "~hosts";
const WORKSPACE_PART = "workspace";
const PAGES_PART = "pages";
const MAX_JSON_LENGTH = 3 * 1024 * 1024;

type CachePart = typeof WORKSPACE_PART | typeof PAGES_PART;

const segment = (value: string) => value.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "_");
const rootDirectory = () => (FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}${ROOT}` : null);
const serverFileNames = (name: string) =>
  [name, `${name}~${WORKSPACE_PART}`, `${name}~${PAGES_PART}`].flatMap((base) => [`${base}.bin`, `${base}.next.bin`]);

let keyLoad: Promise<Crypto.AESEncryptionKey | null> | null = null;

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
  void load.then((key) => {
    if (!key && keyLoad === load) keyLoad = null;
  });
  return load;
}

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

const nativeTextDecoder = typeof TextDecoder === "function" ? new TextDecoder() : null;

function asciiText(bytes: Uint8Array): string {
  if (nativeTextDecoder) return nativeTextDecoder.decode(bytes);
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192)
    text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return text;
}

function decodeCachedColors(value: unknown): CachedServer["colors"] {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry: unknown) =>
    isDynamicRecord(entry) && isString(entry.agentId) && isAvatarColor(entry.color)
      ? [{ agentId: entry.agentId, color: entry.color }]
      : [],
  );
}

function decodeCachedChannels(value: unknown): CachedServer["channels"] {
  if (!isDynamicRecord(value) || !Array.isArray(value.pages)) return null;
  try {
    return { channels: decodeChannelSummaries(value.channels), pages: value.pages.map(decodeChannelPage) };
  } catch {
    return null;
  }
}

function decodeCachedChannelSummaries(value: unknown): ChannelSummary[] | null {
  if (value === null) return null;
  try {
    return decodeChannelSummaries(value);
  } catch {
    return null;
  }
}

function decodeHidden(value: unknown): string[] | null {
  if (value === null) return null;
  if (Array.isArray(value) && value.every(isString)) return value;
  throw new Error("The workspace cache is invalid.");
}

function decodeWorkspaceFields(value: DynamicRecord) {
  const capabilities = value.capabilities;
  return {
    agents: decodeAgentSummaries(value.agents),
    hidden: decodeHidden(value.hidden),
    colors: decodeCachedColors(value.colors),
    sidebar: value.sidebar === null ? null : decodeSidebarLayout(value.sidebar),
    capabilities: Array.isArray(capabilities) && capabilities.every(isString) ? capabilities : null,
    drawer: decodeDrawerSnapshot(value.drawer),
  };
}

function decodeLegacyServer(value: unknown): CachedWorkspace {
  if (!isDynamicRecord(value) || value.format !== FORMAT || !Array.isArray(value.conversations))
    throw new Error("The workspace cache is invalid.");
  const channels = decodeCachedChannels(value.channels);
  const conversations: unknown[] = value.conversations;
  return {
    ...decodeWorkspaceFields(value),
    channels: channels?.channels ?? null,
    readPages: async () => ({
      conversations: conversations.map(decodeConversationPage),
      channelPages: channels?.pages ?? [],
    }),
  };
}

function decodeWorkspacePart(value: unknown) {
  if (!isDynamicRecord(value) || value.format !== SPLIT_FORMAT || !isString(value.pagesId))
    throw new Error("The workspace cache is invalid.");
  return {
    pagesId: value.pagesId,
    workspace: { ...decodeWorkspaceFields(value), channels: decodeCachedChannelSummaries(value.channels) },
  };
}

function pagesDecoder(pagesId: string) {
  return (value: unknown): CachedPages => {
    if (
      !isDynamicRecord(value) ||
      value.format !== SPLIT_FORMAT ||
      value.pagesId !== pagesId ||
      !Array.isArray(value.conversations) ||
      !Array.isArray(value.channelPages)
    )
      throw new Error("The workspace cache is invalid.");
    return {
      conversations: value.conversations.map(decodeConversationPage),
      channelPages: value.channelPages.map(decodeChannelPage),
    };
  };
}

function decodeCachedHost(value: unknown): RemoteTeamHost {
  if (!isDynamicRecord(value)) throw new Error("The cached server list is invalid.");
  const { hostId, name, logoKey, devicePublicKey, membershipId, role, memberLimit, hosted, keyChangedAt } = value;
  const { restartAvailable, storageGb, appearance, hidden } = value;
  if (
    !isString(hostId) ||
    !isString(name) ||
    (logoKey !== null && !isString(logoKey)) ||
    !isString(devicePublicKey) ||
    !devicePublicKey ||
    !isString(membershipId) ||
    (role !== "owner" && role !== "admin" && role !== "member") ||
    (memberLimit !== undefined && !(isNumber(memberLimit) && Number.isSafeInteger(memberLimit))) ||
    (hosted !== undefined && !isBoolean(hosted)) ||
    (keyChangedAt !== undefined && !isNumber(keyChangedAt))
  )
    throw new Error("The cached server list is invalid.");
  return {
    hostId,
    name,
    logoKey,
    devicePublicKey,
    membershipId,
    role,
    ...(memberLimit === undefined ? {} : { memberLimit }),
    ...(hosted === undefined ? {} : { hosted }),
    ...(hidden === true ? { hidden } : {}),
    ...(isBoolean(restartAvailable) ? { restartAvailable } : {}),
    ...(isStorageGb(storageGb) ? { storageGb } : {}),
    ...optionalServerAppearanceField(appearance),
    ...(keyChangedAt === undefined ? {} : { keyChangedAt }),
  };
}

function decodeCachedHosts(value: unknown): RemoteTeamHost[] {
  if (!isDynamicRecord(value) || value.format !== FORMAT || !Array.isArray(value.hosts))
    throw new Error("The cached server list is invalid.");
  return value.hosts.map(decodeCachedHost);
}

export function createWorkspaceCache(scope: string): WorkspaceCache | null {
  const root = rootDirectory();
  if (!root) return null;
  const account = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope);
  const folder = async () => `${root}${await account}/`;
  const paths = async (serverId: string | null, part?: CachePart) => {
    const base = serverId === null ? HOSTS_NAME : segment(serverId);
    const name = part ? `${base}~${part}` : base;
    const directory = await folder();
    return { folder: directory, file: `${directory}${name}.bin`, next: `${directory}${name}.next.bin` };
  };
  const binding = async (serverId: string | null, part?: CachePart) =>
    asciiBytes(asciiJson(part ? [SPLIT_FORMAT, await account, serverId, part] : [FORMAT, await account, serverId]));
  const queues = new Map<string | null, Promise<unknown>>();
  const inOrder = <T>(serverId: string | null, operation: () => Promise<T>): Promise<T> => {
    const result = (queues.get(serverId) ?? Promise.resolve()).then(operation, operation);
    const tail = result.catch(() => undefined);
    queues.set(serverId, tail);
    void tail.then(() => {
      if (queues.get(serverId) === tail) queues.delete(serverId);
    });
    return result;
  };
  const unseal = async <T>(
    key: Crypto.AESEncryptionKey,
    serverId: string | null,
    part: CachePart | undefined,
    decode: (value: unknown) => T,
  ): Promise<T | null> => {
    const { file } = await paths(serverId, part);
    if (!(await FileSystem.getInfoAsync(file)).exists) return null;
    try {
      const sealed = Crypto.AESSealedData.fromCombined(await FileSystem.readAsStringAsync(file));
      const plain = await Crypto.aesDecryptAsync(sealed, key, {
        output: "bytes",
        additionalData: await binding(serverId, part),
      });
      return decode(JSON.parse(asciiText(plain)));
    } catch {
      await FileSystem.deleteAsync(file, { idempotent: true });
      return null;
    }
  };
  const seal = async (
    serverId: string | null,
    part: CachePart | undefined,
    key: Crypto.AESEncryptionKey,
    json: string,
  ) => {
    const sealed = await Crypto.aesEncryptAsync(asciiBytes(json), key, {
      additionalData: await binding(serverId, part),
    });
    const { folder: directory, file, next } = await paths(serverId, part);
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.writeAsStringAsync(next, await sealed.combined("base64"));
    await FileSystem.deleteAsync(file, { idempotent: true });
    await FileSystem.moveAsync({ from: next, to: file });
  };
  const deleteFiles = async (serverId: string, part?: CachePart) => {
    const { file, next } = await paths(serverId, part);
    await FileSystem.deleteAsync(file, { idempotent: true });
    await FileSystem.deleteAsync(next, { idempotent: true });
  };
  const readPages = (serverId: string, pagesId: string) =>
    inOrder(serverId, async () => {
      const key = await cacheKey();
      return key ? unseal(key, serverId, PAGES_PART, pagesDecoder(pagesId)) : null;
    });

  return {
    read: (serverId) =>
      inOrder(serverId, async () => {
        const key = await cacheKey();
        if (!key) return null;
        const legacy = await unseal(key, serverId, undefined, decodeLegacyServer);
        if (legacy) return legacy;
        const split = await unseal(key, serverId, WORKSPACE_PART, decodeWorkspacePart);
        if (!split) return null;
        return { ...split.workspace, readPages: () => readPages(serverId, split.pagesId) };
      }),
    readHosts: () =>
      inOrder(null, async () => {
        const key = await cacheKey();
        return key ? unseal(key, null, undefined, decodeCachedHosts) : null;
      }),
    writeHosts: (hosts) =>
      inOrder(null, async () => {
        const key = await cacheKey();
        if (key) await seal(null, undefined, key, asciiJson({ format: FORMAT, hosts }));
      }),
    write: (serverId, value) =>
      inOrder(serverId, async () => {
        const key = await cacheKey();
        if (!key) return false;
        const agents = value.agents.map(({ foreignProvider, ...agent }) => ({
          ...agent,
          provider: agent.provider ?? foreignProvider,
        }));
        const pagesId = Crypto.randomUUID();
        const head = asciiJson({
          format: SPLIT_FORMAT,
          pagesId,
          agents,
          hidden: value.hidden,
          colors: value.colors,
          sidebar: value.sidebar,
          capabilities: value.capabilities,
          drawer: value.drawer,
          channels: value.channels?.channels ?? null,
        });
        let length = head.length;
        const conversations: string[] = [];
        const channelPages: string[] = [];
        const pages = [
          ...value.conversations.map((page) => {
            const messages = page.messages.filter(({ itemType }) => itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE);
            return { page: { ...page, messages }, at: messages.at(-1)?.createdAt ?? "", kept: conversations };
          }),
          ...(value.channels?.pages ?? []).map((page) => ({
            page,
            at: page.messages.at(-1)?.message.createdAt ?? "",
            kept: channelPages,
          })),
        ].sort((a, b) => b.at.localeCompare(a.at));
        for (const { page, kept } of pages) {
          const json = asciiJson(page);
          length += json.length + 1;
          if (length > MAX_JSON_LENGTH) break;
          kept.push(json);
        }
        const pagesJson = `{"format":${SPLIT_FORMAT},"pagesId":${asciiJson(pagesId)},"conversations":[${conversations.join(",")}],"channelPages":[${channelPages.join(",")}]}`;
        await seal(serverId, PAGES_PART, key, pagesJson);
        await seal(serverId, WORKSPACE_PART, key, head);
        await deleteFiles(serverId);
        return true;
      }),
    remove: (serverId) =>
      inOrder(serverId, async () => {
        await deleteFiles(serverId);
        await deleteFiles(serverId, WORKSPACE_PART);
        await deleteFiles(serverId, PAGES_PART);
      }),
    retain: async (serverIds) => {
      const directory = await folder();
      if (!(await FileSystem.getInfoAsync(directory)).exists) return;
      const kept = new Set([
        `${HOSTS_NAME}.bin`,
        `${HOSTS_NAME}.next.bin`,
        ...serverIds.flatMap((serverId) => serverFileNames(segment(serverId))),
      ]);
      for (const name of await FileSystem.readDirectoryAsync(directory))
        if (!kept.has(name)) await FileSystem.deleteAsync(`${directory}${name}`, { idempotent: true });
    },
  };
}

export async function deleteWorkspaceCaches(): Promise<void> {
  keyLoad = null;
  await LockedKeychain.deleteItemAsync(KEY_NAME).catch(() => undefined);
  const root = rootDirectory();
  if (root) await FileSystem.deleteAsync(root, { idempotent: true }).catch(() => undefined);
}
