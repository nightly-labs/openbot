import { homedir } from "node:os";
import { posix } from "node:path";

export function resolveDevelopmentAppDataRoot(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  if (platform === "darwin") {
    return posix.join(homeDirectory, "Library", "Application Support");
  }

  if (platform === "win32") {
    const appData = environment.APPDATA?.trim();
    if (!appData) {
      throw new Error("APPDATA is not set. OpenBot dev state was not changed.");
    }
    return appData;
  }

  return environment.XDG_CONFIG_HOME?.trim() || posix.join(homeDirectory, ".config");
}
