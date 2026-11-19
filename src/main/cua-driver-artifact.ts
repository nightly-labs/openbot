import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { Effect } from "effect";
import { cuaIO } from "./cua-driver-effects";

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
  pathVariable: string | null;
  overrides?: readonly (string | undefined)[];
  installDirectory?: string | undefined;
  localAppDataDirectory?: string | undefined;
  applicationsDirectory?: string;
}

export function isSupportedCuaDriverTarget(platform: NodeJS.Platform, architecture: string): boolean {
  return SUPPORTED_TARGETS[platform]?.includes(architecture) ?? false;
}

export const resolveCuaDriver = Effect.fn("CuaDriver.resolve")(function* (input: CuaDriverArtifactInput) {
  if (!isSupportedCuaDriverTarget(input.platform, input.architecture)) return null;

  for (const candidate of candidatePaths(input)) {
    if (
      yield* cuaIO(() => access(candidate, constants.X_OK)).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      )
    )
      return candidate;
  }
  return null;
});

export const CUA_DRIVER_VENDOR_CALLS_OFF: Readonly<Record<string, string>> = {
  CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
  CUA_DRIVER_RS_UPDATE_CHECK: "0",
};

function executableName(platform: NodeJS.Platform): "cua-driver" | "cua-driver.exe" {
  return platform === "win32" ? "cua-driver.exe" : "cua-driver";
}

function* candidatePaths(input: CuaDriverArtifactInput): Generator<string> {
  const name = executableName(input.platform);

  if (input.isPackaged) {
    yield join(input.resourcesPath, "cua-driver", input.platform, input.architecture, name);
    return;
  }

  for (const override of input.overrides ?? []) {
    const trimmed = override?.trim();
    if (trimmed && isAbsolute(trimmed)) yield trimmed;
  }

  yield join(input.sourceRoot, "build", "cua-driver", input.platform, input.architecture, name);

  const installDirectory = input.installDirectory?.trim();
  if (installDirectory) yield join(installDirectory, name);

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
