import { readFile } from "node:fs/promises";
import type { UpdatePreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";

const DEFAULT_PREFERENCE: UpdatePreference = { autoDownload: true };

export async function readUpdatePreference(path: string): Promise<UpdatePreference> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isBoolean(parsed.autoDownload)) {
      return { ...DEFAULT_PREFERENCE };
    }
    return { autoDownload: parsed.autoDownload };
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return { ...DEFAULT_PREFERENCE };
    throw error;
  }
}

/**
 * Writes are serialized because each one renames its own temporary file into place. Two quick toggles
 * would otherwise race, and the earlier rename could land last and persist the value the user just
 * turned off. Chaining also keeps the replies in invocation order, so the renderer adopts the latest.
 */
let pendingWrite: Promise<unknown> = Promise.resolve();

export function writeUpdatePreference(path: string, autoDownload: boolean): Promise<UpdatePreference> {
  const write = pendingWrite.then(
    () => replaceUpdatePreference(path, autoDownload),
    () => replaceUpdatePreference(path, autoDownload),
  );
  pendingWrite = write.catch(() => undefined);
  return write;
}

async function replaceUpdatePreference(path: string, autoDownload: boolean): Promise<UpdatePreference> {
  const preference = { autoDownload };
  await writeJsonFileAtomically(path, { version: 1, autoDownload });
  return preference;
}
