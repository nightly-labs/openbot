import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { PRESENCE_KEY, type PresenceAck } from "./client-browser-messages";

const SESSION_KEY = "openbot.session.v1";
const DEVICE_KEY = "openbot.device.v1";
const SERVER_KEY = "openbot.server.v1";
const HOST_KEY_PREFIX = "openbot.host-key.v1:";
const HOST_PROTOCOL_PREFIX = "openbot.host-protocol.v1:";
const OPEN_CHAT_KEY = "openbot.open-chat.v1";
const X_CHATS_KEY = "openbot.x-chats.v1";
const X_CHATS_KEPT = 20;

let area: chrome.storage.StorageArea | null = null;

export function useStorageArea(next: chrome.storage.StorageArea): void {
  area = next;
}

const local = () => area ?? chrome.storage.local;

export interface ExtensionSession {
  token: string;
  user: CentralAuthUser;
}

export function decodeUser(value: unknown): CentralAuthUser | null {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.email)) return null;
  return {
    id: value.id,
    email: value.email,
    name: isString(value.name) ? value.name : null,
    avatarUrl: isString(value.avatarUrl) ? value.avatarUrl : null,
    analyticsEnabled: isBoolean(value.analyticsEnabled) ? value.analyticsEnabled : null,
    chatColor: null,
  };
}

export async function readSession(): Promise<ExtensionSession | null> {
  const value = (await local().get(SESSION_KEY))[SESSION_KEY];
  if (!isDynamicRecord(value) || !isString(value.token)) return null;
  const user = decodeUser(value.user);
  return user ? { token: value.token, user } : null;
}

export function saveSession(session: ExtensionSession): Promise<void> {
  return local().set({ [SESSION_KEY]: { token: session.token, user: { ...session.user } } });
}

export function clearSession(): Promise<void> {
  return local().remove([SESSION_KEY, SERVER_KEY, OPEN_CHAT_KEY, X_CHATS_KEY]);
}

export interface ChatToOpen {
  hostId: string;
  agentId: string;
  taskId: string | null;
}

function decodeChat(value: unknown): ChatToOpen | null {
  if (!isDynamicRecord(value) || !isString(value.hostId) || !isString(value.agentId)) return null;
  return { hostId: value.hostId, agentId: value.agentId, taskId: isString(value.taskId) ? value.taskId : null };
}

interface XChat {
  postId: string;
  chat: ChatToOpen;
}

async function readXChats(): Promise<XChat[]> {
  const value = (await local().get(X_CHATS_KEY))[X_CHATS_KEY];
  if (!isDynamicRecord(value)) return [];
  return Object.entries(value).flatMap(([postId, stored]) => {
    const chat = decodeChat(stored);
    return chat ? [{ postId, chat }] : [];
  });
}

function writeXChats(chats: XChat[]): Promise<void> {
  return local().set({
    [X_CHATS_KEY]: Object.fromEntries(
      chats.map(({ postId, chat }) => [postId, { hostId: chat.hostId, agentId: chat.agentId, taskId: chat.taskId }]),
    ),
  });
}

export async function saveXChat(postId: string, chat: ChatToOpen): Promise<void> {
  const kept = (await readXChats()).filter((entry) => entry.postId !== postId).slice(-(X_CHATS_KEPT - 1));
  await writeXChats([...kept, { postId, chat }]);
}

export async function openXChat(postId: string): Promise<void> {
  const chats = await readXChats();
  const chat = chats.find((entry) => entry.postId === postId)?.chat;
  await writeXChats(chats.filter((entry) => entry.postId !== postId));
  if (chat) await local().set({ [OPEN_CHAT_KEY]: { hostId: chat.hostId, agentId: chat.agentId, taskId: chat.taskId } });
}

export async function takeChatToOpen(): Promise<ChatToOpen | null> {
  const value = (await local().get(OPEN_CHAT_KEY))[OPEN_CHAT_KEY];
  await local().remove(OPEN_CHAT_KEY);
  return decodeChat(value);
}

export async function deviceId(): Promise<string> {
  const value = (await local().get(DEVICE_KEY))[DEVICE_KEY];
  if (isString(value)) return value;
  const id = crypto.randomUUID();
  await local().set({ [DEVICE_KEY]: id });
  return id;
}

export async function readServerId(): Promise<string | null> {
  const value = (await local().get(SERVER_KEY))[SERVER_KEY];
  return isString(value) ? value : null;
}

export function saveServerId(hostId: string): Promise<void> {
  return local().set({ [SERVER_KEY]: hostId });
}

export const hostKeys = (accountId: string) => ({
  get: async (hostId: string) => {
    const key = `${HOST_KEY_PREFIX}${accountId}:${hostId}`;
    const value = (await local().get(key))[key];
    return isString(value) ? value : null;
  },
  set: (hostId: string, publicKey: string) => local().set({ [`${HOST_KEY_PREFIX}${accountId}:${hostId}`]: publicKey }),
});

export async function readHostProtocols(accountId: string): Promise<Map<string, number>> {
  const prefix = `${HOST_PROTOCOL_PREFIX}${accountId}:`;
  const all = await local().get(null);
  const protocols = new Map<string, number>();
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix) && typeof value === "number" && Number.isSafeInteger(value) && value > 0)
      protocols.set(key.slice(prefix.length), value);
  }
  return protocols;
}

export function saveHostProtocol(accountId: string, hostId: string, protocol: number): Promise<void> {
  return local().set({ [`${HOST_PROTOCOL_PREFIX}${accountId}:${hostId}`]: protocol });
}

export function savePresenceAck(ack: PresenceAck): Promise<void> {
  return local().set({ [PRESENCE_KEY]: { ...ack } });
}
