import { readFile, rm } from "node:fs/promises";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import { isEmptyStoredFile, parseStoredJson, setAsideDamagedFile, writeJsonFileAtomically } from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";

const logger = createOpenBotLogger("user-browsing");

/** A step that no memory review read is deleted after this time. */
export const USER_BROWSING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * The most steps kept for one agent, which is also the most that one memory review reads. The
 * oldest go first, so the log keeps no step that a review would not read.
 */
const STEPS_PER_AGENT = 80;
/** The most characters of each text of a step. */
export const USER_BROWSING_TEXT_CHARACTERS = 80;
const PATH_CHARACTERS = 120;

const Text = Schema.String.check(Schema.isMaxLength(PATH_CHARACTERS));
const StoredStep = Schema.Struct({
  at: Schema.Number,
  kind: Schema.Literals(["page", "click"]),
  host: Text,
  path: Text,
  title: Schema.optional(Text),
  role: Schema.optional(Text),
  name: Schema.optional(Text),
});

/**
 * One thing that a person did in a tab of an agent while they held it: a page that loaded, or a
 * click with the role and the name of what they clicked. It has no typed text, no query and no hash.
 */
export type UserBrowsingStep = typeof StoredStep.Type;

const StoredLog = Schema.Struct({
  version: Schema.Literal(1),
  agents: Schema.Array(Schema.Struct({ agentId: Schema.String, steps: Schema.Array(StoredStep) })),
});
type StoredLog = typeof StoredLog.Type;
const decodeStored = Schema.decodeUnknownSync(StoredLog);

class UserBrowsingReadFailed extends Schema.TaggedError<UserBrowsingReadFailed>()("UserBrowsingReadFailed", {
  cause: Schema.Defect(),
}) {}

/** `text` on one line, at most `limit` characters. */
export function stepText(text: string, limit = USER_BROWSING_TEXT_CHARACTERS): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/**
 * A path part that looks like a code, such as the token of a reset or an invitation link, or an id:
 * a hex or UUID value, a long mix of letters and digits that is not a hyphenated slug, or any long part.
 */
function isCodeSegment(segment: string): boolean {
  if (segment.length >= 32) return true;
  if (!/\d/u.test(segment)) return false;
  return (
    /^[0-9a-f-]{8,}$/iu.test(segment) || (segment.length >= 16 && /[a-z]/iu.test(segment) && !/[-.]/u.test(segment))
  );
}

/**
 * The host and the path of a web page, or null for any other URL. The query and the hash stay out,
 * and each path part that looks like a code becomes ":id".
 */
export function stepPlace(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
    const path = parsed.pathname
      .split("/")
      .map((segment) => (isCodeSegment(segment) ? ":id" : segment))
      .join("/");
    return { host: stepText(parsed.hostname, PATH_CHARACTERS), path: stepText(path, PATH_CHARACTERS) };
  } catch {
    return null;
  }
}

/**
 * Owns the file of what a person did in agent tabs that they held (takeover or Take control), while
 * the "Learn from my browsing" setting is on. Only the background memory review reads it, and it
 * deletes the steps it read. A step that no review read is deleted after 30 days. Turning the setting
 * off deletes the file. The steps are an aid, not data: a missing or damaged file starts empty.
 *
 * It stays on this computer. The memory review sends the redacted steps to the agent's provider.
 */
export class UserBrowsingLog {
  readonly #path: string;
  readonly #now: () => number;
  readonly #steps = new Map<string, UserBrowsingStep[]>();
  readonly #writes = Semaphore.makeUnsafe(1);
  #loaded = false;

  constructor(path: string, now: () => number = Date.now) {
    this.#path = path;
    this.#now = now;
  }

