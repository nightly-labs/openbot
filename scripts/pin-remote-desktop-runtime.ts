import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createRemoteDesktopInputDigest,
  createRemoteDesktopReleaseTag,
  loadNativeRuntimeLock,
  type NativeRuntimeLock,
  parseNativeRuntimeLock,
} from "./native-runtime-lock";
import { parseReleaseManifest, sha256 } from "./remote-desktop-runtime-release";

export function pinRemoteDesktopRuntime(
  lock: NativeRuntimeLock,
  manifestValue: unknown,
  manifestSha256: string,
): NativeRuntimeLock {
  const manifest = parseReleaseManifest(manifestValue);
  const inputDigest = createRemoteDesktopInputDigest(lock);
  if (manifest.inputDigest !== inputDigest) throw new Error("The release manifest input digest is not current.");
  if (manifest.tag !== createRemoteDesktopReleaseTag(inputDigest))
    throw new Error("The release manifest tag is invalid.");
  if (manifest.recipeVersion !== lock.remoteDesktop.recipeVersion) {
    throw new Error("The release manifest recipe version is not current.");
  }
  if (
    manifest.sources.sunshine.commit !== lock.remoteDesktop.sunshine.commit ||
    manifest.sources.sunshine.licenseSha256 !== lock.remoteDesktop.sunshine.licenseSha256 ||
    manifest.sources.moonlightWeb.commit !== lock.remoteDesktop.moonlightWeb.commit ||
    manifest.sources.moonlightWeb.licenseSha256 !== lock.remoteDesktop.moonlightWeb.licenseSha256
  ) {
    throw new Error("The release manifest source commits are not current.");
  }

  return parseNativeRuntimeLock({
    ...lock,
    remoteDesktop: {
      ...lock.remoteDesktop,
      artifactRelease: {
        repository: manifest.repository,
        tag: manifest.tag,
        inputDigest,
        manifestAsset: "remote-desktop-runtime-manifest.json",
        manifestSha256,
      },
      releaseArtifacts: {
        "darwin-arm64": {
          asset: manifest.artifacts["darwin-arm64"].asset,
          sha256: manifest.artifacts["darwin-arm64"].sha256,
        },
        "win32-x64": {
          asset: manifest.artifacts["win32-x64"].asset,
          sha256: manifest.artifacts["win32-x64"].sha256,
        },
      },
    },
  });
}

/**
 * Puts a pin into the lock file's own text, editing the two keys it owns and copying out everything
 * else byte for byte.
 *
 * `native-runtime.lock.json` answers to two schemas: `codex`, `claude` and `grok` belong to
 * `agent-runtime-lock.ts`, and `native-runtime-lock.ts` declares only `cloudflared` and
 * `remoteDesktop`. Zod keeps what its schema names and drops the rest, which is harmless while
 * reading and destroys the file on the way back out -- serializing the parsed lock over it deletes
 * every provider runtime pin, the assets and digests and licence hashes
 * `src/main/provider-runtime-manager.ts` reads to bundle the CLIs. Nothing downstream caught it: the
 * pin written was correct, and the publish job's guard counts the files a pin changed rather than
 * the keys it lost, so eighty deleted lines left every check green.
 */
export function pinRuntimeLockDocument(source: string, pinned: NativeRuntimeLock["remoteDesktop"]): string {
  const document = JSON.parse(source);
  document.remoteDesktop.artifactRelease = pinned.artifactRelease;
  document.remoteDesktop.releaseArtifacts = pinned.releaseArtifacts;
  return `${JSON.stringify(document, null, 2)}\n`;
}

if (import.meta.main) {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error("Usage: bun scripts/pin-remote-desktop-runtime.ts <manifest.json>");
  const sourceRoot = process.cwd();
  const lockPath = resolve(sourceRoot, "native-runtime.lock.json");
  const lock = await loadNativeRuntimeLock(sourceRoot);
  const manifestBytes = await readFile(resolve(manifestPath));
  const updated = pinRemoteDesktopRuntime(lock, JSON.parse(manifestBytes.toString("utf8")), sha256(manifestBytes));
  await writeFile(lockPath, pinRuntimeLockDocument(await readFile(lockPath, "utf8"), updated.remoteDesktop));
  // Machine-readable: tooling parses the pinned tag from stdout.
  process.stdout.write(`Pinned ${updated.remoteDesktop.artifactRelease?.tag}.\n`);
}
