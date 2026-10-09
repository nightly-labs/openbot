import { chmod, copyFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { parseMuseVersion, parsePiVersion } from "../backend/cli";
import { sha256File } from "../backend/file-hash";
import { assertSafeArchive, extractArchive, extractZipTree, rejectNonRegularFiles } from "./provider-runtime-archive";
import type { ProviderRuntimeDescriptor, ProviderStageContext } from "./provider-runtime-descriptors";
import { ProviderRuntimeFailure, runtimeIO } from "./provider-runtime-effects";

/** Native provider archives share staging and verification, not their wire protocols. */
export function nativeProviderRuntime(runtime: "pi" | "muse"): ProviderRuntimeDescriptor {
  return {
    runtime,
    spec: (target, lock) => {
      const provider = lock[runtime];
      const artifact = provider.artifacts[target];
      return {
        runtime,
        target,
        source: "lock",
        version: provider.version,
        packageVersion: provider.version,
        url: artifact.url,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    stage: Effect.fn("NativeProvider.stage")(function* ({ spec, downloadedPath, staging }: ProviderStageContext) {
      const message = sourceText("error.provider.nativeArchiveInvalid");
      if (runtime === "muse") {
        yield* runtimeIO(() => mkdir(join(staging, "bin"), { recursive: true }));
        yield* runtimeIO(() => copyFile(downloadedPath, join(staging, "bin", spec.executableName)));
      } else {
        if (spec.target === "win32-x64") {
          yield* runtimeIO(() => mkdir(join(staging, "bin"), { recursive: true }));
          yield* extractZipTree(downloadedPath, join(staging, "bin"), "", message);
        } else {
          yield* assertSafeArchive(downloadedPath, ["pi"], message);
          yield* extractArchive(downloadedPath, staging);
        }
        if (spec.target !== "win32-x64") {
          yield* rejectNonRegularFiles(join(staging, "pi"));
          yield* runtimeIO(() => rename(join(staging, "pi"), join(staging, "bin")));
        }
      }
      if (spec.target !== "win32-x64") yield* runtimeIO(() => chmod(join(staging, "bin", spec.executableName), 0o755));
    }),
    verify: Effect.fn("NativeProvider.verify")(function* (root, spec, lock) {
      for (const [path, expected] of Object.entries(lock[runtime].artifacts[spec.target].files)) {
        const actual = yield* sha256File(join(root, path)).pipe(
          Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
        );
        if (actual !== expected)
          return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeChecksum")) });
      }
    }),
    parseVersion: runtime === "pi" ? parsePiVersion : parseMuseVersion,
  };
}
