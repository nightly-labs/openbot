import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createRemoteDesktopInputDigest,
  createRemoteDesktopReleaseTag,
  loadNativeRuntimeLock,
  type NativeRuntimeLock,
  parseNativeRuntimeLock,
} from "./native-runtime-lock";
import { parseReleaseManifest, remoteDesktopTargets, sha256 } from "./remote-desktop-runtime-release";

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
      releaseArtifacts: Object.fromEntries(
        remoteDesktopTargets.map((target) => [
          target,
          { asset: manifest.artifacts[target].asset, sha256: manifest.artifacts[target].sha256 },
        ]),
      ),
    },
  });
}

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
  process.stdout.write(`Pinned ${updated.remoteDesktop.artifactRelease?.tag}.\n`);
}
