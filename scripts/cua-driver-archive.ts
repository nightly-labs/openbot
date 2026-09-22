import { execFileSync } from "node:child_process";
import type { CUA_DRIVER_TARGETS } from "./cua-driver-lock";

type CuaDriverArchive = (typeof CUA_DRIVER_TARGETS)[keyof typeof CUA_DRIVER_TARGETS]["archive"];

/**
 * Unpacks a downloaded `cua-driver` release archive.
 *
 * The command follows the machine that unpacks, not the platform the archive is for. Windows ships
 * `tar`, which reads a ZIP as well, and ships no `unzip`: a checkout that runs `package:win` from
 * PowerShell reaches none of the utilities Git Bash installs. Every other desktop has `unzip`, and
 * a `tar` that reads tar archives only, so there the ZIP goes to `unzip`.
 *
 * Ownership is not restored: the release is fetched as this user, and every mode the installed tree
 * carries is set from the lock rather than taken from the archive.
 */
export function extractCuaDriverArchive(archive: string, destination: string, kind: CuaDriverArchive): void {
  if (kind !== "zip") {
    execFileSync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"], { stdio: "inherit" });
    return;
  }
  if (process.platform === "win32") {
    execFileSync("tar", ["-xf", archive, "-C", destination], { stdio: "inherit" });
    return;
  }
  execFileSync("unzip", ["-q", "-o", archive, "-d", destination], { stdio: "inherit" });
}
