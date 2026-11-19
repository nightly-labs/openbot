import { execFileSync } from "node:child_process";
import type { CUA_DRIVER_TARGETS } from "./cua-driver-lock";

type CuaDriverArchive = (typeof CUA_DRIVER_TARGETS)[keyof typeof CUA_DRIVER_TARGETS]["archive"];

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
