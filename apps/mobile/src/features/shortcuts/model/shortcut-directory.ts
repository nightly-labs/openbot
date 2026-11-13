import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Directory, File, Paths } from "expo-file-system";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import {
  type AvatarFileAgent as AvatarAgent,
  agentAvatarFile,
  syncAvatarFolder,
} from "@/features/workspace/model/agent-avatar-file";

/**
 * What the App Intents of the shortcuts read from the App Group
 * (`plugins/shortcuts/ShortcutData.swift`). The intents run in native code with no JavaScript, also
 * when the app is not in memory: they list the agents, send a message to the agent of the setting,
 * and say why a shortcut cannot run. The file has no secret: names, IDs and the public keys of the
 * servers. The session token is in the keychain item of the share extension. The file stays on this
 * phone, and sign-out deletes it.
 */
export interface ShortcutDirectory {
  /** `ShortcutData.swift` reads only this version. An older file reads as no file. */
  version: 2;
  apiUrl: string;
  userId: string;
  servers: ShortcutDirectoryServer[];
  /** The app lock is on, or its settings are not read yet. A shortcut then opens the app. */
  locked: boolean;
  /** The agent that gets the messages of the shortcuts. Null until the user chooses one. */
  agent: ShortcutDirectoryAgent | null;
  agents: ShortcutDirectoryAgent[];
  /** The text of the cards that an intent draws by itself, in the app's language, by catalog key. */
  text: Record<string, string>;
  /** The app's accent color, as `#rrggbb`. */
  accent: string;
}

interface ShortcutDirectoryServer {
  id: string;
  /** The key the app connects with. A message goes only to a server with this key. */
  publicKey: string;
  hosted: boolean;
}

export interface ShortcutDirectoryAgent {
  serverId: string;
  id: string;
  name: string;
  /** The name of the agent's server. */
  server: string;
  /** The agent's picture: a file in `shortcut-avatars` of the App Group. */
  avatar?: string;
}

/** The App Group of the app and its extensions. `app.json` names the same group. */
const APP_GROUP = "group.run.openbot.mobile";
const DIRECTORY_FILE = "shortcuts.json";
const AVATAR_FOLDER = "shortcut-avatars";
/** 36 points at 3x, the size of the picture on a card. */
const AVATAR_PIXELS = 108;

function directoryFile(): File | null {
  const container = Paths.appleSharedContainers[APP_GROUP];
  // The App Group is missing on Android and in a build without the widget extension.
  return container ? new File(container, DIRECTORY_FILE) : null;
}

function avatarFolder(): Directory | null {
  const container = Paths.appleSharedContainers[APP_GROUP];
  return container ? new Directory(container, AVATAR_FOLDER) : null;
}

/** The file name of the agent's picture. `writeShortcutDirectory` writes the file. */
export function shortcutAvatarName(agent: AvatarAgent): string {
  return agentAvatarFile(agent, AVATAR_PIXELS).name;
}

function decodeAgent(value: unknown): ShortcutDirectoryAgent | null {
  if (!isDynamicRecord(value)) return null;
  const { serverId, id, name, server, avatar } = value;
  if (!isString(serverId) || !isString(id) || !isString(name) || !isString(server)) return null;
  return { serverId, id, name, server, ...(isString(avatar) ? { avatar } : {}) };
}

/**
 * The agents of the file that the app wrote last, and the agent of the setting. Null when there is
 * no file, or it is for another account.
 */
export function readShortcutDirectory(
  apiUrl: string,
  userId: string,
): Pick<ShortcutDirectory, "agent" | "agents"> | null {
  try {
    const file = directoryFile();
    if (!file?.exists) return null;
    const value = JSON.parse(file.textSync());
    if (!isDynamicRecord(value) || value.apiUrl !== apiUrl || value.userId !== userId) return null;
    if (!Array.isArray(value.agents)) return null;
    return {
      agent: decodeAgent(value.agent),
      agents: value.agents.flatMap((agent: unknown) => decodeAgent(agent) ?? []),
    };
  } catch {
    return null;
  }
}

let written: string | null = null;

/**
 * Writes the pictures that the directory names and are missing, from `avatars`, and removes the
 * pictures that it no longer names. Then the directory file goes, so a card finds each picture.
 */
export function writeShortcutDirectory(directory: ShortcutDirectory, avatars: readonly AvatarAgent[]): void {
  const text = JSON.stringify(directory);
  if (text === written) return;
  try {
    const file = directoryFile();
    if (!file) return;
    const folder = avatarFolder();
    if (folder) {
      // The agent of the setting can be a hidden chat, which the list does not have.
      const shown = directory.agent ? [...directory.agents, directory.agent] : directory.agents;
      const named = new Set(shown.flatMap((agent) => agent.avatar ?? []));
      syncAvatarFolder(folder, named, avatars, AVATAR_PIXELS, "Shortcut avatar");
    }
    file.writeSync(text);
    written = text;
  } catch (error) {
    supportLog.add("warn", "app", `Shortcut data not saved: ${supportLogValue(error)}`);
  }
}

/**
 * Locks the saved directory when the app cannot write a new one, such as while the account directory
 * loads. A shortcut then opens the app, which asks for the app lock.
 */
export function lockShortcutDirectory(): void {
  try {
    const file = directoryFile();
    if (!file?.exists) return;
    const value = JSON.parse(file.textSync());
    if (!isDynamicRecord(value) || value.locked === true) return;
    file.writeSync(JSON.stringify({ ...value, locked: true }));
    written = null;
  } catch (error) {
    supportLog.add("warn", "app", `Shortcut data not locked: ${supportLogValue(error)}`);
  }
}

/** Without a session the shortcuts have nothing: no agents and no pictures. */
export function resetShortcutDirectory(): void {
  written = null;
  try {
    const file = directoryFile();
    if (file?.exists) file.delete();
    const folder = avatarFolder();
    if (folder?.exists) folder.delete();
  } catch (error) {
    supportLog.add("warn", "app", `Shortcut data not removed: ${supportLogValue(error)}`);
  }
}
