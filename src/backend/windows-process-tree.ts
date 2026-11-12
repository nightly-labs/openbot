import { type ChildProcess, type ExecFileException, execFile } from "node:child_process";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Fiber, Schema } from "effect";

/**
 * Stops a process and every process it started, and waits for it to exit. Windows has no process
 * group: a `.cmd` command runs under `cmd.exe`, and a kill of the wrapper leaves the real program
 * running. `taskkill /T` stops the whole tree while the wrapper still holds it.
 */
class ProcessTreeFailed extends Schema.TaggedError<ProcessTreeFailed>()("ProcessTreeFailed", {
  cause: Schema.Defect(),
}) {}

const logger = createOpenBotLogger("windows-process-tree");

/** Runs `taskkill /T /F` on a tree. Its error, or null when it stopped each process of the tree. */
const taskkillTree = (pid: number) =>
  Effect.tryPromise({
    try: () =>
      new Promise<ExecFileException | null>((resolve) =>
        execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, (error) => resolve(error)),
      ),
    catch: (cause) => new ProcessTreeFailed({ cause }),
  });

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
  // A child that exits while `taskkill` walks the tree, or a refused child, makes it fail part-way.
  // A kill of the wrapper alone then leaves the rest of the tree with no parent, where no later
  // `taskkill` finds it (#6470). So it runs once more while the wrapper still holds the tree.
  const failure = yield* taskkillTree(pid);
  if (failure && child.exitCode === null && child.signalCode === null) {
    const again = yield* taskkillTree(pid);
    if (again && child.exitCode === null && child.signalCode === null)
      logger.warn("taskkill did not stop a process tree.", { pid, code: again.code ?? null });
  }
  yield* Effect.try({
    try: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
    catch: (cause) => new ProcessTreeFailed({ cause }),
  });
  yield* Fiber.join(exited);
}, Effect.uninterruptible);

/**
 * Ends a provider process and waits for it to exit. On Windows it stops the whole tree. Elsewhere it
 * sends SIGTERM, and SIGKILL when the process is still running after 2 seconds.
 */
export const endProcessTree = Effect.fn("ProcessTree.end")(function* (child: ChildProcess) {
  // A signal exit leaves `exitCode` null, and a failed spawn has no `pid` and may never emit `exit`.
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") return yield* stopWindowsProcessTree(child);
  yield* Effect.callback<void>((resume) => {
    const forceKill = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2_000);
    const exited = () => {
      clearTimeout(forceKill);
      resume(Effect.void);
    };
    child.once("exit", exited);
    child.kill("SIGTERM");
    return Effect.sync(() => {
      clearTimeout(forceKill);
      child.off("exit", exited);
    });
  });
});

/**
 * Stops a process that may run under `cmd.exe`, such as a sign-in through a `.cmd` launcher, and
 * does not wait for it. Elsewhere SIGTERM goes to the process itself.
 */
export const stopProcessTree = Effect.fn("ProcessTree.stop")(function* (child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") yield* stopWindowsProcessTree(child);
  else yield* Effect.try({ try: () => child.kill("SIGTERM"), catch: (cause) => new ProcessTreeFailed({ cause }) });
});
