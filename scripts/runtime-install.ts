import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("runtime-install");

export async function isCurrentInstallation(verify: () => Promise<void>): Promise<boolean> {
  try {
    await verify();
    return true;
  } catch {
    return false;
  }
}

export async function download(fetchImpl: typeof fetch, url: string, label: string): Promise<Buffer> {
  const attempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await fetchImpl(url, {
        headers: { "User-Agent": "OpenBot-runtime-installer" },
        redirect: "follow",
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      failure = error;
    }
    if (response && !response.ok) {
      failure = new Error(`${label} download failed with HTTP ${response.status}.`);
      if (response.status !== 429 && response.status < 500) throw failure;
      await response.body?.cancel();
    }
    if (attempt === attempts) throw failure;
    logger.warn(`${label} download failed (attempt ${attempt} of ${attempts}): ${String(failure)}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 5_000));
  }
}

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
