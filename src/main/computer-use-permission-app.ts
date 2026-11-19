import { basename, dirname } from "node:path";

export function applicationBundlePath(executablePath: string, platform: NodeJS.Platform): string | null {
  if (platform !== "darwin") return null;
  let directory = dirname(executablePath);
  while (directory !== dirname(directory)) {
    if (directory.endsWith(".app")) return directory;
    directory = dirname(directory);
  }
  return null;
}

export function applicationBundleName(bundlePath: string): string {
  return basename(bundlePath).replace(/\.app$/u, "");
}

export function applicationIconName(bundlePath: string, resourceNames: readonly string[]): string | null {
  const icons = resourceNames.filter((name) => name.endsWith(".icns"));
  const preferred = `${applicationBundleName(bundlePath).toLowerCase()}.icns`;
  return icons.find((name) => name.toLowerCase() === preferred) ?? icons[0] ?? null;
}
