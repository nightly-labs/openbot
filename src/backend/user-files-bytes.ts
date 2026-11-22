import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Exit, Fiber, Option, Schema, Scope } from "effect";

const logger = createOpenBotLogger("user-files-bytes");

const MEASURE_INTERVAL_MS = 10 * 60_000;
const FIRST_ANSWER_WAIT_MS = 15_000;
const DU_TIMEOUT_MS = 5 * 60_000;
const DU_MAX_BUFFER = 4 * 1024 * 1024;
const TEMPORARY_FOLDERS = ["/tmp", "/var/tmp"];
const DOCKER_MARKERS = ["/var/lib/docker", "/run/docker.sock", "/var/run/docker.sock"];

class UserFilesBytesFailure extends Schema.TaggedError<UserFilesBytesFailure>()("UserFilesBytesFailure", {
  cause: Schema.Defect(),
}) {}

const statOrNull = (path: string) =>
  Effect.tryPromise({ try: () => stat(path), catch: (cause) => new UserFilesBytesFailure({ cause }) }).pipe(
    Effect.orElseSucceed(() => null),
  );

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

function duTotal(output: string): number | null {
  const match = /^(\d+)\ttotal$/mu.exec(output.trimEnd().split("\n").at(-1) ?? "");
  const bytes = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

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

export class UserFilesBytes {
  readonly #dataRoot: string;
  readonly #home: string;
  readonly #now: () => number;
  readonly #scope = Scope.makeUnsafe();
  #last: { at: number; epoch: number; bytes: number | null } | null = null;
  #running: { token: object; epoch: number; fiber: Fiber.Fiber<number | null> } | null = null;
  #epoch = 0;

  constructor(dataRoot: string, home: string, now: () => number = Date.now) {
    this.#dataRoot = dataRoot;
    this.#home = home;
    this.#now = now;
  }

  readonly read = Effect.fn("UserFilesBytes.read")(function* (this: UserFilesBytes) {
    const last = this.#last?.epoch === this.#epoch ? this.#last : null;
    if (last && this.#now() - last.at < MEASURE_INTERVAL_MS) return last.bytes;
    const running = this.#running?.epoch === this.#epoch ? this.#running.fiber : null;
    const fiber = running ?? (yield* this.#start());
    if (last) return last.bytes;
    return Option.getOrNull(yield* Fiber.join(fiber).pipe(Effect.timeoutOption(FIRST_ANSWER_WAIT_MS)));
  }).bind(this);

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
      if (!ended) this.#running = { token, epoch, fiber };
      return fiber;
    });
  }

  dispose() {
    return Scope.close(this.#scope, Exit.void);
  }
}
