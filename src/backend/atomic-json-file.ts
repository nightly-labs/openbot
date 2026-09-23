import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Every stored JSON file carries a schema version, so a later release can read an older one. */
export interface VersionedJsonFile {
  version: number;
}

export interface WriteJsonFileOptions {
  /** Creates the parent directory, readable only by the user, when it is missing. */
  createDirectory?: boolean;
}

/**
 * Replaces `path` with `value` as one line of JSON, readable only by the user.
 *
 * The value goes to a temporary sibling first and is renamed over `path`, so a crash leaves the
 * previous file or the new one, never a truncated one. Each call has its own temporary name, so
 * overlapping writes never share a file, and a failed write removes its temporary file.
 */
export async function writeJsonFileAtomically<Content extends VersionedJsonFile>(
  path: string,
  value: Content,
  options: WriteJsonFileOptions = {},
): Promise<void> {
  if (options.createDirectory) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
