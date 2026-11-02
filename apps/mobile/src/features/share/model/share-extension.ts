import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { Directory, File, Paths } from "expo-file-system";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import {
  type AvatarFileAgent as AvatarAgent,
  agentAvatarFile,
  syncAvatarFolder,
} from "@/features/workspace/model/agent-avatar-file";

/**
 * What the iOS share extension needs to send a share without the app. It reads this file from the
 * App Group and the session from the shared keychain item (`modules/share-extension`). The file has
 * no secret: names, server IDs and the public keys of the servers.
 */
export interface ShareExtensionDirectory {
  version: 1;
  apiUrl: string;
  userId: string;
  /** The app lock is on, or its settings are not read yet. The extension then opens the app. */
  locked: boolean;
  servers: ShareExtensionServer[];
  agents: ShareExtensionAgent[];
  /** The agent of the last share in the app, which the extension selects first. */
  lastTarget: { serverId: string; agentId: string } | null;
  /** The extension's text in the app's language, by catalog key. */
  text: Record<string, string>;
  /** The app's accent color, as `#rrggbb`. */
  accent: string;
}

interface ShareExtensionServer {
  id: string;
  name: string;
  /** The key the app connects with. The extension connects only to a server with this key. */
  publicKey: string;
  hosted: boolean;
}

export interface ShareExtensionAgent {
  serverId: string;
  id: string;
  name: string;
  /** The agent's picture: a file in `share-extension-avatars` of the App Group. */
  avatar?: string;
}

declare class ShareExtensionModule extends NativeModule {
  setSession(value: string | null): Promise<void>;
  donate(target: { conversationId: string; agentName: string; avatarUri?: string }): Promise<void>;
  forget(conversationIds: string[] | null): Promise<void>;
}

/** `modules/share-extension`. Android, Expo Go and a build without the module have no extension to feed. */
const native = requireOptionalNativeModule<ShareExtensionModule>("OpenBotShareExtension");

/** The App Group of the app and its extensions. `app.json` names the same group. */
const APP_GROUP = "group.run.openbot.mobile";
/** `plugins/share-extension/ShareExtensionData.swift` and `NotificationService.swift` read this file. */
const DIRECTORY_FILE = "share-extension.json";
/**
 * `plugins/share-extension/ShareView.swift` reads the pictures from this folder, and
 * `plugins/notification-service/NotificationService.swift` reads them with the agents of the file.
 */
const AVATAR_FOLDER = "share-extension-avatars";
/** 36 points at 3x, the size of the extension's avatar. */
const AVATAR_PIXELS = 108;

/** The ID that the extension reads from a share suggestion. */
export function shareConversationId(serverId: string, agentId: string): string {
  return `${serverId}/${agentId}`;
}

function directoryFile(): File | null {
  const container = Paths.appleSharedContainers[APP_GROUP];
  // The App Group is missing when the app was built without the extension.
  return container ? new File(container, DIRECTORY_FILE) : null;
}

function avatarFolder(): Directory | null {
  const container = Paths.appleSharedContainers[APP_GROUP];
  return container ? new Directory(container, AVATAR_FOLDER) : null;
}

/** The file name of the agent's picture. `writeShareExtensionDirectory` writes the file. */
export function shareAvatarName(agent: AvatarAgent): string {
  return agentAvatarFile(agent, AVATAR_PIXELS).name;
}

function decodeAgent(value: unknown): ShareExtensionAgent | null {
  if (!isDynamicRecord(value) || !isString(value.serverId) || !isString(value.id) || !isString(value.name)) return null;
  const agent: ShareExtensionAgent = { serverId: value.serverId, id: value.id, name: value.name };
  if (isString(value.avatar)) agent.avatar = value.avatar;
  return agent;
}

/** The agents of the file that the app wrote last. Null when there is none, or it is for another account. */
export function readShareExtensionAgents(apiUrl: string, userId: string): ShareExtensionAgent[] | null {
  try {
    const file = directoryFile();
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
/** The picture of each offered agent, for the share suggestions that the app donates. */
let avatarUris = new Map<string, string>();

/**
 * Writes the pictures that the directory names and are missing, from `avatars`, and removes the
 * pictures that it no longer names. Then the directory file goes, so the extension finds each picture.
 */
function writeAvatars(directory: ShareExtensionDirectory, avatars: readonly AvatarAgent[]): void {
  const folder = avatarFolder();
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
    const file = directoryFile();
    if (!file) return;
    writeAvatars(directory, avatars);
    file.writeSync(text);
    writtenDirectory = text;
  } catch (error) {
    supportLog.add("warn", "app", `Share extension data not saved: ${supportLogValue(error)}`);
  }
}

let writtenSession: string | null = null;
/** False after sign-out, so a send that ends later does not give iOS a suggestion again. */
let signedIn = false;

/** Gives the extension the session of the app. The token goes to the keychain only, never to the file. */
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

/** The share sheet offers agents that get messages from this phone. */
export function donateShareTarget(serverId: string, agentId: string, agentName: string): void {
  if (!signedIn) return;
  const conversationId = shareConversationId(serverId, agentId);
  const avatarUri = avatarUris.get(conversationId);
  void native?.donate({ conversationId, agentName, ...(avatarUri ? { avatarUri } : {}) }).catch(() => undefined);
}

/** Removes the share suggestions of agents that are gone. */
export function forgetShareTargets(conversationIds: string[]): void {
  if (conversationIds.length > 0) void native?.forget(conversationIds).catch(() => undefined);
}

/** Without a session the extension has nothing: no token, no agents and no suggestions. */
export function resetShareExtension(): void {
  signedIn = false;
  writtenSession = null;
  writtenDirectory = null;
  avatarUris = new Map();
  try {
    const file = directoryFile();
    if (file?.exists) file.delete();
    const folder = avatarFolder();
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

/**
 * Locks the saved directory when the app cannot write a new one, such as while the account directory
 * loads. The extension then opens the app, which asks for the app lock.
 */
export function lockShareExtension(): void {
  try {
    const file = directoryFile();
    if (!file?.exists) return;
    const value = JSON.parse(file.textSync());
    if (!isDynamicRecord(value) || value.locked === true) return;
    file.writeSync(JSON.stringify({ ...value, locked: true }));
    writtenDirectory = null;
  } catch (error) {
    supportLog.add("warn", "app", `Share extension data not locked: ${supportLogValue(error)}`);
  }
}
