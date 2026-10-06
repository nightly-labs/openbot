import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function isCurrentInstallation(verify: () => Promise<void>): Promise<boolean> {
  try {
    await verify();
    return true;
  } catch {
    return false;
  }
}

export async function download(fetchImpl: typeof fetch, url: string, label: string): Promise<Buffer> {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "OpenBot-runtime-installer" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${label} download failed with HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

/** Splits a relative archive path into parts and rejects absolute, drive, `.` and `..` paths. */
export function safeArchivePathParts(name: string, label: string): string[] {
  if (name.includes("\0") || name.includes("\\")) throw new Error(`Unsafe ${label} archive path: ${name}`);
  const normalized = name.replace(/\/+$/u, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`Unsafe ${label} archive path: ${name}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe ${label} archive path: ${name}`);
  }
  return parts;
}

export async function installValidatedTree(source: string, destination: string): Promise<void> {
  const temporaryTarget = join(dirname(destination), `.${destination.split(/[\\/]/u).at(-1)}.installing`);
  await mkdir(dirname(destination), { recursive: true });
  await rm(temporaryTarget, { recursive: true, force: true });
  await cp(source, temporaryTarget, { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(temporaryTarget, destination);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
