// Installs the 1Password CLI into a folder that OpenBot owns, so Connect works without Homebrew,
// an installer package or administrator rights.

import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { OnePasswordOperationError, onePasswordCall } from "./onepassword-effects";
import { extractZipFiles } from "./provider-runtime-archive";
import type { RuntimeTarget } from "./provider-runtime-descriptors";

/**
 * The release that Install puts in place. 1Password publishes no hash for its downloads, so each
 * archive's SHA-256 is pinned here, taken from 1Password's own CDN. A new release is a code change.
 */
const ONEPASSWORD_CLI_VERSION = "2.39.0";

const ARCHIVES: Record<RuntimeTarget, { name: string; sha256: string }> = {
  "darwin-arm64": {
    name: "op_darwin_arm64",
    sha256: "05391d3388a0c0b4f602691bedc1ab368541c487b6f14d2e3399743b4682af67",
  },
  "darwin-x64": {
    name: "op_darwin_amd64",
    sha256: "753fbf56b00996426edbb8439d2f3c0be9227b9557cdff468fb144cd3621aa6e",
  },
  "linux-x64": {
    name: "op_linux_amd64",
    sha256: "6fba7f376b6c6dec49f41b06408930a43ad064cce103c6a2ce5b3d0413a86434",
  },
  "linux-arm64": {
    name: "op_linux_arm64",
    sha256: "829baeff1c07e055cfa132031b1d9f2282ccdf5076258e482caf2fda70aea5d0",
  },
  "win32-x64": {
    name: "op_windows_amd64",
    sha256: "38b3748d76d104469eb6e2744f843d2a7e03d1b6d330cc42d600cff379c37bab",
  },
};

/** Each archive is about 15 MB. A much larger answer is not the archive. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function executableName(target: RuntimeTarget): "op" | "op.exe" {
  return target === "win32-x64" ? "op.exe" : "op";
}

function archiveUrl(target: RuntimeTarget): string {
  const { name } = ARCHIVES[target];
  return `https://cache.agilebits.com/dist/1P/op2/pkg/v${ONEPASSWORD_CLI_VERSION}/${name}_v${ONEPASSWORD_CLI_VERSION}.zip`;
}

/** Where Install puts the CLI. It exists only after a complete, verified install. */
function managedCliPath(directory: string, target: RuntimeTarget): string {
  return join(directory, ONEPASSWORD_CLI_VERSION, executableName(target));
}

/**
 * Downloads the pinned release, checks its hash, and unpacks only `op` and its signature into
 * `<directory>/<version>`. A failed, stopped or interrupted install leaves nothing in that folder.
 */
export const installOnePasswordCli = Effect.fn("OnePasswordCli.install")(function* (options: {
  directory: string;
  target: RuntimeTarget;
  signal?: AbortSignal;
  fetch?: Fetch;
}): Effect.fn.Return<string, OnePasswordOperationError> {
  const { directory, target } = options;
  const failed = sourceText("error.connector.onePasswordCliInstallFailed");
  const destination = join(directory, ONEPASSWORD_CLI_VERSION);
  const staging = join(directory, `.staging-${randomBytes(6).toString("hex")}`);
  const archive = `${staging}.zip`;
  yield* onePasswordCall(() => mkdir(directory, { recursive: true }));
  return yield* Effect.gen(function* () {
    const digest = yield* onePasswordCall((interrupted) =>
      downloadArchive({
        url: archiveUrl(target),
        archive,
        failed,
        signal: options.signal ? AbortSignal.any([options.signal, interrupted]) : interrupted,
        fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      }),
    );
    if (digest !== ARCHIVES[target].sha256) return yield* new OnePasswordOperationError({ cause: new Error(failed) });
    const executable = executableName(target);
    yield* onePasswordCall(() => mkdir(staging));
    yield* extractZipFiles(archive, staging, [executable, `${executable}.sig`], failed).pipe(
      Effect.mapError((failure) => new OnePasswordOperationError({ cause: failure.cause })),
    );
    yield* onePasswordCall(async () => {
      await chmod(join(staging, executable), 0o755);
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
    });
    return managedCliPath(directory, target);
  }).pipe(
    Effect.ensuring(
      onePasswordCall(async () => {
        await rm(archive, { force: true });
        await rm(staging, { recursive: true, force: true });
      }).pipe(Effect.ignore),
    ),
  );
});

/** Writes the archive to `archive` and returns its SHA-256. A larger or failed answer rejects with `failed`. */
async function downloadArchive(options: {
  url: string;
  archive: string;
  failed: string;
  signal: AbortSignal;
  fetch: Fetch;
}): Promise<string> {
  const { failed, signal } = options;
  const response = await options.fetch(options.url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]),
  });
  if (!response.ok || !response.body) throw new Error(failed);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_ARCHIVE_BYTES) throw new Error(failed);
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  let size = 0;
  await pipeline(
    async function* () {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) return;
          size += chunk.value.byteLength;
          if (size > MAX_ARCHIVE_BYTES) throw new Error(failed);
          hash.update(chunk.value);
          yield chunk.value;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    },
    createWriteStream(options.archive, { mode: 0o600 }),
    { signal },
  );
  return hash.digest("hex");
}

/** The installed CLI, or null when Install has not completed. */
export function installedManagedCli(directory: string, target: RuntimeTarget): Effect.Effect<string | null> {
  const path = managedCliPath(directory, target);
  return onePasswordCall(() => stat(path)).pipe(
    Effect.map((entry) => (entry.isFile() ? path : null)),
    Effect.orElseSucceed(() => null),
  );
}
