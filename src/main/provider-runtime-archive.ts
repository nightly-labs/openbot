import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024;

/**
 * The archive checks a provider runtime shares. They are here rather than in the manager because
 * the per-provider staging steps in `provider-runtime-descriptors.ts` are what call them, and a
 * provider must not be able to skip them by writing its own extraction.
 *
 * `allowedRoots` is the set of top-level names the archive may contain: an archive that unpacks
 * anything else is rejected before extraction, so a changed upstream layout is a loud failure
 * rather than a file written where OpenBot did not expect one.
 */
export async function assertSafeArchive(path: string, allowedRoots: readonly string[], message: string): Promise<void> {
  const [{ stdout: namesValue }, { stdout: detailsValue }] = await Promise.all([
    execFileAsync("tar", ["-tzf", path], { encoding: "utf8", maxBuffer: MAX_ARCHIVE_LIST_BYTES }),
    execFileAsync("tar", ["-tvzf", path], { encoding: "utf8", maxBuffer: MAX_ARCHIVE_LIST_BYTES }),
  ]);
  const names = namesValue.split(/\r?\n/u).filter(Boolean);
  const details = detailsValue.split(/\r?\n/u).filter(Boolean);
  if (details.some((line) => !["-", "d"].includes(line.trimStart().charAt(0)))) {
    throw new Error("The runtime archive contains a link or special file.");
  }
  for (const name of names) {
    if (name.includes("\0") || name.includes("\\")) throw new Error("The runtime archive contains an unsafe path.");
    const normalized = name.replace(/\/+$/u, "");
    const parts = normalized.split("/");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:/u.test(normalized) ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("The runtime archive contains an unsafe path.");
    }
    if (!allowedRoots.includes(parts[0] ?? "")) throw new Error(message);
  }
}

export async function extractArchive(archive: string, destination: string): Promise<void> {
  await execFileAsync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"], {
    encoding: "utf8",
    maxBuffer: MAX_ARCHIVE_LIST_BYTES,
  });
}

export async function rejectNonRegularFiles(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new Error("The runtime contains a link or special file.");
      }
      if (entry.isDirectory()) await rejectNonRegularFiles(path);
    }),
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
