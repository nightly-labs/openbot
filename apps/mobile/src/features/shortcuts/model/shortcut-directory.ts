import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { File, Paths } from "expo-file-system";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";

/**
 * What the App Intents of the shortcuts read from the App Group
 * (`plugins/shortcuts/ShortcutData.swift`). The intents run in native code with no JavaScript, also
 * when the app is not in memory: they list the agents, send a message to the agent of the setting,
 * and say why a shortcut cannot run. The file has no secret: names and IDs. It stays on this phone,
 * and sign-out deletes it.
 *
 * The intents take the rest from the data of the share extension, which the app keeps current
 * (`src/features/share/model/share-extension.ts`): the servers with their keys, the agent pictures,
 * and the session token in the keychain.
 */
export interface ShortcutDirectory {
  /** `ShortcutData.swift` reads only this version. An older file reads as no file. */
  version: 2;
  apiUrl: string;
  userId: string;
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

export interface ShortcutDirectoryAgent {
  serverId: string;
  id: string;
  name: string;
  /** The name of the agent's server. */
  server: string;
  /** The agent's picture: a file of the share extension, named by `shareAvatarName`. */
  avatar?: string;
}

/** The App Group of the app and its extensions. `app.json` names the same group. */
const APP_GROUP = "group.run.openbot.mobile";
const DIRECTORY_FILE = "shortcuts.json";

function directoryFile(): File | null {
  const container = Paths.appleSharedContainers[APP_GROUP];
  // The App Group is missing on Android and in a build without the widget extension.
  return container ? new File(container, DIRECTORY_FILE) : null;
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

export function writeShortcutDirectory(directory: ShortcutDirectory): void {
  const text = JSON.stringify(directory);
  if (text === written) return;
  try {
    const file = directoryFile();
    if (!file) return;
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

/** Without a session the shortcuts have no agents. */
export function resetShortcutDirectory(): void {
  written = null;
  try {
    const file = directoryFile();
    if (file?.exists) file.delete();
  } catch (error) {
    supportLog.add("warn", "app", `Shortcut data not removed: ${supportLogValue(error)}`);
  }
}
