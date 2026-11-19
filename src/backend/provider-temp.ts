import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, statfsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { causeHelpers } from "./effect-boundary";

const logger = createOpenBotLogger("provider-temp");

const PROVIDER_TEMP_FREE_BYTES = 1024 ** 3;

export interface ProviderTempOptions {
  root: string;
  provider: string;
  availableDiskBytes?: ((path: string) => number) | undefined;
}

export class ProviderTempDiskSpaceError extends Error {}

class ProviderTempIoError extends Schema.TaggedError<ProviderTempIoError>()("ProviderTempIoError", {
  cause: Schema.Defect(),
}) {}

const { io } = causeHelpers(ProviderTempIoError);

export function spawnWithProviderTemp<Child extends ChildProcess>(
  options: ProviderTempOptions | undefined,
  start: (env: Record<string, string>) => Child,
): Child {
  if (!options) return start({});
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  const available = (options.availableDiskBytes ?? freeDiskBytes)(options.root);
  if (available < PROVIDER_TEMP_FREE_BYTES)
    throw new ProviderTempDiskSpaceError(sourceText("error.provider.tempDiskSpace", { provider: options.provider }));
  const directory = mkdtempSync(join(options.root, "run-"));
  const dispose = () => void Effect.runFork(removeDirectory(directory));
  let child: Child;
  try {
    child = start({ TMP: directory, TEMP: directory, TMPDIR: directory });
  } catch (error) {
    dispose();
    throw error;
  }
  child.once("close", dispose);
  child.once("error", () => {
    if (child.pid === undefined) dispose();
  });
  return child;
}

export const sweepProviderTemp = Effect.fn("ProviderTemp.sweep")(function* (root: string) {
  for (const provider of yield* listFolder(root)) {
    for (const run of yield* listFolder(join(root, provider)))
      yield* Effect.forkDetach(removeDirectory(join(root, provider, run)));
  }
});

function listFolder(path: string): Effect.Effect<string[]> {
  return io(() => readdir(path)).pipe(Effect.orElseSucceed((): string[] => []));
}

const removeDirectory = Effect.fn("ProviderTemp.removeDirectory")(function* (directory: string) {
  yield* io(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })).pipe(
    Effect.catch((error) =>
      Effect.sync(() => logger.warn("A provider temporary folder was not removed.", toLogValue(error.cause))),
    ),
  );
});

function freeDiskBytes(path: string): number {
  const filesystem = statfsSync(path);
  return filesystem.bavail * filesystem.bsize;
}
