import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * Where the dev tools keep the files that describe running dev processes: the instance and stack
 * registries, the port allocation lock, and the remote handoff file. It is not the temporary
 * directory, because `TMPDIR` can differ from one shell to the next, and a `dev:status` that reads
 * another registry than the stack wrote to reports no stack while the app runs.
 *
 * The callers keep the directory owner-only. On Linux `XDG_RUNTIME_DIR` is private to the login
 * session; on Windows `%LOCALAPPDATA%` has ACLs private to the user account.
 */
export function devRuntimeDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  const override = environment.OPENBOT_DEV_REGISTRY_DIR?.trim();
  if (override) {
    const path = platform === "win32" ? win32 : posix;
    // A relative path would name a different directory in each working directory.
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

/**
 * The file in which a dev host gives its test client the connection. One for each stack, keyed by
 * the supervisor pid in `OPENBOT_DEV_STACK_ID`, so that two stacks never read each other's host.
 * A subdirectory, because the instance registry reads each `*.json` file in the runtime directory.
 */
export function developmentRemoteConnectionPath(
  environment: NodeJS.ProcessEnv = process.env,
  runtimeDirectory = devRuntimeDirectory(process.platform, environment),
): string {
  const stackId = environment.OPENBOT_DEV_STACK_ID?.trim();
  const name = stackId && /^\d+$/u.test(stackId) ? stackId : "default";
  const path = process.platform === "win32" ? win32 : posix;
  return path.join(runtimeDirectory, "remote", `connection-${name}.json`);
}
