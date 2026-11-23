import { type ChildProcess, type ExecFileException, execFile } from "node:child_process";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Fiber, Schema } from "effect";

class ProcessTreeFailed extends Schema.TaggedError<ProcessTreeFailed>()("ProcessTreeFailed", {
  cause: Schema.Defect(),
}) {}

const logger = createOpenBotLogger("windows-process-tree");

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

export const endProcessTree = Effect.fn("ProcessTree.end")(function* (child: ChildProcess) {
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

export const stopProcessTree = Effect.fn("ProcessTree.stop")(function* (child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") yield* stopWindowsProcessTree(child);
  else yield* Effect.try({ try: () => child.kill("SIGTERM"), catch: (cause) => new ProcessTreeFailed({ cause }) });
});
