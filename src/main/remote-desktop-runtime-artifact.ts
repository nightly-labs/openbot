import { access } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { desktopCall } from "./remote-desktop-effects";

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
  overrideRoot?: string;
}
export const resolveRemoteDesktopRuntime = Effect.fn("RemoteDesktop.resolveRuntime")(function* (
  input: ResolveRuntimeInput,
) {
  const platformDirectory = input.platform;
  const architecture = input.architecture;
  // Releases ship x64 only on Windows and Linux. A Linux arm64 build is for local development.
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
