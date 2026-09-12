import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { type AppLanguagePreference, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

const DEFAULT_PREFERENCE: AppLanguagePreference = { language: DEFAULT_APP_LANGUAGE };

/**
 * The saved language, or the system default.
 *
 * A file that is missing, unreadable or names a language this build no longer ships reads as the
 * system default. Unlike the analytics preference there is no safe-by-default direction to fall
 * back to: an unreadable file must not leave the app with no language at all.
 */
export async function readLanguagePreference(path: string): Promise<AppLanguagePreference> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppLanguage(parsed.language)) {
      return { ...DEFAULT_PREFERENCE };
    }
    return { language: parsed.language };
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return { ...DEFAULT_PREFERENCE };
    throw error;
  }
}

export async function writeLanguagePreference(
  path: string,
  preference: AppLanguagePreference,
): Promise<AppLanguagePreference> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ version: 1, language: preference.language })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    return { language: preference.language };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
