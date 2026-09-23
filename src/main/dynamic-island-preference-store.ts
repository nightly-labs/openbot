import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  DYNAMIC_ISLAND_SIZE_LIMITS,
  type DynamicIslandPreference,
  isDynamicIslandSizePercent,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";

export async function readDynamicIslandPreference(path: string): Promise<DynamicIslandPreference> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isDynamicRecord(parsed) || !isBoolean(parsed.enabled)) {
      return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
    }
    if (parsed.version === 1) return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE, enabled: parsed.enabled };
    if (parsed.version === 2 && isBoolean(parsed.hapticsEnabled)) {
      return {
        ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
        enabled: parsed.enabled,
        hapticsEnabled: parsed.hapticsEnabled,
      };
    }
    if (
      parsed.version !== 3 ||
      !isBoolean(parsed.hapticsEnabled) ||
      !isBoolean(parsed.idleVisible) ||
      !isBoolean(parsed.additionalDisplaysEnabled)
    ) {
      return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
    }
    return {
      enabled: parsed.enabled,
      hapticsEnabled: parsed.hapticsEnabled,
      idleVisible: parsed.idleVisible,
      additionalDisplaysEnabled: parsed.additionalDisplaysEnabled,
      // The size is optional so that 0.18.0 and earlier, which refuse any version but 3, still read
      // this file. A missing or out-of-range size resets only the size, so a bad value cannot make
      // the island too small to find and does not discard the switches beside it.
      widthPercent: isDynamicIslandSizePercent(parsed.widthPercent, DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent)
        ? parsed.widthPercent
        : DEFAULT_DYNAMIC_ISLAND_PREFERENCE.widthPercent,
      heightPercent: isDynamicIslandSizePercent(parsed.heightPercent, DYNAMIC_ISLAND_SIZE_LIMITS.heightPercent)
        ? parsed.heightPercent
        : DEFAULT_DYNAMIC_ISLAND_PREFERENCE.heightPercent,
    };
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
    throw error;
  }
}

export async function writeDynamicIslandPreference(
  path: string,
  preference: DynamicIslandPreference,
): Promise<DynamicIslandPreference> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ version: 3, ...preference })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    return { ...preference };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
