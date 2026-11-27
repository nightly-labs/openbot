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
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
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
  warmed?: { conversations: string[]; channels: string[] } | null;
}

interface WorkspaceCacheWarmIds {
  conversations?: ReadonlySet<string>;
  channels?: ReadonlySet<string>;
}

export interface WorkspaceCache {
  read(serverId: string): Promise<CachedServer | null>;
  write(serverId: string, value: CachedServer, warmed?: WorkspaceCacheWarmIds): Promise<boolean>;
  remove(serverId: string): Promise<void>;
  retain(serverIds: readonly string[]): Promise<void>;
  readHosts(): Promise<RemoteTeamHost[] | null>;
  writeHosts(hosts: readonly RemoteTeamHost[]): Promise<void>;
}

const FORMAT = 1;
const ROOT = "workspace-cache-v1/";
const KEY_NAME = "openbot.mobile.workspace-cache-key.v1";
const HOSTS_NAME = "~hosts";
const MAX_JSON_LENGTH = 3 * 1024 * 1024;

const segment = (value: string) => value.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "_");
const rootDirectory = () => (FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}${ROOT}` : null);

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

function asciiText(bytes: Uint8Array): string {
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

function decodeCachedWarmed(value: unknown): CachedServer["warmed"] {
  if (!isDynamicRecord(value)) return null;
  const conversations = Array.isArray(value.conversations) ? value.conversations.filter(isString) : [];
  const channels = Array.isArray(value.channels) ? value.channels.filter(isString) : [];
  return { conversations, channels };
}

function decodeCachedServer(value: unknown): CachedServer {
  if (
    !isDynamicRecord(value) ||
    value.format !== FORMAT ||
    !Array.isArray(value.conversations) ||
    (value.hidden !== null && !(Array.isArray(value.hidden) && value.hidden.every(isString)))
  )
    throw new Error("The workspace cache is invalid.");
  const capabilities = value.capabilities;
  return {
    agents: decodeAgentSummaries(value.agents),
    hidden: value.hidden,
    colors: decodeCachedColors(value.colors),
    sidebar: value.sidebar === null ? null : decodeSidebarLayout(value.sidebar),
    conversations: value.conversations.map(decodeConversationPage),
    capabilities: Array.isArray(capabilities) && capabilities.every(isString) ? capabilities : null,
    drawer: decodeDrawerSnapshot(value.drawer),
    channels: decodeCachedChannels(value.channels),
    warmed: decodeCachedWarmed(value.warmed),
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
  const paths = async (serverId: string | null) => {
    const folder = `${root}${await account}/`;
    const name = serverId === null ? HOSTS_NAME : segment(serverId);
    return { folder, file: `${folder}${name}.bin`, next: `${folder}${name}.next.bin` };
  };
  const binding = async (serverId: string | null) => asciiBytes(asciiJson([FORMAT, await account, serverId]));
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
  const open = <T>(serverId: string | null, decode: (value: unknown) => T) =>
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
        return decode(JSON.parse(asciiText(plain)));
      } catch {
        await FileSystem.deleteAsync(file, { idempotent: true });
        return null;
      }
    });
  const seal = async (serverId: string | null, key: Crypto.AESEncryptionKey, json: string) => {
    const sealed = await Crypto.aesEncryptAsync(asciiBytes(json), key, { additionalData: await binding(serverId) });
    const { folder, file, next } = await paths(serverId);
    await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
    await FileSystem.writeAsStringAsync(next, await sealed.combined("base64"));
    await FileSystem.deleteAsync(file, { idempotent: true });
    await FileSystem.moveAsync({ from: next, to: file });
  };

  return {
    read: (serverId) => open(serverId, decodeCachedServer),
    readHosts: () => open(null, decodeCachedHosts),
    writeHosts: (hosts) =>
      inOrder(null, async () => {
        const key = await cacheKey();
        if (key) await seal(null, key, asciiJson({ format: FORMAT, hosts }));
      }),
    write: (serverId, value, warmed) =>
      inOrder(serverId, async () => {
        const key = await cacheKey();
        if (!key) return false;
        const agents = value.agents.map(({ foreignProvider, ...agent }) => ({
          ...agent,
          provider: agent.provider ?? foreignProvider,
        }));
        const marker = Crypto.randomUUID();
        const conversationsMarker = `${marker}:conversations`;
        const channelPagesMarker = `${marker}:channel-pages`;
        const channels = value.channels && { channels: value.channels.channels, pages: channelPagesMarker };
        const warmedPayload = warmed
          ? {
              conversations: [...(warmed.conversations ?? [])],
              channels: [...(warmed.channels ?? [])],
            }
          : null;
        const head = asciiJson({
          format: FORMAT,
          ...value,
          agents,
          conversations: conversationsMarker,
          channels,
          ...(warmedPayload && (warmedPayload.conversations.length || warmedPayload.channels.length)
            ? { warmed: warmedPayload }
            : {}),
        });
        let length = head.length - conversationsMarker.length - (channels ? channelPagesMarker.length : 0);
        const conversations: string[] = [];
        const channelPages: string[] = [];
        const pages = [
          ...value.conversations.map((page) => {
            const messages = page.messages.filter(({ itemType }) => itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE);
            return {
              page: { ...page, messages },
              at: messages.at(-1)?.createdAt ?? "",
              warmed: warmed?.conversations?.has(page.agentId) ?? false,
              kept: conversations,
            };
          }),
          ...(value.channels?.pages ?? []).map((page) => ({
            page,
            at: page.messages.at(-1)?.message.createdAt ?? "",
            warmed: warmed?.channels?.has(page.channel.id) ?? false,
            kept: channelPages,
          })),
        ].sort((a, b) => Number(a.warmed) - Number(b.warmed) || b.at.localeCompare(a.at));
        for (const { page, kept } of pages) {
          const json = asciiJson(page);
          length += json.length + 1;
          if (length > MAX_JSON_LENGTH) break;
          kept.push(json);
        }
        const json = head
          .replace(`"${conversationsMarker}"`, () => `[${conversations.join(",")}]`)
          .replace(`"${channelPagesMarker}"`, () => `[${channelPages.join(",")}]`);
        await seal(serverId, key, json);
        return true;
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
      const kept = new Set(
        [HOSTS_NAME, ...serverIds.map(segment)].flatMap((name) => [`${name}.bin`, `${name}.next.bin`]),
      );
      for (const name of await FileSystem.readDirectoryAsync(folder))
        if (!kept.has(name)) await FileSystem.deleteAsync(`${folder}${name}`, { idempotent: true });
    },
  };
}

export async function deleteWorkspaceCaches(): Promise<void> {
  keyLoad = null;
  await LockedKeychain.deleteItemAsync(KEY_NAME).catch(() => undefined);
  const root = rootDirectory();
  if (root) await FileSystem.deleteAsync(root, { idempotent: true }).catch(() => undefined);
}
