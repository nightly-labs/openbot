import { access, open, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { desktopCall } from "./remote-desktop-effects";

const MACH_O_64_MAGIC = 0xfeedfacf;
const MACH_O_64_HEADER_BYTES = 32;
const MACH_O_MAX_LOAD_COMMAND_BYTES = 1_048_576;
const LC_VERSION_MIN_MACOSX = 0x24;
const LC_BUILD_VERSION = 0x32;
const BUILD_PLATFORM_MACOS = 1;

async function readMachOLoadCommands(executable: string): Promise<{ count: number; bytes: Buffer } | null> {
  const file = await open(executable, "r");
  try {
    const header = Buffer.alloc(MACH_O_64_HEADER_BYTES);
    await file.read(header, 0, header.length, 0);
    if (header.readUInt32LE(0) !== MACH_O_64_MAGIC) return null;
    const size = header.readUInt32LE(20);
    if (size > MACH_O_MAX_LOAD_COMMAND_BYTES) return null;
    const bytes = Buffer.alloc(size);
    const { bytesRead } = await file.read(bytes, 0, size, MACH_O_64_HEADER_BYTES);
    return { count: header.readUInt32LE(16), bytes: bytes.subarray(0, bytesRead) };
  } finally {
    await file.close();
  }
}

function packedVersion(value: number): string {
  return `${value >>> 16}.${(value >>> 8) & 0xff}.${value & 0xff}`;
}

function minimumMacosVersion(commands: { count: number; bytes: Buffer }): string | null {
  let offset = 0;
  for (let index = 0; index < commands.count && offset + 16 <= commands.bytes.length; index += 1) {
    const command = commands.bytes.readUInt32LE(offset);
    const size = commands.bytes.readUInt32LE(offset + 4);
    if (command === LC_BUILD_VERSION && commands.bytes.readUInt32LE(offset + 8) === BUILD_PLATFORM_MACOS)
      return packedVersion(commands.bytes.readUInt32LE(offset + 12));
    if (command === LC_VERSION_MIN_MACOSX) return packedVersion(commands.bytes.readUInt32LE(offset + 8));
    if (size < 8) return null;
    offset += size;
  }
  return null;
}

const readMinimumMacosVersion = Effect.fn("RemoteDesktop.readMinimumMacosVersion")(function* (executable: string) {
  const commands = yield* desktopCall(() => readMachOLoadCommands(executable));
  return commands ? minimumMacosVersion(commands) : null;
});

const listLibraries = (directory: string) =>
  desktopCall(() => readdir(directory)).pipe(
    Effect.map((names) => names.filter((name) => name.endsWith(".dylib")).map((name) => join(directory, name))),
    Effect.orElseSucceed((): string[] => []),
  );

export const readRuntimeMinimumMacosVersion = Effect.fn("RemoteDesktop.readRuntimeMinimumMacosVersion")(function* (
  paths: RemoteDesktopRuntimePaths,
) {
  const libraries = yield* Effect.forEach(
    [join(dirname(dirname(paths.sunshine)), "Frameworks"), join(dirname(paths.moonlightWebServer), "lib")],
    listLibraries,
  );
  const versions = yield* Effect.forEach(
    [paths.sunshine, paths.moonlightWebServer, paths.moonlightStreamer, ...libraries.flat()],
    (file) => readMinimumMacosVersion(file).pipe(Effect.orElseSucceed(() => undefined)),
  );
  const minimum = versions.reduce<string | null>(
    (highest, version) => (version && (!highest || isMacosOlderThan(highest, version)) ? version : highest),
    null,
  );
  return { minimum, complete: versions.every((version) => version !== undefined) };
});

function versionParts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

export function isMacosOlderThan(systemVersion: string, minimumVersion: string): boolean {
  const system = versionParts(systemVersion);
  const minimum = versionParts(minimumVersion);
  for (let index = 0; index < Math.max(system.length, minimum.length); index += 1) {
    const difference = (system[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

export function displayMacosVersion(version: string): string {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return patch === "0" ? `${major}.${minor}` : `${major}.${minor}.${patch}`;
}

export interface RemoteDesktopRuntimePaths {
  sunshine: string;
  moonlightWebServer: string;
  moonlightStreamer: string;
}

interface ResolveRuntimeInput {
  isPackaged: boolean;
  resourcesPath: string;
  sourceRoot: string;
  platform: "darwin" | "win32" | "linux";
  architecture: string;
  overrideRoot?: string | undefined;
}
export const resolveRemoteDesktopRuntime = Effect.fn("RemoteDesktop.resolveRuntime")(function* (
  input: ResolveRuntimeInput,
) {
  const platformDirectory = input.platform;
  const architecture = input.architecture;
  const architectures = input.platform === "win32" ? ["x64"] : ["arm64", "x64"];
  if (!architectures.includes(architecture)) return null;
  const root = input.overrideRoot
    ? input.overrideRoot
    : input.isPackaged
      ? join(input.resourcesPath, "remote-desktop-runtime", platformDirectory, architecture)
      : join(input.sourceRoot, "build", "remote-desktop-runtime", platformDirectory, architecture);
  const suffix = input.platform === "win32" ? ".exe" : "";
  const paths = {
    sunshine:
      input.platform === "darwin"
        ? join(root, "Sunshine.app", "Contents", "MacOS", "Sunshine")
        : join(root, `sunshine${suffix}`),
    moonlightWebServer: join(root, `web-server${suffix}`),
    moonlightStreamer: join(root, `streamer${suffix}`),
  };
  return yield* Effect.forEach(Object.values(paths), (path) => desktopCall(() => access(path)), {
    concurrency: "unbounded",
  }).pipe(
    Effect.map(() => paths),
    Effect.catch(() => Effect.succeed(null)),
  );
});
