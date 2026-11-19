import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { appGroupFile, lockAppGroupFile } from "@/shared/lib/app-group";

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

const DIRECTORY_FILE = "shortcuts.json";

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
    const file = appGroupFile(DIRECTORY_FILE);
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
    const file = appGroupFile(DIRECTORY_FILE);
    if (!file) return;
    file.writeSync(text);
    written = text;
  } catch (error) {
    supportLog.add("warn", "app", `Shortcut data not saved: ${supportLogValue(error)}`);
  }
}

export function lockShortcutDirectory(): void {
  try {
    if (lockAppGroupFile(DIRECTORY_FILE)) written = null;
  } catch (error) {
    supportLog.add("warn", "app", `Shortcut data not locked: ${supportLogValue(error)}`);
  }
}

export function resetShortcutDirectory(): void {
  written = null;
  try {
    const file = appGroupFile(DIRECTORY_FILE);
    if (file?.exists) file.delete();
  } catch (error) {
    supportLog.add("warn", "app", `Shortcut data not removed: ${supportLogValue(error)}`);
  }
}
