import { z } from "zod";
import { HOST_MANAGER_DIRECTORY } from "../src/main/host-update-files";

export const HOST_TEAM_ID = "ZTRDTUL87R";
export const HOST_PACKAGE_ID = "app.openbot.host";
export const HOST_DAEMON_PLIST = "/Library/LaunchDaemons/app.openbot.host-manager.plist";
export const HOST_AGENT_PLIST = "/Library/LaunchAgents/app.openbot.desktop.relaunch.plist";
export const HOST_EXECUTABLES = ["host-manager", "openbot-host", "create-tenants"] as const;
export const HOST_FILES = [
  ...HOST_EXECUTABLES.map((name) => `${HOST_MANAGER_DIRECTORY}/${name}`),
  `${HOST_MANAGER_DIRECTORY}/openbot-relaunch.sh`,
  `${HOST_MANAGER_DIRECTORY}/host-release.json`,
  HOST_DAEMON_PLIST,
  HOST_AGENT_PLIST,
  "/usr/local/bin/openbot-host",
] as const;
export const hostReleaseSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    arch: z.literal("arm64"),
  })
  .strict();

export function hostExecutableRequirement(name: string): string {
  if (!HOST_EXECUTABLES.some((entry) => entry === name)) throw new Error("Unknown host executable.");
  return `=anchor apple generic and identifier "app.openbot.host.${name}" and certificate leaf[subject.OU] = "${HOST_TEAM_ID}" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`;
}

export function hostFileMode(path: string) {
  return path.endsWith(".plist") || path.endsWith(".json") ? 0o644 : 0o755;
}
