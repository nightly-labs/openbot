// The application bundle a user drags into a System Settings list, and how it is named there.

import { basename, dirname } from "node:path";

/**
 * The application bundle the running executable belongs to, or `null` when it belongs to none.
 *
 * macOS grants a permission to a bundle, and the list in System Settings offers no way to browse
 * for one that is not already there: what the user can always do is drag the bundle in. That is
 * the whole reason main has to name this path, and the reason the name it reports is the bundle's
 * own - in a development build the responsible application is Electron, and a window that called
 * it "OpenBot" would send the user looking for a row that never appears.
 *
 * `null` on every system that is not macOS, and for a build that runs from a plain directory.
 */
export function applicationBundlePath(executablePath: string, platform: NodeJS.Platform): string | null {
  if (platform !== "darwin") return null;
  let directory = dirname(executablePath);
  while (directory !== dirname(directory)) {
    if (directory.endsWith(".app")) return directory;
    directory = dirname(directory);
  }
  return null;
}

/** What System Settings lists the bundle as: its own name, without the extension. */
export function applicationBundleName(bundlePath: string): string {
  return basename(bundlePath).replace(/\.app$/u, "");
}

/**
 * The icon file inside a bundle, or `null` when the bundle carries none.
 *
 * `app.getFileIcon` is what asks macOS for this, and on this Electron it ends the main process, so
 * the icon is read from the bundle itself. A bundle names its icon after itself often enough to
 * prefer that one, and any other `.icns` is still the bundle's own picture.
 */
export function applicationIconName(bundlePath: string, resourceNames: readonly string[]): string | null {
  const icons = resourceNames.filter((name) => name.endsWith(".icns"));
  const preferred = `${applicationBundleName(bundlePath).toLowerCase()}.icns`;
  return icons.find((name) => name.toLowerCase() === preferred) ?? icons[0] ?? null;
}
