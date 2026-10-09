import { spawn } from "node:child_process";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect } from "effect";
import { cliSpawnTarget } from "../backend/cli";
import { stopWindowsProcessTree } from "../backend/windows-process-tree";
import { ProviderRuntimeFailure, runtimeSync, toProviderRuntimeFailure } from "./provider-runtime-effects";

/** Owns the installer's process group until every cancellation cleanup step has finished. */
export const runRegistryInstaller = Effect.fn("AcpRegistry.runInstaller")(function* (
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) {
  const target = cliSpawnTarget(executable, args);
  const closed = Deferred.makeUnsafe<void>();
  const result = Deferred.makeUnsafe<void, ProviderRuntimeFailure>();
  return yield* Effect.acquireUseRelease(
    runtimeSync(() => {
      const child = spawn(target.command, target.args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: "ignore",
        windowsVerbatimArguments: target.windowsVerbatimArguments,
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      child.once("error", () =>
        Deferred.doneUnsafe(
          result,
          Effect.fail(
            new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryInstallFailed")) }),
          ),
        ),
      );
      child.once("close", (code) => {
        Deferred.doneUnsafe(closed, Effect.void);
        Deferred.doneUnsafe(
          result,
          code === 0
            ? Effect.void
            : Effect.fail(
                new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryInstallFailed")) }),
              ),
        );
      });
      return child;
    }),
    () =>
      Deferred.await(result).pipe(
        Effect.timeoutOrElse({
          duration: 300_000,
          orElse: () =>
            Effect.fail(
              new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryInstallFailed")) }),
            ),
        }),
      ),
    (child) =>
      Effect.gen(function* () {
        if (process.platform === "win32") {
          yield* stopWindowsProcessTree(child).pipe(toProviderRuntimeFailure, Effect.orDie);
          return;
        }
        const signal = (value: NodeJS.Signals) =>
          Effect.sync(() => {
            try {
              if (child.pid) process.kill(-child.pid, value);
            } catch {
              /* The owned group has already exited. */
            }
          });
        yield* signal("SIGTERM");
        yield* Deferred.await(closed).pipe(
          Effect.timeoutOrElse({
            duration: 2_000,
            orElse: () => signal("SIGKILL").pipe(Effect.andThen(Deferred.await(closed))),
          }),
        );
        yield* signal("SIGKILL");
      }),
  );
});
