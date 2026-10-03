import { Effect, Schema } from "effect";
import { OPENBOT_LINKS } from "../lib/landing-links";

export type AvailableDownloadPlatform = "linux" | "macos" | "windows";

/**
 * `latest-mac.yml` lists the Apple silicon and the Intel installer, so a macOS download also names
 * its architecture. electron-builder puts `arm64` in the Apple silicon asset name and no
 * architecture suffix that contains it in the Intel one.
 */
export type MacDownloadArchitecture = "arm64" | "x64";

interface DownloadManifestConfig {
  /**
   * Compared against a lowercased asset name, so it must be lowercase itself. The Linux asset is
   * published as `.AppImage`.
   */
  extension: ".appimage" | ".dmg" | ".exe";
  manifest: "latest-linux.yml" | "latest-mac.yml" | "latest.yml";
}

const RELEASES_BASE_URL = "https://github.com/nightly-labs/openbot/releases";

const DOWNLOAD_MANIFESTS: Record<AvailableDownloadPlatform, DownloadManifestConfig> = {
  linux: { extension: ".appimage", manifest: "latest-linux.yml" },
  macos: { extension: ".dmg", manifest: "latest-mac.yml" },
  windows: { extension: ".exe", manifest: "latest.yml" },
};

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location,
    },
  });
}

function findInstaller(
  manifest: string,
  extension: DownloadManifestConfig["extension"],
  macArchitecture: MacDownloadArchitecture | undefined,
): string | undefined {
  const assetLines = manifest.matchAll(/^\s*-\s+url:\s*["']?([^\s"']+)["']?\s*$/gim);
  for (const match of assetLines) {
    const asset = match[1];
    if (!asset?.toLowerCase().endsWith(extension) || !/^[a-z0-9][a-z0-9._+-]+$/i.test(asset)) continue;
    if (macArchitecture && asset.toLowerCase().includes("arm64") !== (macArchitecture === "arm64")) continue;
    return asset;
  }
  return undefined;
}

/**
 * The releases page is a working answer but not the one that was asked for, so each fallback says
 * why. Written to the Worker log rather than to analytics: a server event has no session, and the
 * landing reports are defined on sessions. Platform and reason only, never a URL or a response body.
 */
function fallbackToReleases(platform: AvailableDownloadPlatform, reason: string): Response {
  console.warn(`latest-download: serving the releases page for ${platform} (${reason})`);
  return redirect(OPENBOT_LINKS.releases);
}

class DownloadManifestError extends Schema.TaggedError<DownloadManifestError>()("DownloadManifestError", {}) {}

const latestDownload = Effect.fn("LatestDownload.resolve")(function* (
  platform: AvailableDownloadPlatform,
  fetcher: typeof fetch,
  macArchitecture: MacDownloadArchitecture,
) {
  const config = DOWNLOAD_MANIFESTS[platform];
  const manifestUrl = `${RELEASES_BASE_URL}/latest/download/${config.manifest}`;
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetcher(manifestUrl, {
        headers: { accept: "text/yaml, text/plain" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      }),
    catch: () => new DownloadManifestError({}),
  });
  if (!response.ok) return fallbackToReleases(platform, `manifest status ${response.status}`);
  const manifest = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: () => new DownloadManifestError({}),
  });
  const installer = findInstaller(manifest, config.extension, platform === "macos" ? macArchitecture : undefined);
  if (!installer) return fallbackToReleases(platform, `no ${config.extension} asset in the manifest`);
  return redirect(`${RELEASES_BASE_URL}/latest/download/${encodeURIComponent(installer)}`);
});

export function latestDownloadResponse(
  platform: AvailableDownloadPlatform,
  fetcher: typeof fetch = fetch,
  macArchitecture: MacDownloadArchitecture = "arm64",
) {
  return latestDownload(platform, fetcher, macArchitecture).pipe(
    Effect.catch(() => Effect.sync(() => fallbackToReleases(platform, "the manifest request failed"))),
  );
}
