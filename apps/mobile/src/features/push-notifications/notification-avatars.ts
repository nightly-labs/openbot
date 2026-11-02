import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { type AvatarFileAgent, agentAvatarFile, syncAvatarFolder } from "@/features/workspace/model/agent-avatar-file";

/**
 * `OpenBotMessagingService.kt` reads this file and the pictures of its folder in the files folder of
 * the app (`Paths.document`), and shows the picture of the agent as the large icon of its
 * notification. iOS reads the pictures of the share extension (`share-extension.ts`).
 */
const INDEX_FILE = "notification-avatars.json";
const AVATAR_FOLDER = "notification-avatars";
/** 64 dp at 3x, the size of the large icon of an Android notification. */
const AVATAR_PIXELS = 192;

export interface NotificationAvatar {
  serverId: string;
  id: string;
  /** A file in `AVATAR_FOLDER`. */
  avatar: string;
}

/** Only Android reads the files. */
export const notificationAvatarsSupported = Platform.OS === "android";

export function notificationAvatarName(agent: AvatarFileAgent): string {
  return agentAvatarFile(agent, AVATAR_PIXELS).name;
}

function decodeAvatar(value: unknown): NotificationAvatar | null {
  if (!isDynamicRecord(value) || !isString(value.serverId) || !isString(value.id) || !isString(value.avatar)) {
    return null;
  }
  return { serverId: value.serverId, id: value.id, avatar: value.avatar };
}

/** The pictures that the app wrote last. */
export function readNotificationAvatars(): NotificationAvatar[] {
  if (!notificationAvatarsSupported) return [];
  try {
    const file = new File(Paths.document, INDEX_FILE);
    if (!file.exists) return [];
    const value = JSON.parse(file.textSync());
    if (!isDynamicRecord(value) || value.version !== 1 || !Array.isArray(value.agents)) return [];
    return value.agents.flatMap((agent: unknown) => decodeAvatar(agent) ?? []);
  } catch {
    return [];
  }
}

let writtenIndex: string | null = null;

/**
 * Writes the pictures that `index` names and are missing, from `agents`, and removes the pictures
 * that it no longer names. Then the index goes, so the service finds each picture.
 */
export function writeNotificationAvatars(
  index: readonly NotificationAvatar[],
  agents: readonly AvatarFileAgent[],
): void {
  const text = JSON.stringify({ version: 1, agents: index });
  if (!notificationAvatarsSupported || text === writtenIndex) return;
  try {
    const named = new Set(index.map((agent) => agent.avatar));
    syncAvatarFolder(new Directory(Paths.document, AVATAR_FOLDER), named, agents, AVATAR_PIXELS, "Notification avatar");
    new File(Paths.document, INDEX_FILE).writeSync(text);
    writtenIndex = text;
  } catch (error) {
    supportLog.add("warn", "app", `Notification avatars not saved: ${supportLogValue(error)}`);
  }
}

/** Sign-out removes the pictures. */
export function resetNotificationAvatars(): void {
  writtenIndex = null;
  if (!notificationAvatarsSupported) return;
  try {
    const file = new File(Paths.document, INDEX_FILE);
    if (file.exists) file.delete();
    const folder = new Directory(Paths.document, AVATAR_FOLDER);
    if (folder.exists) folder.delete();
  } catch (error) {
    supportLog.add("warn", "app", `Notification avatars not removed: ${supportLogValue(error)}`);
  }
}
