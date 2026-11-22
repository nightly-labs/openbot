import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { File } from "expo-file-system";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import {
  type AvatarFileAgent as AvatarAgent,
  agentAvatarFile,
  syncAvatarFolder,
} from "@/features/workspace/model/agent-avatar-file";
import { appGroupDirectory, appGroupFile, lockAppGroupFile } from "@/shared/lib/app-group";

export interface ShareExtensionDirectory {
  version: 1;
  apiUrl: string;
  userId: string;
  locked: boolean;
  servers: ShareExtensionServer[];
  agents: ShareExtensionAgent[];
  lastTarget: { serverId: string; agentId: string } | null;
  text: Record<string, string>;
  accent: string;
}

interface ShareExtensionServer {
  id: string;
  name: string;
  publicKey: string;
  hosted: boolean;
}

export interface ShareExtensionAgent {
  serverId: string;
  id: string;
  name: string;
  avatar?: string;
}

declare class ShareExtensionModule extends NativeModule {
  setSession(value: string | null): Promise<void>;
  donate(target: { conversationId: string; agentName: string; avatarUri?: string }): Promise<void>;
  forget(conversationIds: string[] | null): Promise<void>;
}

const native = requireOptionalNativeModule<ShareExtensionModule>("OpenBotShareExtension");

const DIRECTORY_FILE = "share-extension.json";
const AVATAR_FOLDER = "share-extension-avatars";
const AVATAR_PIXELS = 108;

export function shareConversationId(serverId: string, agentId: string): string {
  return `${serverId}/${agentId}`;
}

export function shareAvatarName(agent: AvatarAgent): string {
  return agentAvatarFile(agent, AVATAR_PIXELS).name;
}

function decodeAgent(value: unknown): ShareExtensionAgent | null {
  if (!isDynamicRecord(value) || !isString(value.serverId) || !isString(value.id) || !isString(value.name)) return null;
  const agent: ShareExtensionAgent = { serverId: value.serverId, id: value.id, name: value.name };
  if (isString(value.avatar)) agent.avatar = value.avatar;
  return agent;
}

export function readShareExtensionAgents(apiUrl: string, userId: string): ShareExtensionAgent[] | null {
  try {
    const file = appGroupFile(DIRECTORY_FILE);
    if (!file?.exists) return null;
    const value = JSON.parse(file.textSync());
    if (!isDynamicRecord(value) || value.apiUrl !== apiUrl || value.userId !== userId) return null;
    if (!Array.isArray(value.agents)) return null;
    return value.agents.flatMap((agent: unknown) => decodeAgent(agent) ?? []);
  } catch {
    return null;
  }
}

let writtenDirectory: string | null = null;
let avatarUris = new Map<string, string>();

function writeAvatars(directory: ShareExtensionDirectory, avatars: readonly AvatarAgent[]): void {
  const folder = appGroupDirectory(AVATAR_FOLDER);
  if (!folder) return;
  const named = new Set(directory.agents.flatMap((agent) => agent.avatar ?? []));
  syncAvatarFolder(folder, named, avatars, AVATAR_PIXELS, "Share extension avatar");
  avatarUris = new Map(
    directory.agents.flatMap((agent) =>
      agent.avatar ? [[shareConversationId(agent.serverId, agent.id), new File(folder, agent.avatar).uri]] : [],
    ),
  );
}

export function writeShareExtensionDirectory(
  directory: ShareExtensionDirectory,
  avatars: readonly AvatarAgent[],
): void {
  const text = JSON.stringify(directory);
  if (text === writtenDirectory) return;
  try {
    const file = appGroupFile(DIRECTORY_FILE);
    if (!file) return;
    writeAvatars(directory, avatars);
    file.writeSync(text);
    writtenDirectory = text;
  } catch (error) {
    supportLog.add("warn", "app", `Share extension data not saved: ${supportLogValue(error)}`);
  }
}

let writtenSession: string | null = null;
let signedIn = false;

export function setShareExtensionSession(session: { apiUrl: string; userId: string; sessionToken: string }): void {
  signedIn = true;
  const value = JSON.stringify(session);
  if (!native || value === writtenSession) return;
  writtenSession = value;
  native.setSession(value).catch((error: unknown) => {
    if (writtenSession === value) writtenSession = null;
    supportLog.add("warn", "app", `Share extension session not saved: ${supportLogValue(error)}`);
  });
}

export function donateShareTarget(serverId: string, agentId: string, agentName: string): void {
  if (!signedIn) return;
  const conversationId = shareConversationId(serverId, agentId);
  const avatarUri = avatarUris.get(conversationId);
  void native?.donate({ conversationId, agentName, ...(avatarUri ? { avatarUri } : {}) }).catch(() => undefined);
}

export function forgetShareTargets(conversationIds: string[]): void {
  if (conversationIds.length > 0) void native?.forget(conversationIds).catch(() => undefined);
}

export function resetShareExtension(): void {
  signedIn = false;
  writtenSession = null;
  writtenDirectory = null;
  avatarUris = new Map();
  try {
    const file = appGroupFile(DIRECTORY_FILE);
    if (file?.exists) file.delete();
    const folder = appGroupDirectory(AVATAR_FOLDER);
    if (folder?.exists) folder.delete();
  } catch (error) {
    supportLog.add("warn", "app", `Share extension data not removed: ${supportLogValue(error)}`);
  }
  if (!native) return;
  native.setSession(null).catch((error: unknown) => {
    supportLog.add("warn", "app", `Share extension session not removed: ${supportLogValue(error)}`);
  });
  void native.forget(null).catch(() => undefined);
}

export function lockShareExtension(): void {
  try {
    if (lockAppGroupFile(DIRECTORY_FILE)) writtenDirectory = null;
  } catch (error) {
    supportLog.add("warn", "app", `Share extension data not locked: ${supportLogValue(error)}`);
  }
}
