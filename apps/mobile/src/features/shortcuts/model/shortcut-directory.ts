import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { File, Paths } from "expo-file-system";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";

export interface ShortcutDirectory {
  version: 2;
  apiUrl: string;
  userId: string;
  locked: boolean;
  agent: ShortcutDirectoryAgent | null;
  agents: ShortcutDirectoryAgent[];
  text: Record<string, string>;
  accent: string;
}

export interface ShortcutDirectoryAgent {
  serverId: string;
  id: string;
  name: string;
  server: string;
  avatar?: string;
}

const APP_GROUP = "group.run.openbot.mobile";
const DIRECTORY_FILE = "shortcuts.json";

function directoryFile(): File | null {
  const container = Paths.appleSharedContainers[APP_GROUP];
  return container ? new File(container, DIRECTORY_FILE) : null;
}

function decodeAgent(value: unknown): ShortcutDirectoryAgent | null {
  if (!isDynamicRecord(value)) return null;
  const { serverId, id, name, server, avatar } = value;
  if (!isString(serverId) || !isString(id) || !isString(name) || !isString(server)) return null;
  return { serverId, id, name, server, ...(isString(avatar) ? { avatar } : {}) };
}

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

export function resetShortcutDirectory(): void {
  written = null;
  try {
    const file = directoryFile();
    if (file?.exists) file.delete();
  } catch (error) {
    supportLog.add("warn", "app", `Shortcut data not removed: ${supportLogValue(error)}`);
  }
}
