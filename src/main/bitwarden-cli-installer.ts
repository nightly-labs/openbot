// Installs the Bitwarden CLI into a folder that OpenBot owns, so a server with no `bw` on its PATH,
// such as the Docker image, can connect Bitwarden or Vaultwarden.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import { PasswordVaultError } from "../backend/password-vault";
import { downloadArchive } from "./onepassword-cli-installer";
import { extractZipFiles } from "./provider-runtime-archive";
import type { RuntimeTarget } from "./provider-runtime-descriptors";

const { io: vaultCall } = causeHelpers(PasswordVaultError);

/**
 * The release that the host installs. Each archive's SHA-256 is pinned here, taken from the GitHub
 * release of Bitwarden's own repository. A new release is a code change.
 */
const BITWARDEN_CLI_VERSION = "2026.9.1";

const ARCHIVES: Record<RuntimeTarget, { name: string; sha256: string }> = {
  "darwin-arm64": {
    name: "bw-macos-arm64",
    sha256: "9f52edf5fb855e277315c1106f1bae326a87c41b425a4c0e00fd1440e77fa0a6",
  },
  "darwin-x64": {
    name: "bw-macos",
    sha256: "7996558e562a7e5d1ef167f625e4dfde0230fe87246e01caf647aff5501ca658",
  },
  "linux-x64": {
    name: "bw-linux",
    sha256: "84289eaf59d691f04242605112f21b00e8dba65acdedbc60dde001a2860f2097",
  },
  "linux-arm64": {
    name: "bw-linux-arm64",
    sha256: "c451c773378a6f1f041ea26568a897b285a8656bee16a16e4914ce9e40fb7c79",
  },
  "win32-x64": {
    name: "bw-windows",
    sha256: "51712d5e21903cdd719847bd082041e0fafadd665e9bbf5d8cbfbbdcc8e36900",
  },
};

function executableName(target: RuntimeTarget): "bw" | "bw.exe" {
  return target === "win32-x64" ? "bw.exe" : "bw";
}

function archiveUrl(target: RuntimeTarget): string {
  const { name } = ARCHIVES[target];
  return `https://github.com/bitwarden/clients/releases/download/cli-v${BITWARDEN_CLI_VERSION}/${name}-${BITWARDEN_CLI_VERSION}.zip`;
}

function managedCliPath(directory: string, target: RuntimeTarget): string {
  return join(directory, BITWARDEN_CLI_VERSION, executableName(target));
}

/**
 * The installed CLI, or a new install of the pinned release: downloaded, checked against its hash,
 * and unpacked into `<directory>/<version>`. A failed or stopped install leaves nothing in that folder.
 */
export const managedBitwardenCli = Effect.fn("BitwardenCli.managed")(function* (options: {
  directory: string;
  target: RuntimeTarget;
  signal: AbortSignal;
}): Effect.fn.Return<string, PasswordVaultError> {
  const { directory, target, signal } = options;
  const path = managedCliPath(directory, target);
  const installed = yield* vaultCall(() => stat(path)).pipe(
    Effect.map((entry) => entry.isFile()),
    Effect.orElseSucceed(() => false),
  );
  if (installed) return path;
  const failed = sourceText("error.connector.bitwardenCliInstallFailed");
  const destination = join(directory, BITWARDEN_CLI_VERSION);
  const staging = join(directory, `.staging-${randomBytes(6).toString("hex")}`);
  const archive = `${staging}.zip`;
  yield* vaultCall(() => mkdir(directory, { recursive: true }));
  return yield* Effect.gen(function* () {
    const digest = yield* vaultCall((interrupted) =>
      downloadArchive({
        url: archiveUrl(target),
        archive,
        failed,
        signal: AbortSignal.any([signal, interrupted]),
        fetch: (input, init) => fetch(input, init),
      }),
    );
    if (digest !== ARCHIVES[target].sha256) return yield* new PasswordVaultError({ cause: new Error(failed) });
    const executable = executableName(target);
    yield* vaultCall(() => mkdir(staging));
    yield* extractZipFiles(archive, staging, [executable], failed).pipe(
      Effect.mapError(({ cause }) => new PasswordVaultError({ cause })),
    );
    yield* vaultCall(async () => {
      await chmod(join(staging, executable), 0o755);
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
    });
    return path;
  }).pipe(
    Effect.ensuring(
      vaultCall(async () => {
        await rm(archive, { force: true });
        await rm(staging, { recursive: true, force: true });
      }).pipe(Effect.ignore),
    ),
  );
});
