import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { HostManagerConfig, HostTenantStatus, HostUpdateState } from "../../packages/contracts/src/host-manager";

export const HOST_MANAGER_DIRECTORY = "/Library/Application Support/OpenBot/HostManager";
export const HOST_POLL_MS = 5_000;
export const HOST_HEARTBEAT_TIMEOUT_MS = 20_000;
export const HOST_IDLE_GRACE_MS = 300_000;
const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/)
  .max(64);
export const hostConfigSchema: z.ZodType<HostManagerConfig> = z
  .object({
    managed: z.boolean(),
    tenants: z
      .array(z.number().int().min(501))
      .min(1)
      .max(100)
      .refine((uids) => new Set(uids).size === uids.length),
  })
  .strict();
export const hostStateSchema: z.ZodType<HostUpdateState> = z
  .object({
    phase: z.enum(["idle", "downloading", "waiting", "stopping", "installing", "released", "failed"]),
    cycle: z.string().max(64),
    version: version.nullable(),
    updatedAt: z.number().nonnegative(),
    error: z.string().max(300).nullable(),
  })
  .strict();
export const tenantStatusSchema: z.ZodType<HostTenantStatus> = z
  .object({
    uid: z.number().int().min(501),
    pid: z.number().int().positive(),
    currentVersion: version,
    heartbeatAt: z.number().nonnegative(),
    safeToRestart: z.boolean(),
    idleSince: z.number().nonnegative().nullable(),
    cycle: z.string().max(64),
    healthy: z.boolean(),
  })
  .strict();

/** Each ancestor is immutable to tenants. Never accept a symlink as a directory. */
export async function verifyHostDirectory(path: string, hostUid = 0): Promise<void> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (parent !== absolute) await verifyHostDirectory(parent, hostUid);
  const info = await lstat(absolute);
  // Tests use a private directory below the OS temporary directory. Production always uses UID 0.
  if (!info.isDirectory() || (info.uid !== 0 && info.uid !== hostUid) || (info.mode & 0o022) !== 0) {
    throw new Error("Host directory must have a trusted owner and no group or public write permission.");
  }
}

export async function readOwnedJson<T>(path: string, uid: number, schema: z.ZodType<T>): Promise<T> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== uid || info.nlink !== 1 || (info.mode & 0o022) !== 0 || info.size > 8192) {
      throw new Error("Invalid host protocol file ownership, type, permissions or size.");
    }
    // Bound the read even if the tenant grows its file after fstat.
    const buffer = Buffer.alloc(8193);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 8192) throw new Error("Host protocol file is too large.");
    return schema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
  } finally {
    await handle.close();
  }
}

/** Rename replaces the directory entry; it never opens an existing destination or symlink. */
export async function writeProtocolJson(
  path: string,
  value: HostUpdateState | HostTenantStatus | HostManagerConfig,
): Promise<void> {
  const temporary = join(dirname(path), `.write-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o644);
  try {
    await handle.chmod(0o644);
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch (error) {
    await unlink(temporary).catch((cleanupError: unknown) => {
      if (!isMissingFile(cleanupError)) throw cleanupError;
    });
    throw error;
  }
}

export async function readHostConfig(
  directory = HOST_MANAGER_DIRECTORY,
  hostUid = 0,
): Promise<HostManagerConfig | null> {
  try {
    await verifyHostDirectory(directory, hostUid);
    return await readOwnedJson(join(directory, "config.json"), hostUid, hostConfigSchema);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function verifyTenantDirectory(directory: string, uid: number, hostUid = 0): Promise<string> {
  await verifyHostDirectory(join(directory, "tenants"), hostUid);
  const path = join(directory, "tenants", String(uid));
  const info = await lstat(path);
  // The parent is root-owned, so a tenant cannot replace this directory with a symlink.
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw new Error("Invalid tenant status directory.");
  }
  return path;
}
