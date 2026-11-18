// Installs the Proton Pass CLI (`pass-cli`) into a folder that OpenBot owns. OpenBot runs the binary
// only; it does not include or change its code.

import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { causeHelpers } from "../../backend/effect-boundary";
import { downloadArchive } from "../onepassword-cli-installer";
import { extractZipFiles } from "../provider-runtime-archive";
import type { RuntimeTarget } from "../provider-runtime-descriptors";
import { PasswordManagerError, passwordManagerFailure } from "./driver";

const { io } = causeHelpers(PasswordManagerError);

/**
 * The release that the host installs. Each SHA-256 is pinned here, taken from the files that Proton
 * publishes for this version. A new release is a code change.
 */
const PROTON_PASS_CLI_VERSION = "2.7.0";

interface ReleaseFile {
  /** The file name at Proton. */
  name: string;
  /** The hash of the download. */
  sha256: string;
  /** The hash of each installed file, by name. The CLI runs only when all of them match. */
  installed: Readonly<Record<string, string>>;
}

/** On macOS and Linux, the file is the executable. On Windows, it is a zip with `pass-cli.exe` and its DLL. */
const FILES: Record<RuntimeTarget, ReleaseFile> = {
  "darwin-arm64": single("pass-cli-macos-aarch64", "f17222619b4c4c4112eccc3796edea4bc0e4a341dc8960f7bb4023782adcc4a1"),
  "darwin-x64": single("pass-cli-macos-x86_64", "1829f7ecef108df5e14f92081cf4a4412c0fdc5be2034f9ee85d1e6745a62322"),
  "linux-arm64": single("pass-cli-linux-aarch64", "93918d5621593cac88956854d0f52cbc43851dcd9c01840ffe48a88b3be84c6b"),
  "linux-x64": single("pass-cli-linux-x86_64", "fd933e76179a5a33b295853e9c6696e49e584fe2141b1aafc63a3d78c0791cdb"),
  "win32-x64": {
    name: "pass-cli-windows-x86_64.zip",
    sha256: "c752af109dbda98ad154dfcdb40e8e43f1a38bc37de224b6182647b625290bb7",
    installed: {
      "pass-cli.exe": "1a270d4a058e989ba481c4eb00cb541bb5f6fd2ea3bb81473de3f4061fd3ed77",
      "libcrypto-3-x64.dll": "88b1760db84d724cf5bc40be5dcbcd0a835e42c3ed239e397a61f73acabbf4c8",
    },
  },
};

/** A download that is the executable itself. */
function single(name: string, sha256: string): ReleaseFile {
  return { name, sha256, installed: { "pass-cli": sha256 } };
}

function executableName(target: RuntimeTarget): "pass-cli" | "pass-cli.exe" {
  return target === "win32-x64" ? "pass-cli.exe" : "pass-cli";
}

/** The SHA-256 of a file, or null when it cannot be read. */
function fileSha256(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", () => resolve(null));
  });
}

/** True when each installed file is there and has its pinned hash. */
async function installedFilesMatch(destination: string, release: ReleaseFile): Promise<boolean> {
  const checks = Object.entries(release.installed).map(
    async ([name, sha256]) => (await fileSha256(join(destination, name))) === sha256,
  );
  return (await Promise.all(checks)).every(Boolean);
}

function fileUrl(target: RuntimeTarget): string {
  return `https://proton.me/download/pass-cli/${PROTON_PASS_CLI_VERSION}/${FILES[target].name}`;
}

/**
 * The installed CLI when its files have their pinned hashes, or else a new install of the pinned
 * release: downloaded, checked against its hash, and put into `<directory>/<version>`. A failed or
 * stopped install leaves nothing in that folder.
 */
export const managedProtonPassCli = Effect.fn("ProtonPassCli.managed")(function* (options: {
  directory: string;
  target: RuntimeTarget;
  signal: AbortSignal;
  fetch?: typeof fetch;
}): Effect.fn.Return<string, PasswordManagerError> {
  const { directory, target, signal } = options;
  const executable = executableName(target);
  const destination = join(directory, PROTON_PASS_CLI_VERSION);
  const path = join(destination, executable);
  const release = FILES[target];
  if (yield* Effect.promise(() => installedFilesMatch(destination, release))) return path;
  const failed = sourceText("error.connector.protonPassCliInstallFailed");
  const zipped = release.name.endsWith(".zip");
  const staging = join(directory, `.staging-${randomBytes(6).toString("hex")}`);
  const download = `${staging}.download`;
  const request = options.fetch ?? fetch;
  yield* io(() => mkdir(directory, { recursive: true }));
  return yield* Effect.gen(function* () {
    const digest = yield* io((interrupted) =>
      downloadArchive({
        url: fileUrl(target),
        archive: download,
        failed,
        signal: AbortSignal.any([signal, interrupted]),
        fetch: (input, init) => request(input, init),
      }),
    );
    if (digest !== release.sha256) return yield* passwordManagerFailure(failed);
    yield* io(() => mkdir(staging));
    if (zipped) {
      yield* extractZipFiles(download, staging, Object.keys(release.installed), failed).pipe(
        Effect.mapError(({ cause }) => new PasswordManagerError({ cause })),
      );
    } else {
      yield* io(() => rename(download, join(staging, executable)));
    }
    if (!(yield* Effect.promise(() => installedFilesMatch(staging, release))))
      return yield* passwordManagerFailure(failed);
    yield* io(async () => {
      await chmod(join(staging, executable), 0o755);
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
    });
    return path;
  }).pipe(
    Effect.ensuring(
      io(async () => {
        await rm(download, { force: true });
        await rm(staging, { recursive: true, force: true });
      }).pipe(Effect.ignore),
    ),
  );
});
