import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Exit, Fiber, Option, Schema, Scope } from "effect";

const logger = createOpenBotLogger("user-files-bytes");

/** A new measurement at most each 10 minutes: `du` reads each file entry of the home folder. */
const MEASURE_INTERVAL_MS = 10 * 60_000;
/** The first request waits this long; after that it answers null and the next request gets the value. */
const FIRST_ANSWER_WAIT_MS = 15_000;
const DU_TIMEOUT_MS = 5 * 60_000;
/** Also the limit of stderr, which has one line for each folder of another user in `/tmp`. */
const DU_MAX_BUFFER = 4 * 1024 * 1024;
const TEMPORARY_FOLDERS = ["/tmp", "/var/tmp"];
/**
 * Docker keeps images and containers in its own folder, which the user cannot read, so `du` does not
 * see them. A boat sandbox has Docker; a VPS of the operator does not (docs/hosted-servers.md).
 */
const DOCKER_MARKERS = ["/var/lib/docker", "/run/docker.sock", "/var/run/docker.sock"];

class UserFilesBytesFailure extends Schema.TaggedError<UserFilesBytesFailure>()("UserFilesBytesFailure", {
  cause: Schema.Defect(),
}) {}

const statOrNull = (path: string) =>
  Effect.tryPromise({ try: () => stat(path), catch: (cause) => new UserFilesBytesFailure({ cause }) }).pipe(
    Effect.orElseSucceed(() => null),
  );

/**
 * The folders that hold the files of the user who runs OpenBot, on the disk of `dataRoot`: the home
 * folder and the temporary folders. Null on a machine with Docker. A folder on another disk, such as a
 * `/tmp` in memory, does not use this disk.
 */
const userFolders = Effect.fn("UserFilesBytes.folders")(function* (dataRoot: string, home: string) {
  for (const marker of DOCKER_MARKERS) if (yield* statOrNull(marker)) return null;
  const data = yield* statOrNull(dataRoot);
  if (!data) return null;
  const folders: string[] = [];
  for (const folder of [home, ...TEMPORARY_FOLDERS]) {
    const info = yield* statOrNull(folder);
    if (info?.isDirectory() && info.dev === data.dev) folders.push(folder);
  }
  return folders.length > 0 ? folders : null;
});

/** The last line of `du -c`: "<bytes>\ttotal". */
function duTotal(output: string): number | null {
  const match = /^(\d+)\ttotal$/mu.exec(output.trimEnd().split("\n").at(-1) ?? "");
  const bytes = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

/**
 * The disk bytes of `folders` together, with a hard link counted once. `du` exits with 1 when it
 * cannot read a folder of another user in `/tmp`; its total still counts each folder that it read.
 */
const diskUsage = (folders: readonly string[]) =>
  Effect.callback<number, UserFilesBytesFailure>((resume) => {
    const child = execFile(
      "nice",
      ["-n", "19", "du", "-s", "-x", "-c", "-B1", "--", ...folders],
      { encoding: "utf8", timeout: DU_TIMEOUT_MS, maxBuffer: DU_MAX_BUFFER },
      (error, stdout) => {
        const total = duTotal(stdout);
        resume(
          total !== null && (!error || typeof error.code === "number")
            ? Effect.succeed(total)
            : Effect.fail(new UserFilesBytesFailure({ cause: error ?? new Error("du wrote no total.") })),
        );
      },
    );
    return Effect.sync(() => {
      child.kill();
    });
  });

/**
 * The bytes that the files of the server's user use on the disk of the host data, for the plan storage
 * of a hosted server. The disk of a VPS is much larger than the plan, and its system part changes, so
 * the clients cannot count the user part from the free space alone.
 */
export class UserFilesBytes {
  readonly #dataRoot: string;
  readonly #home: string;
  readonly #now: () => number;
  readonly #scope = Scope.makeUnsafe();
  /**
   * `at` is the start of the measurement. `epoch` counts the deletes and clears before it started: a
   * delete during a measurement makes its value old.
   */
  #last: { at: number; epoch: number; bytes: number | null } | null = null;
  #running: { token: object; epoch: number; fiber: Fiber.Fiber<number | null> } | null = null;
  #epoch = 0;

  constructor(dataRoot: string, home: string, now: () => number = Date.now) {
    this.#dataRoot = dataRoot;
    this.#home = home;
    this.#now = now;
  }

  /**
   * The last value, and a new measurement in the background when it is old. The first read, and the
   * first read after `forget`, waits for the new value. Null when there is no value.
   */
  readonly read = Effect.fn("UserFilesBytes.read")(function* (this: UserFilesBytes) {
    const last = this.#last?.epoch === this.#epoch ? this.#last : null;
    if (last && this.#now() - last.at < MEASURE_INTERVAL_MS) return last.bytes;
    const running = this.#running?.epoch === this.#epoch ? this.#running.fiber : null;
    const fiber = running ?? (yield* this.#start());
    if (last) return last.bytes;
    return Option.getOrNull(yield* Fiber.join(fiber).pipe(Effect.timeoutOption(FIRST_ANSWER_WAIT_MS)));
  }).bind(this);

  /** After a delete or a clear: the next read waits for a measurement that starts after it. */
  forget(): void {
    this.#epoch += 1;
  }

  #start() {
    return Effect.gen({ self: this }, function* () {
      const at = this.#now();
      const epoch = this.#epoch;
      const token = {};
      let ended = false;
      const fiber = yield* userFolders(this.#dataRoot, this.#home).pipe(
        Effect.flatMap((folders) => (folders ? diskUsage(folders) : Effect.succeed(null))),
        Effect.catch((error) =>
          Effect.sync(() => {
            logger.warn("Could not measure the files of the server's user.", toLogValue(error.cause));
            return null;
          }),
        ),
        Effect.tap((bytes) =>
          Effect.sync(() => {
            const last = this.#last;
            if (!last || epoch > last.epoch || (epoch === last.epoch && at >= last.at))
              this.#last = { at, epoch, bytes };
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            ended = true;
            if (this.#running?.token === token) this.#running = null;
          }),
        ),
        Effect.forkIn(this.#scope),
      );
      // A fiber that ended before this line must not stay as the running measurement.
      if (!ended) this.#running = { token, epoch, fiber };
      return fiber;
    });
  }

  dispose() {
    return Scope.close(this.#scope, Exit.void);
  }
}