  /**
   * Reads the file once, and deletes the steps older than 30 days. The read holds the write permit,
   * so no write replaces the file first. Call it at start, so old steps go also when nothing records.
   */
  load(): Effect.Effect<void> {
    if (this.#loaded) return Effect.void;
    return this.#writes
      .withPermit(this.#read())
      .pipe(Effect.andThen(Effect.suspend(() => (this.#prune() ? this.#write() : Effect.void))));
  }

  readonly #read = Effect.fn("UserBrowsingLog.read")(function* (this: UserBrowsingLog) {
    if (this.#loaded) return;
    this.#loaded = true;
    const read = yield* Effect.result(
      Effect.tryPromise({
        try: () => readFile(this.#path, "utf8"),
        catch: (cause) => new UserBrowsingReadFailed({ cause }),
      }),
    );
    if (Result.isFailure(read)) {
      if (!isMissingFileError(read.failure.cause))
        logger.warn("Could not read the browsing steps.", { error: read.failure.cause });
      return;
    }
    if (isEmptyStoredFile(read.success)) return;
    const stored = yield* Effect.result(
      Effect.try({
        try: () => parseStoredJson(this.#path, read.success, decodeStored),
        catch: (cause) => new UserBrowsingReadFailed({ cause }),
      }),
    );
    if (Result.isFailure(stored)) {
      logger.warn("The browsing steps are damaged. They start empty.", { error: stored.failure.cause });
      yield* setAsideDamagedFile(this.#path);
      return;
    }
    for (const agent of stored.success.agents) this.#steps.set(agent.agentId, [...agent.steps]);
  }).bind(this);

  /** Adds one step. A page that is the same as the step before it is not added again. */
  record(agentId: string, step: Omit<UserBrowsingStep, "at">): Effect.Effect<void> {
    return this.#change(() => {
      const steps = this.#steps.get(agentId) ?? [];
      const last = steps.at(-1);
      if (step.kind === "page" && last?.kind === "page" && last.host === step.host && last.path === step.path) {
        if (step.title === undefined || last.title === step.title) return false;
        // A new time, so that a review that read the old title does not delete the new one.
        steps[steps.length - 1] = { ...last, title: step.title, at: this.#now() };
      } else steps.push({ ...step, at: this.#now() });
      this.#steps.set(agentId, steps.slice(-STEPS_PER_AGENT));
      return true;
    });
  }

  /** The newest steps of the agent that no review read, oldest first. */
  pending(agentId: string): Effect.Effect<readonly UserBrowsingStep[]> {
    return this.load().pipe(
      Effect.andThen(
        Effect.sync(() => {
          const since = this.#now() - USER_BROWSING_RETENTION_MS;
          return (this.#steps.get(agentId) ?? []).filter((step) => step.at > since);
        }),
      ),
    );
  }

  /** Deletes the steps of the agent up to `through`, after a review read them. */
  reviewed(agentId: string, through: number): Effect.Effect<void> {
    return this.#change(() => {
      const steps = this.#steps.get(agentId);
      if (!steps) return false;
      const kept = steps.filter((step) => step.at > through);
      if (kept.length === steps.length) return false;
      if (kept.length === 0) this.#steps.delete(agentId);
      else this.#steps.set(agentId, kept);
      return true;
    });
  }

  /** Deletes the steps of a deleted agent. */
  forgetAgent(agentId: string): Effect.Effect<void> {
    return this.#change(() => this.#steps.delete(agentId));
  }

  /** Deletes every step and the file, when the setting turns off. */
  clear(): Effect.Effect<void> {
    return this.load().pipe(
      Effect.andThen(
        this.#writes.withPermit(
          Effect.uninterruptible(
            Effect.suspend(() => {
              this.#steps.clear();
              return Effect.tryPromise(() => rm(this.#path, { force: true }));
            }),
          ),
        ),
      ),
      Effect.catch((failure) =>
        Effect.sync(() => logger.warn("Could not delete the browsing steps.", { error: failure })),
      ),
    );
  }

  /** Runs `change` after the load, prunes old steps, and writes the file when anything changed. */
  #change(change: () => boolean): Effect.Effect<void> {
    return this.load().pipe(
      Effect.andThen(
        Effect.suspend(() => {
          const changed = change();
          const pruned = this.#prune();
          return changed || pruned ? this.#write() : Effect.void;
        }),
      ),
    );
  }

  #prune(): boolean {
    const since = this.#now() - USER_BROWSING_RETENTION_MS;
    let changed = false;
    for (const [agentId, steps] of this.#steps) {
      const kept = steps.filter((step) => step.at > since);
      if (kept.length === steps.length) continue;
      changed = true;
      if (kept.length === 0) this.#steps.delete(agentId);
      else this.#steps.set(agentId, kept);
    }
    return changed;
  }

  /** Writes the current map. The last write in the queue wins. A write that started ends. */
  #write(): Effect.Effect<void> {
    return this.#writes
      .withPermit(
        Effect.uninterruptible(
          Effect.suspend(() => {
            const stored: StoredLog = {
              version: 1,
              agents: [...this.#steps].map(([agentId, steps]) => ({ agentId, steps })),
            };
            return writeJsonFileAtomically(this.#path, stored, { createDirectory: true });
          }),
        ),
      )
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() => logger.warn("Could not save the browsing steps.", { error: failure.cause })),
        ),
      );
  }
}
