import { type ChildProcess, type ExecFileException, execFile } from "node:child_process";
import { win32 } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Fiber, Schema } from "effect";

class ProcessTreeFailed extends Schema.TaggedError<ProcessTreeFailed>()("ProcessTreeFailed", {
  cause: Schema.Defect(),
}) {}

const logger = createOpenBotLogger("windows-process-tree");

const TASKKILL_PROCESS_NOT_FOUND_EXIT_CODE = 128;

const stoppingTrees = new WeakMap<ChildProcess, Deferred.Deferred<void, ProcessTreeFailed>>();

const taskkillTree = (pid: number) =>
  Effect.tryPromise({
    try: () =>
      new Promise<ExecFileException | null>((resolve) =>
        execFile(
          win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
          ["/pid", String(pid), "/T", "/F"],
          { windowsHide: true },
          (error) => resolve(error),
        ),
      ),
    catch: (cause) => new ProcessTreeFailed({ cause }),
  });

export const stopWindowsProcessTree = Effect.fn("WindowsProcessTree.stop")(function* (child: ChildProcess) {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const running = stoppingTrees.get(child);
  if (running) return yield* Deferred.await(running);
  const done = Deferred.makeUnsafe<void, ProcessTreeFailed>();
  stoppingTrees.set(child, done);
  yield* stopTree(child, pid).pipe(
    Effect.onExit((exit) =>
      Effect.andThen(
        Effect.sync(() => stoppingTrees.delete(child)),
        Deferred.done(done, exit),
      ),
    ),
  );
}, Effect.uninterruptible);

const stopTree = Effect.fn("WindowsProcessTree.stopTree")(function* (child: ChildProcess, pid: number) {
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
  if (
    failure &&
    failure.code !== TASKKILL_PROCESS_NOT_FOUND_EXIT_CODE &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
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
});

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
