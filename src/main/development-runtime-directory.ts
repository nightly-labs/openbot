import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export function devRuntimeDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  const override = environment.OPENBOT_DEV_REGISTRY_DIR?.trim();
  if (override) {
    const path = platform === "win32" ? win32 : posix;
    if (!path.isAbsolute(override)) throw new Error("OPENBOT_DEV_REGISTRY_DIR must be an absolute path.");
    return path.normalize(override);
  }
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA?.trim() || win32.join(homeDirectory, "AppData", "Local");
    return win32.join(localAppData, "OpenBot", "openbot-dev-instances");
  }
  if (platform === "darwin") return posix.join(homeDirectory, "Library", "Caches", "OpenBot", "dev");
  const runtimeDirectory = environment.XDG_RUNTIME_DIR?.trim();
  if (runtimeDirectory && posix.isAbsolute(runtimeDirectory)) return posix.join(runtimeDirectory, "openbot-dev");
  return posix.join(homeDirectory, ".cache", "openbot", "dev");
}

export function developmentRemoteConnectionPath(
  environment: NodeJS.ProcessEnv = process.env,
  runtimeDirectory = devRuntimeDirectory(process.platform, environment),
): string {
  const stackId = environment.OPENBOT_DEV_STACK_ID?.trim();
  const name = stackId && /^\d+$/u.test(stackId) ? stackId : "default";
  const path = process.platform === "win32" ? win32 : posix;
  return path.join(runtimeDirectory, "remote", `connection-${name}.json`);
}
