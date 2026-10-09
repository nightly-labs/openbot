import { readFile } from "node:fs/promises";
import type { HostReleaseStatus, UpdateStatus } from "@openbot/contracts/ipc";
import { Deferred, Effect, Exit, Schema } from "effect";
import { parse } from "yaml";
import { isValidSemver } from "./update-service";

class ReleaseCheckFailed extends Schema.TaggedError<ReleaseCheckFailed>()("ReleaseCheckFailed", {}) {}

const ReleaseManifest = Schema.Struct({
  version: Schema.String.check(Schema.isMaxLength(64), Schema.isPattern(/^\d+\.\d+\.\d+$/u)),
  files: Schema.Array(Schema.Struct({ url: Schema.String })),
});

type ReleaseTarget = { feed: string; asset: (version: string) => string };

/** Only published desktop targets have a compatible release feed. */
function releaseTarget(platform: NodeJS.Platform, arch: string): ReleaseTarget | null {
  if (arch !== "x64" && arch !== "arm64") return null;
  if (platform === "linux")
    return {
      feed: arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml",
      asset: (version) => `OpenBot-${version}-${arch === "x64" ? "x86_64" : "arm64"}.AppImage`,
    };
  if (platform === "darwin")
    return {
      feed: "latest-mac.yml",
      asset: (version) => `OpenBot-${version}-${arch}.zip`,
    };
  if (platform === "win32" && arch === "x64")
    return {
      feed: "latest.yml",
      asset: (version) => `OpenBot-${version}-x64.exe`,
    };
  return null;
}

interface HostReleaseOptions {
  currentVersion: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  environment: NodeJS.ProcessEnv;
  updateStatus: () => Pick<UpdateStatus, "phase" | "managedByHost">;
  installationMode: string | null;
  fetch?: typeof fetch;
}

/** Reads only the install marker. No command or application file is executed. */
export const readInstallationMode = Effect.fn("HostRelease.readInstallationMode")(function* () {
  return yield* Effect.tryPromise({
    try: (signal) => readFile("/opt/OpenBot/hosted/mode", { encoding: "utf8", signal }),
    catch: () => new ReleaseCheckFailed(),
  }).pipe(
    Effect.map((value) => value.trim()),
    Effect.catch(() => Effect.succeed(null)),
  );
});

/** Read-only release discovery. Installation stays with the existing updater or administrator. */
export class HostReleaseService {
  readonly #options: HostReleaseOptions;
  readonly #target: ReleaseTarget | null;
  #phase: HostReleaseStatus["phase"] = "idle";
  #latestVersion: string | null = null;
  #pending: Deferred.Deferred<HostReleaseStatus> | null = null;

  constructor(options: HostReleaseOptions) {
    this.#options = options;
    this.#target =
      options.packaged && isValidSemver(options.currentVersion) ? releaseTarget(options.platform, options.arch) : null;
  }

  snapshot(): HostReleaseStatus {
    return {
      currentVersion: this.#options.currentVersion,
      latestVersion: this.#latestVersion,
      phase: this.#target ? this.#phase : "unavailable",
      method: this.#method(),
    };
  }

  #method(): HostReleaseStatus["method"] {
    if (!this.#options.packaged) return "unavailable";
    if (this.#options.updateStatus().managedByHost) return "host-manager";
    if (this.#options.platform === "linux") {
      if (this.#options.installationMode === "container") return "container";
      // A hosted or self-installed server whose root installs updates on request.
      if (this.#options.updateStatus().phase !== "unsupported") return "self-update";
      if (this.#options.environment.OPENBOT_HOSTED_SERVER === "1") return "hosted";
      if (this.#options.installationMode === "self") return "system";
    }
    return this.#options.updateStatus().phase === "unsupported" ? "manual" : "self-update";
  }

  readonly check = Effect.fn("HostRelease.check")(function* (this: HostReleaseService) {
    if (!this.#target) return this.snapshot();
    if (this.#pending) return yield* Deferred.await(this.#pending);
    const pending = Deferred.makeUnsafe<HostReleaseStatus>();
    this.#pending = pending;
    this.#phase = "checking";
    this.#latestVersion = null;
    const target = this.#target;
    return yield* Effect.gen({ self: this }, function* () {
      const version = yield* Effect.tryPromise({
        try: (signal) => fetchLatestRelease(target, this.#options.fetch ?? fetch, signal),
        catch: () => new ReleaseCheckFailed(),
      });
      this.#latestVersion = version;
      this.#phase = newerRelease(version, this.#options.currentVersion) ? "available" : "up-to-date";
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          this.#phase = "error";
        }),
      ),
      Effect.onExit(() =>
        Effect.gen({ self: this }, function* () {
          if (this.#phase === "checking") this.#phase = "error";
          yield* Deferred.done(pending, Exit.succeed(this.snapshot()));
          this.#pending = null;
        }),
      ),
      Effect.map(() => this.snapshot()),
    );
  }).bind(this);
}

/** The version of the latest published release for `target`. Rejects on any fault of the feed. */
async function fetchLatestRelease(target: ReleaseTarget, request: typeof fetch, signal: AbortSignal): Promise<string> {
  const response = await request(`https://github.com/nightly-labs/openbot/releases/latest/download/${target.feed}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Release feed unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 65_536) throw new Error("Release feed too large");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const manifest = Schema.decodeUnknownSync(ReleaseManifest)(parse(Buffer.concat(chunks).toString("utf8")));
  if (!isValidSemver(manifest.version) || !manifest.files.some((file) => file.url === target.asset(manifest.version)))
    throw new Error("No compatible release");
  return manifest.version;
}

/** The latest Linux release for `arch`, for the hosted installer. */
export function fetchLatestLinuxRelease(arch: string, request: typeof fetch, signal: AbortSignal): Promise<string> {
  const target = releaseTarget("linux", arch);
  if (!target) return Promise.reject(new Error("No release for this machine"));
  return fetchLatestRelease(target, request, signal);
}

export function newerRelease(candidate: string, current: string): boolean {
  const left = candidate.split(".").map(Number);
  const right = current.split(/[.+-]/u).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return current.split("+", 1)[0]?.includes("-") ?? false;
}
