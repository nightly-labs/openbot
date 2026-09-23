import { readFile } from "node:fs/promises";
import type { AnalyticsPreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";

const DEFAULT_PREFERENCE: AnalyticsPreference = { enabled: true };

export async function readAnalyticsPreference(path: string): Promise<AnalyticsPreference> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isBoolean(parsed.enabled)) {
      return { enabled: false };
    }
    return { enabled: parsed.enabled };
  } catch (error) {
    if (isMissingFileError(error)) return { ...DEFAULT_PREFERENCE };
    if (error instanceof SyntaxError) return { enabled: false };
    throw error;
  }
}

export async function writeAnalyticsPreference(path: string, enabled: boolean): Promise<AnalyticsPreference> {
  const preference = { enabled };
  await writeJsonFileAtomically(path, { version: 1, enabled });
  return preference;
}
