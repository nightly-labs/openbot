import { type ChildProcess, execFile } from "node:child_process";
import { Effect, Fiber, Schema } from "effect";

/**
 * Stops a process and every process it started, and waits for it to exit. Windows has no process
 * group: a `.cmd` command runs under `cmd.exe`, and a kill of the wrapper leaves the real program
 * running. `taskkill /T` stops the whole tree while the wrapper still holds it.
 */
class ProcessTreeFailed extends Schema.TaggedError<ProcessTreeFailed>()("ProcessTreeFailed", {
  cause: Schema.Defect(),
}) {}

export const stopWindowsProcessTree = Effect.fn("WindowsProcessTree.stop")(function* (child: ChildProcess) {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = yield* Effect.forkChild(
    Effect.callback<void>((resume) => {
      const onExit = () => {
        child.off("exit", onExit);
        resume(Effect.void);
      };
      child.once("exit", onExit);
      return Effect.sync(() => child.off("exit", onExit));
    }),
    { startImmediately: true },
  );
  yield* Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve) =>
        execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve()),
      ),
    catch: (cause) => new ProcessTreeFailed({ cause }),
  });
  yield* Effect.try({
    try: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
    catch: (cause) => new ProcessTreeFailed({ cause }),
  });
  yield* Fiber.join(exited);
}, Effect.uninterruptible);

/**
 * Stops a process that may run under `cmd.exe`, such as a sign-in through a `.cmd` launcher, and
 * does not wait for it. Elsewhere SIGTERM goes to the process itself.
 */
export const stopProcessTree = Effect.fn("ProcessTree.stop")(function* (child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") yield* stopWindowsProcessTree(child);
  else yield* Effect.try({ try: () => child.kill("SIGTERM"), catch: (cause) => new ProcessTreeFailed({ cause }) });
});
