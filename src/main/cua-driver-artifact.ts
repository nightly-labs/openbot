// Where the Computer Use driver executable is, across a packaged build, a checkout and a machine
// the developer installed it on by hand.

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

const EXECUTABLE_NAME = "cua-driver";
const PLATFORM_DIRECTORY = "darwin";
const ARCHITECTURE = "arm64";

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
  /** `CUA_DRIVER_RS_INSTALL_DIR`, the install script's own override. */
  installDirectory?: string;
}

/**
 * The driver executable, or `null` when this computer has none.
 *
 * `null` is a status, not a failure: Computer Use is a feature the app works without, so a missing
 * binary must never throw out of startup. Every candidate is checked for the execute bit rather
 * than for existence, because a half-extracted download is a file that cannot be spawned.
 *
 * Packaged builds are expected to carry the binary under `resources/cua-driver`. Nothing writes it
 * there yet; the pin belongs in `native-runtime.lock.json` with the other runtimes, and this
 * function is the seam that will read it.
 */
export async function resolveCuaDriver(input: CuaDriverArtifactInput): Promise<string | null> {
  if (input.platform !== PLATFORM_DIRECTORY || input.architecture !== ARCHITECTURE) return null;

  for (const candidate of candidatePaths(input)) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

function* candidatePaths(input: CuaDriverArtifactInput): Generator<string> {
  for (const override of input.overrides ?? []) {
    const trimmed = override?.trim();
    if (trimmed && isAbsolute(trimmed)) yield trimmed;
  }

  yield input.isPackaged
    ? join(input.resourcesPath, EXECUTABLE_NAME, PLATFORM_DIRECTORY, ARCHITECTURE, EXECUTABLE_NAME)
    : join(input.sourceRoot, "build", EXECUTABLE_NAME, PLATFORM_DIRECTORY, ARCHITECTURE, EXECUTABLE_NAME);

  const installDirectory = input.installDirectory?.trim();
  if (installDirectory) yield join(installDirectory, EXECUTABLE_NAME);

  // Where the driver's own install script puts it.
  yield join(input.homeDirectory, ".local", "bin", EXECUTABLE_NAME);

  for (const entry of input.pathVariable?.split(delimiter) ?? []) {
    const trimmed = entry.trim();
    if (trimmed) yield join(trimmed, EXECUTABLE_NAME);
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
