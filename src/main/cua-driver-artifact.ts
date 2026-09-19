// Where the Computer Use driver executable is, across a packaged build, a checkout and a machine
// the developer installed it on by hand.

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * The targets `cua-driver` ships a binary for.
 *
 * The driver is one program on three desktops, so the only reason a target is absent here is that
 * upstream publishes nothing for it. Keep this table and the packaged layout in step: the directory
 * names are the Node ones, because the resolver reads `process.platform` and `process.arch`.
 */
const SUPPORTED_TARGETS: Readonly<Record<string, readonly string[]>> = {
  darwin: ["arm64", "x64"],
  win32: ["x64", "arm64"],
  linux: ["x64", "arm64"],
};

export interface CuaDriverArtifactInput {
  isPackaged: boolean;
  resourcesPath: string;
  sourceRoot: string;
  platform: NodeJS.Platform;
  architecture: string;
  homeDirectory: string;
  /** `PATH` as the process received it, or `null` when it is unset. */
  pathVariable: string | null;
  /** `OPENBOT_CUA_DRIVER_PATH`, then the driver's own `CUA_DRIVER_PATH`. */
  overrides?: readonly (string | undefined)[];
  /** `CUA_DRIVER_RS_INSTALL_DIR` and its legacy alias `CUA_DRIVER_BIN_DIR`, the installer's own override. */
  installDirectory?: string;
  /** `%LOCALAPPDATA%`. Read only on Windows, where the installer writes below it. */
  localAppDataDirectory?: string;
  /** `/Applications`. Read only on macOS, where the driver's real binary is inside a bundle there. */
  applicationsDirectory?: string;
}

/** Whether this computer is one the driver is published for, which is not whether it is installed. */
export function isSupportedCuaDriverTarget(platform: NodeJS.Platform, architecture: string): boolean {
  return SUPPORTED_TARGETS[platform]?.includes(architecture) ?? false;
}

/**
 * The driver executable, or `null` when this computer has none.
 *
 * `null` is a status, not a failure: Computer Use is a feature the app works without, so a missing
 * binary must never throw out of startup. Every candidate is checked for the execute bit rather
 * than for existence, because a half-extracted download is a file that cannot be spawned.
 *
 * A packaged build carries the binary under `resources/cua-driver/<platform>/<architecture>`, and a
 * checkout under `build/cua-driver/<platform>/<architecture>`. `scripts/install-cua-driver.ts`
 * writes the second path from the pin in `native-runtime.lock.json`, and `electron-builder.yml`
 * copies it to the first. A hand-installed driver is still found, one candidate later.
 */
export async function resolveCuaDriver(input: CuaDriverArtifactInput): Promise<string | null> {
  if (!isSupportedCuaDriverTarget(input.platform, input.architecture)) return null;

  for (const candidate of candidatePaths(input)) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * The two calls the driver makes to its own vendor, off for every copy OpenBot starts.
 *
 * `CUA_DRIVER_RS_TELEMETRY_ENABLED` stops the product analytics. The driver ships with them on, and
 * OpenBot now ships the driver, so a user who never chose the driver would otherwise send a vendor
 * that is not OpenBot a record of each tool call.
 *
 * `CUA_DRIVER_RS_UPDATE_CHECK` stops the release check `serve` makes at startup. OpenBot pins the
 * driver in `native-runtime.lock.json` and packages that exact build, so the answer could only offer
 * the user an update OpenBot would refuse: on macOS the binary sits inside a signed application
 * bundle, and replacing it would break the signature. Off, the daemon also writes no
 * `~/.cua-driver/version_check.json`.
 *
 * The driver reads the environment before its own configuration, so these decide the question:
 * nothing a process inherits can turn them back on, and OpenBot writes no file, so a driver the user
 * runs themselves keeps the settings they gave it. This is why both are spread last, after any
 * inherited environment, at every place that runs the binary: the daemon, the MCP proxy each
 * provider spawns, the permission probe, and the doctor script.
 */
export const CUA_DRIVER_VENDOR_CALLS_OFF: Readonly<Record<string, string>> = {
  CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
  CUA_DRIVER_RS_UPDATE_CHECK: "0",
};

/** The file name, which carries an extension only where the operating system needs one. */
function executableName(platform: NodeJS.Platform): "cua-driver" | "cua-driver.exe" {
  return platform === "win32" ? "cua-driver.exe" : "cua-driver";
}

function* candidatePaths(input: CuaDriverArtifactInput): Generator<string> {
  const name = executableName(input.platform);

  for (const override of input.overrides ?? []) {
    const trimmed = override?.trim();
    if (trimmed && isAbsolute(trimmed)) yield trimmed;
  }

  yield input.isPackaged
    ? join(input.resourcesPath, "cua-driver", input.platform, input.architecture, name)
    : join(input.sourceRoot, "build", "cua-driver", input.platform, input.architecture, name);

  const installDirectory = input.installDirectory?.trim();
  if (installDirectory) yield join(installDirectory, name);

  // Where the driver's own installers put it. The POSIX script uses `~/.local/bin`. The Windows
  // script uses a junction below the per-user program directory, so that an upgrade retargets a
  // junction and needs no administrator. Its vendor folder was renamed in driver v0.2.14, and the
  // installer migrates a legacy install only when it is run again, so both names are read here.
  // macOS keeps the real binary in an application bundle and puts only a symlink in `~/.local/bin`.
  // A user who moved the bundle in by hand, or who cleared `~/.local/bin`, still has a driver.
  const applications = input.applicationsDirectory?.trim();
  if (input.platform === "darwin" && applications) {
    yield join(applications, "CuaDriver.app", "Contents", "MacOS", name);
  }

  if (input.platform === "win32") {
    const localAppData = input.localAppDataDirectory?.trim() || join(input.homeDirectory, "AppData", "Local");
    yield join(localAppData, "Programs", "Cua", "cua-driver", "bin", name);
    yield join(localAppData, "Programs", "trycua", "cua-driver-rs", "bin", name);
  } else {
    yield join(input.homeDirectory, ".local", "bin", name);
  }

  for (const entry of input.pathVariable?.split(delimiter) ?? []) {
    const trimmed = entry.trim();
    if (trimmed) yield join(trimmed, name);
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
