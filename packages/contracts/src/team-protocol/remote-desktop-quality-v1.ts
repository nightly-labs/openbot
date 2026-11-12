// Frozen optional remote-desktop-quality-v1 contract.
//
// What it grants, recorded here because freezing it makes it permanent: a client adds
// `?quality=<value>` to the remote desktop viewer address (`TEAM_API_ROUTES.remoteScreen.viewer`), and
// the host's viewer page sets the stream to the preset of that value before Moonlight starts it.
// Moonlight reads the stream settings only at the start, so a client opens a new session to change
// the quality. Without the parameter, or with a value outside the list, the page changes nothing.
// The values and their presets do not follow app changes; a new value or preset needs a second
// capability string.

export const REMOTE_DESKTOP_QUALITY_CAPABILITY = "remote-desktop-quality-v1";

export const REMOTE_DESKTOP_QUALITIES = ["fast", "smooth", "saver"] as const;
export type RemoteDesktopQuality = (typeof REMOTE_DESKTOP_QUALITIES)[number];

/**
 * The stream of each value. `smooth` is what Moonlight Web streams when nothing sets it, so a viewer
 * that does not choose sees no change. `fast` helps only a host display of 120 Hz or more. `saver` is
 * for a slow or lossy link: the software encoder of a Linux host also has less work. The phone app
 * uses the same frame rates and bitrates.
 */
export const REMOTE_DESKTOP_QUALITY_PRESETS = {
  fast: { fps: 120, bitrate: 20_000, width: 1920, height: 1080 },
  smooth: { fps: 60, bitrate: 10_000, width: 1920, height: 1080 },
  saver: { fps: 30, bitrate: 3_000, width: 1280, height: 720 },
} as const satisfies Record<RemoteDesktopQuality, { fps: number; bitrate: number; width: number; height: number }>;

const QUALITY_PARAMETER = "quality";

export function remoteDesktopViewerQuality(url: URL): RemoteDesktopQuality | null {
  const value = url.searchParams.get(QUALITY_PARAMETER);
  return REMOTE_DESKTOP_QUALITIES.find((quality) => quality === value) ?? null;
}

export function remoteDesktopViewerUrlWithQuality(viewerUrl: string, quality: RemoteDesktopQuality): string {
  const url = new URL(viewerUrl);
  url.searchParams.set(QUALITY_PARAMETER, quality);
  return url.toString();
}
